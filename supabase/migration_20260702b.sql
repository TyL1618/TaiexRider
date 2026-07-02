-- ============================================================
-- TaiexRider migration 2026-07-02 b（Fable 5 下午場）
-- 內容：① 全服死亡熱點 RPC（匿名彙總，人人可查）
--       ② 隱藏統計頁 admin RPC（綁定 email，只有開發者拿得到數據）
-- 前置：需先跑過 migration_20260702.sql（events 表）。
-- 用法：Supabase SQL Editor 全選貼上 → Run（跑一次即可）。
-- ============================================================

-- ── ① 今日每日排名賽死亡熱點（匿名彙總）────────────────────────
-- 回傳今天（台灣日曆日）daily 模式死亡位置的 20 等分分佈 + 總死亡數。
-- 純聚合、不含任何個別玩家資訊 → 開放 anon 查詢無隱私疑慮。
create or replace function public.daily_death_heatmap()
returns table (bucket int, deaths bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    width_bucket(least(greatest((props->>'xr')::numeric, 0), 0.9999), 0, 1, 20) as bucket,
    count(*) as deaths
  from events
  where event = 'death'
    and mode  = 'daily'
    and props ? 'xr'
    and (ts at time zone 'Asia/Taipei')::date = (now() at time zone 'Asia/Taipei')::date
  group by 1
  order by 1;
$$;
revoke execute on function public.daily_death_heatmap() from public;
grant  execute on function public.daily_death_heatmap() to anon, authenticated;

-- ── ② 隱藏統計頁 admin 彙總（僅開發者 email 可取數）──────────────
-- 前端「連點版本號 5 下」只是入口糖衣，真正的門鎖在這裡：
-- JWT email 不符 → 回傳 null（靜默），別人開了頁面也拿不到任何數據。
create or replace function public.admin_stats(p_days int default 14)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  result jsonb;
begin
  if v_email <> 'tyl161803@gmail.com' then
    return null;
  end if;
  if p_days < 1 or p_days > 90 then p_days := 14; end if;

  select jsonb_build_object(
    -- 每日 DAU / 開局數
    'daily', (
      select coalesce(jsonb_agg(t order by t->>'d' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'd', (ts at time zone 'Asia/Taipei')::date,
          'dau', count(distinct device_id),
          'runs', count(*) filter (where event = 'run_start'),
          'finishes', count(*) filter (where event = 'finish'),
          'deaths', count(*) filter (where event = 'death'),
          'shares', count(*) filter (where event = 'share'),
          'revives', count(*) filter (where event = 'revive')
        ) as t
        from events
        where ts > now() - (p_days || ' days')::interval
        group by (ts at time zone 'Asia/Taipei')::date
      ) s
    ),
    -- 模式分佈（區間內開局）
    'modes', (
      select coalesce(jsonb_object_agg(mode, cnt), '{}'::jsonb) from (
        select coalesce(mode, '?') as mode, count(*) as cnt
        from events
        where event = 'run_start' and ts > now() - (p_days || ' days')::interval
        group by 1
      ) s
    ),
    -- 死亡原因分佈
    'deathCauses', (
      select coalesce(jsonb_object_agg(cause, cnt), '{}'::jsonb) from (
        select coalesce(props->>'cause', '?') as cause, count(*) as cnt
        from events
        where event = 'death' and ts > now() - (p_days || ' days')::interval
        group by 1
      ) s
    ),
    -- 次日留存（區間內 cohort）
    'retention', (
      with first_seen as (
        select device_id, min((ts at time zone 'Asia/Taipei')::date) as d0
        from events where event = 'run_start' group by device_id
      )
      select coalesce(jsonb_agg(t order by t->>'d0' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'd0', f.d0,
          'new', count(*),
          'retained', count(*) filter (where exists (
            select 1 from events e
            where e.device_id = f.device_id and e.event = 'run_start'
              and (e.ts at time zone 'Asia/Taipei')::date = f.d0 + 1
          ))
        ) as t
        from first_seen f
        where f.d0 > (now() at time zone 'Asia/Taipei')::date - p_days
          and f.d0 < (now() at time zone 'Asia/Taipei')::date
        group by f.d0
      ) s
    ),
    'totalEvents', (select count(*) from events),
    'generatedAt', now()
  ) into result;

  return result;
end;
$$;
revoke execute on function public.admin_stats(int) from public, anon;
grant  execute on function public.admin_stats(int) to authenticated;
