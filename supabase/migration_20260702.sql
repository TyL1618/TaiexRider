-- ============================================================
-- TaiexRider migration 2026-07-02（Fable 5）
-- 內容：① 監控 events 表 + log_event RPC ② 資安補強（SECURITY_REVIEW.md）
-- 用法：Supabase Dashboard → SQL Editor → 全選貼上 → Run（跑一次即可）
-- ⚠️ push 不會更新 DB，一定要手動跑這份，否則前端打點全部靜默失敗（不影響遊戲）。
-- ============================================================

-- ── ① 監控：events 表 ─────────────────────────────────────────
-- 輕量事件流：開局/死亡/完賽/復活/分享。zero-SDK，前端 fire-and-forget 打 RPC。
-- 讀取面完全不開放（無 select policy）：只有 Dashboard / service_role 可查，
-- 之後遊戲內隱藏統計頁再加「admin-only 彙總 RPC」。
create table if not exists public.events (
  id        bigint generated always as identity primary key,
  ts        timestamptz not null default now(),
  event     text  not null,          -- run_start | death | finish | revive | share
  mode      text,                    -- daily | slot | custom | long | classic
  device_id text,                    -- localStorage 匿名裝置 ID（跨模式/未登入也能算留存）
  player_id text,                    -- auth.uid()（已登入才有；由 RPC 決定，客戶端無法偽造）
  props     jsonb not null default '{}'::jsonb
);
create index if not exists events_ts_idx       on public.events (ts);
create index if not exists events_event_ts_idx on public.events (event, ts);

alter table public.events enable row level security;
revoke all on table public.events from anon, authenticated;
-- 刻意不建任何 select/insert policy：寫入只能走下面的 RPC，讀取只有後台。

-- 寫入 RPC：事件白名單 + 各欄位長度/大小上限（防塞爆），player_id 綁 auth.uid()
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
begin
  -- 白名單 + 上限驗證：不符合就靜默丟棄（打點失敗不該影響遊戲，也不給攻擊者線索）
  if p_event is null or p_event not in ('run_start','death','finish','revive','share') then return; end if;
  if p_mode is not null and char_length(p_mode) > 16 then return; end if;
  if pg_column_size(coalesce(p_props, '{}'::jsonb)) > 2048 then return; end if;

  insert into public.events (event, mode, device_id, player_id, props)
  values (p_event, p_mode, left(p_device, 48), auth.uid()::text, coalesce(p_props, '{}'::jsonb));
end;
$$;

-- Postgres 預設把函式 EXECUTE 給 PUBLIC，先收回再精準授權
revoke execute on function public.log_event(text, text, text, jsonb) from public;
grant  execute on function public.log_event(text, text, text, jsonb) to anon, authenticated;

-- 保留策略：原始事件留 90 天（由每日 GitHub Actions 以 service key 呼叫，見 fetchDailyMap.ts）
create or replace function public.cleanup_old_events()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.events where ts < now() - interval '90 days';
end;
$$;
revoke execute on function public.cleanup_old_events() from public, anon, authenticated;
-- service_role 天生繞過權限，CI 用 service key 呼叫即可。

-- ── ② 資安補強（SECURITY_REVIEW.md 2026-07-02）───────────────────
-- (a) user_profiles.player_name 長度硬上限（先截斷既有資料再上 constraint）
update public.user_profiles
  set player_name = left(player_name, 32)
  where char_length(player_name) > 32;
alter table public.user_profiles drop constraint if exists user_profiles_name_len;
alter table public.user_profiles
  add constraint user_profiles_name_len check (char_length(player_name) <= 32);

-- (b) SELECT policy 補 authenticated（原本只授 anon，登入後直查表會拿到 0 列的脆弱設計）
drop policy if exists "anon read scores" on public.daily_scores;
drop policy if exists "read scores" on public.daily_scores;
create policy "read scores" on public.daily_scores
  for select to anon, authenticated using (true);

drop policy if exists "anon read classic" on public.classic_records;
drop policy if exists "read classic" on public.classic_records;
create policy "read classic" on public.classic_records
  for select to anon, authenticated using (true);

drop policy if exists "anon read daily_map" on public.daily_map;
drop policy if exists "read daily_map" on public.daily_map;
create policy "read daily_map" on public.daily_map
  for select to anon, authenticated using (true);
grant select on public.daily_map to authenticated;

drop policy if exists "anon read keepalive" on public.keep_alive;
drop policy if exists "read keepalive" on public.keep_alive;
create policy "read keepalive" on public.keep_alive
  for select to anon, authenticated using (true);
grant select on public.keep_alive to authenticated;

-- (c)（可選，預設不動）cleanup_old_scores_if_needed 目前 anon 可呼叫。
-- 想收權時取消下行註解——⚠️ 收權後 cron-job.org 的呼叫端要改帶 service key，否則清理失效。
-- revoke execute on function public.cleanup_old_scores_if_needed() from public, anon, authenticated;
