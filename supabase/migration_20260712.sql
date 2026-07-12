-- ============================================================================
-- 2026-07-12：反作弊 Phase B——單日提交次數側限 + suspect 標記 + 排行榜/結算排除
--（ANTICHEAT_DESIGN.md 第二層 3.／第三層，vc27 批次）
--
-- ── 為什麼 ─────────────────────────────────────────────────────────────────
-- Phase A（migration_20260704.sql）+ 07-11c 已經擋掉「亂填數字」跟「完全沒玩過就打
-- API」，但擋不住「單次挑戰額度內，反覆用不同 (score,time,flips,perfect) 組合
-- hill-climb 逼近物理上限」——這種攻擊每次提交個別都通過 A2~A5 的物理一致性檢查，
-- 只有「同一天對同一玩家改分數改了異常多次」這個頻率特徵看得出來。
-- 30 秒提交冷卻（doc 原訂第二層 1.）**其實已經在 Phase A 做了**，只是調成 10 秒
-- （見 migration_20260704.sql 頭尾註解：實測完賽中位數僅 17s，30s 會誤殺連續進步的
-- 正常玩家），這裡不重複調整，維持現狀。
--
-- ── 這份做兩件事 ───────────────────────────────────────────────────────────
-- 1. [頻率標記] daily_scores 新增 submit_count（每次「真的改善分數」的 upsert +1）；
--    單日 submit_count > 12（5 次挑戰 + 復活 + 容忍緩衝，同 ANTICHEAT_DESIGN.md 估算）
--    → suspect = true。不擋提交、不刪資料，只標記。
-- 2. [離群標記，複用既有夜間排程] settle_daily_diamonds() 在結算「前一期」鑽石之前，
--    先對那一期跑一次 z-score 離群掃描（相對當天分數分布 > 4 個標準差，樣本數 < 8
--    時不判斷，避免玩家太少時統計不穩定誤殺）→ suspect = true。這支 RPC 本來就是
--    scripts/settleDailyRewards.ts 每晚 00:00 呼叫，不需要新開一支 GitHub Actions。
--
-- suspect 的效果：
--   - daily_scores_ranked VIEW 排除（排行榜前端看不到，不擠掉正常玩家名次）
--   - settle_daily_diamonds() 的名次獎排除（suspect 拿不到名次鑽石；參與獎不影響，
--     那是攤平發放不看分數，跟這個攻擊面無關）
--   - 不會自動刪除/覆蓋玩家紀錄，人工可在 Dashboard 把 suspect 改回 false 復權
--     （誤判零成本復原）
--
-- 範圍刻意只涵蓋每日排行榜（daily_scores）。經典模式（classic_records，永久前三名）
-- 攻擊模型不同（沒有「單日」概念），建議加人工覆核，這份不動它，留待之後需要時再做。
--
-- 執行方式：Supabase Dashboard → SQL Editor 貼上整份執行一次（push 不會自動生效）。
-- ============================================================================

-- ── 1. 新增欄位 ──────────────────────────────────────────────────────────────
alter table public.daily_scores add column if not exists suspect boolean not null default false;
alter table public.daily_scores add column if not exists submit_count int not null default 0;

-- ── 2. submit_daily_score：加上 submit_count 累加 + 超額標記 suspect ─────────
-- 其餘全部檢查（A1 冷卻／A2 分數上限／A3 完美落地／A4 翻轉比例／A5 時間下限／
-- A9 攻次要求）逐字照抄 migration_20260711c.sql 現行版本，不變動判斷邏輯。
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
  v_new_count int;
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

  insert into public.daily_scores
    (challenge_date, player_id, player_name, score, time_ms, flips, perfect, submit_count)
  values (v_today, v_uid, left(p_name, 16), p_score, p_time, p_flips, p_perfect, 1)
  on conflict (challenge_date, player_id) do update
    set score        = excluded.score,
        time_ms      = excluded.time_ms,
        flips        = excluded.flips,
        perfect      = excluded.perfect,
        player_name  = excluded.player_name,
        created_at   = now(),
        submit_count = public.daily_scores.submit_count + 1
    where excluded.score > public.daily_scores.score
       or (excluded.score = public.daily_scores.score
           and excluded.time_ms < public.daily_scores.time_ms)
  returning submit_count into v_new_count;

  -- [B1] 🔒 新增：單日「真的改善分數」的提交次數 > 12 次 → 標記可疑（不擋提交）
  if v_new_count is not null and v_new_count > 12 then
    update public.daily_scores set suspect = true
     where challenge_date = v_today and player_id = v_uid;
  end if;
end;
$$;

revoke execute on function public.submit_daily_score(text, int, int, int, int) from public, anon;
grant  execute on function public.submit_daily_score(text, int, int, int, int) to authenticated;

-- ── 3. daily_scores_ranked VIEW：排除 suspect（照抄 scripts/migration_user_profiles.sql
--    現行定義，只加一行 WHERE，欄位/型別/順序完全不變，CREATE OR REPLACE 安全）──────
create or replace view public.daily_scores_ranked as
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

-- ── 4. settle_daily_diamonds()：結算前先跑 z-score 離群掃描 + 名次獎排除 suspect ──
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

  -- [B2] 🔒 新增：離群分數標記（z-score > 4，樣本數 < 8 不判斷避免統計不穩定誤殺）。
  -- 在名次結算前跑，當晚就會排除在名次獎之外；suspect 可在 Dashboard 人工復權。
  with stats as (
    select avg(score) as mean, stddev_pop(score) as sd, count(*) as n
      from public.daily_scores where challenge_date = v_prev_session
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
        -- [B3] 🔒 新增：suspect 不列入排名（拿不到名次鑽石，參與獎不受影響）
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

-- 驗收：
-- 1. 同一帳號同一天對 submit_daily_score 打 13 次遞增分數（間隔 >10s 避開 A1）→
--    daily_scores.suspect 應變 true，且該筆從 daily_scores_ranked 消失。
-- 2. 手動在測試資料裡塞一筆離群分數（例如其他人都 800 分，塞一筆 49000），跑一次
--    select public.settle_daily_diamonds(); → 該筆 suspect 應變 true。
-- 3. 正常單次挑戰、正常分數的既有流程應完全無感（suspect 全部維持 false）。
