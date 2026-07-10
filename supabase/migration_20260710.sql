-- ============================================================================
-- 2026-07-10：每日次數「以伺服器為準」+ wallet_earn 回報有沒有真的發錢
--
-- ── 為什麼要這個 migration ──────────────────────────────────────────────────
-- 真機實測（TWA→Capacitor 更新後）發現：前端的「今日看廣告次數 / 排名賽挑戰次數」
-- 只存在 localStorage，跟伺服器的 wallet_earn_log / wallet_daily_attempts 各記各的、
-- 從不對帳。只要 localStorage 被清掉（清除資料、重裝、或這次換殼導致 web origin
-- 從 https://taiexrider.pages.dev 變成 https://localhost），前端計數就歸零，玩家
-- 會看到「還能再看 2 次廣告」的按鈕。
--
-- ⚠️ 這**不是**經濟漏洞：wallet_earn 的每日上限、consume_attempt 的 5 次上限都在
-- 伺服器端硬性把關，清資料刷不出額外金幣/場次。真正的問題是**體驗**：玩家看完
-- 30 秒廣告卻什麼都沒拿到（金幣數字閃一下就被伺服器權威值蓋回去），而且沒有任何提示。
-- 實測證據：某帳號 wallet_earn_log(kind='ad').n = 4，但上限是 2 → 第 3、4 次白看。
--
-- ── 這個 migration 做兩件事 ────────────────────────────────────────────────
-- ① wallet_daily_usage()：讓前端進車庫/排行榜時能拿到「伺服器認定的今日已用次數」，
--    覆蓋本地計數，清了資料也會立刻同步回真實次數。
-- ② wallet_earn() 加一個 granted 輸出欄位：明確告訴前端「這次到底有沒有加到錢」，
--    前端才能顯示「今日已達領取上限」而不是靜默把數字捲回去。
--
-- ⚠️ 42702 踩雷提醒（見 CLAUDE.md）：`returns table(...)` 的輸出欄位在 PL/pgSQL 裡是
-- 隱含變數，跟資料表欄位撞名會讓整支函式歧義炸掉（且前端慣例靜默吞錯，玩家只是
-- 「安靜拿不到錢」）。因此：
--   - wallet_earn 的 UPDATE/SELECT 一律加資料表名/別名前綴。
--   - wallet_daily_usage 的輸出欄位刻意命名為 attempts_used（不叫 attempts），
--     避開 wallet_daily_attempts.attempts 撞名的地雷。
--
-- 執行方式：Supabase Dashboard → SQL Editor 貼上整份執行（push 不會自動生效）。
-- ============================================================================

-- ── ① wallet_daily_usage()：回傳伺服器認定的「今日已用次數」──────────────────
-- ad_claims    ：看廣告拿金幣（wallet_earn_log.kind='ad'），按**台灣日曆日**計，
--                跟 wallet_earn 裡的 v_today 同一套（不是 session date）。
-- attempts_used：每日排名賽挑戰次數（wallet_daily_attempts），按 **session date**
--                計（＝daily_map 中 ≤ 台灣今天的 max(map_date)，連假整段同一期），
--                跟 consume_attempt() 的 v_today 同一套算法，兩邊必須一致。
create or replace function public.wallet_daily_usage()
returns table(ad_claims int, attempts_used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     text := auth.uid()::text;
  v_cal_day date := (now() at time zone 'Asia/Taipei')::date;
  v_session date := coalesce(
    (select max(m.map_date) from public.daily_map m
      where m.map_date <= (now() at time zone 'Asia/Taipei')::date),
    (now() at time zone 'Asia/Taipei')::date
  );
begin
  if v_uid is null then return; end if; -- 訪客：回空集合，前端 fallback 純本地計數

  return query
    select
      coalesce((select l.n from public.wallet_earn_log l
                 where l.player_id = v_uid and l.earn_date = v_cal_day and l.kind = 'ad'), 0)::int,
      coalesce((select a.attempts from public.wallet_daily_attempts a
                 where a.player_id = v_uid and a.challenge_date = v_session), 0)::int;
end;
$$;
revoke execute on function public.wallet_daily_usage() from public, anon;
grant  execute on function public.wallet_daily_usage() to authenticated;

-- ── ② wallet_earn()：加上 granted 輸出欄位 ──────────────────────────────────
-- 回傳型別改變，必須先 drop 再建（create or replace 不能改 return type）。
-- 順便清掉 2026-07-08 之前殘留的舊單參數重載 wallet_earn(text)：它從沒被 drop 過，
-- 跟 wallet_earn(text,int) 在 DB 裡並存，PostgREST 有選錯候選函式的風險。
drop function if exists public.wallet_earn(text);
drop function if exists public.wallet_earn(text, int);

create or replace function public.wallet_earn(p_kind text, p_amount int default null)
returns table(coins int, diamonds int, granted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      text := auth.uid()::text;
  v_amount   int;
  v_cap      int;
  v_log_kind text;
  v_step     int;
  v_today    date := (now() at time zone 'Asia/Taipei')::date;
  v_n        int;
  v_change   numeric;
begin
  if v_uid is null then return; end if;

  case p_kind
    when 'finish'      then v_amount := 5;  v_log_kind := 'play';  v_step := 5;  v_cap := 100;
    when 'crash'       then v_amount := 2;  v_log_kind := 'play';  v_step := 2;  v_cap := 100;
    when 'long_finish' then v_amount := 30; v_log_kind := 'play';  v_step := 30; v_cap := 100;
    when 'long_crash'  then
      v_amount   := greatest(0, least(30, coalesce(p_amount, 0))); -- 不信任前端，clamp 在 0~30
      v_log_kind := 'play';
      v_step     := v_amount;
      v_cap      := 100;
    when 'quest'  then v_amount := 25; v_log_kind := 'quest'; v_step := 1;  v_cap := 3;
    when 'ad'     then v_amount := 40; v_log_kind := 'ad';    v_step := 1;  v_cap := 2;
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
  values (v_uid, v_today, v_log_kind, v_step)
  on conflict (player_id, earn_date, kind) do update set n = l.n + v_step
  returning n into v_n;

  -- 超過每日上限：不加錢，granted=false 讓前端能明確告訴玩家「今日已達上限」，
  -- 不要再靜默把樂觀更新的數字捲回去（玩家會以為是 bug 或被吃錢）。
  if v_n > v_cap then
    return query select w.coins, w.diamonds, false from public.player_wallet w where w.player_id = v_uid;
    return;
  end if;

  update public.player_wallet
     set coins = player_wallet.coins + v_amount, updated_at = now()
   where player_wallet.player_id = v_uid;

  return query select w.coins, w.diamonds, true from public.player_wallet w where w.player_id = v_uid;
end;
$$;
revoke execute on function public.wallet_earn(text, int) from public, anon;
grant  execute on function public.wallet_earn(text, int) to authenticated;

-- ── 驗收（跑完貼回結果確認）────────────────────────────────────────────────
--   select * from public.wallet_daily_usage();   -- 用玩家 JWT 呼叫才有意義（Dashboard 是 postgres 角色會回空）
--   select proname, pg_get_function_identity_arguments(oid)
--     from pg_proc where proname in ('wallet_earn','wallet_daily_usage');
--   -- 預期只剩 wallet_earn(text, integer) 一個重載，不應該再看到 wallet_earn(text)
