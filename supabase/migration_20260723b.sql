-- ============================================================
-- TaiexRider migration 2026-07-23b — 幸運轉輪十連抽
--
-- 背景：使用者反映一次一次抽太花時間，拍板加十連抽（190 鑽石／次，比單抽 20×10=200
-- 便宜 10）。機率表跟單抽完全共用（LOTTERY_DESIGN.md 那張表），十抽裡任何一抽都可能
-- 抽到隱藏車款/P系列稀有車款，重複保護（已擁有→換等值鑽石）邏輯也逐抽即時生效——
-- 同一次十連裡連續抽到同一台車，第二次就會被判定成重複。
--
-- 做法：把 lottery_spin() 裡原本內嵌的「累加機率區間決定結果」那段抽籤邏輯抽成獨立
-- 函式 lottery_roll_prize()，單抽/十連共用同一張機率表——避免以後改機率表(這張表
-- 過去幾週已經改過好幾次)時，兩個函式各存一份、改一邊忘記改另一邊悄悄跑掉分岔
-- （這正是 CLAUDE.md 記錄過的 wallet_earn_via_ticket 金額表分岔事故同一種風險）。
-- lottery_spin() 本身行為完全不變，只是把機率判斷換成呼叫這個新函式，其餘（付費/
-- 免費次數檢查、重複保護、寫回錢包）原封不動。
--
-- 用法：Supabase Dashboard → SQL Editor → 全選貼上 → Run。
-- ⚠️ push 不會更新 DB，一定要手動跑這份。
-- ============================================================

-- ── ① 抽籤邏輯抽成獨立函式（純機率判斷，不碰錢包，方便單抽/十連共用）────────────
create or replace function public.lottery_roll_prize()
returns table(prize_kind text, award_diamonds int, award_tickets int, grant_skin text)
language plpgsql
set search_path = public
as $$
declare
  v_roll numeric := random();
  v_prize_kind text;
  v_award_diamonds int := 0;
  v_award_tickets int := 0;
  v_grant_skin text;
begin
  -- 跟 migration_20260721g.sql 的 lottery_spin() 完全一致的機率區間，原封不動搬過來。
  if v_roll < 0.08 then v_prize_kind := 'ticket'; v_award_tickets := 1;
  elsif v_roll < 0.10 then v_prize_kind := 'ticket'; v_award_tickets := 2;
  elsif v_roll < 0.7695 then v_prize_kind := 'diamond'; v_award_diamonds := 5;
  elsif v_roll < 0.77 then v_prize_kind := 'skin'; v_grant_skin := 'hidden-invisiblehand';
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

  return query select v_prize_kind, v_award_diamonds, v_award_tickets, v_grant_skin;
end;
$$;
revoke execute on function public.lottery_roll_prize() from public, anon;
grant  execute on function public.lottery_roll_prize() to authenticated;

-- ── ② lottery_spin()：改呼叫上面的共用函式，行為/回傳格式完全不變 ──────────────
drop function if exists public.lottery_spin(boolean);
create or replace function public.lottery_spin(p_paid boolean default false)
returns table(
  ok boolean, prize_kind text, prize_id text, diamonds int, tickets int, owned jsonb,
  duplicate_of text
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
  v_prize_kind text;
  v_prize_id   text;
  v_award_diamonds int;
  v_award_tickets  int;
  v_grant_skin text;
  v_duplicate_of text;
begin
  if v_uid is null then return; end if;

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  select w.owned, w.diamonds, w.tickets into v_owned, v_diamonds, v_tickets
    from public.player_wallet w where w.player_id = v_uid for update;

  if p_paid then
    if v_diamonds < 20 then
      return query select false, null::text, null::text, v_diamonds, v_tickets, v_owned, null::text;
      return;
    end if;
    v_diamonds := v_diamonds - 20;
  else
    insert into public.wallet_daily_lottery as l (player_id, spin_date, free_spins)
    values (v_uid, v_today, 1)
    on conflict (player_id, spin_date) do update set free_spins = l.free_spins + 1
    returning free_spins into v_n;
    if v_n > 2 then
      return query select false, null::text, null::text, v_diamonds, v_tickets, v_owned, null::text;
      return;
    end if;
  end if;

  select r.prize_kind, r.award_diamonds, r.award_tickets, r.grant_skin
    into v_prize_kind, v_award_diamonds, v_award_tickets, v_grant_skin
    from public.lottery_roll_prize() r;

  if v_prize_kind = 'ticket' then
    v_tickets := v_tickets + v_award_tickets;
    v_prize_id := v_award_tickets::text;
  elsif v_prize_kind = 'diamond' then
    v_diamonds := v_diamonds + v_award_diamonds;
    v_prize_id := v_award_diamonds::text;
  else
    if v_owned ? v_grant_skin then
      v_award_diamonds := case v_grant_skin
        when 'hidden-blackswan' then 800
        when 'hidden-invisiblehand' then 800
        when 'p1-crimson' then 300
        when 'p4-samurai' then 380
        when 'p3-gold'    then 450
        when 'p5-phantom' then 520
        when 'p2-galaxy'  then 600
        else 0
      end;
      v_diamonds := v_diamonds + v_award_diamonds;
      v_duplicate_of := v_grant_skin;
      v_prize_kind := 'diamond';
      v_prize_id := v_award_diamonds::text;
    else
      v_owned := v_owned || jsonb_build_array(v_grant_skin);
      if v_grant_skin = 'hidden-blackswan' then
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

  return query select true, v_prize_kind, v_prize_id, v_diamonds, v_tickets, v_owned, v_duplicate_of;
end;
$$;
revoke execute on function public.lottery_spin(boolean) from public, anon;
grant  execute on function public.lottery_spin(boolean) to authenticated;

-- ── ③ 新函式：十連抽（固定 190 鑽石，沒有免費管道）─────────────────────────────
-- prizes 回傳 jsonb 陣列，每個元素 {prize_kind, prize_id, duplicate_of}，跟前端
-- LotterySlot.tsx 單抽的 LotterySpinResult 欄位命名一致，前端逐筆轉換即可。
create or replace function public.lottery_spin_x10()
returns table(ok boolean, prizes jsonb, diamonds int, tickets int, owned jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      text := auth.uid()::text;
  v_owned    jsonb;
  v_diamonds int;
  v_tickets  int;
  v_prizes   jsonb := '[]'::jsonb;
  v_prize_kind text;
  v_prize_id   text;
  v_award_diamonds int;
  v_award_tickets  int;
  v_grant_skin text;
  v_duplicate_of text;
  i int;
begin
  if v_uid is null then return; end if;

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  select w.owned, w.diamonds, w.tickets into v_owned, v_diamonds, v_tickets
    from public.player_wallet w where w.player_id = v_uid for update;

  if v_diamonds < 190 then
    return query select false, '[]'::jsonb, v_diamonds, v_tickets, v_owned;
    return;
  end if;
  v_diamonds := v_diamonds - 190;

  for i in 1..10 loop
    v_duplicate_of := null;

    select r.prize_kind, r.award_diamonds, r.award_tickets, r.grant_skin
      into v_prize_kind, v_award_diamonds, v_award_tickets, v_grant_skin
      from public.lottery_roll_prize() r;

    if v_prize_kind = 'ticket' then
      v_tickets := v_tickets + v_award_tickets;
      v_prize_id := v_award_tickets::text;
    elsif v_prize_kind = 'diamond' then
      v_diamonds := v_diamonds + v_award_diamonds;
      v_prize_id := v_award_diamonds::text;
    else
      -- 重複保護用「這次十連目前為止已更新的 v_owned」判斷，同一批連抽到同一台車
      -- 第二次就會被判重複，跟單抽邏輯一致，不會讓十連變相繞過保護機制。
      if v_owned ? v_grant_skin then
        v_award_diamonds := case v_grant_skin
          when 'hidden-blackswan' then 800
          when 'hidden-invisiblehand' then 800
          when 'p1-crimson' then 300
          when 'p4-samurai' then 380
          when 'p3-gold'    then 450
          when 'p5-phantom' then 520
          when 'p2-galaxy'  then 600
          else 0
        end;
        v_diamonds := v_diamonds + v_award_diamonds;
        v_duplicate_of := v_grant_skin;
        v_prize_kind := 'diamond';
        v_prize_id := v_award_diamonds::text;
      else
        v_owned := v_owned || jsonb_build_array(v_grant_skin);
        if v_grant_skin = 'hidden-blackswan' then
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

    v_prizes := v_prizes || jsonb_build_array(jsonb_build_object(
      'prize_kind', v_prize_kind, 'prize_id', v_prize_id, 'duplicate_of', v_duplicate_of
    ));
  end loop;

  update public.player_wallet
     set diamonds = v_diamonds, tickets = v_tickets, owned = v_owned, updated_at = now()
   where player_id = v_uid;

  return query select true, v_prizes, v_diamonds, v_tickets, v_owned;
end;
$$;
revoke execute on function public.lottery_spin_x10() from public, anon;
grant  execute on function public.lottery_spin_x10() to authenticated;
