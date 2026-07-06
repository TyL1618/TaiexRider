-- ============================================================================
-- 2026-07-06：永久去除廣告 IAP（一次性非消耗型商品，跟鑽石消耗型不同）
-- 使用者確認範圍：復活廣告、每日拿金幣廣告、每日排名賽後 3 次挑戰的廣告標籤，
-- 全部要在購買後永久跳過。SKU id：remove_ads_forever。
--
-- 跟鑽石購買的差異：鑽石是消耗型（可重複購買，Google 端要 consume），
-- 去廣告是非消耗型（買一次終身有效，Google 端要 acknowledge 不是 consume，
-- 否則會變成可以重複購買）。Edge Function 那邊要依 sku 類型分流呼叫。
--
-- 在 Supabase SQL Editor 執行一次即可。
-- ============================================================================

alter table public.player_wallet add column if not exists ads_removed boolean not null default false;

-- 授予永久去廣告（security definer，只給 service_role 呼叫，前端不能直接騙）
create or replace function public.grant_remove_ads(
  p_player_id      text,
  p_purchase_token text
) returns table(ads_removed boolean, ok boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_player_id is null or p_purchase_token is null then
    return query select false, false; return;
  end if;

  -- 防重放：同一個 purchase_token 不能重複兌換（留稽核紀錄，沿用 iap_purchases，
  -- diamonds 欄位對這個 SKU 不適用，填 0）
  if exists (select 1 from public.iap_purchases where purchase_token = p_purchase_token) then
    return query select w.ads_removed, false from public.player_wallet w where w.player_id = p_player_id;
    return;
  end if;

  insert into public.iap_purchases (purchase_token, player_id, sku_id, diamonds)
  values (p_purchase_token, p_player_id, 'remove_ads_forever', 0);

  insert into public.player_wallet (player_id) values (p_player_id) on conflict (player_id) do nothing;
  update public.player_wallet set ads_removed = true, updated_at = now() where player_id = p_player_id;

  return query select w.ads_removed, true from public.player_wallet w where w.player_id = p_player_id;
end;
$$;
revoke execute on function public.grant_remove_ads(text, text) from public, anon, authenticated;

-- wallet_get() 一併帶回 ads_removed（沿用既有登入同步呼叫點，不需要新增呼叫時機）
drop function if exists public.wallet_get();
create or replace function public.wallet_get()
returns table(
  coins int, diamonds int, owned jsonb,
  bull_finishes int, bear_finishes int,
  streak_count int, last_session_key date,
  collection text[], ads_removed boolean
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
           c.codes, w.ads_removed
      from public.player_wallet w
      join public.player_achievements a on a.player_id = w.player_id
      join public.player_streak s on s.player_id = w.player_id
      join public.player_collection c on c.player_id = w.player_id
     where w.player_id = v_uid;
end;
$$;
revoke execute on function public.wallet_get() from public, anon;
grant  execute on function public.wallet_get() to authenticated;
