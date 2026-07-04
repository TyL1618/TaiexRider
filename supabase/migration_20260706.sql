-- ============================================================
-- TaiexRider migration 2026-07-06 — 帳號相關資料全面搬進資料庫
-- 背景：2026-07-05 晚發現「同裝置切換 Google 帳號」會互相污染——暱稱
--       （taiex_player_name）、Q 系列成就進度（tr_achv_market）、連續參賽
--       streak（tr_daily_streak）皆為純 localStorage、不分帳號、登出也不清，
--       導致舊帳號的本地資料被新登入的帳號誤讀甚至誤寫回伺服器
--       （Garage.tsx 偵測到本地「已達標」會自動呼叫 wallet_unlock_achievement
--       RPC，把 Q 車款寫進「目前登入帳號」的真實擁有清單——已發生於
--       tommyisboy08@gmail.com，2026-07-05 手動 SQL 清除)。
--       金幣/鑽石/擁有清單其實已經是 DB 權威（migration_20260705.sql），
--       這份補齊剩下兩塊：① 暱稱 ② 成就/streak，做法比照錢包——
--       DB 是唯一真相，localStorage 只當「上次同步下來的顯示快取」。
-- 用法：Supabase Dashboard → SQL Editor → 全選貼上 → Run（可重複跑）。
-- ⚠️ push 不會更新 DB，一定要手動跑這份，否則新 RPC 不存在、客戶端會
--    fallback（暱稱/成就/streak 維持舊的純本地行為，不影響遊戲能不能玩，
--    但污染問題不會被修好）。
-- ============================================================

-- ── ① 暱稱：get_player_name()，讓客戶端登入時能「拉」自己的暱稱 ──────────
-- 現有 user_profiles 只有「本地→DB」的 upsert（updateProfileName），沒有反向
-- 讀取。改用 security definer RPC 而非直接開 user_profiles 的 select RLS，
-- 避免猜錯既有 policy 現況、多一層保險（bypass RLS，只回傳呼叫者自己那列）。
create or replace function public.get_player_name()
returns text
language sql
security definer
set search_path = public
as $$
  select player_name from public.user_profiles where player_id = auth.uid()::text;
$$;
revoke execute on function public.get_player_name() from public, anon;
grant  execute on function public.get_player_name() to authenticated;

-- ── ② player_achievements：Q1/Q2 大漲/大跌日完賽累計次數（伺服器權威）───────
create table if not exists public.player_achievements (
  player_id     text primary key,
  bull_finishes int not null default 0 check (bull_finishes >= 0),
  bear_finishes int not null default 0 check (bear_finishes >= 0),
  updated_at    timestamptz not null default now()
);
alter table public.player_achievements enable row level security;
revoke all on table public.player_achievements from public, anon, authenticated;

-- ── ③ player_streak：連續參賽天數（伺服器權威，取代 tr_daily_streak）──────
-- last_session_key 直接存 date（= daily_map map_date / 前端 sessionKey 對應日），
-- 算天數差用 date 相減即為整數，比原本前端 daysBetween() 字串解析更單純。
create table if not exists public.player_streak (
  player_id        text primary key,
  last_session_key date,
  streak_count     int not null default 0 check (streak_count >= 0),
  updated_at       timestamptz not null default now()
);
alter table public.player_streak enable row level security;
revoke all on table public.player_streak from public, anon, authenticated;

-- ── record_market_finish()：完賽時呼叫，伺服器自己查當期 TAIEX 漲跌 ──────
-- 不信任客戶端傳的 mood 字串（原本 recordFinish(mood) 完全由前端算+前端寫），
-- 直接在 RPC 內重算今日 TAIEX mood（邏輯同 src/lib/marketMood.ts，±1% 門檻），
-- 杜絕「開 devtools 直接打 unlock RPC / 偽造 mood 灌次數」的路。
drop function if exists public.record_market_finish();
create or replace function public.record_market_finish()
returns table(bull_finishes int, bear_finishes int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     text := auth.uid()::text;
  v_today   date := coalesce(
    (select max(map_date) from public.daily_map
       where map_date <= (now() at time zone 'Asia/Taipei')::date),
    (now() at time zone 'Asia/Taipei')::date
  );
  v_prices  jsonb;
  v_first   numeric;
  v_last    numeric;
  v_change  numeric;
begin
  if v_uid is null then return; end if;

  select prices into v_prices from public.daily_map
    where map_date = v_today and stock_code = 'TAIEX';

  insert into public.player_achievements (player_id) values (v_uid)
    on conflict (player_id) do nothing;

  if v_prices is not null and jsonb_array_length(v_prices) >= 2 then
    v_first := (v_prices ->> 0)::numeric;
    v_last  := (v_prices ->> (jsonb_array_length(v_prices) - 1))::numeric;
    if v_first > 0 then
      v_change := (v_last - v_first) / v_first;
      if v_change > 0.01 then
        update public.player_achievements
           set bull_finishes = bull_finishes + 1, updated_at = now()
         where player_id = v_uid;
      elsif v_change < -0.01 then
        update public.player_achievements
           set bear_finishes = bear_finishes + 1, updated_at = now()
         where player_id = v_uid;
      end if;
    end if;
  end if;

  return query
    select a.bull_finishes, a.bear_finishes
      from public.player_achievements a where a.player_id = v_uid;
end;
$$;
revoke execute on function public.record_market_finish() from public, anon;
grant  execute on function public.record_market_finish() to authenticated;

-- ── consume_attempt()：改回傳 table(ok, streak)，同一次呼叫順便更新 streak ──
-- 原本只回 boolean。streak 判定邏輯搬自 src/lib/streak.ts recordStreak()：
-- 同期重複呼叫不重複累計；與上期相差 1~5 天視為連續（+1）；否則重置為 1。
-- 這支 RPC 本來就在「進入每日排名賽」當下呼叫（DailyChallenge.tsx handleStart），
-- 跟原本 recordStreak() 呼叫時機完全對齊，不需要另外新增呼叫點。
drop function if exists public.consume_attempt();
create or replace function public.consume_attempt()
returns table(ok boolean, streak_count int, last_session_key date)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   text := auth.uid()::text;
  v_today date := coalesce(
    (select max(map_date) from public.daily_map
       where map_date <= (now() at time zone 'Asia/Taipei')::date),
    (now() at time zone 'Asia/Taipei')::date
  );
  v_n       int;
  v_last    date;
  v_count   int;
  v_diff    int;
  v_streak  int;
begin
  if v_uid is null then return query select true, 0, null::date; return; end if;

  insert into public.wallet_daily_attempts as a (player_id, challenge_date, attempts)
  values (v_uid, v_today, 1)
  on conflict (player_id, challenge_date) do update set attempts = a.attempts + 1
  returning attempts into v_n;

  insert into public.player_streak (player_id) values (v_uid)
    on conflict (player_id) do nothing;

  select last_session_key, streak_count into v_last, v_count
    from public.player_streak where player_id = v_uid;

  if v_last is null then
    v_streak := 1;
  elsif v_last = v_today then
    v_streak := v_count; -- 同期重複玩（今天已消耗過次數）不重複累計
  else
    v_diff := v_today - v_last;
    v_streak := (case when v_diff > 0 and v_diff <= 5 then v_count + 1 else 1 end);
  end if;

  update public.player_streak
     set last_session_key = v_today, streak_count = v_streak, updated_at = now()
   where player_id = v_uid;

  return query select (v_n <= 5), v_streak, v_today;
end;
$$;
revoke execute on function public.consume_attempt() from public, anon;
grant  execute on function public.consume_attempt() to authenticated;

-- ── wallet_get()：一併帶回成就/streak 原始狀態（沿用同一支「登入時整包同步」RPC）──
-- 刻意回傳「原始」last_session_key + streak_count（不在 SQL 內做衰減判斷），
-- 讓客戶端沿用既有 src/lib/streak.ts 的 getStreak()/daysBetween() 衰減邏輯
-- 處理顯示——同一份判斷邏輯只寫一次，未登入(本地)/已登入(DB 同步下來的快取)
-- 走同一套讀取函式，不用在 SQL 和前端各維護一份「>5 天算斷」規則。
drop function if exists public.wallet_get();
create or replace function public.wallet_get()
returns table(
  coins int, diamonds int, owned jsonb,
  bull_finishes int, bear_finishes int,
  streak_count int, last_session_key date
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

  return query
    select w.coins, w.diamonds, w.owned,
           a.bull_finishes, a.bear_finishes,
           s.streak_count, s.last_session_key
      from public.player_wallet w
      join public.player_achievements a on a.player_id = w.player_id
      join public.player_streak s on s.player_id = w.player_id
     where w.player_id = v_uid;
end;
$$;
revoke execute on function public.wallet_get() from public, anon;
grant  execute on function public.wallet_get() to authenticated;

-- ── wallet_unlock_achievement()：改成伺服器自行驗證門檻，不再信任客戶端宣稱 ──
-- 這是這次修復的核心：v1（migration_20260705.sql）只要客戶端說「達標了」就給，
-- 這正是 tommyisboy08 被誤解鎖的路徑（Garage.tsx 讀到裝置上另一帳號留下的
-- 假進度，判斷「已達標」就打了這支 RPC）。v2 改成 RPC 自己查
-- player_achievements/player_streak 是否真的達標，客戶端傳的 skin_id 只是
-- 「想解鎖哪一個」，達不達標由伺服器說了算。
drop function if exists public.wallet_unlock_achievement(text);
create or replace function public.wallet_unlock_achievement(p_skin_id text)
returns table(owned jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     text := auth.uid()::text;
  v_owned   jsonb;
  v_bull    int;
  v_bear    int;
  v_streak  int;
  v_eligible boolean := false;
begin
  if v_uid is null then return; end if;
  if p_skin_id not in ('q1-bull', 'q2-bear', 'q3-phoenix') then return; end if;

  insert into public.player_wallet (player_id) values (v_uid) on conflict (player_id) do nothing;
  insert into public.player_achievements (player_id) values (v_uid) on conflict (player_id) do nothing;
  insert into public.player_streak (player_id) values (v_uid) on conflict (player_id) do nothing;

  select bull_finishes, bear_finishes into v_bull, v_bear
    from public.player_achievements where player_id = v_uid;
  select streak_count into v_streak from public.player_streak where player_id = v_uid;

  v_eligible := (p_skin_id = 'q1-bull'    and v_bull    >= 10)
             or (p_skin_id = 'q2-bear'    and v_bear    >= 10)
             or (p_skin_id = 'q3-phoenix' and v_streak  >= 30);

  select w.owned into v_owned from public.player_wallet w where w.player_id = v_uid for update;

  if v_eligible and not (v_owned ? p_skin_id) then
    v_owned := v_owned || jsonb_build_array(p_skin_id);
    update public.player_wallet set owned = v_owned, updated_at = now() where player_id = v_uid;
  end if;

  return query select v_owned;
end;
$$;
revoke execute on function public.wallet_unlock_achievement(text) from public, anon;
grant  execute on function public.wallet_unlock_achievement(text) to authenticated;

-- ── wallet_dev_grant()：開發者測試帳號一併灌成就/streak 到門檻值 ──────────
-- 取代原本前端 devSetProgress()/devForceStreak() 直接寫 localStorage 的做法
-- （那正是「純本地、不分帳號」問題的源頭之一）。JWT email 綁定同原設計。
drop function if exists public.wallet_dev_grant();
create or replace function public.wallet_dev_grant()
returns table(coins int, diamonds int, bull_finishes int, bear_finishes int, streak_count int, last_session_key date)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   text := auth.uid()::text;
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_today date := coalesce(
    (select max(map_date) from public.daily_map
       where map_date <= (now() at time zone 'Asia/Taipei')::date),
    (now() at time zone 'Asia/Taipei')::date
  );
begin
  if v_uid is null then return; end if;
  if v_email <> 'tyl161803@gmail.com' then return; end if;

  insert into public.player_wallet (player_id) values (v_uid) on conflict (player_id) do nothing;
  insert into public.player_achievements (player_id) values (v_uid) on conflict (player_id) do nothing;
  insert into public.player_streak (player_id) values (v_uid) on conflict (player_id) do nothing;

  update public.player_wallet
     set coins = 99999, diamonds = 99999, updated_at = now()
   where player_id = v_uid;

  update public.player_achievements
     set bull_finishes = 10, bear_finishes = 10, updated_at = now()
   where player_id = v_uid;

  update public.player_streak
     set last_session_key = v_today, streak_count = 30, updated_at = now()
   where player_id = v_uid;

  return query
    select w.coins, w.diamonds, a.bull_finishes, a.bear_finishes, s.streak_count, s.last_session_key
      from public.player_wallet w, public.player_achievements a, public.player_streak s
     where w.player_id = v_uid and a.player_id = v_uid and s.player_id = v_uid;
end;
$$;
revoke execute on function public.wallet_dev_grant() from public, anon;
grant  execute on function public.wallet_dev_grant() to authenticated;

-- player_achievements/player_streak 是每人一列的累計狀態（非按日 log），
-- 不需要像 wallet_earn_log/wallet_daily_attempts 那樣按天過期清理。
