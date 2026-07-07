-- ============================================================================
-- 2026-07-08 使用者拍板：排行榜（每日挑戰）不再給金幣，改給鑽石——
--   參與獎：前一期只要玩過（wallet_daily_attempts.attempts > 0）就 +3 鑽石。
--   名次獎：前一期最終排名疊加：第1名+80／第2名+50／第3~4名+20／第5~10名+10。
--   兩者可疊加（有玩又上榜＝參與3+名次獎）。每晚台灣 00:00 由 GitHub Actions
--   （scripts/settleDailyRewards.ts）呼叫 settle_daily_diamonds()，只有 service_role
--   能呼叫（跟 cleanup_old_scores_if_needed 同一套收權模式）。
--
-- 「前一期」不是單純「今天-1」，是仿 submit_daily_score 的 v_today 算法：用
-- daily_map.map_date 找出「目前這一期 session」，再往前一筆找出「上一期 session」。
-- 這樣連假整段沿用同一張榜時，不會在連假第二晚就把還沒打完的榜提早結算——
-- 只有真的出現新一期（新交易日收盤資料進來）當晚才會把前一期結算掉。結算表用
-- (player_id, challenge_date) 當主鍵防重複發放，連假期間這支排程重跑多次也安全
-- （沒有新一期出現時，v_prev_session 不會變，重複跑只會撞到已存在的列，不會重複加鑽石）。
--
-- 在 Supabase SQL Editor 執行一次即可（需先跑過 migration_20260705.sql 建立
-- player_wallet/wallet_daily_attempts，以及 schema.sql 建立 daily_scores）。
-- ============================================================================

create table if not exists public.daily_diamond_settlement (
  player_id      text not null,
  challenge_date date not null,
  diamonds       int  not null,
  rank           int,                       -- null = 只有參與獎、沒有上前十名
  acked          boolean not null default false, -- 玩家端是否已看過彈窗
  settled_at     timestamptz not null default now(),
  primary key (player_id, challenge_date)
);
alter table public.daily_diamond_settlement enable row level security;
revoke all on table public.daily_diamond_settlement from public, anon, authenticated;

-- ── settle_daily_diamonds()：只有 service_role 能呼叫（GitHub Actions 帶 service key）──
create or replace function public.settle_daily_diamonds()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today_session date;
  v_prev_session  date;
  r record;
  v_bonus int;
begin
  -- 跟 submit_daily_score 的 v_today 同一套算法：daily_map 中 ≤ 台灣今天的 max(map_date)。
  v_today_session := coalesce(
    (select max(map_date) from public.daily_map
       where map_date <= (now() at time zone 'Asia/Taipei')::date),
    (now() at time zone 'Asia/Taipei')::date
  );
  -- 「上一期」＝比目前這一期更早的最後一個 map_date。連假整段 v_today_session 不變時，
  -- v_prev_session 也跟著不變，不會提早把還在進行中的榜結算掉。
  v_prev_session := (select max(map_date) from public.daily_map where map_date < v_today_session);
  if v_prev_session is null then return; end if; -- 還沒有前一期可結算（剛部署/DB 無資料）

  for r in
    select coalesce(p.player_id, s.player_id) as player_id,
           (p.player_id is not null) as participated,
           s.rn as rank
      from (
        select player_id from public.wallet_daily_attempts
         where challenge_date = v_prev_session and attempts > 0
      ) p
      full outer join (
        select player_id, row_number() over (order by score desc, time_ms asc) as rn
          from public.daily_scores where challenge_date = v_prev_session
      ) s on s.player_id = p.player_id
  loop
    v_bonus := case
      when r.rank = 1 then 80
      when r.rank = 2 then 50
      when r.rank between 3 and 4 then 20
      when r.rank between 5 and 10 then 10
      else 0
    end;
    if r.participated then v_bonus := v_bonus + 3; end if;
    continue when v_bonus <= 0;

    insert into public.daily_diamond_settlement (player_id, challenge_date, diamonds, rank)
    values (r.player_id, v_prev_session, v_bonus, r.rank)
    on conflict (player_id, challenge_date) do nothing;

    if found then -- 真的新插入（沒撞到 conflict）才加鑽石，連假重跑不會重複發放
      insert into public.player_wallet (player_id) values (r.player_id) on conflict (player_id) do nothing;
      update public.player_wallet set diamonds = diamonds + v_bonus, updated_at = now()
       where player_id = r.player_id;
    end if;
  end loop;
end;
$$;
revoke execute on function public.settle_daily_diamonds() from public, anon, authenticated;

-- ── get_pending_daily_settlement()：玩家端查詢「還沒看過的前一期結算結果」───
create or replace function public.get_pending_daily_settlement()
returns table(challenge_date date, diamonds int, rank int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then return; end if;
  return query select s.challenge_date, s.diamonds, s.rank
    from public.daily_diamond_settlement s
   where s.player_id = v_uid and s.acked = false
   order by s.challenge_date desc
   limit 1;
end;
$$;
revoke execute on function public.get_pending_daily_settlement() from public, anon;
grant  execute on function public.get_pending_daily_settlement() to authenticated;

-- ── ack_daily_settlement()：玩家看過彈窗後呼叫，標記已讀不再跳 ──────────────
create or replace function public.ack_daily_settlement(p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then return; end if;
  update public.daily_diamond_settlement
     set acked = true
   where player_id = v_uid and challenge_date = p_date;
end;
$$;
revoke execute on function public.ack_daily_settlement(date) from public, anon;
grant  execute on function public.ack_daily_settlement(date) to authenticated;

-- ── cleanup_old_wallet_logs()：順便清 14 天前的結算紀錄（跟 wallet_earn_log 同節奏）──
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
end;
$$;
revoke execute on function public.cleanup_old_wallet_logs() from public, anon, authenticated;
