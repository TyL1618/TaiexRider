-- ============================================================
-- TaiexRider migration 2026-07-21k — 個人化裝備排行榜顯示改「即時查詢」，
--   不再是「提交當下定格」（修復 migration_20260721j.sql 的實際體驗落差）
--
-- 背景：使用者跑完 j 之後真機測試，發現排行榜完全沒顯示任何裝備——連自己那列
-- 都沒有（j 之前，自己至少看得到自己「現在」裝備的東西）。根因：j 把裝備快照
-- 存進 daily_scores.cosmetics，但這個快照只有在「這次提交真的改善分數」時才會
-- 更新（跟既有 skin_id 同一套 upsert 規則），使用者當天已經打完當日排名賽次數
-- 上限（畫面顯示「今日已達上限」），沒有機會再交一筆新成績去刷新快照——這代表
-- 「先玩完一整天次數、再回車庫裝備」這個很正常的操作順序，會讓排行榜整天看起來
-- 像什麼都沒裝備，體驗比 j 之前的「純本地即時讀」還差。
--
-- 修法：排行榜/鬼影改成查詢當下才即時 join `player_wallet.equipped`（伺服器
-- 權威、單一資料來源），不再需要提交成績才會更新——裝備變更立刻對所有人生效，
-- 不用等下一次交出新紀錄。新增 get_daily_top() RPC（security definer，跟
-- get_daily_ghost_path 同一套「join player_wallet」寫法，這個專案裡
-- settle_daily_diamonds() 等既有函式本來就有跨玩家讀寫 player_wallet 的先例，
-- 不是新的信任模型）取代原本 daily_scores_ranked VIEW 的直接 REST 查詢
-- （VIEW 本身沒有权限直接 join player_wallet——該表 revoke all from anon/
-- authenticated，只有 security definer 函式能讀，這是 j 沒注意到、只能靠
-- 快照繞過的根本限制）。daily_scores.cosmetics 欄位跟著撤掉（不再需要，
-- 留著會變成誤導性的第二個資料來源）。
--
-- 用法：Supabase Dashboard → SQL Editor → 全選貼上 → Run。
-- ⚠️ push 不會更新 DB，一定要手動跑這份。
-- ============================================================

-- ── 1. 新增 get_daily_top()：即時 join player_wallet.equipped，取代
--    daily_scores_ranked VIEW 給前端排行榜用（VIEW 沒有權限 join player_wallet，
--    只能停在提交當下的快照，這正是本次要修的落差）。────────────────────────
create or replace function public.get_daily_top(p_date date, p_limit int default 100)
returns table(player_name text, score int, time_ms int, flips int, perfect int, cosmetics jsonb)
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(up.player_name, ds.player_name) as player_name,
         ds.score, ds.time_ms, ds.flips, ds.perfect,
         coalesce(w.equipped, '{}'::jsonb) - 'trail' as cosmetics
    from public.daily_scores ds
    left join public.user_profiles up on up.player_id = ds.player_id
    left join public.player_wallet w on w.player_id = ds.player_id
   where ds.challenge_date = p_date and not ds.suspect
   order by ds.score desc, ds.time_ms asc
   limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;
revoke execute on function public.get_daily_top(date, int) from public;
grant  execute on function public.get_daily_top(date, int) to anon, authenticated;

-- ── 2. get_daily_ghost_path：cosmetics 改即時 join player_wallet，不再讀
--    daily_scores.cosmetics 快照（回傳型別不變，create or replace 即可）。─────
create or replace function public.get_daily_ghost_path(p_date date)
returns table(path jsonb, skin_id text, cosmetics jsonb)
language sql
security definer
set search_path = public
stable
as $$
  select ds.replay -> 'path', ds.skin_id,
         coalesce(w.equipped, '{}'::jsonb) - 'trail'
    from public.daily_scores ds
    left join public.player_wallet w on w.player_id = ds.player_id
   where ds.challenge_date = p_date and not ds.suspect
   order by ds.score desc, ds.time_ms asc
   limit 1;
$$;
revoke execute on function public.get_daily_ghost_path(date) from public;
grant  execute on function public.get_daily_ghost_path(date) to anon, authenticated;

-- ── 3. daily_scores_ranked VIEW：撤回 j 加的 cosmetics 欄位（改用上面 get_daily_top
--    RPC，這個 VIEW 恢復回 migration_20260712.sql 原本的 7 欄位版本；REMOVE 尾端
--    欄位不能用 CREATE OR REPLACE，要 DROP 再 CREATE）。────────────────────────
drop view if exists public.daily_scores_ranked;
create view public.daily_scores_ranked as
select
  ds.challenge_date,
  ds.player_id,
  ds.score,
  ds.time_ms,
  ds.flips,
  ds.perfect,
  coalesce(up.player_name, ds.player_name) as player_name
from public.daily_scores ds
left join public.user_profiles up on up.player_id = ds.player_id
where not ds.suspect;
grant select on public.daily_scores_ranked to anon, authenticated;

-- ── 4. submit_daily_score：撤回 j 加的「讀 player_wallet.equipped 存快照」那段，
--    逐字還原成 migration_20260715.sql 現行版本（裝備資料改在讀取端即時 join，
--    提交端不用再管這件事，函式簽章完全不變）。───────────────────────────────
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

-- ── 5. daily_scores.cosmetics 欄位撤除（j 加的快照不再需要，留著會變成誤導性
--    的第二個資料來源——真正的資料來源是 get_daily_top()/get_daily_ghost_path()
--    即時 join 的 player_wallet.equipped）。────────────────────────────────
alter table public.daily_scores drop column if exists cosmetics;

-- 驗收：
-- 1. 帳號 A 今天已經打完排名賽次數上限（畫面顯示「今日已達上限」）→ 回車庫換裝備
--    （例如換一個新稱號）→ 不用再玩一局 → 帳號 B（甚至訪客）重新整理排行榜頁面，
--    應該立刻在帳號 A 那一列看到新稱號（不用帳號 A 交新成績）。
-- 2. 帳號 A 是當日第一名且裝備鬼影顏色 → 帳號 B 開鬼影進場，鬼影應顯示帳號 A
--    「現在」裝備的顏色（換裝備後重新整理排行榜頁應該立刻反映，不用等 A 交新成績）。
-- 3. 舊資料（這份跑之前提交的 daily_scores 列）不受影響，get_daily_top() 一樣能
--    正確 join 出對應玩家目前的 equipped（沒裝備過的人看到空物件，跟以前一樣）。
