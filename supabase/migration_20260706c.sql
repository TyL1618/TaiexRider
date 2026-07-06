-- ============================================================================
-- 2026-07-06/07：鑽石購買頁 IAP 骨架（Google Play Billing，僅 Android TWA）
-- 網頁版不開放購買（已跟使用者確認），Digital Goods API 本來就只有 TWA 環境才有。
--
-- 安全設計（跟 wallet_spend_skin/wallet_unlock_achievement 同一套原則）：
-- 真正「發鑽石」的 grant_iap_diamonds() 只給 service_role 呼叫（前端完全不能碰），
-- 呼叫順序必須是：前端拿到 purchase_token → Edge Function 向 Google Play Developer
-- API 驗證是真的付款 → 驗證通過才由 Edge Function（帶 service key）呼叫這支 RPC。
-- 不能讓前端直接呼叫，否則隨便偽造一個 purchase_token 就能騙鑽石。
--
-- iap_purchases 表用來防重放（同一個 purchase_token 不能重複兌換兩次鑽石）+ 留稽核紀錄。
-- SKU 對照表（鑽石數）目前是暫定佔位值，真實定價/包裝待使用者在 Play Console 建立
-- 商品時決定，屆時這裡的 case/when 要跟 Play Console 的 SKU id 同步更新。
-- 在 Supabase SQL Editor 執行一次即可。
-- ============================================================================

create table if not exists public.iap_purchases (
  purchase_token text primary key,
  player_id      text not null,
  sku_id         text not null,
  diamonds       int  not null,
  created_at     timestamptz not null default now()
);
alter table public.iap_purchases enable row level security;
revoke all on table public.iap_purchases from public, anon, authenticated;

create or replace function public.grant_iap_diamonds(
  p_player_id      text,
  p_sku_id         text,
  p_purchase_token text
) returns table(diamonds int, ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount int;
begin
  if p_player_id is null or p_purchase_token is null then
    return query select 0, false; return;
  end if;

  -- SKU 白名單（暫定佔位鑽石數，對照 Play Console 商品設定，之後要同步改）
  case p_sku_id
    when 'diamonds_100'  then v_amount := 100;
    when 'diamonds_350'  then v_amount := 350;
    when 'diamonds_1200' then v_amount := 1200;
    else
      return query select 0, false; return;
  end case;

  -- 防重放：同一個 purchase_token 只能兌換一次
  if exists (select 1 from public.iap_purchases where purchase_token = p_purchase_token) then
    return query select w.diamonds, false from public.player_wallet w where w.player_id = p_player_id;
    return;
  end if;

  insert into public.iap_purchases (purchase_token, player_id, sku_id, diamonds)
  values (p_purchase_token, p_player_id, p_sku_id, v_amount);

  insert into public.player_wallet (player_id) values (p_player_id) on conflict (player_id) do nothing;
  update public.player_wallet
     set diamonds = diamonds + v_amount, updated_at = now()
   where player_id = p_player_id;

  return query select w.diamonds, true from public.player_wallet w where w.player_id = p_player_id;
end;
$$;

-- 只給 service_role 呼叫（Edge Function 用 service key），前端不能直接呼叫
revoke execute on function public.grant_iap_diamonds(text, text, text) from public, anon, authenticated;
