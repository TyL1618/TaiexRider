-- P3~P5 鑽石車款生圖完成上線（黃金大亨/電馭武士/幽靈匿蹤），補進 wallet_spend_skin()
-- 的伺服器端價格白名單（migration_20260705.sql 原本只有 p1-crimson/p2-galaxy 兩台）。
-- 價格需與 src/lib/garage.ts 的 BIKE_SKINS 完全一致，否則玩家會扣錯鑽石數。
-- 其餘邏輯（owned 冪等檢查/餘額檢查/security definer）原封不動，只是 create or replace
-- 整個函式本體（PL/pgSQL 不支援單獨改 values 常數）。

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
    ('p2-galaxy',           380, 'diamond'),
    ('p3-gold',             450, 'diamond'),
    ('p4-samurai',          520, 'diamond'),
    ('p5-phantom',          600, 'diamond')
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
