-- ============================================================================
-- 2026-07-06 批次五：狂暴盤日事件 + 股票圖鑑 + 週任務 + 經典模式前三名
-- 使用者已點頭 schema（見對話紀錄 / NEXT_BATCH_PLAN.md 批次 5）：
--   ① 狂暴盤門檻 2.5%（實測 TAIEX 2 年資料，約兩週一次，比原提案 2% 更稀有）
--   ② 股票圖鑑：每人一列存已收集代號陣列（text[]），天生封頂在股票池總數（~1090），
--      不會隨玩家數爆炸；不清除（永久收藏）。
--   ③ 週任務：每人每週一列存累計數據，仿 wallet_earn_log 保留最近 8 週即可清除。
--   ④ 經典模式：從「每關 1 位保持者」改成「每關前 3 名，同玩家更新覆蓋不佔位」，
--      表大小恆定＝關卡數 × 3，不隨玩家數增長。
-- 在 Supabase SQL Editor 執行一次即可。
-- ============================================================================

-- ── ① taiex_change_pct()：共用的「當期 TAIEX 漲跌幅」計算（供狂暴盤判定重用，
--     邏輯抽出自 record_market_finish()，避免每個要用到的 RPC 各寫一份） ──────
create or replace function public.taiex_change_pct()
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today  date := coalesce(
    (select max(map_date) from public.daily_map
       where map_date <= (now() at time zone 'Asia/Taipei')::date),
    (now() at time zone 'Asia/Taipei')::date
  );
  v_prices jsonb;
  v_first  numeric;
  v_last   numeric;
begin
  select prices into v_prices from public.daily_map
    where map_date = v_today and stock_code = 'TAIEX';
  if v_prices is null or jsonb_array_length(v_prices) < 2 then return null; end if;
  v_first := (v_prices ->> 0)::numeric;
  v_last  := (v_prices ->> (jsonb_array_length(v_prices) - 1))::numeric;
  if v_first <= 0 then return null; end if;
  return (v_last - v_first) / v_first;
end;
$$;
revoke execute on function public.taiex_change_pct() from public, anon;
grant  execute on function public.taiex_change_pct() to authenticated;

-- ── ② wallet_earn()：狂暴盤日（|漲跌|≥2.5%）任務獎勵 ×2 ─────────────────
-- 只對 kind='quest' 加倍（每日任務用這個 kind），finish/crash/ad 面額不受影響。
-- 伺服器自己算漲跌，不信任客戶端傳的狀態，杜絕偽造狂暴盤騙雙倍幣。
drop function if exists public.wallet_earn(text);
create or replace function public.wallet_earn(p_kind text)
returns table(coins int, diamonds int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    text := auth.uid()::text;
  v_amount int;
  v_cap    int;
  v_today  date := (now() at time zone 'Asia/Taipei')::date;
  v_n      int;
  v_change numeric;
begin
  if v_uid is null then return; end if;

  case p_kind
    when 'finish' then v_amount := 10; v_cap := 30;
    when 'crash'  then v_amount := 3;  v_cap := 30;
    when 'quest'  then v_amount := 25; v_cap := 3;
    when 'ad'     then v_amount := 20; v_cap := 2;
    else return; -- 未知 kind 靜默拒絕
  end case;

  if p_kind = 'quest' then
    v_change := public.taiex_change_pct();
    if v_change is not null and abs(v_change) >= 0.025 then
      v_amount := v_amount * 2;
    end if;
  end if;

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  insert into public.wallet_earn_log as l (player_id, earn_date, kind, n)
  values (v_uid, v_today, p_kind, 1)
  on conflict (player_id, earn_date, kind) do update set n = l.n + 1
  returning n into v_n;
  if v_n > v_cap then
    return query select w.coins, w.diamonds from public.player_wallet w where w.player_id = v_uid;
    return;
  end if;

  update public.player_wallet
     set coins = coins + v_amount, updated_at = now()
   where player_id = v_uid;

  return query select w.coins, w.diamonds from public.player_wallet w where w.player_id = v_uid;
end;
$$;
revoke execute on function public.wallet_earn(text) from public, anon;
grant  execute on function public.wallet_earn(text) to authenticated;

-- ── ③ 股票圖鑑：player_collection（每人一列存已收集代號陣列，天生封頂在股票池
--     總數，不會隨玩家數爆炸，永久保留不清除）───────────────────────────
create table if not exists public.player_collection (
  player_id  text primary key,
  codes      text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.player_collection enable row level security;
revoke all on table public.player_collection from public, anon, authenticated;

-- 收集股票（自選/長征模式開局或完賽時呼叫）：已收集過就不重複加，回傳最新清單。
create or replace function public.collect_stock(p_code text)
returns table(codes text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then return; end if;
  if p_code is null or length(p_code) = 0 or length(p_code) > 12 then return; end if;

  insert into public.player_collection (player_id, codes)
  values (v_uid, array[p_code])
  on conflict (player_id) do update
    set codes = case
          when p_code = any(public.player_collection.codes) then public.player_collection.codes
          else public.player_collection.codes || array[p_code]
        end,
        updated_at = now();

  return query select pc.codes from public.player_collection pc where pc.player_id = v_uid;
end;
$$;
revoke execute on function public.collect_stock(text) from public, anon;
grant  execute on function public.collect_stock(text) to authenticated;

-- wallet_get() 一併帶回收集清單，沿用既有「登入時整包同步」呼叫點（garage.ts
-- syncWalletFromServer()），不需要新增一個同步呼叫點。
drop function if exists public.wallet_get();
create or replace function public.wallet_get()
returns table(
  coins int, diamonds int, owned jsonb,
  bull_finishes int, bear_finishes int,
  streak_count int, last_session_key date,
  collection text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then return; end if;

  insert into public.player_wallet (player_id) values (v_uid) on conflict (player_id) do nothing;
  insert into public.player_achievements (player_id) values (v_uid) on conflict (player_id) do nothing;
  insert into public.player_streak (player_id) values (v_uid) on conflict (player_id) do nothing;
  insert into public.player_collection (player_id) values (v_uid) on conflict (player_id) do nothing;

  return query
    select w.coins, w.diamonds, w.owned,
           a.bull_finishes, a.bear_finishes,
           s.streak_count, s.last_session_key,
           c.codes
      from public.player_wallet w
      join public.player_achievements a on a.player_id = w.player_id
      join public.player_streak s on s.player_id = w.player_id
      join public.player_collection c on c.player_id = w.player_id
     where w.player_id = v_uid;
end;
$$;
revoke execute on function public.wallet_get() from public, anon;
grant  execute on function public.wallet_get() to authenticated;

-- ── ④ 週任務：player_weekly_quest（每人每週一列存累計數據＋已領獎清單）───
create table if not exists public.player_weekly_quest (
  player_id       text not null,
  week_key        text not null,       -- ISO 週別，如 '2026-W27'
  perfect_sum     int not null default 0,
  flips_sum       int not null default 0,
  max_score       int not null default 0,
  max_survive_sec numeric not null default 0,
  play_count      int not null default 0,
  claimed         text[] not null default '{}',
  updated_at      timestamptz not null default now(),
  primary key (player_id, week_key)
);
alter table public.player_weekly_quest enable row level security;
revoke all on table public.player_weekly_quest from public, anon, authenticated;

-- 讀取目前本週進度（畫面掛載時呼叫，不累加任何數據，只確保有列存在）。
create or replace function public.get_weekly_quest(p_week text)
returns table(perfect_sum int, flips_sum int, max_score int, max_survive_sec numeric, play_count int, claimed text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then return; end if;
  insert into public.player_weekly_quest (player_id, week_key) values (v_uid, p_week)
    on conflict (player_id, week_key) do nothing;
  return query select q.perfect_sum, q.flips_sum, q.max_score, q.max_survive_sec, q.play_count, q.claimed
    from public.player_weekly_quest q where q.player_id = v_uid and q.week_key = p_week;
end;
$$;
revoke execute on function public.get_weekly_quest(text) from public, anon;
grant  execute on function public.get_weekly_quest(text) to authenticated;

-- 每局結束呼叫：累加本週數據，回傳最新進度（前端依此算出「這一局新完成」的任務）。
create or replace function public.record_weekly_run(
  p_week text, p_score int, p_flips int, p_perfect int, p_time_ms int
) returns table(perfect_sum int, flips_sum int, max_score int, max_survive_sec numeric, play_count int, claimed text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then return; end if;

  insert into public.player_weekly_quest
    (player_id, week_key, perfect_sum, flips_sum, max_score, max_survive_sec, play_count)
  values (
    v_uid, p_week, greatest(p_perfect, 0), greatest(p_flips, 0), greatest(p_score, 0),
    greatest(p_time_ms, 0) / 1000.0, 1
  )
  on conflict (player_id, week_key) do update
    set perfect_sum     = player_weekly_quest.perfect_sum + greatest(p_perfect, 0),
        flips_sum       = player_weekly_quest.flips_sum + greatest(p_flips, 0),
        max_score       = greatest(player_weekly_quest.max_score, p_score),
        max_survive_sec = greatest(player_weekly_quest.max_survive_sec, greatest(p_time_ms, 0) / 1000.0),
        play_count      = player_weekly_quest.play_count + 1,
        updated_at      = now();

  return query select q.perfect_sum, q.flips_sum, q.max_score, q.max_survive_sec, q.play_count, q.claimed
    from public.player_weekly_quest q where q.player_id = v_uid and q.week_key = p_week;
end;
$$;
revoke execute on function public.record_weekly_run(text,int,int,int,int) from public, anon;
grant  execute on function public.record_weekly_run(text,int,int,int,int) to authenticated;

-- 領獎（前端判斷任務已達標且未領過才呼叫）：伺服器自行驗證面額＋是否重複領獎，
-- 狂暴盤日（|漲跌|≥2.5%）獎勵 ×2，跟 wallet_earn('quest') 用同一套判定。
create or replace function public.claim_weekly_quest(p_week text, p_quest_id text)
returns table(coins int, ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     text := auth.uid()::text;
  v_reward  int;
  v_change  numeric;
  v_claimed text[];
begin
  if v_uid is null then return; end if;

  case p_quest_id
    when 'w_flips30'    then v_reward := 40;
    when 'w_perfect10'  then v_reward := 40;
    when 'w_score2000'  then v_reward := 40;
    when 'w_play10'     then v_reward := 35;
    when 'w_survive25'  then v_reward := 35;
    else
      return query select w.coins, false from public.player_wallet w where w.player_id = v_uid;
      return;
  end case;

  insert into public.player_weekly_quest (player_id, week_key) values (v_uid, p_week)
    on conflict (player_id, week_key) do nothing;

  select claimed into v_claimed from public.player_weekly_quest
    where player_id = v_uid and week_key = p_week;

  if v_claimed is not null and p_quest_id = any(v_claimed) then
    return query select w.coins, false from public.player_wallet w where w.player_id = v_uid;
    return;
  end if;

  v_change := public.taiex_change_pct();
  if v_change is not null and abs(v_change) >= 0.025 then
    v_reward := v_reward * 2;
  end if;

  update public.player_weekly_quest
     set claimed = claimed || array[p_quest_id], updated_at = now()
   where player_id = v_uid and week_key = p_week;

  insert into public.player_wallet (player_id) values (v_uid) on conflict (player_id) do nothing;
  update public.player_wallet set coins = coins + v_reward, updated_at = now() where player_id = v_uid;

  return query select w.coins, true from public.player_wallet w where w.player_id = v_uid;
end;
$$;
revoke execute on function public.claim_weekly_quest(text,text) from public, anon;
grant  execute on function public.claim_weekly_quest(text,text) to authenticated;

-- ── ⑤ 清理擴充：player_weekly_quest 只留最近 8 週（掛在既有清理節奏上，
--     CI fetchDailyMap.ts 已在呼叫 cleanup_old_wallet_logs，不需要新增呼叫點）──
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
end;
$$;
revoke execute on function public.cleanup_old_wallet_logs() from public, anon, authenticated;

-- ── ⑥ 經典模式改「每關前 3 名」：(level_id, player_id) 複合主鍵，
--     同玩家進步時更新覆蓋（不重複佔位），每次提交後裁剪到前 3 名，
--     表大小恆定＝關卡數 × 3（目前 12 關＝36 列上限），不隨玩家數增長 ──
alter table public.classic_records drop constraint if exists classic_records_pkey;
alter table public.classic_records add constraint classic_records_pkey primary key (level_id, player_id);

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
  v_uid text;
begin
  v_uid := auth.uid()::text;
  if v_uid is null then return; end if;                  -- 需登入
  if p_level is null or length(p_level) > 32 then return; end if;
  if p_score < 0    or p_score > 50000   then return; end if;
  if p_time  < 1000 or p_time  > 7200000 then return; end if;

  insert into public.classic_records
    (level_id, player_id, player_name, score, time_ms, updated_at)
  values (p_level, v_uid, left(p_name, 16), p_score, p_time, now())
  on conflict (level_id, player_id) do update
    set player_name = excluded.player_name,
        score       = excluded.score,
        time_ms     = excluded.time_ms,
        updated_at  = now()
    -- 只有「自己分數更高，或同分但時間更短」才覆蓋自己那筆
    where excluded.score > public.classic_records.score
       or (excluded.score = public.classic_records.score
           and excluded.time_ms < public.classic_records.time_ms);

  -- 裁剪：只保留該關前 3 名，其餘刪除
  delete from public.classic_records
   where level_id = p_level
     and player_id not in (
       select player_id from public.classic_records
        where level_id = p_level
        order by score desc, time_ms asc
        limit 3
     );
end;
$$;

grant execute on function public.submit_classic_record(text, text, int, int) to authenticated;
