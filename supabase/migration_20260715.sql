-- ============================================================================
-- 2026-07-15：鬼影改用紀錄保持者當下使用的車皮（不再是玩家自己的車）
--
-- ── 為什麼 ─────────────────────────────────────────────────────────────────
-- 使用者發現排行榜鬼影目前顯示的是「玩家自己選用的車」（GameCanvas.tsx 直接重用
-- bikeEntry），不是紀錄保持者提交當下實際騎的車——這樣鬼影既無法真實還原對手的
-- 狀態，也讓買車/換車皮少了一個可以被看見的理由。改法：daily_scores 新增
-- skin_id 欄位存「提交當下使用的車皮 id」，submit_daily_score 收一併存入，
-- get_daily_ghost_path 跟 path 一起回傳，前端渲染鬼影時查表載入對應貼圖。
--
-- ── 這份做三件事 ───────────────────────────────────────────────────────────
-- 1. daily_scores 新增 skin_id text not null default 'default'（既有資料/舊版
--    客戶端沒帶這欄位一律視為預設車，不影響既有排行榜資料）。
-- 2. submit_daily_score 新增 p_skin_id text default 'default' 參數（照既有
--    「加參數＋給預設值」慣例用 create or replace 原地更新，不產生新 overload，
--    向下相容還沒更新的舊客戶端）。長度上限 32 字元防禦性 cap，不做白名單比對
--    ——渲染端找不到對應車款會 fallback 預設車，惡意值頂多顯示錯車，無安全疑慮。
-- 3. get_daily_ghost_path 回傳型別從純 jsonb 改成 table(path jsonb, skin_id text)
--    ——回傳型別變更不能用 create or replace，需先 drop 再建。PostgREST 對
--    set-returning function 一律回陣列，前端 fetchDailyGhostPath 已同步改讀
--    data[0]（見 src/lib/leaderboard.ts）。
--
-- 執行方式：Supabase Dashboard → SQL Editor 貼上整份執行一次（push 不會自動生效，
-- 且要在新版前端上線前/後盡快跑——沒跑之前 submit_daily_score 呼叫端多傳的
-- p_skin_id 會被 PostgREST 直接拒絕整個請求，導致排名賽分數交不出去）。
-- ============================================================================

-- ── 1. daily_scores 新增欄位 ──────────────────────────────────────────────
alter table public.daily_scores
  add column if not exists skin_id text not null default 'default';

-- ── 2. submit_daily_score：加 p_skin_id（其餘驗證邏輯逐字沿用 20260713b.sql）──
create or replace function public.submit_daily_score(
  p_name    text,
  p_score   int,
  p_time    int,
  p_flips   int default 0,
  p_perfect int default 0,
  p_replay  jsonb default null,
  p_skin_id text default 'default'
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

      -- [C3] path 雙格式驗證：v1（vc28）＝純數字陣列，x 每 500ms；
      -- v2（vc29 起）＝[x,y,角度] 三元組每 250ms，客戶端錄滿 2400 筆封頂。
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
    (challenge_date, player_id, player_name, score, time_ms, flips, perfect, submit_count, replay, skin_id)
  values (v_today, v_uid, left(p_name, 16), p_score, p_time, p_flips, p_perfect, 1, p_replay, left(coalesce(p_skin_id, 'default'), 32))
  on conflict (challenge_date, player_id) do update
    set score        = excluded.score,
        time_ms      = excluded.time_ms,
        flips        = excluded.flips,
        perfect      = excluded.perfect,
        player_name  = excluded.player_name,
        created_at   = now(),
        submit_count = public.daily_scores.submit_count + 1,
        replay       = excluded.replay,
        skin_id      = excluded.skin_id
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

revoke execute on function public.submit_daily_score(text, int, int, int, int, jsonb, text) from public, anon;
grant  execute on function public.submit_daily_score(text, int, int, int, int, jsonb, text) to authenticated;

-- ── 3. get_daily_ghost_path：回傳型別改成 table(path, skin_id) ────────────────
-- 回傳型別變更不能用 create or replace，先 drop 再建。維持「真第一名」語意不變：
-- 當日第一名（非 suspect）沒有 replay 就整列不回（前端拿到空陣列視為 null）。
drop function if exists public.get_daily_ghost_path(date);

create function public.get_daily_ghost_path(p_date date)
returns table(path jsonb, skin_id text)
language sql
security definer
set search_path = public
stable
as $$
  select replay -> 'path', daily_scores.skin_id
    from public.daily_scores
   where challenge_date = p_date and not suspect
   order by score desc, time_ms asc
   limit 1;
$$;
revoke execute on function public.get_daily_ghost_path(date) from public;
grant  execute on function public.get_daily_ghost_path(date) to anon, authenticated;

-- 驗收：
-- 1. 車庫換一台非預設車皮 → 玩一局排名賽提交 → daily_scores 該列 skin_id 應為
--    該車款 id（例如 'p3-gold'），不是 'default'。
-- 2. 用另一帳號（或訪客切換車皮後再登入）開鬼影進場 → 鬼影應顯示第一名當時的車款
--    貼圖（形狀跟自己選用的車不同才算對），半透明可看到真實顏色（無去色濾鏡）。
-- 3. 舊資料（這份跑之前就存在的 daily_scores 列）skin_id 應自動補為 'default'，
--    讀出來鬼影照舊能顯示（預設車），不會因為欄位缺值而整支 RPC 出錯。
-- 4. get_daily_ghost_path 在今日還沒人提交過成績時應回空陣列（前端視為 null）。
