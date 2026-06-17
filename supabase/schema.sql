-- TaiexRider Phase 4 後端 schema（排行榜 MVP）
-- 用法：在 Supabase 專案的 SQL Editor 全選貼上 → Run。
-- 設計見 DEVDOC §11。

-- ── 每日成績表 ────────────────────────────────────────────────
create table if not exists public.daily_scores (
  id            uuid primary key default gen_random_uuid(),
  challenge_date date         not null,
  player_id     text          not null,
  player_name   text          not null,
  score         int           not null,
  time_ms       int           not null,
  flips         int           not null default 0,
  perfect       int           not null default 0,
  created_at    timestamptz   not null default now(),
  unique (challenge_date, player_id)        -- 每人每日一筆（取最佳）
);

-- 排行榜查詢索引：同一天依「分數高→時間短」
create index if not exists daily_scores_rank_idx
  on public.daily_scores (challenge_date, score desc, time_ms asc);

-- ── 提交成績 RPC（security definer，upsert-if-better）──────────
-- anon 只能呼叫此 function，不能直接寫表 → 稍微收斂偽造。
create or replace function public.submit_daily_score(
  p_date    date,
  p_id      text,
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
begin
  insert into public.daily_scores
    (challenge_date, player_id, player_name, score, time_ms, flips, perfect)
  values (p_date, p_id, left(p_name, 16), greatest(p_score, 0), greatest(p_time, 0),
          greatest(p_flips, 0), greatest(p_perfect, 0))
  on conflict (challenge_date, player_id) do update
    set score       = excluded.score,
        time_ms     = excluded.time_ms,
        flips       = excluded.flips,
        perfect     = excluded.perfect,
        player_name = excluded.player_name,
        created_at  = now()
    -- 只有「分數更高，或同分但時間更短」才覆蓋
    where excluded.score > public.daily_scores.score
       or (excluded.score = public.daily_scores.score
           and excluded.time_ms < public.daily_scores.time_ms);
end;
$$;

-- ── RLS ───────────────────────────────────────────────────────
alter table public.daily_scores enable row level security;

-- 任何人可讀排行榜
drop policy if exists "anon read scores" on public.daily_scores;
create policy "anon read scores" on public.daily_scores
  for select to anon using (true);

-- 不開放直接 insert/update（一律走 RPC）
revoke insert, update, delete on public.daily_scores from anon;

-- 允許 anon 執行提交 RPC
grant execute on function public.submit_daily_score(date, text, text, int, int, int, int) to anon;

-- ── 自動清理（DB > 400 MB 時刪 90 天前成績，由 cron-job.org 每日呼叫）────
create or replace function public.cleanup_old_scores_if_needed()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  db_size_mb numeric;
begin
  select pg_database_size(current_database()) / 1024.0 / 1024.0
  into db_size_mb;

  if db_size_mb > 400 then
    delete from public.daily_scores
    where challenge_date < current_date - interval '90 days';
  end if;
end;
$$;

grant execute on function public.cleanup_old_scores_if_needed() to anon;

-- ── 保活表（cron-job.org 每日 ping，見 memory / DEVDOC）─────────
create table if not exists public.keep_alive (id int primary key, t timestamptz default now());
insert into public.keep_alive (id) values (1) on conflict do nothing;
alter table public.keep_alive enable row level security;
drop policy if exists "anon read keepalive" on public.keep_alive;
create policy "anon read keepalive" on public.keep_alive for select to anon using (true);
grant select on public.keep_alive to anon;
