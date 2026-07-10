-- ============================================================================
-- 2026-07-10b：修 consume_attempt() 的 42702 撞名 bug（伺服器次數上限失效）
--
-- ── 問題 ──────────────────────────────────────────────────────────────────
-- 回家後真機實測發現：不管玩幾場排名賽，畫面都卡在 1/5，且第 3~5 次的看廣告解鎖
-- 從未真正觸發。查 Supabase：public.wallet_daily_attempts 今天完全沒有任何一筆
-- 紀錄——consume_attempt() 從沒真的寫入成功過。
--
-- 根因（跟 CLAUDE.md 記錄過的 42702 撞名地雷同一類、這次是 SELECT INTO 而非
-- UPDATE）：這支函式 `returns table(ok boolean, streak_count int,
-- last_session_key date)`，PL/pgSQL 會把 streak_count / last_session_key 當成
-- 隱含輸出變數；原本這段：
--   select last_session_key, streak_count into v_last, v_count
--     from public.player_streak where player_id = v_uid;
-- 沒加資料表別名，跟 player_streak 表裡同名欄位完全歧義 → 42702 → 整支函式
-- rollback。前端 consumeAttemptServer() 呼叫失敗是 fail-open 設計（見
-- challengeAttempts.ts），錯誤只印 console、照樣放行遊戲，玩家/開發者完全看不出
-- 伺服器那邊其實一直沒寫入——這才是「怎麼玩都卡 1/5」的真正原因。
--
-- ── 修法 ──────────────────────────────────────────────────────────────────
-- SELECT INTO 那行加上表別名 ps.，其餘邏輯不動。
--
-- 執行方式：Supabase Dashboard → SQL Editor 貼上整份執行（push 不會自動生效）。
-- ============================================================================

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

  -- 修法：加 ps. 別名，避免跟輸出參數 last_session_key/streak_count 撞名（42702）。
  select ps.last_session_key, ps.streak_count into v_last, v_count
    from public.player_streak ps where ps.player_id = v_uid;

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

-- ── 驗證方式（跑完上面之後，登入任一帳號真的玩一場排名賽，再回 SQL Editor 查）──
--   select * from public.wallet_daily_attempts
--     where challenge_date = (select coalesce(max(map_date), (now() at time zone 'Asia/Taipei')::date)
--                              from public.daily_map
--                              where map_date <= (now() at time zone 'Asia/Taipei')::date);
--   應該要看到剛剛那個帳號多一筆 attempts=1（或原本次數+1）的紀錄。
