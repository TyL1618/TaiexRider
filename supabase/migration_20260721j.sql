-- ============================================================
-- TaiexRider migration 2026-07-21j — 個人化裝備改成真的能被別人看到
--
-- 背景：使用者質疑「本來就該讓別人看得到才有這個價值」——查code後證實，
-- 排行榜暱稱顏色/稱號/前綴圖示、鬼影顏色，全部都是「每個玩家自己的手機只讀
-- 自己裝備了什麼，套用在自己那一列/自己看到的鬼影上」，別人的手機完全沒有
-- 管道知道你裝備了什麼——排行榜資料（daily_scores_ranked）根本沒有這個欄位，
-- 鬼影渲染讀的也是「當下正在看的這個人」自己的鬼影顏色偏好，不是紀錄保持者的。
-- 這份把它改成真的伺服器廣播：提交排名賽成績時，把「提交當下裝備的個人化
-- 道具」（讀 migration_20260721i.sql 的 player_wallet.equipped，伺服器權威，
-- 不信任前端）存進 daily_scores，其他玩家看排行榜/鬼影就能看到。
--
-- ⚠️ 依賴 migration_20260721i.sql 先跑過（player_wallet.equipped 欄位要存在）。
--
-- 範圍：只做每日排名賽（daily_scores）。經典模式（classic_records，永久前三名
-- 排行榜）目前排行榜只套自己那列的暱稱顏色、版面本來就窄，這次不動，之後
-- 有需要再排。尾焰特效顏色（trail）只在自己遊玩當下看得到意義，不 snapshot。
--
-- 用法：Supabase Dashboard → SQL Editor → 全選貼上 → Run。
-- ⚠️ push 不會更新 DB，一定要手動跑這份。
-- ============================================================

-- ── 1. daily_scores 新增 cosmetics 欄位（提交當下裝備的稱號/暱稱顏色/前綴
--    圖示/鬼影顏色快照，跟既有 skin_id 同一套「提交時定格」設計）──────────
alter table public.daily_scores
  add column if not exists cosmetics jsonb not null default '{}'::jsonb;

-- ── 2. submit_daily_score：逐字沿用 migration_20260715.sql 現行版本的全部
--    驗證邏輯，只加「提交前讀伺服器權威 player_wallet.equipped 存快照」這段，
--    函式簽章不變（不需要新增參數，equipped 已經是伺服器自己知道的資料，
--    沒有被前端竄改的空間）。────────────────────────────────────────────
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
  v_cosmetics jsonb;
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

  -- [新增] 提交當下裝備的個人化道具快照：讀伺服器權威 player_wallet.equipped
  -- （migration_20260721i.sql），不信任/不需要前端傳值。trail 尾焰色只在自己
  -- 遊玩當下有意義，不存進排行榜快照。
  select w.equipped into v_cosmetics from public.player_wallet w where w.player_id = v_uid;
  v_cosmetics := coalesce(v_cosmetics, '{}'::jsonb) - 'trail';

  insert into public.daily_scores
    (challenge_date, player_id, player_name, score, time_ms, flips, perfect, submit_count, replay, skin_id, cosmetics)
  values (v_today, v_uid, left(p_name, 16), p_score, p_time, p_flips, p_perfect, 1, p_replay, left(coalesce(p_skin_id, 'default'), 32), v_cosmetics)
  on conflict (challenge_date, player_id) do update
    set score        = excluded.score,
        time_ms      = excluded.time_ms,
        flips        = excluded.flips,
        perfect      = excluded.perfect,
        player_name  = excluded.player_name,
        created_at   = now(),
        submit_count = public.daily_scores.submit_count + 1,
        replay       = excluded.replay,
        skin_id      = excluded.skin_id,
        cosmetics    = excluded.cosmetics
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

-- ── 3. daily_scores_ranked VIEW：cosmetics 加在最後一欄（CREATE OR REPLACE VIEW
--    只能在既有欄位「後面」加欄位，不能插在中間，否則 Postgres 會拒絕）───────
create or replace view public.daily_scores_ranked as
select
  ds.challenge_date,
  ds.player_id,
  ds.score,
  ds.time_ms,
  ds.flips,
  ds.perfect,
  coalesce(up.player_name, ds.player_name) as player_name,
  ds.cosmetics
from public.daily_scores ds
left join public.user_profiles up on up.player_id = ds.player_id
where not ds.suspect;

grant select on public.daily_scores_ranked to anon, authenticated;

-- ── 4. get_daily_ghost_path：回傳型別加 cosmetics（鬼影顏色要顯示紀錄保持者
--    自己裝備的顏色，不是正在看的這個人自己的偏好）。回傳型別變更需 drop 重建。──
drop function if exists public.get_daily_ghost_path(date);

create function public.get_daily_ghost_path(p_date date)
returns table(path jsonb, skin_id text, cosmetics jsonb)
language sql
security definer
set search_path = public
stable
as $$
  select replay -> 'path', daily_scores.skin_id, daily_scores.cosmetics
    from public.daily_scores
   where challenge_date = p_date and not suspect
   order by score desc, time_ms asc
   limit 1;
$$;
revoke execute on function public.get_daily_ghost_path(date) from public;
grant  execute on function public.get_daily_ghost_path(date) to anon, authenticated;

-- 驗收：
-- 1. 帳號 A 裝備一個稱號/暱稱顏色 → 玩一局排名賽提交（要改善分數才會存新快照，
--    跟 skin_id 同一套既有限制）→ 帳號 B（甚至訪客）打開同一天排行榜，應該在
--    帳號 A 那一列看到稱號/暱稱顏色/前綴圖示，不用登入帳號 A 也看得到。
-- 2. 帳號 A 是當日第一名且裝備了鬼影顏色 → 帳號 B 開啟「第一名鬼影」進場，
--    鬼影身上的色調應該是帳號 A 裝備的顏色，不是帳號 B 自己裝備的顏色
--    （帳號 B 沒裝備鬼影顏色時，仍應該看到帳號 A 的顏色）。
-- 3. 舊資料（這份跑之前就存在的 daily_scores 列）cosmetics 應自動補為 '{}'，
--    排行榜/鬼影渲染不受影響（沒有稱號/顏色可顯示，跟從沒裝備過一樣）。
