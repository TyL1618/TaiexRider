// 鑽石購買（Google Play Billing，Digital Goods API）——僅 Android TWA 可用，
// 網頁版不開放購買（已跟使用者確認：Digital Goods API 本來就只有 TWA 環境才有，
// 網頁分頁完全沒有這支 API，isBillingAvailable() 在網頁版一律回傳 false）。
//
// 流程：purchaseDiamondPack() 觸發 PaymentRequest（帶 "https://play.google.com/billing"
// 付款方式）跳出 Google 原生付款介面 → 使用者付款完成拿到 purchase_token → 呼叫
// verify-iap-purchase Edge Function（supabase/functions/）向 Google Play Developer API
// 驗證是真的付款 → 驗證通過才發鑽石，不信任前端。
//
// ⚠️ 這裡的 SKU 清單目前是暫定佔位（鑽石數對照 supabase/migration_20260707b.sql 的
// grant_iap_diamonds() 白名單，兩邊要同步）。真實定價由使用者在 Play Console 建立
// 商品時決定，這裡不寫死價格，改用 fetchPackPrices() 向 Google 動態查詢顯示。
// ⚠️ 部署前置作業（Play Console 商品/Google Cloud 服務帳號/Edge Function 部署）
// 尚未完成前，isBillingAvailable() 就算在 TWA 裡也會因為 Play Console 沒有對應商品
// 而讓 getDetails()/purchase 失敗，購買按鈕應處理好這個「查價失敗」的降級顯示。

import { isInsideTWA } from "./ads";
import { supabase } from "./supabase";

export interface DiamondPack {
  sku: string;
  diamonds: number;
  label: string;
}

export const DIAMOND_PACKS: DiamondPack[] = [
  { sku: "diamonds_100",  diamonds: 100,  label: "小包" },
  { sku: "diamonds_350",  diamonds: 350,  label: "中包" },
  { sku: "diamonds_1200", diamonds: 1200, label: "大包" },
];

interface DigitalGoodsService {
  getDetails(itemIds: string[]): Promise<{ itemId: string; price: { currency: string; value: string } }[]>;
}

interface WindowWithDigitalGoods extends Window {
  getDigitalGoodsService?: (paymentMethod: string) => Promise<DigitalGoodsService>;
  PaymentRequest?: new (
    methods: { supportedMethods: string; data: Record<string, unknown> }[],
    details: { total: { label: string; amount: { currency: string; value: string } } },
  ) => {
    show(): Promise<{ details: { purchaseToken: string }; complete(result: "success" | "fail"): Promise<void> }>;
  };
}

// 是否可能可以購買：TWA 環境 + 瀏覽器支援 Digital Goods API。
// 「可能」是因為就算兩者都成立，Play Console 商品沒設好一樣會購買失敗（見檔頭說明）。
export function isBillingAvailable(): boolean {
  const w = window as WindowWithDigitalGoods;
  return isInsideTWA() && typeof w.getDigitalGoodsService === "function" && typeof w.PaymentRequest === "function";
}

let _service: DigitalGoodsService | null = null;
async function getService(): Promise<DigitalGoodsService | null> {
  if (_service) return _service;
  const w = window as WindowWithDigitalGoods;
  if (!w.getDigitalGoodsService) return null;
  try {
    _service = await w.getDigitalGoodsService("https://play.google.com/billing");
    return _service;
  } catch {
    return null;
  }
}

// 向 Google Play 查各 SKU 的實際定價（顯示用；扣款金額由 Google 那邊決定，這裡不寫死）。
// 查不到（Play Console 商品尚未建立/網路問題）回傳空 Map，UI 應顯示「暫無法查價」。
export async function fetchPackPrices(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const service = await getService();
  if (!service) return out;
  try {
    const details = await service.getDetails(DIAMOND_PACKS.map((p) => p.sku));
    for (const d of details) out.set(d.itemId, `${d.price.currency} ${d.price.value}`);
  } catch { /* 靜默，UI 略過價格顯示 */ }
  return out;
}

// 購買一包鑽石。回傳最新鑽石餘額；null 代表使用者取消/失敗（不用特別跳錯誤，
// 靜默返回讓 UI 恢復成可再按一次的狀態即可）。
export async function purchaseDiamondPack(sku: string): Promise<number | null> {
  const w = window as WindowWithDigitalGoods;
  if (!isBillingAvailable() || !w.PaymentRequest) return null;

  try {
    const request = new w.PaymentRequest(
      [{ supportedMethods: "https://play.google.com/billing", data: { sku } }],
      { total: { label: "鑽石", amount: { currency: "TWD", value: "0" } } },
    );
    const response = await request.show();
    const purchaseToken = response.details.purchaseToken;
    await response.complete("success");

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const { data, error } = await supabase.functions.invoke("verify-iap-purchase", {
      body: { sku_id: sku, purchase_token: purchaseToken },
    });
    if (error || !data?.ok) return null;
    return data.diamonds as number;
  } catch {
    return null;
  }
}
