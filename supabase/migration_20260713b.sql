-- ============================================================================
-- 2026-07-13b：replay path 升級 v2 格式（完整鬼影復刻）——submit_daily_score 雙格式驗證
--
-- ── 為什麼 ─────────────────────────────────────────────────────────────────
-- 使用者實測 vc28 鬼影後拍板升級：鬼影要「完全複製原本遊玩的樣子」——空中拋物線、
-- 後空翻轉速、落地姿態。v1 格式只錄 x（每 500ms）、高度/傾角用地形函式貼地重建，
-- 天生做不到空中復刻。v2 格式改錄 [x, y, 累計旋轉角] 三元組（每 250ms，錄滿 2400
-- 筆＝10 分鐘封頂，防掛機灌大；正常一局 < 1 分鐘 ≈ 240 筆 ≈ 5KB，離 64KB 上限很遠）。
--
-- ── 雙格式相容（⚠️ 這份要在 vc29 客戶端上線前跑，順序很重要）───────────────────
-- 舊 vc28 客戶端仍會提交 v1（純數字陣列、500ms）；vc29/新版 PWA 提交 v2（三元組、
-- 250ms）。這份讓兩種都過驗證——沒跑這份之前，20260713.sql 的「path 元素皆需為
-- 數字」會把 v2 提交整筆靜默拒絕（vc29/PWA 玩家分數上不了榜）。push 到 Cloudflare
-- Pages 的 PWA 是自動部署，所以 **push 後要立刻來跑這份**，不要隔天。
-- 渲染端（GameCanvas drawGhost）同樣雙格式：讀到 v1 就退回貼地重建，讀到 v2 完整復刻。
--
-- 其餘（events 驗證/64KB 上限/exception 靜默拒絕/B1 標記等）逐字沿用 20260713.sql。
-- get_daily_ghost_path 不用改（回傳 path 原樣，格式判斷在客戶端）。
--
-- 執行方式：Supabase Dashboard → SQL Editor 貼上整份執行一次。
-- ============================================================================

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
  v_path_step int;
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

  -- [C1]+[C2] 有帶 replay 才驗（向下相容舊客戶端）。整塊包 exception：格式惡意/
  -- 損壞（非物件、欄位型別錯造成 cast 失敗等）一律靜默拒絕，不回 SQL 錯誤。
  if p_replay is not null then
    begin
      -- [C2] 大小/型別/長度硬上限（防 DB 膨脹＋防鬼影資料污染）
      if pg_column_size(p_replay) > 65536 then return; end if;
      if jsonb_typeof(p_replay) <> 'object' then return; end if;
      if jsonb_typeof(coalesce(p_replay->'events', '[]'::jsonb)) <> 'array' then return; end if;
      if jsonb_typeof(coalesce(p_replay->'path',   '[]'::jsonb)) <> 'array' then return; end if;
      if jsonb_array_length(coalesce(p_replay->'events', '[]'::jsonb)) > 150 then return; end if;

      -- [C3] path 雙格式驗證（2026-07-13b）：
      -- v1（vc28）＝純數字陣列，x 每 500ms；v2（vc29 起）＝[x,y,角度] 三元組每 250ms，
      -- 客戶端錄滿 2400 筆封頂（GameCanvas REPLAY_MAX_SAMPLES，兩邊要一致）。
      v_path_len := jsonb_array_length(coalesce(p_replay->'path', '[]'::jsonb));
      if v_path_len = 0 then
        -- 空 path：只有極短局才合理（正常客戶端 t=0 就會記第一筆）
        if ceil(p_time / 500.0) > 5 then return; end if;
      elsif jsonb_typeof(p_replay->'path'->0) = 'array' then
        -- v2
        v_path_step := 250;
        if v_path_len > 2400 then return; end if;
        if exists (
          select 1 from jsonb_array_elements(p_replay->'path') e
           where jsonb_typeof(e.value) <> 'array'
              or jsonb_array_length(e.value) <> 3
              or jsonb_typeof(e.value->0) <> 'number'
              or jsonb_typeof(e.value->1) <> 'number'
              or jsonb_typeof(e.value->2) <> 'number'
        ) then return; end if;
        if abs(v_path_len - least(ceil(p_time / 250.0), 2400)) > 8 then return; end if;
        v_path_last := v_path_len * v_path_step;
        if v_path_last > p_time + 2000 + v_path_step then return; end if;
      else
        -- v1
        v_path_step := 500;
        if exists (
          select 1 from jsonb_array_elements(p_replay->'path') e
           where jsonb_typeof(e.value) <> 'number'
        ) then return; end if;
        if abs(v_path_len - ceil(p_time / 500.0)) > 5 then return; end if;
        v_path_last := v_path_len * v_path_step;
        if v_path_last > p_time + 2000 + v_path_step then return; end if;
      end if;

      -- [C1] 事件粗一致性：events 圈數加總 / perfect 筆數 vs 回報值
      select coalesce(sum((ev->>2)::int), 0),
             count(*) filter (where ev->>1 = 'p'),
             coalesce(max((ev->>0)::numeric), 0)
        into v_ev_flip, v_ev_perf, v_ev_last
        from jsonb_array_elements(coalesce(p_replay->'events', '[]'::jsonb)) ev;

      if abs(v_ev_flip - p_flips) > 2 then return; end if;
      if abs(v_ev_perf - p_perfect) > 2 then return; end if;
      if v_ev_last > p_time + 2000 then return; end if;
    exception when others then
      return;
    end;
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

-- 驗收：
-- 1. vc29/新版 PWA 玩一局提交 → daily_scores.replay->'path' 元素應為 [x,y,angle]
--    三元組陣列；再玩一局開鬼影 → 鬼影應照原局軌跡起跳/翻轉。
-- 2. vc28 舊客戶端提交（純數字 path）→ 照常收分（v1 驗證分支）。
-- 3. get_daily_ghost_path 不用改，直接回傳新格式 path。
