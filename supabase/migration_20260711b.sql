-- ============================================================================
-- 2026-07-11b：鑽石大包內容物 1200 → 1300（定價定案）
--
-- 使用者拍板的正式定價（售價在 Play Console 手動改，DB 只管發放數量）：
--   diamonds_100   NT$30   → 100 鑽（3.3 顆/元）
--   diamonds_350   NT$90   → 350 鑽（3.9 顆/元，+18%）
--   diamonds_1200  NT$290  → 1300 鑽（4.5 顆/元，+36%）★ 這份只改這包
--   remove_ads_forever NT$72 維持不變（無需改動）
-- SKU id 沿用 diamonds_1200 不改（Play Console 商品 id 建立後固定，改 id 要重建商品
-- ＋前端/Edge Function/DB 三處同步換名，風險不值得；只改內容物數量）。
-- 前端對照：src/lib/billing.ts DIAMOND_PACKS（同 commit 已改 1300，兩邊要一致）。
-- Edge Function verify-iap-purchase 只驗 SKU 合法性不管數量，不用重新部署。
--
-- 執行方式：Supabase Dashboard → SQL Editor 貼上整份執行一次（push 不會自動生效）。
-- 函式本體照抄 migration_20260709b.sql 的 42702 修復版，僅 diamonds_1200 的數量改 1300。
-- ============================================================================

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

  -- SKU 白名單（2026-07-11 定價定案；對照 Play Console 商品與 billing.ts DIAMOND_PACKS）
  case p_sku_id
    when 'diamonds_100'  then v_amount := 100;
    when 'diamonds_350'  then v_amount := 350;
    when 'diamonds_1200' then v_amount := 1300; -- 大包內容物 1200→1300（SKU id 不改）
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
     set diamonds = player_wallet.diamonds + v_amount, updated_at = now()
   where player_id = p_player_id;

  return query select w.diamonds, true from public.player_wallet w where w.player_id = p_player_id;
end;
$$;
revoke execute on function public.grant_iap_diamonds(text, text, text) from public, anon, authenticated;
