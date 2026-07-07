-- ============================================================================
-- 2026-07-08 使用者拍板：金幣經濟大改版（跟 client 端同步，一起跑）
--
-- ① wallet_earn()：
--    - 完賽/摔車「遊玩」上限 50→100（長征模式一場最高 60，兩場就吃滿，用意是
--      拉高長征模式的誘因；看廣告雙倍本局金幣也共用這個 kind，算在同一桶內）。
--    - 新增 long_finish（長征完賽固定 30）/ long_crash（長征摔車依跑到全程的
--      比例給，0~30，比例由 GameCanvas 算出當作 p_amount 傳進來，伺服器 clamp
--      在 0~30 之間、不信任前端超出範圍的數字——跟現有反作弊「誠實邊界」設計
--      一致：竄改者最多騙到一次滿額 30，不會超過合法值）。
--    - quest/ad 兩種 kind 完全不受影響，維持原本次數上限（quest 3 次/日、
--      ad 2 次/日）。
-- ② wallet_spend_skin()：咖啡騎士/通勤小白 200/150 → 500/500（使用者拍板）。
--
-- 在 Supabase SQL Editor 執行一次即可。
-- ============================================================================

-- ── wallet_earn()：加 long_finish/long_crash + 上限 50→100 ──────────────────
drop function if exists public.wallet_earn(text);
create or replace function public.wallet_earn(p_kind text, p_amount int default null)
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
    when 'finish'      then v_amount := 5;  v_log_kind := 'play';  v_step := 5;  v_cap := 100;
    when 'crash'       then v_amount := 2;  v_log_kind := 'play';  v_step := 2;  v_cap := 100;
    when 'long_finish' then v_amount := 30; v_log_kind := 'play';  v_step := 30; v_cap := 100;
    when 'long_crash'  then
      v_amount   := greatest(0, least(30, coalesce(p_amount, 0))); -- 不信任前端，clamp 在 0~30
      v_log_kind := 'play';
      v_step     := v_amount;
      v_cap      := 100;
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
revoke execute on function public.wallet_earn(text, int) from public, anon;
grant  execute on function public.wallet_earn(text, int) to authenticated;

-- ── wallet_spend_skin()：咖啡騎士/通勤小白 200/150 → 500/500 ──────────────
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
    ('b2-cafe-racer'::text, 500, 'coin'::text),
    ('b1-street-white',     500, 'coin'),
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
