-- ============================================================================
-- 2026-07-08 使用者拍板：經典模式紀錄榜從「永久佔位」改成「每週重置」，
-- 前三名週結算發鑽石（第1名30／第2名20／第3名10），避免有人卡住前三名之後
-- 就永遠不會再有新人有機會拿到。跟排行榜鑽石結算掛在同一支每晚台灣 00:00
-- 的排程（scripts/settleDailyRewards.ts 已呼叫 settle_classic_weekly()）。
--
-- 設計：classic_records 加 week_key（ISO 週別，跟 client weekKey()/現有
-- player_weekly_quest 用同一種格式 'IYYY-"W"IW'），複合主鍵改成
-- (level_id, player_id, week_key)，每次提交後裁到「該關該週」前 3 名。
-- settle_classic_weekly() 找出「已經結束的週」（week_key < 本週且還沒結算過，
-- 用 classic_diamond_settlement 當已結算清單防重複）逐關發鑽石。舊週的
-- classic_records 列不立刻刪，跟其他清理一樣掛在 cleanup_old_wallet_logs()
-- 的節奏上定期清（保留最近 2 週，讓剛結算完的上一週資料還能核對一下）。
--
-- 在 Supabase SQL Editor 執行一次即可（需先跑過 migration_20260706b.sql）。
-- ============================================================================

-- ── classic_records：加 week_key，複合主鍵改三欄 ────────────────────────────
alter table public.classic_records add column if not exists week_key text;
update public.classic_records
   set week_key = to_char((now() at time zone 'Asia/Taipei')::date, 'IYYY-"W"IW')
 where week_key is null;
alter table public.classic_records alter column week_key set not null;
alter table public.classic_records drop constraint if exists classic_records_pkey;
alter table public.classic_records add constraint classic_records_pkey primary key (level_id, player_id, week_key);

-- ── submit_classic_record()：改成寫入「本週」，裁剪範圍改成該關該週前 3 名 ──
drop function if exists public.submit_classic_record(text, text, int, int);
create or replace function public.submit_classic_record(
  p_level text,
  p_name  text,
  p_score int,
  p_time  int
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  text;
  v_week text := to_char((now() at time zone 'Asia/Taipei')::date, 'IYYY-"W"IW');
begin
  v_uid := auth.uid()::text;
  if v_uid is null then return; end if;                  -- 需登入
  if p_level is null or length(p_level) > 32 then return; end if;
  if p_score < 0    or p_score > 50000   then return; end if;
  if p_time  < 1000 or p_time  > 7200000 then return; end if;

  insert into public.classic_records
    (level_id, player_id, week_key, player_name, score, time_ms, updated_at)
  values (p_level, v_uid, v_week, left(p_name, 16), p_score, p_time, now())
  on conflict (level_id, player_id, week_key) do update
    set player_name = excluded.player_name,
        score       = excluded.score,
        time_ms     = excluded.time_ms,
        updated_at  = now()
    -- 只有「自己分數更高，或同分但時間更短」才覆蓋自己那筆
    where excluded.score > public.classic_records.score
       or (excluded.score = public.classic_records.score
           and excluded.time_ms < public.classic_records.time_ms);

  -- 裁剪：只保留該關「本週」前 3 名，其餘刪除（跨週的舊資料不動，等清理排程處理）
  delete from public.classic_records
   where level_id = p_level and week_key = v_week
     and player_id not in (
       select player_id from public.classic_records
        where level_id = p_level and week_key = v_week
        order by score desc, time_ms asc
        limit 3
     );
end;
$$;
grant execute on function public.submit_classic_record(text, text, int, int) to authenticated;

-- ── classic_diamond_settlement：週結算紀錄（防重複結算＋將來可做通知用）───
create table if not exists public.classic_diamond_settlement (
  player_id  text not null,
  level_id   text not null,
  week_key   text not null,
  rank       int  not null,
  diamonds   int  not null,
  settled_at timestamptz not null default now(),
  primary key (player_id, level_id, week_key)
);
alter table public.classic_diamond_settlement enable row level security;
revoke all on table public.classic_diamond_settlement from public, anon, authenticated;

-- ── settle_classic_weekly()：只有 service_role 能呼叫，找出「已結束但還沒結算」
--    的週別逐關發鑽石。用 classic_diamond_settlement 是否已有該 week_key 的紀錄
--    判斷是否結算過，天天跑也安全（沒有新週結束時單純找不到東西可結算）。
create or replace function public.settle_classic_weekly()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_week text := to_char((now() at time zone 'Asia/Taipei')::date, 'IYYY-"W"IW');
  w record;
  r record;
  v_bonus int;
begin
  for w in
    select distinct week_key from public.classic_records
     where week_key < v_current_week
       and week_key not in (select distinct week_key from public.classic_diamond_settlement)
  loop
    for r in
      select level_id, player_id,
             row_number() over (partition by level_id order by score desc, time_ms asc) as rn
        from public.classic_records
       where week_key = w.week_key
    loop
      if r.rn > 3 then continue; end if;
      v_bonus := case r.rn when 1 then 30 when 2 then 20 when 3 then 10 else 0 end;
      continue when v_bonus <= 0;

      insert into public.classic_diamond_settlement (player_id, level_id, week_key, rank, diamonds)
      values (r.player_id, r.level_id, w.week_key, r.rn, v_bonus)
      on conflict (player_id, level_id, week_key) do nothing;

      if found then
        insert into public.player_wallet (player_id) values (r.player_id) on conflict (player_id) do nothing;
        update public.player_wallet set diamonds = diamonds + v_bonus, updated_at = now()
         where player_id = r.player_id;
      end if;
    end loop;
  end loop;
end;
$$;
revoke execute on function public.settle_classic_weekly() from public, anon, authenticated;

-- ── cleanup_old_wallet_logs()：順便清舊週的經典紀錄（留最近 2 週）+ 60 天前結算紀錄──
create or replace function public.cleanup_old_wallet_logs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.wallet_earn_log where earn_date < current_date - interval '14 days';
  delete from public.wallet_daily_attempts where challenge_date < current_date - interval '14 days';
  delete from public.player_weekly_quest
   where week_key < to_char(current_date - interval '8 weeks', 'IYYY-"W"IW');
  delete from public.daily_diamond_settlement where challenge_date < current_date - interval '14 days';
  delete from public.classic_records
   where week_key < to_char(current_date - interval '2 weeks', 'IYYY-"W"IW');
  delete from public.classic_diamond_settlement where settled_at < now() - interval '60 days';
end;
$$;
revoke execute on function public.cleanup_old_wallet_logs() from public, anon, authenticated;
