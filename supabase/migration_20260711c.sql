-- ============================================================================
-- 2026-07-11c：submit_daily_score 綁定「今天必須消耗過至少一次挑戰次數」
--（反作弊 Phase A 補洞——排行榜提交跟每日次數限制脫鉤的漏洞）
--
-- ── 為什麼 ─────────────────────────────────────────────────────────────────
-- 舊版 submit_daily_score 只驗物理一致性（分數/時間/翻轉比例）+ 10 秒提交冷卻，
-- **完全不檢查這個玩家今天有沒有真的消耗過排名賽次數**（次數把關是 consume_attempt()
-- 這支完全獨立的 RPC，UI 上是「按開始鍵時」才呼叫，兩支函式互不知道對方）。
-- 任何登入者可以繞過 UI，直接每 10 秒打一次 submit_daily_score，完全不用先呼叫
-- consume_attempt()，物理驗證範圍內（例如 60 秒/120 圈翻轉/兩萬多分）都會被收下。
--
-- 這個洞的嚴重性不只是「排行榜公平性」：**每日排行榜名次直接發鑽石**（第1名 +80、
-- 前十都有，見 migration_20260708c.sql settle_daily_diamonds()），鑽石是真錢購買的
-- 付費貨幣（NT$30~290）。假分數霸榜 = 每天免費印鑽石，等於在印付費貨幣。
--
-- ── 修法 ───────────────────────────────────────────────────────────────────
-- 提交前多一道查詢：wallet_daily_attempts 裡這個玩家「這一期」(v_today，跟本函式
-- 既有的 session 算法同源) 的 attempts 必須 ≥ 1，否則靜默拒絕（沒消耗過次數，
-- 不可能有分數要交）。這不是完整的反作弊（沒有做到「提交次數 ≤ 消耗次數」的
-- 逐筆對帳，那個留給 ANTICHEAT Phase B 全套處理），但直接堵掉「完全沒碰過遊玩
-- 流程、純打 API 洗榜」這種最基本的腳本攻擊面，成本是一行 SQL 查詢。
--
-- 其餘所有既有檢查（A1~A5：冷卻/分數上限/完美落地上限/翻轉比例/時間下限）原封
-- 不動，逐字照抄 migration_20260704.sql 現行版本，只新增這一道 [A9] 檢查。
--
-- 執行方式：Supabase Dashboard → SQL Editor 貼上整份執行一次（push 不會自動生效）。
-- 驗收：用完全沒點過「開始挑戰」的登入帳號直接打
--   POST /rest/v1/rpc/submit_daily_score {p_name,p_score,p_time,p_flips,p_perfect}
-- 應該靜默不寫入（daily_scores 查不到這筆）；正常玩過一場再提交應正常上榜。
-- ============================================================================

create or replace function public.submit_daily_score(
  p_name    text,
  p_score   int,
  p_time    int,
  p_flips   int default 0,
  p_perfect int default 0
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_today date := coalesce(
    (select max(map_date) from public.daily_map
       where map_date <= (now() at time zone 'Asia/Taipei')::date),
    (now() at time zone 'Asia/Taipei')::date
  );
  v_slack   constant int     := 500;
  v_speed   constant numeric := 414.72;
  v_last    timestamptz;
  v_len     int;
  v_full_ms numeric;
  v_ratio   numeric;
  v_attempts int;
begin
  v_uid := auth.uid()::text;
  if v_uid is null then return; end if;

  -- 單欄位範圍驗證（既有）
  if p_score  < 0      or p_score  > 50000   then return; end if;
  if p_time   < 1000   or p_time   > 7200000 then return; end if;
  if p_flips  < 0      or p_flips  > 50      then return; end if;
  if p_perfect < 0     or p_perfect > 50     then return; end if;

  -- [A9] 🔒 新增：這一期必須消耗過至少一次排名賽次數才可能有分數要交
  -- （wallet_daily_attempts.challenge_date 與本函式 v_today 同一套 session 算法，
  -- 見 consume_attempt() migration_20260710b.sql，兩者恆同源可直接查）。
  select attempts into v_attempts from public.wallet_daily_attempts
   where player_id = v_uid and challenge_date = v_today;
  if coalesce(v_attempts, 0) < 1 then return; end if;

  -- [A1] 提交冷卻：同 uid 距上次「成功寫入」< 10s 靜默拒絕
  select created_at into v_last from public.daily_scores
   where challenge_date = v_today and player_id = v_uid;
  if v_last is not null and now() - v_last < interval '10 seconds' then return; end if;

  -- [A2] 分數上限：行進 1000 + 完美翻轉 200/圈 + 舊制 slack
  if p_score > 1000 + 200 * p_flips + v_slack then return; end if;

  -- [A3] 完美落地不可能多於翻轉（每次完美至少記 1 圈）
  if p_perfect > p_flips + 3 then return; end if;

  -- [A4] 翻轉/時間比：物理極限 ≈ 1.9 圈/s → 2 圈/s + 3 緩衝
  if p_flips > ceil(p_time / 1000.0) * 2 + 3 then return; end if;

  -- [A5] 時間下限：分數隱含「至少跑了多遠」→ 至少要花多少時間
  select jsonb_array_length(prices) into v_len
    from public.daily_map where map_date = v_today
   order by difficulty desc limit 1;
  if v_len is not null then
    v_full_ms := (v_len + 4) * 80 / v_speed * 1000;
    v_ratio := least(1.0, greatest(0.0, (p_score - 200 * p_flips - v_slack) / 1000.0));
    if p_time < v_ratio * v_full_ms * 0.9 then return; end if;
  end if;

  insert into public.daily_scores
    (challenge_date, player_id, player_name, score, time_ms, flips, perfect)
  values (v_today, v_uid, left(p_name, 16), p_score, p_time, p_flips, p_perfect)
  on conflict (challenge_date, player_id) do update
    set score       = excluded.score,
        time_ms     = excluded.time_ms,
        flips       = excluded.flips,
        perfect     = excluded.perfect,
        player_name = excluded.player_name,
        created_at  = now()
    where excluded.score > public.daily_scores.score
       or (excluded.score = public.daily_scores.score
           and excluded.time_ms < public.daily_scores.time_ms);
end;
$$;

revoke execute on function public.submit_daily_score(text, int, int, int, int) from public, anon;
grant  execute on function public.submit_daily_score(text, int, int, int, int) to authenticated;
