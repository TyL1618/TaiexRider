-- ============================================================
-- TaiexRider 監控日報查詢集（在 Supabase SQL Editor 逐段執行，或存成 Saved queries）
-- 資料來源：public.events（見 migration_20260702.sql）
-- 時區：一律轉 Asia/Taipei 再分組（events.ts 是 UTC）
-- ============================================================

-- 1️⃣ 每日活躍裝置 (DAU) + 開局數：最近 14 天
select
  (ts at time zone 'Asia/Taipei')::date as day,
  count(distinct device_id)             as dau,
  count(*) filter (where event = 'run_start') as runs
from events
where ts > now() - interval '14 days'
group by 1 order by 1 desc;

-- 2️⃣ 各模式開局分佈：最近 7 天（哪個模式沒人玩一目瞭然）
select
  mode,
  count(*)                     as runs,
  count(distinct device_id)    as devices,
  round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from events
where event = 'run_start' and ts > now() - interval '7 days'
group by mode order by runs desc;

-- 3️⃣ 死亡原因分佈：最近 7 天（topHit=翻車撞地 / stuckMidAir=卡死保底）
select
  mode,
  props->>'cause'  as cause,
  count(*)         as deaths
from events
where event = 'death' and ts > now() - interval '7 days'
group by 1, 2 order by deaths desc;

-- 4️⃣ 完賽率：各模式 完賽 / 開局（最近 7 天）
with s as (
  select mode,
    count(*) filter (where event = 'run_start') as starts,
    count(*) filter (where event = 'finish')    as finishes
  from events
  where ts > now() - interval '7 days'
  group by mode
)
select mode, starts, finishes,
  case when starts > 0 then round(100.0 * finishes / starts, 1) else 0 end as finish_pct
from s order by starts desc;

-- 5️⃣ 死亡位置熱點：今天的每日排名賽，死在賽道哪一段（xr = 死亡位置/全長 0~1）
--    → 未來可直接餵給「全服死亡熱點」遊戲內顯示
select
  width_bucket((props->>'xr')::numeric, 0, 1, 10) as track_decile, -- 1=前10%…10=末10%
  count(*) as deaths
from events
where event = 'death'
  and mode  = 'daily'
  and (ts at time zone 'Asia/Taipei')::date = (now() at time zone 'Asia/Taipei')::date
  and props ? 'xr'
group by 1 order by 1;

-- 6️⃣ 次日留存（裝置級，最近 14 天 cohort）：
--    D0 = 該裝置首次出現日；retained = 隔天有再開局
with first_seen as (
  select device_id, min((ts at time zone 'Asia/Taipei')::date) as d0
  from events where event = 'run_start' group by device_id
),
next_day as (
  select f.device_id, f.d0,
    exists (
      select 1 from events e
      where e.device_id = f.device_id
        and e.event = 'run_start'
        and (e.ts at time zone 'Asia/Taipei')::date = f.d0 + 1
    ) as retained
  from first_seen f
  where f.d0 > (now() at time zone 'Asia/Taipei')::date - 14
    and f.d0 < (now() at time zone 'Asia/Taipei')::date   -- 今天的 cohort 還沒有「明天」
)
select d0 as cohort_day, count(*) as new_devices,
  count(*) filter (where retained) as retained_next_day,
  round(100.0 * count(*) filter (where retained) / count(*), 1) as retention_pct
from next_day group by d0 order by d0 desc;

-- 7️⃣ 完賽成績概況：分數/用時分佈（最近 7 天，daily 模式）
select
  (ts at time zone 'Asia/Taipei')::date as day,
  count(*)                              as finishes,
  round(avg((props->>'score')::numeric))          as avg_score,
  max((props->>'score')::numeric)                 as max_score,
  round(avg((props->>'timeMs')::numeric) / 1000, 1) as avg_sec
from events
where event = 'finish' and mode = 'daily' and ts > now() - interval '7 days'
group by 1 order by 1 desc;

-- 8️⃣ 復活使用率：看廣告復活按鈕的實際使用（最近 7 天）
select (ts at time zone 'Asia/Taipei')::date as day, count(*) as revives
from events where event = 'revive' and ts > now() - interval '7 days'
group by 1 order by 1 desc;

-- 9️⃣ events 表大小監控（原始事件留 90 天，由 CI 每日清理）
select pg_size_pretty(pg_total_relation_size('public.events')) as events_size,
       count(*) as total_rows, min(ts) as oldest from events;
