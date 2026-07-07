-- ============================================================================
-- 2026-07-07 使用者拍板兩項調整（跟 client 端 v0.12.34 同步，一起跑）：
--
-- ① wallet_earn()：完賽/摔車獎勵調降（10→5／3→2），且改成兩者共用同一個
--    「每日 50 金幣」組合上限（原本各自獨立用「次數」計 30 次上限，等於單日
--    最多 300/90 金幣，太容易靠刷短賽道無限賺——現在改成不論怎麼組合，
--    完賽+摔車合計單日最多 50 金幣）。quest/ad 兩種 kind 完全不受影響，維持
--    原本各自的次數上限（quest 3 次/日、ad 2 次/日），使用者明確要求範圍只
--    包含玩遊戲（完賽/摔車）獎勵。
-- ② wallet_spend_skin()：P 系列鑽石車款重新排序定價（id 不變，只改價格），
--    對齊 src/lib/garage.ts 新順序：赤紅300／武士380／黃金期貨450／
--    匿蹤幽靈520／銀河鍍鉻600（原本銀河鍍鉻最便宜 380，現在改成最貴）。
--
-- 在 Supabase SQL Editor 執行一次即可。
-- ============================================================================

-- ── wallet_earn()：finish/crash 改用共用 kind='play' 的金幣累計上限 ──────────
-- 原本 finish/crash 各自寫入 wallet_earn_log(kind='finish'/'crash')、累計「次數」
-- 上限 30（等於單日最多 10*30=300 或 3*30=90 金幣）。改成兩者都寫進同一個
-- kind='play'，累計值改成「金幣數」而非次數，上限 50——不管怎麼組合完賽/摔車，
-- 當日合計超過 50 金幣後這兩種 kind 就不再加錢（quest/ad 邏輯完全不動）。
drop function if exists public.wallet_earn(text);
create or replace function public.wallet_earn(p_kind text)
returns table(coins int, diamonds int)
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
begin
  if v_uid is null then return; end if;

  case p_kind
    when 'finish' then v_amount := 5;  v_log_kind := 'play';  v_step := 5;  v_cap := 50;
    when 'crash'  then v_amount := 2;  v_log_kind := 'play';  v_step := 2;  v_cap := 50;
    when 'quest'  then v_amount := 25; v_log_kind := 'quest'; v_step := 1;  v_cap := 3;
    when 'ad'     then v_amount := 20; v_log_kind := 'ad';    v_step := 1;  v_cap := 2;
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

  insert into public.wallet_earn_log as l (player_id, earn_date, kind, n)
  values (v_uid, v_today, v_log_kind, v_step)
  on conflict (player_id, earn_date, kind) do update set n = l.n + v_step
  returning n into v_n;
  if v_n > v_cap then
    return query select w.coins, w.diamonds from public.player_wallet w where w.player_id = v_uid;
    return;
  end if;

  update public.player_wallet
     set coins = coins + v_amount, updated_at = now()
   where player_id = v_uid;

  return query select w.coins, w.diamonds from public.player_wallet w where w.player_id = v_uid;
end;
$$;
revoke execute on function public.wallet_earn(text) from public, anon;
grant  execute on function public.wallet_earn(text) to authenticated;

-- ── wallet_spend_skin()：P 系列鑽石車款重新定價（id 不動，只換價格）───────────
create or replace function public.wallet_spend_skin(p_skin_id text)
returns table(coins int, diamonds int, owned jsonb, ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      text := auth.uid()::text;
  v_price    int;
  v_currency text;
  v_owned    jsonb;
  v_coins    int;
  v_diamonds int;
begin
  if v_uid is null then return; end if;

  select t.price, t.currency into v_price, v_currency from (values
    ('b2-cafe-racer'::text, 200, 'coin'::text),
    ('b1-street-white',     150, 'coin'),
    ('p1-crimson',          300, 'diamond'),
    ('p4-samurai',          380, 'diamond'),
    ('p3-gold',             450, 'diamond'),
    ('p5-phantom',          520, 'diamond'),
    ('p2-galaxy',           600, 'diamond')
  ) as t(id, price, currency) where t.id = p_skin_id;
  if v_price is null then return; end if; -- 未知/免費車款不走這個 RPC，靜默拒絕

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  select w.owned, w.coins, w.diamonds into v_owned, v_coins, v_diamonds
    from public.player_wallet w where w.player_id = v_uid for update;

  if v_owned ? p_skin_id then
    return query select v_coins, v_diamonds, v_owned, true; -- 已擁有：冪等回傳現況，不重複扣款
    return;
  end if;

  if v_currency = 'diamond' then
    if v_diamonds < v_price then
      return query select v_coins, v_diamonds, v_owned, false;
      return;
    end if;
    v_diamonds := v_diamonds - v_price;
  else
    if v_coins < v_price then
      return query select v_coins, v_diamonds, v_owned, false;
      return;
    end if;
    v_coins := v_coins - v_price;
  end if;

  v_owned := v_owned || jsonb_build_array(p_skin_id);

  update public.player_wallet
     set coins = v_coins, diamonds = v_diamonds, owned = v_owned, updated_at = now()
   where player_id = v_uid;

  return query select v_coins, v_diamonds, v_owned, true;
end;
$$;
revoke execute on function public.wallet_spend_skin(text) from public, anon;
grant  execute on function public.wallet_spend_skin(text) to authenticated;
