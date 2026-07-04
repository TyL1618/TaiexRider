-- ============================================================
-- TaiexRider migration 2026-07-04（Fable 5）— 反作弊 Phase A
-- 內容：submit_daily_score / submit_classic_record 加「欄位間物理一致性驗證」+ 提交冷卻
--       （ANTICHEAT_DESIGN.md 第一層 + 第二層冷卻項，純 SQL、不動客戶端）
-- 用法：Supabase Dashboard → SQL Editor → 全選貼上 → Run（跑一次即可，可重複跑）。
-- ⚠️ push 不會更新 DB，一定要手動跑這份，否則 RPC 仍是舊版（無反作弊）。
--
-- 上線前已用線上真實資料回測（2026-07-04，27 筆 daily + 12 筆 classic）：0 誤殺。
-- 與 ANTICHEAT_DESIGN.md 原公式的三處刻意偏差（照抄會誤殺 16/27 筆真實成績）：
--   1. 分數上限加 slack +500：v0.12.14（2026-07-03）前的舊計分制（perfect 不累計 flips、
--      翻轉分遞增制）產生的成績會超過 1000+200f；尚未更新的舊 PWA 客戶端仍可能提交舊制分數。
--      → 待 v0.12.14 全面普及（建議一週後）可把 SLACK 改 0 重跑本檔收緊。
--   2. 時間下限不能假設「完賽」：摔車也會提交（App.handleGameOver 不分 finished），
--      時間短+分數低是合法組合 → 改用「分數隱含的最低行進比例」推時間下限。
--   3. 冷卻 30s → 10s：實測完賽時間中位數僅 17s，跑完→重開→再跑完的合法循環可 < 30s，
--      30s 會誤殺連續進步的正常玩家；10s 照樣讓腳本狂打失效（寫入頻率上限 6 次/分）。
-- 另補：經典關卡 level_id 白名單（順帶修掉「任意字串塞新列」的資料污染面）。
-- 所有拒絕一律靜默 return（不回錯誤，不給攻擊者線索），與既有風格一致。
-- ============================================================

-- ── ① submit_daily_score：物理一致性 + 10s 冷卻 ───────────────────
-- 計分現實（v0.12.14 線性制，對照 src/game/constants.ts / GameCanvas.settleFlip）：
--   行進分 ≤ 1000（distScore 封頂）；翻轉每圈 +100；完美落地＝該趟翻轉分 ×2 且 flips 至少 +1
--   → score ≤ 1000 + 200×flips；perfect ≤ flips（恆成立，+3 容忍浮點/舊制邊角）。
--   翻轉極速：airSpinMax 0.192 rad/step × 60 = 11.52 rad/s，0.85 圈即進位
--   → 理論上限 ≈ 1.9 圈/s（文件寫 1.5 偏緊，實測玩家最高 0.66）→ 用 2圈/s + 3 緩衝。
--   地圖幾何：賽道距離 = (len(prices)+4)×80 px（+7 頭尾平台 −1 頂點柵欄 −2 起點段），
--   谷底平台插入只會加長 → 用它當保守下界。極速 = cruiseSpeed 6.912×60 = 414.72 px/s。
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
  -- challenge_date = daily_map 中 map_date ≤ 台灣今天（日曆日）的「最大」值，與前端 resolveSessionDate 同源。
  -- 上界用「今天」(非 +1)：map_date = sessionDate+1 已內建「00:00 才生效」，週末/連假整段沿用最後交易日那張榜，
  -- 隔天交易日盤抓到後在 00:00 才換新榜。DB 無 map_date 時 fallback 台灣日曆日。
  v_today date := coalesce(
    (select max(map_date) from public.daily_map
       where map_date <= (now() at time zone 'Asia/Taipei')::date),
    (now() at time zone 'Asia/Taipei')::date
  );
  v_slack   constant int     := 500;    -- 舊計分制容忍（v0.12.14 普及後可改 0 收緊）
  v_speed   constant numeric := 414.72; -- cruiseSpeed 極速 px/s
  v_last    timestamptz;
  v_len     int;      -- 當日挑戰圖（最難一張）prices 資料點數
  v_full_ms numeric;  -- 全圖理論最短完賽毫秒
  v_ratio   numeric;  -- 分數隱含的最低行進比例（摔車提交 ratio 低 → 時間要求低，不誤殺）
begin
  -- 必須是已登入用戶（Google OAuth），anon 靜默拒絕
  v_uid := auth.uid()::text;
  if v_uid is null then return; end if;

  -- 單欄位範圍驗證（既有）
  if p_score  < 0      or p_score  > 50000   then return; end if;
  if p_time   < 1000   or p_time   > 7200000 then return; end if;
  if p_flips  < 0      or p_flips  > 50      then return; end if;
  if p_perfect < 0     or p_perfect > 50     then return; end if;

  -- [A1] 提交冷卻：同 uid 距上次「成功寫入」< 10s 靜默拒絕
  --（created_at 只在寫入成功時刷新；合法的下一次進步至少隔一局 ≥ 13s）
  select created_at into v_last from public.daily_scores
   where challenge_date = v_today and player_id = v_uid;
  if v_last is not null and now() - v_last < interval '10 seconds' then return; end if;

  -- [A2] 分數上限：行進 1000 + 完美翻轉 200/圈 + 舊制 slack
  if p_score > 1000 + 200 * p_flips + v_slack then return; end if;

  -- [A3] 完美落地不可能多於翻轉（每次完美至少記 1 圈）
  if p_perfect > p_flips + 3 then return; end if;

  -- [A4] 翻轉/時間比：物理極限 ≈ 1.9 圈/s → 2 圈/s + 3 緩衝
  if p_flips > ceil(p_time / 1000.0) * 2 + 3 then return; end if;

  -- [A5] 時間下限：分數隱含「至少跑了多遠」→ 至少要花多少時間。
  -- 當日挑戰圖 = 該期最難一張（與前端 fetchHardestDailyMap 同查法）。查無圖（DB 空窗）跳過不擋。
  select jsonb_array_length(prices) into v_len
    from public.daily_map where map_date = v_today
   order by difficulty desc limit 1;
  if v_len is not null then
    v_full_ms := (v_len + 4) * 80 / v_speed * 1000;
    v_ratio := least(1.0, greatest(0.0, (p_score - 200 * p_flips - v_slack) / 1000.0));
    if p_time < v_ratio * v_full_ms * 0.9 then return; end if;  -- 0.9 容忍係數
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
    -- 只有「分數更高，或同分但時間更短」才覆蓋
    where excluded.score > public.daily_scores.score
       or (excluded.score = public.daily_scores.score
           and excluded.time_ms < public.daily_scores.time_ms);
end;
$$;

-- 簽名沒變，既有 grant 保留；防手癢重收一次權（冪等）
revoke execute on function public.submit_daily_score(text, int, int, int, int) from public, anon;
grant  execute on function public.submit_daily_score(text, int, int, int, int) to authenticated;

-- ── ② submit_classic_record：level 白名單 + 分數/時間一致性 + 10s 冷卻 ──
-- 經典 RPC 沒有 flips 欄位 → 反向檢核：給定時間，分數不可能超過
--   行進分上限(時間內可跑距離) + 翻轉分上限(時間內可翻圈數×200) + slack。
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
  v_slack   constant int     := 500;
  v_speed   constant numeric := 414.72;
  v_last    timestamptz;
  v_len     int;
  v_full_ms numeric;
  v_max     numeric;
begin
  v_uid := auth.uid()::text;
  if v_uid is null then return; end if;                  -- 需登入
  if p_level is null or length(p_level) > 32 then return; end if;
  if p_score < 0    or p_score > 50000   then return; end if;
  if p_time  < 1000 or p_time  > 7200000 then return; end if;

  -- [A6] 關卡白名單 + 資料點數（src/data/classics.json 的 prices.length）。
  -- 未知 level_id 拒收（修掉任意字串塞新列的污染面）。⚠️ 新增經典關卡時要同步更新這張表。
  select len into v_len from (values
    ('tw2000', 140), ('tw2008', 140), ('tw2020', 140), ('tw2022', 140),
    ('tw319',   29), ('tw2024',  22), ('us1987', 105), ('us2000', 140),
    ('us2008', 140), ('us2020', 140), ('gme2021',102), ('jp1989', 140)
  ) as t(id, len) where t.id = p_level;
  if v_len is null then return; end if;

  -- [A7] 冷卻：同 uid 同關卡距上次「成功寫入」< 10s 靜默拒絕
  --（updated_at 只在成功覆蓋紀錄時刷新；連兩次破同關紀錄至少隔一局）
  select updated_at into v_last from public.classic_records
   where level_id = p_level and player_id = v_uid;
  if v_last is not null and now() - v_last < interval '10 seconds' then return; end if;

  -- [A8] 分數/時間一致性（回測 12 筆現任紀錄 margin 全 > 6600，不誤殺）
  v_full_ms := (v_len + 4) * 80 / v_speed * 1000;
  v_max := 1000 * least(1.0, p_time / (0.9 * v_full_ms))
         + 200 * (2 * p_time / 1000.0 + 3) + v_slack;
  if p_score > v_max then return; end if;

  insert into public.classic_records
    (level_id, player_id, player_name, score, time_ms, updated_at)
  values (p_level, v_uid, left(p_name, 16), p_score, p_time, now())
  on conflict (level_id) do update
    set player_id   = excluded.player_id,
        player_name = excluded.player_name,
        score       = excluded.score,
        time_ms     = excluded.time_ms,
        updated_at  = now()
    -- 只有「分數更高，或同分但時間更短」才覆蓋保持者
    where excluded.score > public.classic_records.score
       or (excluded.score = public.classic_records.score
           and excluded.time_ms < public.classic_records.time_ms);
end;
$$;

revoke execute on function public.submit_classic_record(text, text, int, int) from public, anon;
grant  execute on function public.submit_classic_record(text, text, int, int) to authenticated;
