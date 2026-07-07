-- ============================================================================
-- 2026-07-08 使用者拍板：每日/週任務池從 5 種擴充到 10 種（久了同樣 5 種任務會
-- 一直重複用不同組合出現，加新種類增加新鮮感）。新增類型需要額外資料（是否完賽/
-- 玩的模式/當天盤勢方向），每日任務純本地不用改 DB；週任務需登入者的進度存伺服器，
-- 這份就是加週任務新欄位＋改對應 RPC（跟 client 端 v0.12.x 同步，一起跑）。
--
-- 在 Supabase SQL Editor 執行一次即可（需先跑過 migration_20260706b.sql 建立
-- player_weekly_quest 表）。
-- ============================================================================

alter table public.player_weekly_quest
  add column if not exists finish_count        int not null default 0,
  add column if not exists long_finish_count    int not null default 0,
  add column if not exists classic_finish_count int not null default 0,
  add column if not exists up_day_finish_count  int not null default 0,
  add column if not exists down_day_finish_count int not null default 0;

-- ── get_weekly_quest()：回傳多加 5 個新欄位（改了 RETURNS TABLE 形狀，
--    create or replace 不能改回傳型別，要先 drop）──────────────────────
drop function if exists public.get_weekly_quest(text);
create or replace function public.get_weekly_quest(p_week text)
returns table(
  perfect_sum int, flips_sum int, max_score int, max_survive_sec numeric, play_count int,
  finish_count int, long_finish_count int, classic_finish_count int,
  up_day_finish_count int, down_day_finish_count int, claimed text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then return; end if;
  insert into public.player_weekly_quest (player_id, week_key) values (v_uid, p_week)
    on conflict (player_id, week_key) do nothing;
  return query select
    q.perfect_sum, q.flips_sum, q.max_score, q.max_survive_sec, q.play_count,
    q.finish_count, q.long_finish_count, q.classic_finish_count,
    q.up_day_finish_count, q.down_day_finish_count, q.claimed
    from public.player_weekly_quest q where q.player_id = v_uid and q.week_key = p_week;
end;
$$;
revoke execute on function public.get_weekly_quest(text) from public, anon;
grant  execute on function public.get_weekly_quest(text) to authenticated;

-- ── record_weekly_run()：多收 p_finished/p_mode/p_market_mood，累加新欄位 ──
-- p_mode/p_market_mood 是前端自己傳的字串，只拿來決定「+1 哪個計數器」，不影響
-- 金幣/鑽石等有價值的東西，就算被竄改頂多讓某個任務進度多跳一點，風險等級很低，
-- 不需要伺服器重算（跟 quest 金幣本身的驗證是分開兩件事，claim_weekly_quest 才管錢）。
drop function if exists public.record_weekly_run(text,int,int,int,int);
create or replace function public.record_weekly_run(
  p_week text, p_score int, p_flips int, p_perfect int, p_time_ms int,
  p_finished boolean default false, p_mode text default null, p_market_mood text default null
) returns table(
  perfect_sum int, flips_sum int, max_score int, max_survive_sec numeric, play_count int,
  finish_count int, long_finish_count int, classic_finish_count int,
  up_day_finish_count int, down_day_finish_count int, claimed text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
  v_finish_inc        int := case when p_finished then 1 else 0 end;
  v_long_finish_inc    int := case when p_finished and p_mode = 'long'    then 1 else 0 end;
  v_classic_finish_inc int := case when p_finished and p_mode = 'classic' then 1 else 0 end;
  v_up_finish_inc      int := case when p_finished and p_market_mood = 'up'   then 1 else 0 end;
  v_down_finish_inc    int := case when p_finished and p_market_mood = 'down' then 1 else 0 end;
begin
  if v_uid is null then return; end if;

  insert into public.player_weekly_quest
    (player_id, week_key, perfect_sum, flips_sum, max_score, max_survive_sec, play_count,
     finish_count, long_finish_count, classic_finish_count, up_day_finish_count, down_day_finish_count)
  values (
    v_uid, p_week, greatest(p_perfect, 0), greatest(p_flips, 0), greatest(p_score, 0),
    greatest(p_time_ms, 0) / 1000.0, 1,
    v_finish_inc, v_long_finish_inc, v_classic_finish_inc, v_up_finish_inc, v_down_finish_inc
  )
  on conflict (player_id, week_key) do update
    set perfect_sum        = player_weekly_quest.perfect_sum + greatest(p_perfect, 0),
        flips_sum          = player_weekly_quest.flips_sum + greatest(p_flips, 0),
        max_score          = greatest(player_weekly_quest.max_score, p_score),
        max_survive_sec    = greatest(player_weekly_quest.max_survive_sec, greatest(p_time_ms, 0) / 1000.0),
        play_count         = player_weekly_quest.play_count + 1,
        finish_count       = player_weekly_quest.finish_count + v_finish_inc,
        long_finish_count  = player_weekly_quest.long_finish_count + v_long_finish_inc,
        classic_finish_count = player_weekly_quest.classic_finish_count + v_classic_finish_inc,
        up_day_finish_count  = player_weekly_quest.up_day_finish_count + v_up_finish_inc,
        down_day_finish_count = player_weekly_quest.down_day_finish_count + v_down_finish_inc,
        updated_at         = now();

  return query select
    q.perfect_sum, q.flips_sum, q.max_score, q.max_survive_sec, q.play_count,
    q.finish_count, q.long_finish_count, q.classic_finish_count,
    q.up_day_finish_count, q.down_day_finish_count, q.claimed
    from public.player_weekly_quest q where q.player_id = v_uid and q.week_key = p_week;
end;
$$;
revoke execute on function public.record_weekly_run(text,int,int,int,int,boolean,text,text) from public, anon;
grant  execute on function public.record_weekly_run(text,int,int,int,int,boolean,text,text) to authenticated;

-- ── claim_weekly_quest()：case 補新任務 id 的面額 ─────────────────────────
create or replace function public.claim_weekly_quest(p_week text, p_quest_id text)
returns table(coins int, ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     text := auth.uid()::text;
  v_reward  int;
  v_change  numeric;
  v_claimed text[];
begin
  if v_uid is null then return; end if;

  case p_quest_id
    when 'w_flips30'    then v_reward := 40;
    when 'w_perfect10'  then v_reward := 40;
    when 'w_score2000'  then v_reward := 40;
    when 'w_play10'     then v_reward := 35;
    when 'w_survive25'  then v_reward := 35;
    when 'w_finish10'       then v_reward := 40;
    when 'w_longFinish3'    then v_reward := 45;
    when 'w_classicFinish3' then v_reward := 40;
    when 'w_upDayFinish3'   then v_reward := 35;
    when 'w_downDayFinish3' then v_reward := 35;
    else
      return query select w.coins, false from public.player_wallet w where w.player_id = v_uid;
      return;
  end case;

  insert into public.player_weekly_quest (player_id, week_key) values (v_uid, p_week)
    on conflict (player_id, week_key) do nothing;

  select claimed into v_claimed from public.player_weekly_quest
    where player_id = v_uid and week_key = p_week;

  if v_claimed is not null and p_quest_id = any(v_claimed) then
    return query select w.coins, false from public.player_wallet w where w.player_id = v_uid;
    return;
  end if;

  v_change := public.taiex_change_pct();
  if v_change is not null and abs(v_change) >= 0.025 then
    v_reward := v_reward * 2;
  end if;

  update public.player_weekly_quest
     set claimed = claimed || array[p_quest_id], updated_at = now()
   where player_id = v_uid and week_key = p_week;

  insert into public.player_wallet (player_id) values (v_uid) on conflict (player_id) do nothing;
  update public.player_wallet set coins = coins + v_reward, updated_at = now() where player_id = v_uid;

  return query select w.coins, true from public.player_wallet w where w.player_id = v_uid;
end;
$$;
revoke execute on function public.claim_weekly_quest(text,text) from public, anon;
grant  execute on function public.claim_weekly_quest(text,text) to authenticated;
