-- ============================================================================
-- 2026-07-13：Phase C 補強（replay 防灌爆 + 格式硬化）+ z-score 排除已標記者
--            + get_daily_ghost_path 改嚴格「真第一名」語意
--（2026-07-13 全面體檢的 🟠 兩項 + 🟡 鬼影措辭落差，純 SQL、不需重包 APK）
--
-- ── 這份做三件事 ───────────────────────────────────────────────────────────
-- 1. [C2] submit_daily_score 的 p_replay 加上大小/型別硬上限：
--    - 整包 jsonb > 64KB 拒絕（合法一局 events ≤ ~100 筆、整包 ~2KB，64KB 已極寬）
--    - events 陣列 > 150 筆拒絕（舊版只驗「圈數加總」，惡意客戶端可塞幾萬筆
--      [0,"x",0] 垃圾事件通過驗證灌爆單列 jsonb——DB 膨脹攻擊面）
--    - path 元素必須全為數字（這份資料會餵給其他玩家客戶端畫鬼影，垃圾值會讓
--      第一名的鬼影變成隱形/NaN，等於作弊者可以「污染」大家的鬼影體驗）
--    - 整個 [C1]/[C2] 驗證包進 exception 區塊：格式惡意/損壞（非物件、cast 失敗）
--      一律靜默拒絕，不再回 SQL 400 給呼叫端（跟 A 系列檢查同一種靜默風格）
-- 2. settle_daily_diamonds() 的 z-score 統計加 `and not suspect`：舊版把已標記的
--    作弊分也算進 mean/sd，一筆超大作弊分會撐大標準差、掩護其他離群值。
-- 3. get_daily_ghost_path() 改成嚴格「真第一名」：舊版回「有 replay 的最高分」，
--    空窗期內真第一名還是舊成績（無 replay）時，鬼影其實是第二名但 UI 寫「第一名
--    鬼影」——語意對不上。改成直接取真第一名那列的 replay->path，沒有就回 null
--    （鬼影晚一點出現，但出現時保證真的是第一名）。
--
-- 執行方式：Supabase Dashboard → SQL Editor 貼上整份執行一次（push 不會自動生效）。
-- ============================================================================

-- ── 1. submit_daily_score：[C1] 驗證硬化（其餘檢查逐字照抄 20260712b 現行版本）──
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

  -- [C1]+[C2] 有帶 replay 才驗（向下相容舊客戶端）。整塊包 exception：格式惡意/
  -- 損壞（非物件、欄位型別錯造成 cast 失敗等）一律靜默拒絕，不回 SQL 錯誤。
  if p_replay is not null then
    begin
      -- [C2] 大小/型別/長度硬上限（防 DB 膨脹＋防鬼影資料污染，2026-07-13 補強）
      if pg_column_size(p_replay) > 65536 then return; end if;
      if jsonb_typeof(p_replay) <> 'object' then return; end if;
      if jsonb_typeof(coalesce(p_replay->'events', '[]'::jsonb)) <> 'array' then return; end if;
      if jsonb_typeof(coalesce(p_replay->'path',   '[]'::jsonb)) <> 'array' then return; end if;
      if jsonb_array_length(coalesce(p_replay->'events', '[]'::jsonb)) > 150 then return; end if;
      if exists (
        select 1 from jsonb_array_elements(coalesce(p_replay->'path', '[]'::jsonb)) e
         where jsonb_typeof(e.value) <> 'number'
      ) then return; end if;

      -- [C1] 粗一致性：events 圈數加總 / perfect 筆數 / path 取樣數 vs 回報值
      -- events 格式 [t, "f"|"p", n]：n＝該次落地貢獻的翻轉圈數（totalFlips 是累計
      -- 圈數不是落地次數，所以加總 n）；perfect 落地次數＝"p" 型別事件筆數。
      select coalesce(sum((ev->>2)::int), 0),
             count(*) filter (where ev->>1 = 'p'),
             coalesce(max((ev->>0)::numeric), 0)
        into v_ev_flip, v_ev_perf, v_ev_last
        from jsonb_array_elements(coalesce(p_replay->'events', '[]'::jsonb)) ev;

      select jsonb_array_length(coalesce(p_replay->'path', '[]'::jsonb))
        into v_path_len;
      v_path_last := v_path_len * 500.0;

      if abs(v_ev_flip - p_flips) > 2 then return; end if;
      if abs(v_ev_perf - p_perfect) > 2 then return; end if;
      if abs(v_path_len - ceil(p_time / 500.0)) > 5 then return; end if;
      if v_ev_last > p_time + 2000 then return; end if;
      if v_path_last > p_time + 2000 + 500 then return; end if;
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

-- ── 2. settle_daily_diamonds：z-score 統計排除已標記的 suspect ────────────────
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
  v_today_session := coalesce(
    (select max(map_date) from public.daily_map
       where map_date <= (now() at time zone 'Asia/Taipei')::date),
    (now() at time zone 'Asia/Taipei')::date
  );
  v_prev_session := (select max(map_date) from public.daily_map where map_date < v_today_session);
  if v_prev_session is null then return; end if;

  -- [B2] 離群分數標記（z-score > 4，樣本數 < 8 不判斷）。
  -- 2026-07-13 補強：mean/sd 只用「未標記」的分數算——舊版把已 suspect 的作弊分
  -- 也算進統計，一筆超大分會撐大標準差、掩護其他離群值。
  with stats as (
    select avg(score) as mean, stddev_pop(score) as sd, count(*) as n
      from public.daily_scores
     where challenge_date = v_prev_session and not suspect
  )
  update public.daily_scores ds
     set suspect = true
    from stats
   where ds.challenge_date = v_prev_session
     and stats.n >= 8
     and stats.sd > 0
     and (ds.score - stats.mean) / stats.sd > 4
     and not ds.suspect;

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
          from public.daily_scores where challenge_date = v_prev_session and not suspect
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

    if found then
      insert into public.player_wallet (player_id) values (r.player_id) on conflict (player_id) do nothing;
      update public.player_wallet set diamonds = diamonds + v_bonus, updated_at = now()
       where player_id = r.player_id;
    end if;
  end loop;
end;
$$;
revoke execute on function public.settle_daily_diamonds() from public, anon, authenticated;

-- ── 3. get_daily_ghost_path：嚴格「真第一名」語意 ────────────────────────────
-- 直接取當日排名第一那一列的 replay->path：第一名還沒有 replay（舊客戶端交的）就回
-- null（不退而求其次回第二名的），跟 UI「第一名鬼影」字面語意一致。
create or replace function public.get_daily_ghost_path(p_date date)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select replay -> 'path'
    from public.daily_scores
   where challenge_date = p_date and not suspect
   order by score desc, time_ms asc
   limit 1;
$$;
revoke execute on function public.get_daily_ghost_path(date) from public;
grant  execute on function public.get_daily_ghost_path(date) to anon, authenticated;

-- 驗收：
-- 1. 正常玩一局排名賽提交 → 照常上榜、replay 有值（合法 replay 不受新上限影響）。
-- 2. 手動打 RPC 塞 events 有 200 筆垃圾事件（圈數加總仍對）→ 應被靜默拒絕。
-- 3. 手動打 RPC 塞 path 含字串元素 → 應被靜默拒絕（不是 SQL 400）。
-- 4. get_daily_ghost_path：當日第一名沒 replay 時應回 null（即使第二名有 replay）。
