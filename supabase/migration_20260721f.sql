-- ============================================================
-- TaiexRider migration 2026-07-21f — lottery_spin() 補「重複補償是哪台車」欄位
--
-- 背景：使用者實測抽到已擁有的黃金期貨（P3），畫面只顯示「獲得 450 鑽石」，
-- 完全看不出來為什麼機率表沒有 450 這個數字、也不知道其實是抽中了 P3 車款。
-- 拍板：畫面依然要顯示「黃金期貨」這台車 + 一句「您已擁有，已換成等值鑽石」
-- 的說明，而不是只丟一個對不上機率表的數字。
--
-- 做法：lottery_spin() 新增 `duplicate_of` 輸出欄位（text，nullable）——重複
-- 保護觸發時填入原本抽到的車款 id，前端據此顯示正確的車款圖示/名稱 + 說明文字；
-- 沒觸發重複保護時是 null，行為不變。
--
-- 用法：Supabase Dashboard → SQL Editor → 全選貼上 → Run。
-- ⚠️ push 不會更新 DB，一定要手動跑這份。
-- ============================================================

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
  v_roll     numeric := random();
  v_prize_kind text;   -- 'diamond' / 'skin' / 'ticket'
  v_prize_id   text;   -- 鑽石數量/票券數量以文字存，或車款 id
  v_award_diamonds int := 0;
  v_award_tickets  int := 0;
  v_grant_skin text;
  v_duplicate_of text; -- 非 null＝重複保護觸發，記錄原本抽到的車款 id
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

  -- 累加機率區間決定結果（見 LOTTERY_DESIGN.md 機率表）
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
      -- 重複保護：已擁有，換算等值鑽石補償，記下原本抽到哪台車給前端顯示
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
      v_duplicate_of := v_grant_skin;
      v_prize_kind := 'diamond'; -- 貨幣層面當成鑽石獎勵入帳，前端顯示靠 duplicate_of 補說明
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

  return query select true, v_prize_kind, v_prize_id, v_diamonds, v_tickets, v_owned, v_duplicate_of;
end;
$$;
revoke execute on function public.lottery_spin(boolean) from public, anon;
grant  execute on function public.lottery_spin(boolean) to authenticated;
