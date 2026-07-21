-- ============================================================
-- TaiexRider migration 2026-07-21d — 修正 wallet_earn_via_ticket() 金額/上限
--   對錯版本 + 補上 long_finish/long_crash（長征模式雙倍要用）
--
-- 事故經過：20260721.sql 寫 wallet_earn_via_ticket() 時，抄的是 2026-07-05
-- 最原始版本的 wallet_earn() 金額表（finish=10/crash=3/quest=25/ad=20，
-- 上限 30/30/3/2），但 wallet_earn() 早就被 2026-07-09/07-10 兩次更新過，
-- 現在實際金額是 finish=5/crash=2/long_finish=30/long_crash=依比例/quest=25/
-- ad=40，上限統一 100/100/3/2，而且 long_finish/long_crash 這兩種（長征模式
-- 結算雙倍要用）舊版根本沒寫，會直接被 `else return` 拒絕。
-- 這份改成完全比照 migration_20260710.sql 那支「真正在線上跑」的 wallet_earn()
-- 邏輯，只把「門檻」從「已看過廣告」換成「扣一張票券」，其餘金額/上限/quest
-- 漲跌加倍規則全部保持一致。
-- ⚠️ 尚未有前端呼叫這支（GameCanvas 復活/雙倍還沒接上，這步之後才做），現在跑
-- 這份不影響任何現有功能，跑完之後才安全接前端。
-- 用法：Supabase Dashboard → SQL Editor → 全選貼上 → Run。
-- ============================================================

drop function if exists public.wallet_earn_via_ticket(text);
create or replace function public.wallet_earn_via_ticket(p_kind text, p_amount int default null)
returns table(ok boolean, coins int, diamonds int, tickets int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      text := auth.uid()::text;
  v_amount   int;
  v_cap      int;
  v_log_kind text;
  v_step     int;
  v_today    date := (now() at time zone 'Asia/Taipei')::date;
  v_n        int;
  v_change   numeric;
  v_tickets  int;
  v_coins    int;
  v_diamonds int;
begin
  if v_uid is null then return; end if;

  case p_kind
    when 'finish'      then v_amount := 5;  v_log_kind := 'play';  v_step := 5;  v_cap := 100;
    when 'crash'       then v_amount := 2;  v_log_kind := 'play';  v_step := 2;  v_cap := 100;
    when 'long_finish' then v_amount := 30; v_log_kind := 'play';  v_step := 30; v_cap := 100;
    when 'long_crash'  then
      v_amount   := greatest(0, least(30, coalesce(p_amount, 0))); -- 不信任前端，clamp 在 0~30
      v_log_kind := 'play';
      v_step     := v_amount;
      v_cap      := 100;
    when 'quest'  then v_amount := 25; v_log_kind := 'quest'; v_step := 1;  v_cap := 3;
    when 'ad'     then v_amount := 40; v_log_kind := 'ad';    v_step := 1;  v_cap := 2;
    else return; -- 未知 kind 靜默拒絕
  end case;

  if p_kind = 'quest' then
    v_change := public.taiex_change_pct();
    if v_change is not null and abs(v_change) >= 0.025 then
      v_amount := v_amount * 2;
    end if;
  end if;

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  select w.tickets, w.coins, w.diamonds into v_tickets, v_coins, v_diamonds
    from public.player_wallet w where w.player_id = v_uid for update;

  if v_tickets < 1 then
    return query select false, v_coins, v_diamonds, v_tickets;
    return;
  end if;

  insert into public.wallet_earn_log as l (player_id, earn_date, kind, n)
  values (v_uid, v_today, v_log_kind, v_step)
  on conflict (player_id, earn_date, kind) do update set n = l.n + v_step
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
revoke execute on function public.wallet_earn_via_ticket(text, int) from public, anon;
grant  execute on function public.wallet_earn_via_ticket(text, int) to authenticated;
