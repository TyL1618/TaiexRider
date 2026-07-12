-- ============================================================================
-- 2026-07-12b：反作弊 Phase C（操作事件序列粗一致性）+ Ghost 鬼影賽跑資料層
--（ANTICHEAT_DESIGN.md 第四層，vc28 批次）
--
-- ── 為什麼兩個放一起 ─────────────────────────────────────────────────────────
-- Phase C 原本設計是「錄一份輕量事件時間軸，反作弊跟 Ghost 回放共用同一份資料」。
-- 實作時範圍稍微收斂：只錄「翻轉/完美落地事件（含時間戳）」+「車輛 x 座標每 0.5s
-- 取樣一次」，不做完整 press/release 合法性狀態機驗證（成本/風險不成比例，事件數
-- 對得上 flips/perfect、取樣點數對得上時間，已經足夠拉高偽造成本；press/release
-- 粒度之後如果真的觀察到繞過案例再加，避免過度設計）。
--
-- ── 這份做三件事 ───────────────────────────────────────────────────────────
-- 1. daily_scores 新增 replay jsonb：{ "events": [[t,"f"|"p"], ...], "path": [x0,x1,...] }
--    （events=翻轉/完美事件時間戳，path=每 0.5s 一個車輛 x 座標，t/x 皆為整數 ms/px）。
-- 2. submit_daily_score 新增 p_replay 參數（預設 null，向下相容尚未更新的舊客戶端——
--    直到玩家全部更新到新版之前，沒有 replay 資料的提交仍照舊只驗物理一致性）。
--    有 p_replay 時多做粗一致性檢查：
--      - events 裡 "f"/"p" 各自數量跟 p_flips/p_perfect 差距在容忍範圍內
--      - path 陣列長度跟 p_time/500 的預期取樣數差距在容忍範圍內
--      - 最後一個事件/取樣的時間戳不能超過 p_time 太多
--    任一項離譜偏差 → 靜默拒絕（跟既有 A2~A5 同一種風格：偽造者要連 replay 都一起
--    造假才可能通過，成本大幅拉高）。
-- 3. get_daily_ghost_path(p_date)：回傳當日「非 suspect、目前第一名」那筆的
--    replay->path（沒有就回 null），anon/authenticated 皆可呼叫（純讀取排行榜等級
--    的公開資料，不需要登入）。前端進每日排名賽開關「第一名鬼影」時呼叫。
--    ⚠️ 只有這份 migration 生效之後、且当天有人用新版客戶端交出帶 replay 的第一名
--    成績，這支才會有資料可回——舊成績沒有 replay 欄位，這是預期中的空窗期。
--
-- 執行方式：Supabase Dashboard → SQL Editor 貼上整份執行一次（push 不會自動生效）。
-- ============================================================================

alter table public.daily_scores add column if not exists replay jsonb;

create or replace function public.submit_daily_score(
  p_name    text,
  p_score   int,
  p_time    int,
  p_flips   int default 0,
  p_perfect int default 0,
  p_replay  jsonb default null
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
  v_new_count int;
  v_ev_flip  int;
  v_ev_perf  int;
  v_ev_last  numeric;
  v_path_len int;
  v_path_last numeric;
begin
  v_uid := auth.uid()::text;
  if v_uid is null then return; end if;

  -- 單欄位範圍驗證（既有）
  if p_score  < 0      or p_score  > 50000   then return; end if;
  if p_time   < 1000   or p_time   > 7200000 then return; end if;
  if p_flips  < 0      or p_flips  > 50      then return; end if;
  if p_perfect < 0     or p_perfect > 50     then return; end if;

  -- [A9] 這一期必須消耗過至少一次排名賽次數才可能有分數要交
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

  -- [C1] 🔒 新增：有帶 replay 才驗（向下相容舊客戶端，見檔頭說明）
  -- events 格式為 [t, "f"|"p", n]：n＝該次落地貢獻的翻轉圈數（totalFlips 是累計圈數，
  -- 不是累計「落地次數」，一次落地可能貢獻多圈，所以這裡要加總 n 而不是數陣列筆數）。
  -- perfect 落地次數（p_perfect）才是單純數「p」型別事件筆數。
  if p_replay is not null then
    select coalesce(sum((ev->>2)::int), 0),
           count(*) filter (where ev->>1 = 'p'),
           coalesce(max((ev->>0)::numeric), 0)
      into v_ev_flip, v_ev_perf, v_ev_last
      from jsonb_array_elements(coalesce(p_replay->'events', '[]'::jsonb)) ev;

    select jsonb_array_length(coalesce(p_replay->'path', '[]'::jsonb))
      into v_path_len;
    v_path_last := v_path_len * 500.0;

    -- 事件數 vs 回報數：容忍 ±2（settleFlip 邊角案例：例如 0 圈但有記翻轉分等）
    if abs(v_ev_flip - p_flips) > 2 then return; end if;
    if abs(v_ev_perf - p_perfect) > 2 then return; end if;
    -- 取樣點數 vs 時間：容忍 ±5 個取樣點（頁面凍結/節流誤差）
    if abs(v_path_len - ceil(p_time / 500.0)) > 5 then return; end if;
    -- 事件/取樣時間戳不能大幅超過回報的總時間（容忍 2 秒）
    if v_ev_last > p_time + 2000 then return; end if;
    if v_path_last > p_time + 2000 + 500 then return; end if;
  end if;

  insert into public.daily_scores
    (challenge_date, player_id, player_name, score, time_ms, flips, perfect, submit_count, replay)
  values (v_today, v_uid, left(p_name, 16), p_score, p_time, p_flips, p_perfect, 1, p_replay)
  on conflict (challenge_date, player_id) do update
    set score        = excluded.score,
        time_ms      = excluded.time_ms,
        flips        = excluded.flips,
        perfect      = excluded.perfect,
        player_name  = excluded.player_name,
        created_at   = now(),
        submit_count = public.daily_scores.submit_count + 1,
        replay       = excluded.replay
    where excluded.score > public.daily_scores.score
       or (excluded.score = public.daily_scores.score
           and excluded.time_ms < public.daily_scores.time_ms)
  returning submit_count into v_new_count;

  -- [B1] 單日「真的改善分數」的提交次數 > 12 次 → 標記可疑（不擋提交）
  if v_new_count is not null and v_new_count > 12 then
    update public.daily_scores set suspect = true
     where challenge_date = v_today and player_id = v_uid;
  end if;
end;
$$;

revoke execute on function public.submit_daily_score(text, int, int, int, int, jsonb) from public, anon;
grant  execute on function public.submit_daily_score(text, int, int, int, int, jsonb) to authenticated;
-- 舊簽章（5 參數版）移除，避免呼叫端型別不明確時 PostgREST 撞到多載歧義
drop function if exists public.submit_daily_score(text, int, int, int, int);

-- ── get_daily_ghost_path()：當日目前第一名（非 suspect）的鬼影路徑 ───────────
create or replace function public.get_daily_ghost_path(p_date date)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select replay -> 'path'
    from public.daily_scores
   where challenge_date = p_date and not suspect and replay is not null
   order by score desc, time_ms asc
   limit 1;
$$;
revoke execute on function public.get_daily_ghost_path(date) from public;
grant  execute on function public.get_daily_ghost_path(date) to anon, authenticated;

-- 驗收：
-- 1. 正常玩一局排名賽提交，daily_scores.replay 應有值（events/path 皆非空陣列）。
-- 2. 打 rpc/get_daily_ghost_path {"p_date":"<今天>"} 應回傳一個數字陣列（有人交過
--    帶 replay 的成績之後）。
-- 3. 手動塞一筆 p_replay 的 events/path 跟 p_flips/p_time 對不上（例如 path 只有
--    2 個元素但 p_time=60000）應被拒絕、daily_scores 查不到這筆。
-- 4. 舊客戶端不帶 p_replay（null）應完全不受影響，照舊正常收分。
