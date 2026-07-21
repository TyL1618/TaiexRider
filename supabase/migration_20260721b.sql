-- ============================================================
-- TaiexRider migration 2026-07-21b — 補「看廣告換票券」RPC
-- 背景：migration_20260721.sql 只做了票券的花費端（consume_ticket/
--       wallet_earn_via_ticket），LOTTERY_DESIGN.md §9 標記賺取來源待確認。
--       動工時拍板：比照既有「車庫看廣告拿金幣」（wallet_earn('ad')）同一套
--       每日上限機制，複用 wallet_earn_log 表（kind='ticket'，不用再開新表）。
-- 用法：Supabase Dashboard → SQL Editor → 全選貼上 → Run（跑一次即可，可重複跑）。
-- ⚠️ push 不會更新 DB，一定要手動跑這份。
-- ============================================================

-- ── wallet_earn_ticket()：看廣告換 1 張票券，每日上限 2 張 ─────────────
-- ⚠️ 同樣避開 `set tickets = tickets + 1` 這種容易撞名寫法，先讀進 v_tickets
--    局部變數算好再整段賦值（見 CLAUDE.md 42702 踩雷筆記）。
create or replace function public.wallet_earn_ticket()
returns table(ok boolean, tickets int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     text := auth.uid()::text;
  v_today   date := (now() at time zone 'Asia/Taipei')::date;
  v_n       int;
  v_tickets int;
begin
  if v_uid is null then return; end if;

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  insert into public.wallet_earn_log as l (player_id, earn_date, kind, n)
  values (v_uid, v_today, 'ticket', 1)
  on conflict (player_id, earn_date, kind) do update set n = l.n + 1
  returning n into v_n;

  select w.tickets into v_tickets from public.player_wallet w where w.player_id = v_uid for update;

  if v_n > 2 then
    -- 今日已達上限：不發票券，回傳現況讓前端知道今天領完了
    return query select false, v_tickets;
    return;
  end if;

  v_tickets := v_tickets + 1;
  update public.player_wallet set tickets = v_tickets, updated_at = now() where player_id = v_uid;

  return query select true, v_tickets;
end;
$$;
revoke execute on function public.wallet_earn_ticket() from public, anon;
grant  execute on function public.wallet_earn_ticket() to authenticated;
