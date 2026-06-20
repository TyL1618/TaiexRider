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

-- ── 提交成績 RPC（security definer，upsert-if-better + 合理性驗證）──────────
-- 防偽造設計（v0.7 Google 登入版）：
--   1. p_id 已移除：player_id 由伺服器 auth.uid() 決定，客戶端無法偽造。
--   2. 必須是已登入用戶（auth.uid() IS NOT NULL），anon 無法呼叫。
--   3. 日期由伺服器決定 = 「目前這一期」session = daily_map 中 ≤ 台灣今天(+1容忍) 的 max(map_date)。
--      ⚠️ 不可用 current_date（UTC）：台灣午夜~早上 8 點間會少算一天 → 成績掛前一天 → 看似沒上榜。
--      ⚠️ 也不可只用台灣日曆日：連假/多日休市時，最後交易日的 map_date 不再等於日曆日，
--         排行榜讀取端（resolveSessionDate）用的是 max(map_date)，這裡必須同源，
--         否則連假第二天起成績掛在不同 key → 整張榜對不上。max(map_date) 連假整段不變 = 同一張榜。
--         找不到任何 map_date 時 fallback 台灣日曆日（DB 空或首次部署的保險）。
--   4. 分數 0~50000、時間 1s~2h、flips/perfect 0~50 合理性驗證。
-- 需先 DROP 舊簽名再建新版。

drop function if exists public.submit_daily_score(date, text, text, int, int, int, int);
drop function if exists public.submit_daily_score(text, text, int, int, int, int);

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
  -- challenge_date = daily_map 中 map_date ≤ 台灣今天（日曆日）的「最大」值，與前端 resolveSessionDate 同源。
  -- 上界用「今天」(非 +1)：map_date = sessionDate+1 已內建「00:00 才生效」，週末/連假整段沿用最後交易日那張榜，
  -- 隔天交易日盤抓到後在 00:00 才換新榜。DB 無 map_date 時 fallback 台灣日曆日。
  v_today date := coalesce(
    (select max(map_date) from public.daily_map
       where map_date <= (now() at time zone 'Asia/Taipei')::date),
    (now() at time zone 'Asia/Taipei')::date
  );
begin
  -- 必須是已登入用戶（Google OAuth），anon 靜默拒絕
  v_uid := auth.uid()::text;
  if v_uid is null then return; end if;

  -- 合理性驗證：靜默拒絕（不回傳錯誤，避免攻擊者得到線索）
  if p_score  < 0      or p_score  > 50000   then return; end if;
  if p_time   < 1000   or p_time   > 7200000 then return; end if;
  if p_flips  < 0      or p_flips  > 50      then return; end if;
  if p_perfect < 0     or p_perfect > 50     then return; end if;

  insert into public.daily_scores
    (challenge_date, player_id, player_name, score, time_ms, flips, perfect)
  values (v_today, v_uid, left(p_name, 16), p_score, p_time, p_flips, p_perfect)
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

-- 只允許已登入用戶執行提交 RPC（新簽名，無 p_id）
grant execute on function public.submit_daily_score(text, int, int, int, int) to authenticated;

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

-- ── 每日地圖（GitHub Actions 21:05 台灣時間抓全台股 + TAIEX，存隔日地圖）──────
-- (map_date, stock_code) 聯合主鍵：每天 ~960 筆，只保留最近 7 天（腳本自動清理）
drop table if exists public.daily_map;
create table public.daily_map (
  map_date     date        not null,
  stock_code   text        not null,
  stock_name   text        not null default '',
  prices       jsonb       not null,
  difficulty   numeric     not null default 0,  -- 最大單步漲跌幅，用於選「今日最難地圖」
  created_at   timestamptz not null default now(),
  primary key (map_date, stock_code)
);
create index daily_map_diff_idx on public.daily_map (map_date, difficulty desc);
alter table public.daily_map enable row level security;
drop policy if exists "anon read daily_map" on public.daily_map;
create policy "anon read daily_map" on public.daily_map
  for select to anon using (true);
grant select on public.daily_map to anon;

-- ── 保活表（cron-job.org 每日 ping，見 memory / DEVDOC）─────────
create table if not exists public.keep_alive (id int primary key, t timestamptz default now());
insert into public.keep_alive (id) values (1) on conflict do nothing;
alter table public.keep_alive enable row level security;
drop policy if exists "anon read keepalive" on public.keep_alive;
create policy "anon read keepalive" on public.keep_alive for select to anon using (true);
grant select on public.keep_alive to anon;
