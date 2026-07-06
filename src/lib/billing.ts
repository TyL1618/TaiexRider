// 鑽石購買（Google Play Billing，Digital Goods API）——僅 Android TWA 可用，
// 網頁版不開放購買（已跟使用者確認：Digital Goods API 本來就只有 TWA 環境才有，
// 網頁分頁完全沒有這支 API，isBillingAvailable() 在網頁版一律回傳 false）。
//
// 流程：purchaseDiamondPack() 觸發 PaymentRequest（帶 "https://play.google.com/billing"
// 付款方式）跳出 Google 原生付款介面 → 使用者付款完成拿到 purchase_token → 呼叫
// verify-iap-purchase Edge Function（supabase/functions/）向 Google Play Developer API
// 驗證是真的付款 → 驗證通過才發鑽石，不信任前端。
//
// ⚠️ 這裡的 SKU 清單目前是暫定佔位（鑽石數對照 supabase/migration_20260706c.sql 的
// grant_iap_diamonds() 白名單、去廣告對照 migration_20260706d.sql 的 grant_remove_ads()，
// 兩邊要同步）。真實定價由使用者在 Play Console 建立商品時決定，這裡不寫死價格，
// 改用 fetchPackPrices() 向 Google 動態查詢顯示。
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

// 永久去除廣告（非消耗型，買一次終身有效）：復活廣告、每日拿金幣廣告、每日排名賽
// 後 3 次挑戰的廣告標籤，購買後全部跳過（見 App.tsx/GameCanvas.tsx/Garage.tsx/
// DailyChallenge.tsx 讀 garage.ts getAdsRemoved() 的判斷點）。
export const REMOVE_ADS_SKU = "remove_ads_forever";

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

// 向 Google Play 查任意 SKU 清單的實際定價（顯示用；扣款金額由 Google 那邊決定，這裡不寫死）。
// 查不到（Play Console 商品尚未建立/網路問題）回傳空 Map，UI 應顯示「暫無法查價」。
export async function fetchPackPrices(skus: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const service = await getService();
  if (!service) return out;
  try {
    const details = await service.getDetails(skus);
    for (const d of details) out.set(d.itemId, `${d.price.currency} ${d.price.value}`);
  } catch { /* 靜默，UI 略過價格顯示 */ }
  return out;
}

// 共用購買流程：觸發 PaymentRequest 付款 → 拿 purchase_token → 呼叫 Edge Function 驗證。
// 回傳 Edge Function 的完整回應（null 代表使用者取消/失敗），呼叫端各自取需要的欄位。
async function runPurchaseFlow(sku: string, label: string): Promise<Record<string, unknown> | null> {
  const w = window as WindowWithDigitalGoods;
  if (!isBillingAvailable() || !w.PaymentRequest) return null;

  try {
    const request = new w.PaymentRequest(
      [{ supportedMethods: "https://play.google.com/billing", data: { sku } }],
      { total: { label, amount: { currency: "TWD", value: "0" } } },
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
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

// 購買一包鑽石。回傳最新鑽石餘額；null 代表使用者取消/失敗（不用特別跳錯誤，
// 靜默返回讓 UI 恢復成可再按一次的狀態即可）。
export async function purchaseDiamondPack(sku: string): Promise<number | null> {
  const data = await runPurchaseFlow(sku, "鑽石");
  return data ? (data.diamonds as number) : null;
}

// 購買永久去廣告。回傳是否成功；不需要餘額（布林旗標而非數值）。
export async function purchaseRemoveAds(): Promise<boolean> {
  const data = await runPurchaseFlow(REMOVE_ADS_SKU, "永久去除廣告");
  return data ? Boolean(data.adsRemoved) : false;
}
