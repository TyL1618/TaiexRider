-- ============================================================
-- TaiexRider migration 2026-07-04 b（Fable 5 晚場）— 資安第二輪修補
-- 內容：① log_event RPC 三層節流（修「anon 可無限呼叫灌爆 events 表」）
--       ② props 上限 2048 → 512（實際 payload 全 < 200B，縮小灌爆單位）
--       ③ cleanup_old_scores_if_needed 收權（改由每日 CI 以 service key 呼叫，
--          scripts/fetchDailyMap.ts 已同步加上呼叫；cron-job.org 那條 cleanup 排程可刪，
--          keepalive ping 排程不受影響、保留）
-- 前置：需先跑過 migration_20260702.sql（events 表 + log_event）。
-- 用法：Supabase SQL Editor 全選貼上 → Run（跑一次即可，可重複跑）。
-- ============================================================

-- ── 節流計數表（只有 security definer 函式讀寫，外部無任何權限）─────────
create table if not exists public.rate_limits (
  bucket  text primary key,          -- 'em:<ip>:<分>' / 'eh:global:<時>' / 'ed:global:<日>'
  n       int not null default 1,
  expires timestamptz not null       -- 過期即可刪（cleanup_old_events 每日順手清）
);
alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from public, anon, authenticated;

-- ── log_event：白名單 + 上限 + 三層節流 ─────────────────────────────
-- 節流設計：
--   1. 單一 IP 每分鐘 60 筆（合法玩家一局 ~4 個事件，NAT 共用 IP 也綽綽有餘）
--   2. 全服每小時 10,000 筆（封測 12 人日常 < 200 筆/天，正式上架後有量再調）
--   3. 全服每天 50,000 筆 → DB 膨脹絕對上限 ≈ 50k × ≤512B ≈ 25MB/天，灌爆不可能
--   IP 來源：cf-connecting-ip（Supabase 前面的 Cloudflare 蓋寫，客戶端無法偽造）優先，
--   退 x-forwarded-for 最後一節（最近可信 proxy 附加的那節；第一節客戶端可自填不可信）。
--   拿不到 IP 時全部落到 'unknown' 共用桶 → 失效模式是「限流變嚴」而非「限流失效」，
--   且打點本來就 fire-and-forget，被丟棄不影響遊戲。
create or replace function public.log_event(
  p_event  text,
  p_mode   text  default null,
  p_device text  default null,
  p_props  jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hdr jsonb;
  v_xff text;
  v_ip  text;
  v_n   int;
begin
  -- 白名單 + 上限驗證：不符合就靜默丟棄（打點失敗不該影響遊戲，也不給攻擊者線索）
  if p_event is null or p_event not in ('run_start','death','finish','revive','share') then return; end if;
  if p_mode is not null and char_length(p_mode) > 16 then return; end if;
  if pg_column_size(coalesce(p_props, '{}'::jsonb)) > 512 then return; end if;

  -- 來源 IP
  begin
    v_hdr := current_setting('request.headers', true)::jsonb;
  exception when others then
    v_hdr := null;
  end;
  v_xff := v_hdr ->> 'x-forwarded-for';
  v_ip := coalesce(
    v_hdr ->> 'cf-connecting-ip',
    nullif(trim((string_to_array(v_xff, ','))[cardinality(string_to_array(v_xff, ','))]), ''),
    'unknown');

  -- 三層節流（計數含被丟棄的呼叫；超限靜默丟棄）
  insert into public.rate_limits as r (bucket, n, expires)
  values ('em:' || v_ip || ':' || to_char(now(), 'YYYYMMDDHH24MI'), 1, now() + interval '10 minutes')
  on conflict (bucket) do update set n = r.n + 1
  returning n into v_n;
  if v_n > 60 then return; end if;

  insert into public.rate_limits as r (bucket, n, expires)
  values ('eh:global:' || to_char(now(), 'YYYYMMDDHH24'), 1, now() + interval '2 hours')
  on conflict (bucket) do update set n = r.n + 1
  returning n into v_n;
  if v_n > 10000 then return; end if;

  insert into public.rate_limits as r (bucket, n, expires)
  values ('ed:global:' || to_char(now(), 'YYYYMMDD'), 1, now() + interval '2 days')
  on conflict (bucket) do update set n = r.n + 1
  returning n into v_n;
  if v_n > 50000 then return; end if;

  insert into public.events (event, mode, device_id, player_id, props)
  values (p_event, p_mode, left(p_device, 48), auth.uid()::text, coalesce(p_props, '{}'::jsonb));
end;
$$;

revoke execute on function public.log_event(text, text, text, jsonb) from public;
grant  execute on function public.log_event(text, text, text, jsonb) to anon, authenticated;

-- ── cleanup_old_events：順手清過期節流計數 ──────────────────────────
create or replace function public.cleanup_old_events()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.events where ts < now() - interval '90 days';
  delete from public.rate_limits where expires < now();
end;
$$;
revoke execute on function public.cleanup_old_events() from public, anon, authenticated;

-- ── cleanup_old_scores_if_needed 收權（SECURITY_REVIEW 首輪 (c) 項，正式執行）──
-- 原 anon 可無限呼叫（後果輕但屬不必要攻擊面）。收權後只剩 service_role（天生繞過權限）：
-- 每日 GitHub Actions 的 fetchDailyMap.ts 已改為順手呼叫，cron-job.org 的 cleanup 排程可刪。
revoke execute on function public.cleanup_old_scores_if_needed() from public, anon, authenticated;
