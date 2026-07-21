-- ============================================================
-- TaiexRider migration 2026-07-21 — 抽獎轉輪 + 鑽石新出口
--   （票券/尾焰特效顏色/鬼影顏色/暱稱顏色/稱號/前綴圖示）+ 黑天鵝隱藏車款
-- 背景：LOTTERY_DESIGN.md（完整規格見該檔）。鑽石目前唯一出口是 P 系列車款，
--       對車無興趣的玩家鑽石沒有消費動機，本次開闢幾個純外觀/便利性鑽石出口
--       （不賣任何影響排行榜公平性的東西），並新增抽獎轉輪拉高每日回訪誘因。
-- 用法：Supabase Dashboard → SQL Editor → 全選貼上 → Run（跑一次即可，可重複跑）。
-- ⚠️ push 不會更新 DB，一定要手動跑這份，否則以下 RPC 都不存在。
-- ⚠️ 前端程式碼尚未跟著改（本次只準備後端），程式碼改完前這些 RPC 不會被呼叫，
--    先跑不會影響現有功能。
-- ============================================================

-- ── player_wallet 擴充：票券餘額（廣告券，花掉可跳過廣告直接領獎勵）──────
alter table public.player_wallet
  add column if not exists tickets int not null default 0 check (tickets >= 0);

-- ── wallet_daily_lottery：每日 2 次免費抽獎次數（比照 wallet_daily_attempts 模式）──
create table if not exists public.wallet_daily_lottery (
  player_id  text not null,
  spin_date  date not null,
  free_spins int  not null default 0,   -- 今日已使用的免費抽獎次數，上限 2
  primary key (player_id, spin_date)
);
alter table public.wallet_daily_lottery enable row level security;
revoke all on table public.wallet_daily_lottery from public, anon, authenticated;

-- ── wallet_get()：改成連票券一併回傳（原函式只回 coins/diamonds/owned）──────
-- Postgres 改 returns table 欄位不能用 create or replace，要先 drop 再建。
drop function if exists public.wallet_get();
create or replace function public.wallet_get()
returns table(coins int, diamonds int, owned jsonb, tickets int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then return; end if;

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  return query select w.coins, w.diamonds, w.owned, w.tickets from public.player_wallet w where w.player_id = v_uid;
end;
$$;
revoke execute on function public.wallet_get() from public, anon;
grant  execute on function public.wallet_get() to authenticated;

-- ── lottery_spin(p_paid)：抽獎主 RPC ──────────────────────────────────
-- p_paid = false（預設）：消耗今日免費額度（上限 2，超過拒絕，回傳 ok=false）。
-- p_paid = true：直接扣 20 鑽石買一次額外抽獎，不受每日次數限制，鑽石不足拒絕。
-- 機率表寫死在函式裡（不信任客戶端傳機率/結果），對應 LOTTERY_DESIGN.md 定案版：
--   5鑽75% / 10鑽18% / 30鑽3.5% / 100鑽0.6% / 300鑽0.09% / 1000鑽0.01% /
--   黑天鵝0.05% / P1(300鑽車)1.00% / P4(380鑽車)0.70% / P3(450鑽車)0.50% /
--   P5(520鑽車)0.35% / P2(600鑽車)0.20%。用 random() 配累加機率區間決定結果。
-- 重複保護：抽到已擁有的車款/黑天鵝，自動換算等值鑽石補償，不浪費這次抽獎。
-- 黑天鵝額外贈送稱號「title:blackswan-witness」+ 徽章「badge:blackswan」
-- （這兩項不開放直接購買，只能靠抽中黑天鵝取得，見 wallet_spend_item 白名單）。
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
  v_prize_kind text;   -- 'diamond' / 'skin'
  v_prize_id   text;   -- 鑽石數量以文字存（例如 '10'）或車款 id
  v_award_diamonds int := 0;
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

  -- 累加機率區間決定結果（見 LOTTERY_DESIGN.md 機率表）
  if v_roll < 0.75 then v_prize_kind := 'diamond'; v_award_diamonds := 5;
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

  if v_prize_kind = 'diamond' then
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
     set diamonds = v_diamonds, owned = v_owned, updated_at = now()
   where player_id = v_uid;

  return query select true, v_prize_kind, v_prize_id, v_diamonds, v_tickets, v_owned;
end;
$$;
revoke execute on function public.lottery_spin(boolean) from public, anon;
grant  execute on function public.lottery_spin(boolean) to authenticated;

-- ── lottery_state()：查詢今日已用免費抽獎次數（UI 判斷按鈕文案用）──────
create or replace function public.lottery_state()
returns table(free_spins_used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   text := auth.uid()::text;
  v_today date := (now() at time zone 'Asia/Taipei')::date;
begin
  if v_uid is null then return; end if;
  return query
    select coalesce(
      (select l.free_spins from public.wallet_daily_lottery l
        where l.player_id = v_uid and l.spin_date = v_today),
      0
    );
end;
$$;
revoke execute on function public.lottery_state() from public, anon;
grant  execute on function public.lottery_state() to authenticated;

-- ── wallet_spend_item(item_id)：購買鑽石新出口道具（暱稱顏色/稱號/前綴圖示/
--    尾焰特效顏色/鬼影顏色）。跟 wallet_spend_skin() 分開一支，避免動到既有
--    車款購買邏輯——這批全新道具價格白名單如下（同步 LOTTERY_DESIGN.md 第 4 節，
--    動工前價格若調整，這裡要跟著改）。黑天鵝專屬的 title:blackswan-witness /
--    badge:blackswan 刻意不在白名單內，不可購買。
create or replace function public.wallet_spend_item(p_item_id text)
returns table(diamonds int, owned jsonb, ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      text := auth.uid()::text;
  v_price    int;
  v_owned    jsonb;
  v_diamonds int;
begin
  if v_uid is null then return; end if;

  select t.price into v_price from (values
    ('nickcolor:neon-cyan'::text,   50),
    ('nickcolor:amber-gold',        50),
    ('nickcolor:danger-red',        80),
    ('nickcolor:deep-purple',       80),
    ('nickcolor:ghost-gray',       100),
    ('nickcolor:black-gold',       250),
    ('title:gravity-challenger',    60),
    ('title:air-walker',            60),
    ('title:perfect-landing',       80),
    ('title:win-streak',            80),
    ('title:leaderboard-regular',  100),
    ('title:taiex-god',            200),
    ('badge:fire',                  80),
    ('badge:star',                  80),
    ('badge:crown',                150),
    ('badge:diamond',              150),
    ('badge:motorcycle',           100),
    ('trail:amber',                 80),
    ('trail:magenta',               80),
    ('trail:green',                 80),
    ('trail:white',                100),
    ('ghostcolor:amber',            80),
    ('ghostcolor:magenta',          80),
    ('ghostcolor:green',            80),
    ('ghostcolor:white',           100)
  ) as t(id, price) where t.id = p_item_id;
  if v_price is null then return; end if; -- 未知/不可購買項目（含黑天鵝專屬道具）一律靜默拒絕

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  select w.owned, w.diamonds into v_owned, v_diamonds
    from public.player_wallet w where w.player_id = v_uid for update;

  if v_owned ? p_item_id then
    return query select v_diamonds, v_owned, true; -- 已擁有：冪等回傳現況，不重複扣款
    return;
  end if;

  if v_diamonds < v_price then
    return query select v_diamonds, v_owned, false;
    return;
  end if;

  v_diamonds := v_diamonds - v_price;
  v_owned := v_owned || jsonb_build_array(p_item_id);

  update public.player_wallet
     set diamonds = v_diamonds, owned = v_owned, updated_at = now()
   where player_id = v_uid;

  return query select v_diamonds, v_owned, true;
end;
$$;
revoke execute on function public.wallet_spend_item(text) from public, anon;
grant  execute on function public.wallet_spend_item(text) to authenticated;

-- ── consume_ticket()：花 1 張票券（廣告券），用於「復活」這類非貨幣型的
--    廣告門檻——單純扣票券，前端扣成功後照既有「看完廣告」的邏輯繼續走。
create or replace function public.consume_ticket()
returns table(ok boolean, tickets int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     text := auth.uid()::text;
  v_tickets int;
begin
  if v_uid is null then return; end if;

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  select w.tickets into v_tickets from public.player_wallet w where w.player_id = v_uid for update;
  if v_tickets < 1 then
    return query select false, v_tickets;
    return;
  end if;

  v_tickets := v_tickets - 1;
  update public.player_wallet set tickets = v_tickets, updated_at = now() where player_id = v_uid;

  return query select true, v_tickets;
end;
$$;
revoke execute on function public.consume_ticket() from public, anon;
grant  execute on function public.consume_ticket() to authenticated;

-- ── wallet_earn_via_ticket(p_kind)：花 1 張票券直接領取原本要看廣告才有的
--    貨幣獎勵（例如車庫拿金幣、結算雙倍）。金額/上限對照現有 wallet_earn()，
--    差別只在門檻從「看廣告」換成「扣一張票券」，兩者互不影響彼此的每日上限。
-- ⚠️ 全程把 coins/diamonds 現值先讀進 v_coins/v_diamonds 局部變數再運算賦值，
--    不寫 `set coins = coins + x` 這種容易跟輸出欄位同名撞名的寫法（見本檔
--    LOTTERY_DESIGN.md §8 第 4 點 / CLAUDE.md 42702 踩雷筆記）。
create or replace function public.wallet_earn_via_ticket(p_kind text)
returns table(ok boolean, coins int, diamonds int, tickets int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      text := auth.uid()::text;
  v_amount   int;
  v_cap      int;
  v_today    date := (now() at time zone 'Asia/Taipei')::date;
  v_n        int;
  v_tickets  int;
  v_coins    int;
  v_diamonds int;
begin
  if v_uid is null then return; end if;

  case p_kind
    when 'finish' then v_amount := 10; v_cap := 30;
    when 'crash'  then v_amount := 3;  v_cap := 30;
    when 'quest'  then v_amount := 25; v_cap := 3;
    when 'ad'     then v_amount := 20; v_cap := 2;
    else return; -- 未知 kind 靜默拒絕
  end case;

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  select w.tickets, w.coins, w.diamonds into v_tickets, v_coins, v_diamonds
    from public.player_wallet w where w.player_id = v_uid for update;

  if v_tickets < 1 then
    return query select false, v_coins, v_diamonds, v_tickets;
    return;
  end if;

  insert into public.wallet_earn_log as l (player_id, earn_date, kind, n)
  values (v_uid, v_today, p_kind, 1)
  on conflict (player_id, earn_date, kind) do update set n = l.n + 1
  returning n into v_n;
  if v_n > v_cap then
    -- 今日該管道已達上限：不扣票券、不發幣，回傳現況讓前端知道今天領完了
    return query select false, v_coins, v_diamonds, v_tickets;
    return;
  end if;

  v_tickets := v_tickets - 1;
  v_coins   := v_coins + v_amount;

  update public.player_wallet
     set coins = v_coins, tickets = v_tickets, updated_at = now()
   where player_id = v_uid;

  return query select true, v_coins, v_diamonds, v_tickets;
end;
$$;
revoke execute on function public.wallet_earn_via_ticket(text) from public, anon;
grant  execute on function public.wallet_earn_via_ticket(text) to authenticated;

-- ── 清理：wallet_daily_lottery 併入既有每日清理排程（只留最近 14 天）──────
create or replace function public.cleanup_old_wallet_logs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.wallet_earn_log where earn_date < current_date - interval '14 days';
  delete from public.wallet_daily_attempts where challenge_date < current_date - interval '14 days';
  delete from public.wallet_daily_lottery where spin_date < current_date - interval '14 days';
end;
$$;
revoke execute on function public.cleanup_old_wallet_logs() from public, anon, authenticated;
