-- ============================================================
-- TaiexRider migration 2026-07-21e — 票券新增管道（抽獎+一般/長征模式結算機率）
--   + 5 個「成就解鎖稱號」（連勝狂魔/排行榜常客/空中飛人/地心引力挑戰者/
--   完美落地大師，改成不可購買、達標自動解鎖，比照 Q 系列車款模式）
--
-- 背景：使用者拍板——① 票券不該只有看廣告一種來源，抽獎轉輪跟一般/長征模式
-- 結算都該有機會拿到，這樣才會吸引玩家玩排行榜以外的模式；② 這 5 個稱號原本
-- 規劃可以花鑽石買，但玩家自己「買」一個宣稱自己很強的稱號很奇怪，改成跟
-- Q 系列車款一樣要達標自動解鎖，花錢買的稱號改成純粹好玩、跟遊戲實力無關的
-- 股市梗稱號（見 Garage.tsx COSMETIC_CATALOG 那批更新，這裡只動後端）。
--
-- 用法：Supabase Dashboard → SQL Editor → 全選貼上 → Run（跑一次即可，可重複跑）。
-- ⚠️ push 不會更新 DB，一定要手動跑這份。
-- ============================================================

-- ── player_achievements 擴充：稱號解鎖用的累計翻轉/完美落地次數 ──────────
alter table public.player_achievements
  add column if not exists total_flips   int not null default 0,
  add column if not exists total_perfect int not null default 0;

-- ── record_run_stats(p_flips, p_perfect)：每局結束累加，不信任前端數字，
--    clamp 在單局合理上限（50 圈翻轉/30 次完美落地）避免竄改灌爆。────────
create or replace function public.record_run_stats(p_flips int, p_perfect int)
returns table(total_flips int, total_perfect int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
  v_add_flips   int := greatest(0, least(50, coalesce(p_flips, 0)));
  v_add_perfect int := greatest(0, least(30, coalesce(p_perfect, 0)));
  v_flips   int;
  v_perfect int;
begin
  if v_uid is null then return; end if;

  insert into public.player_achievements (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  select a.total_flips, a.total_perfect into v_flips, v_perfect
    from public.player_achievements a where a.player_id = v_uid for update;

  v_flips   := v_flips + v_add_flips;
  v_perfect := v_perfect + v_add_perfect;

  update public.player_achievements
     set total_flips = v_flips, total_perfect = v_perfect
   where player_id = v_uid;

  return query select v_flips, v_perfect;
end;
$$;
revoke execute on function public.record_run_stats(int, int) from public, anon;
grant  execute on function public.record_run_stats(int, int) to authenticated;

-- ── wallet_maybe_earn_ticket()：一般/長征模式結算時的機率型票券獎勵 ──────
-- 8% 機率獲得 1 張票券，每日這個管道上限 3 張（wallet_earn_log kind='session_ticket'，
-- 跟看廣告換票券的每日 2 張上限各自獨立）。呼叫端（App.tsx handleGameOver）只在
-- 一般/長征模式（非排行榜/經典）呼叫。
create or replace function public.wallet_maybe_earn_ticket()
returns table(granted boolean, tickets int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   text := auth.uid()::text;
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_n     int;
  v_tickets int;
begin
  if v_uid is null then return; end if;

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  insert into public.wallet_earn_log as l (player_id, earn_date, kind, n)
  values (v_uid, v_today, 'session_ticket', 1)
  on conflict (player_id, earn_date, kind) do update set n = l.n + 1
  returning n into v_n;

  select w.tickets into v_tickets from public.player_wallet w where w.player_id = v_uid;

  if v_n > 3 or random() >= 0.08 then
    return query select false, v_tickets;
    return;
  end if;

  v_tickets := v_tickets + 1;
  update public.player_wallet set tickets = v_tickets, updated_at = now() where player_id = v_uid;

  return query select true, v_tickets;
end;
$$;
revoke execute on function public.wallet_maybe_earn_ticket() from public, anon;
grant  execute on function public.wallet_maybe_earn_ticket() to authenticated;

-- ── wallet_unlock_achievement()：白名單擴增 5 個新稱號（不扣鑽石，達標才給）──
create or replace function public.wallet_unlock_achievement(p_skin_id text)
returns table(owned jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
  v_owned jsonb;
begin
  if v_uid is null then return; end if;
  if p_skin_id not in (
    'q1-bull', 'q2-bear', 'q3-phoenix',
    'title:win-streak', 'title:leaderboard-regular',
    'title:air-walker', 'title:gravity-challenger', 'title:perfect-landing'
  ) then return; end if;

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  select w.owned into v_owned from public.player_wallet w where w.player_id = v_uid for update;
  if not (v_owned ? p_skin_id) then
    v_owned := v_owned || jsonb_build_array(p_skin_id);
    update public.player_wallet set owned = v_owned, updated_at = now() where player_id = v_uid;
  end if;

  return query select v_owned;
end;
$$;
revoke execute on function public.wallet_unlock_achievement(text) from public, anon;
grant  execute on function public.wallet_unlock_achievement(text) to authenticated;

-- ── wallet_get()：再擴充 total_flips/total_perfect（⚠️ 這是第三次改這支函式的
--    輸出欄位，前兩次都因為漏抄舊欄位出過事故——這次完整複製
--    migration_20260721c.sql 目前正確的 10 欄位版本，只在尾端新增這兩個，
--    絕對不能只挑「這次要加的」重寫）。────────────────────────────────
drop function if exists public.wallet_get();
create or replace function public.wallet_get()
returns table(
  coins int, diamonds int, owned jsonb,
  bull_finishes int, bear_finishes int,
  streak_count int, last_session_key date,
  collection text[], ads_removed boolean,
  tickets int, total_flips int, total_perfect int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then return; end if;

  insert into public.player_wallet (player_id) values (v_uid) on conflict (player_id) do nothing;
  insert into public.player_achievements (player_id) values (v_uid) on conflict (player_id) do nothing;
  insert into public.player_streak (player_id) values (v_uid) on conflict (player_id) do nothing;
  insert into public.player_collection (player_id) values (v_uid) on conflict (player_id) do nothing;

  return query
    select w.coins, w.diamonds, w.owned,
           a.bull_finishes, a.bear_finishes,
           s.streak_count, s.last_session_key,
           c.codes, w.ads_removed, w.tickets,
           a.total_flips, a.total_perfect
      from public.player_wallet w
      join public.player_achievements a on a.player_id = w.player_id
      join public.player_streak s on s.player_id = w.player_id
      join public.player_collection c on c.player_id = w.player_id
     where w.player_id = v_uid;
end;
$$;
revoke execute on function public.wallet_get() from public, anon;
grant  execute on function public.wallet_get() to authenticated;

-- ── lottery_spin()：機率表加入票券獎項（從 5鑽/10鑽的機率切一部分出來）──────
-- 新機率：1張票券 8%（原 5鑽 75%→67%）、2張票券 2%（原 10鑽 18%→16%），
-- 其餘獎項機率不變。見 LOTTERY_DESIGN.md 更新版機率表。
create or replace function public.lottery_spin(p_paid boolean default false)
returns table(
  ok boolean, prize_kind text, prize_id text, diamonds int, tickets int, owned jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      text := auth.uid()::text;
  v_today    date := (now() at time zone 'Asia/Taipei')::date;
  v_n        int;
  v_owned    jsonb;
  v_diamonds int;
  v_tickets  int;
  v_roll     numeric := random();
  v_prize_kind text;   -- 'diamond' / 'skin' / 'ticket'
  v_prize_id   text;   -- 鑽石數量/票券數量以文字存，或車款 id
  v_award_diamonds int := 0;
  v_award_tickets  int := 0;
  v_grant_skin text;
begin
  if v_uid is null then return; end if;

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  select w.owned, w.diamonds, w.tickets into v_owned, v_diamonds, v_tickets
    from public.player_wallet w where w.player_id = v_uid for update;

  if p_paid then
    if v_diamonds < 20 then
      return query select false, null::text, null::text, v_diamonds, v_tickets, v_owned;
      return;
    end if;
    v_diamonds := v_diamonds - 20;
  else
    insert into public.wallet_daily_lottery as l (player_id, spin_date, free_spins)
    values (v_uid, v_today, 1)
    on conflict (player_id, spin_date) do update set free_spins = l.free_spins + 1
    returning free_spins into v_n;
    if v_n > 2 then
      return query select false, null::text, null::text, v_diamonds, v_tickets, v_owned;
      return;
    end if;
  end if;

  -- 累加機率區間決定結果（見 LOTTERY_DESIGN.md 機率表，本次改版加入票券獎項）
  if v_roll < 0.08 then v_prize_kind := 'ticket'; v_award_tickets := 1;
  elsif v_roll < 0.10 then v_prize_kind := 'ticket'; v_award_tickets := 2;
  elsif v_roll < 0.77 then v_prize_kind := 'diamond'; v_award_diamonds := 5;
  elsif v_roll < 0.93 then v_prize_kind := 'diamond'; v_award_diamonds := 10;
  elsif v_roll < 0.965 then v_prize_kind := 'diamond'; v_award_diamonds := 30;
  elsif v_roll < 0.971 then v_prize_kind := 'diamond'; v_award_diamonds := 100;
  elsif v_roll < 0.9719 then v_prize_kind := 'diamond'; v_award_diamonds := 300;
  elsif v_roll < 0.9720 then v_prize_kind := 'diamond'; v_award_diamonds := 1000;
  elsif v_roll < 0.9725 then v_prize_kind := 'skin'; v_grant_skin := 'hidden-blackswan';
  elsif v_roll < 0.9825 then v_prize_kind := 'skin'; v_grant_skin := 'p1-crimson';
  elsif v_roll < 0.9895 then v_prize_kind := 'skin'; v_grant_skin := 'p4-samurai';
  elsif v_roll < 0.9945 then v_prize_kind := 'skin'; v_grant_skin := 'p3-gold';
  elsif v_roll < 0.9980 then v_prize_kind := 'skin'; v_grant_skin := 'p5-phantom';
  else v_prize_kind := 'skin'; v_grant_skin := 'p2-galaxy';
  end if;

  if v_prize_kind = 'ticket' then
    v_tickets := v_tickets + v_award_tickets;
    v_prize_id := v_award_tickets::text;
  elsif v_prize_kind = 'diamond' then
    v_diamonds := v_diamonds + v_award_diamonds;
    v_prize_id := v_award_diamonds::text;
  else
    if v_owned ? v_grant_skin then
      -- 重複保護：已擁有，換算等值鑽石補償
      v_award_diamonds := case v_grant_skin
        when 'hidden-blackswan' then 800
        when 'p1-crimson' then 300
        when 'p4-samurai' then 380
        when 'p3-gold'    then 450
        when 'p5-phantom' then 520
        when 'p2-galaxy'  then 600
        else 0
      end;
      v_diamonds := v_diamonds + v_award_diamonds;
      v_prize_kind := 'diamond'; -- 呈現給前端時當成鑽石獎勵（可加註「重複補償」文案）
      v_prize_id := v_award_diamonds::text;
    else
      v_owned := v_owned || jsonb_build_array(v_grant_skin);
      if v_grant_skin = 'hidden-blackswan' then
        -- 黑天鵝額外贈送專屬稱號 + 徽章（不可購買，只能靠這裡取得）
        if not (v_owned ? 'title:blackswan-witness') then
          v_owned := v_owned || jsonb_build_array('title:blackswan-witness');
        end if;
        if not (v_owned ? 'badge:blackswan') then
          v_owned := v_owned || jsonb_build_array('badge:blackswan');
        end if;
      end if;
      v_prize_id := v_grant_skin;
    end if;
  end if;

  update public.player_wallet
     set diamonds = v_diamonds, tickets = v_tickets, owned = v_owned, updated_at = now()
   where player_id = v_uid;

  return query select true, v_prize_kind, v_prize_id, v_diamonds, v_tickets, v_owned;
end;
$$;
revoke execute on function public.lottery_spin(boolean) from public, anon;
grant  execute on function public.lottery_spin(boolean) to authenticated;
