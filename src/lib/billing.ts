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

interface PurchaseDetails {
  itemId: string;
  purchaseToken: string;
}

interface DigitalGoodsService {
  getDetails(itemIds: string[]): Promise<{ itemId: string; price: { currency: string; value: string } }[]>;
  // 目前「已擁有／尚未消耗」的購買清單。用來對帳：付款成功但發鑽石中途失敗時，
  // 下次能撈出這筆孤兒交易重新補發（見 reconcilePurchases）。
  listPurchases(): Promise<PurchaseDetails[]>;
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

// 查價/對帳失敗的診斷字串（給 UI 顯示；TWA release 版 JS console 不進 logcat 也不能
// chrome://inspect，只能靠畫面把原因秀出來）。
let _priceDiag = "";
export function getPriceDiag(): string { return _priceDiag; }

let _service: DigitalGoodsService | null = null;
let _servicePromise: Promise<DigitalGoodsService | null> | null = null;
// 取 Digital Goods 服務。⚠️ 快取「Promise」而非結果：查價與對帳會在車庫載入時同時呼叫，
// 若各自獨立 await getDigitalGoodsService() 會並發建立兩條服務連線，可能互相干擾導致查價
// 卡住（這正是加了對帳後鑽石又變「暫無法購買」的疑點）。快取 Promise 讓並發呼叫共用同一次。
function getService(): Promise<DigitalGoodsService | null> {
  if (_service) return Promise.resolve(_service);
  if (_servicePromise) return _servicePromise;
  const w = window as WindowWithDigitalGoods;
  if (!w.getDigitalGoodsService) {
    _priceDiag = "此瀏覽器不支援 Digital Goods API（getDigitalGoodsService 不存在）";
    return Promise.resolve(null);
  }
  _servicePromise = w.getDigitalGoodsService("https://play.google.com/billing")
    .then((s) => { _service = s; return s; })
    .catch((e) => {
      _priceDiag = `取得付款服務失敗：${(e as { name?: string })?.name ?? "Error"}: ${(e as { message?: string })?.message ?? String(e)}`;
      console.warn("[billing] getDigitalGoodsService() 呼叫失敗：", e);
      _servicePromise = null; // 失敗不快取，下次可重試
      return null;
    });
  return _servicePromise;
}

// 向 Google Play 查任意 SKU 清單的實際定價（顯示用；扣款金額由 Google 那邊決定，這裡不寫死）。
// 查不到（Play Console 商品尚未建立/網路問題）回傳空 Map，UI 應顯示「暫無法查價」。
// 失敗原因一律印 console.warn（前綴 [billing]），方便真機用 chrome://inspect 遠端除錯——
// 常見原因：商品剛建立還在生效中（可達數小時）／SKU id 打錯字／帳號未加入 Play Console
// 「授權測試」名單（app 尚未正式上線到 Production 前，Billing API 通常只對授權測試名單內的
// 帳號開放，即使該帳號能透過封測連結正常安裝遊玩）。
// 重設服務快取，讓下次 getService() 重新向 Chrome 要一條連線。
// clientAppUnavailable 時用——App 內的 Play billing 連線是非同步建立的，冷啟動查太快會
// 拿到「連線還沒好」的錯，重新取連線+重試通常就成功。
function resetService(): void {
  _service = null;
  _servicePromise = null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchPackPrices(skus: string[]): Promise<Map<string, string>> {
  _priceDiag = "";
  const out = new Map<string, string>();
  // 冷啟動 billing 連線未就緒（clientAppUnavailable）會查價失敗，自動重試幾次、間隔漸長。
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const service = await getService();
    if (service) {
      try {
        const details = await service.getDetails(skus);
        console.info(`[billing] getDetails 第 ${attempt} 次回傳 ${details.length} 筆：`, details);
        for (const d of details) out.set(d.itemId, `${d.price.currency} ${d.price.value}`);
        if (out.size > 0) { _priceDiag = ""; return out; } // 有拿到就成功收工
        // 沒 throw 但一筆都沒有 = SKU 真的查不到（非時序問題），不重試，直接報原因
        _priceDiag = `查無定價：${skus.join(", ")}（商品未生效／id 錯／帳號非授權測試名單）`;
        return out;
      } catch (e) {
        _priceDiag = `查價失敗：${(e as { name?: string })?.name ?? "Error"}: ${(e as { message?: string })?.message ?? String(e)}`;
        console.warn(`[billing] getDetails 第 ${attempt} 次拋例外：`, e);
        resetService(); // 連線可能壞了，下次重新取
      }
    } else if (!_priceDiag) {
      _priceDiag = "付款服務尚未就緒";
    }
    if (attempt < maxAttempts) await sleep(attempt * 600); // 0.6s / 1.2s / 1.8s
  }
  return out;
}

// 把一筆 purchase_token 送 Edge Function 驗證+發放。Edge Function 是冪等的：同一筆
// 重複送不會重複發鑽石（DB 端 purchase_token 防重放），但每次都會重試 consume/acknowledge，
// 所以「付款成功卻中途失敗」的孤兒交易可以靠重送補救。
// 回傳 Edge Function 的完整回應（null 代表 session 遺失／驗證失敗／發放未完成，可重試）；
// 失敗時把 Edge Function 真正的錯誤字串寫進 _lastPurchaseError 供 UI 顯示。
async function submitPurchaseToken(sku: string, purchaseToken: string): Promise<Record<string, unknown> | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { _lastPurchaseError = "發放失敗：尚未登入（session 遺失）"; return null; }

  const { data, error } = await supabase.functions.invoke("verify-iap-purchase", {
    body: { sku_id: sku, purchase_token: purchaseToken },
  });

  if (error) {
    // Edge Function 回非 2xx 時，真正的 {ok:false,error:"..."} 在 error.context（Response）裡，
    // 不在 data。把它讀出來才知道是哪一關失敗（purchase not valid／grant error／consume pending…）。
    let detail = (error as { message?: string })?.message ?? String(error);
    try {
      const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
      if (ctx?.json) {
        const body = await ctx.json();
        if (body?.error) detail = body.error;
      }
    } catch { /* 讀不到就用 message */ }
    _lastPurchaseError = `發放失敗：${detail}`;
    return null;
  }
  if (!data?.ok) {
    _lastPurchaseError = `發放失敗：${(data as { error?: string })?.error ?? "未知"}`;
    return null;
  }
  return data as Record<string, unknown>;
}

// 最近一次購買失敗的原因（給 UI 顯示用；靜默失敗會讓玩家不知道發生什麼事）。
// 使用者取消付款不算失敗，不寫入這裡。
let _lastPurchaseError = "";
export function getLastPurchaseError(): string { return _lastPurchaseError; }

// 共用購買流程：觸發 PaymentRequest 付款 → 拿 purchase_token → 送 Edge Function 驗證+發放。
// 回傳 Edge Function 的完整回應（null 代表使用者取消/失敗），呼叫端各自取需要的欄位。
async function runPurchaseFlow(sku: string, label: string): Promise<Record<string, unknown> | null> {
  _lastPurchaseError = "";
  const w = window as WindowWithDigitalGoods;
  if (!isBillingAvailable() || !w.PaymentRequest) {
    _lastPurchaseError = "此環境不支援購買（需 Google Play 安裝版）";
    return null;
  }

  // 🔴 未登入就別叫出付款視窗——訪客錢包只存本地、後端沒有帳號可入帳，若讓 Google 真的
  // 扣款會變成「扣了錢卻無處發鑽石」（只能等 3 天退款）。必須在 PaymentRequest 之前擋掉，
  // 這是最關鍵的一層（UI 隱藏按鈕是第二層）。
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    _lastPurchaseError = "請先登入 Google 帳號才能購買（訪客的購買無法保存）";
    return null;
  }

  let purchaseToken: string;
  try {
    const request = new w.PaymentRequest(
      [{ supportedMethods: "https://play.google.com/billing", data: { sku } }],
      { total: { label, amount: { currency: "TWD", value: "0" } } },
    );
    const response = await request.show();
    purchaseToken = response.details.purchaseToken;
    await response.complete("success");
  } catch (e) {
    // AbortError = 使用者自己取消付款，不是錯誤，不顯示訊息
    const name = (e as { name?: string })?.name ?? "";
    const msg = (e as { message?: string })?.message ?? String(e);
    if (name !== "AbortError") {
      _lastPurchaseError = `付款無法開始：${name || "Error"}: ${msg}`;
      console.warn("[billing] PaymentRequest 失敗：", e);
    }
    return null;
  }

  // 走到這裡代表 Google 已扣款，之後任何失敗都靠 reconcilePurchases 對帳補救。
  // submitPurchaseToken 失敗時已把 Edge Function 的具體錯誤寫進 _lastPurchaseError，
  // 這裡不要覆蓋掉那個更有用的訊息（只有它沒寫時才補上籠統版）。
  const data = await submitPurchaseToken(sku, purchaseToken);
  if (!data && !_lastPurchaseError) _lastPurchaseError = "付款完成但發放暫時失敗，重新進車庫會自動補發";
  return data;
}

// 對帳：撈出「已購買但可能沒發成功」的交易逐筆重送 Edge Function。這是金流的安全網——
// 只要 Google 已扣款，這筆就會出現在 listPurchases()，即使當初付款後發鑽石中途失敗
// （session 遺失/網路斷/function 逾時），下次進車庫就會自動補發，不必等 Google 3 天後退款。
// 已成功對帳過的 token 記在本地，避免對「永久有效」的去廣告商品每次進車庫都重打一次。
const RECONCILED_KEY = "tr_iap_reconciled";
function getReconciledTokens(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(RECONCILED_KEY) ?? "[]") as string[]); }
  catch { return new Set(); }
}
function markReconciled(token: string): void {
  const s = getReconciledTokens();
  s.add(token);
  try { localStorage.setItem(RECONCILED_KEY, JSON.stringify([...s])); } catch { /* 容量滿等，忽略 */ }
}

// 回傳補發後的最新 {diamonds?, adsRemoved?}（有處理到東西才回，否則 null），呼叫端用來更新 UI。
export async function reconcilePurchases(): Promise<{ diamonds?: number; adsRemoved?: boolean } | null> {
  _lastPurchaseError = ""; // 清空，若下面有孤兒交易補發失敗，會留下最後一筆的原因供 UI 顯示
  const service = await getService();
  if (!service || typeof service.listPurchases !== "function") return null;

  let purchases: PurchaseDetails[];
  try {
    purchases = await service.listPurchases();
  } catch (e) {
    console.warn("[billing] listPurchases() 失敗（無法對帳）：", e);
    return null;
  }

  const done = getReconciledTokens();
  const result: { diamonds?: number; adsRemoved?: boolean } = {};
  let changed = false;

  for (const p of purchases) {
    if (done.has(p.purchaseToken)) continue; // 已成功對帳過，跳過
    const data = await submitPurchaseToken(p.itemId, p.purchaseToken);
    if (!data) continue; // 這次補發沒成功（例如 consume 又失敗）→ 不記錄，下次再試
    markReconciled(p.purchaseToken);
    if (typeof data.diamonds === "number") { result.diamonds = data.diamonds; changed = true; }
    if (typeof data.adsRemoved === "boolean") { result.adsRemoved = data.adsRemoved; changed = true; }
  }

  return changed ? result : null;
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
