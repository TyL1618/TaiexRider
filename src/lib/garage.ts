// 車庫系統：軟通貨（金幣）+ 車皮解鎖/選用。設計見 GARAGE_DESIGN.md。
// 物理與貼圖完全分離，換皮不動手感/難度/排行榜公平性。
// 兩種車皮類型：
//   - 無 src：套用預設 bike.png + hueRotateDeg 濾鏡（零成本色彩過渡方案）
//   - 有 src：獨立圖檔，spriteW/spriteOffsetX/spriteOffsetY 覆蓋 constants.ts 的
//     全域 BIKE.spriteW/spriteOffsetX/spriteOffsetY——每張 AI 生圖的車身佔畫布比例
//     不同，靠這三個數字讓貼圖的兩個輪子精準對齊物理輪子位置（見下方各車皮註解，
//     數值由 scripts 量測輪圈色塊中心點算出，不是憑感覺調的）。
// localStorage 慣例同 medals.ts / streak.ts：try/catch 靜默 fallback，無版本欄位。
//
// 2026-07-05：伺服器端錢包上線（migration_20260705.sql，見 WALLET_PLAN.md）。
// 已登入玩家的金幣/鑽石/擁有清單改以 Supabase RPC（wallet_get/wallet_earn/
// wallet_spend_skin/wallet_unlock_achievement）為權威來源，localStorage 只當
// 「顯示用快取」——每次 RPC 回應都會覆寫本地快取，getCoins()/getDiamonds()/
// getOwnedSkins() 這幾個同步讀取函式維持不變，讀的一律是「最後一次跟伺服器
// 同步後」的快取值。未登入玩家（無法上排行榜、竄改零風險）維持純本地。

import { supabase } from "./supabase";
import { writeAchievementsCache, resetAchievementsCache, writeRunStatsCache } from "./achievements";
import { writeStreakCache, resetStreakCache } from "./streak";
import { writeCollectionCache, resetCollectionCache } from "./collection";

export interface BikeSkin {
  id: string;
  name: string;
  desc: string;
  price: number; // 0 = 免費（一開始就擁有，除非 locked）；> 0 = 依 currency 花費金幣或鑽石購買
  currency?: "coin" | "diamond"; // 預設 "coin"；"diamond" = 鑽石車款（IAP 概念先用鑽石代替，見 garage.ts 頂部說明）
  locked?: boolean; // true＝即使 price===0 也不自動擁有，須靠 unlockAchievementSkin() 解鎖（Q 系列）
  hueRotateDeg: number; // 無 src 時套用；有 src 則忽略
  src?: string;             // 相對 BASE_URL 的圖檔路徑
  spriteW?: number;         // 覆蓋 BIKE.spriteW（該車皮的繪製寬度，遊戲 px）
  spriteOffsetX?: number;   // 覆蓋 BIKE.spriteOffsetX
  spriteOffsetY?: number;   // 覆蓋 BIKE.spriteOffsetY
}

// 車款分級定案（2026-07-04 使用者更新拍板，取代 2026-07-03 舊版）：
//   B（基本款）＝金幣購買（原本免費，使用者改口收金幣，見下方 b1/b2 的 price）
//   Q（任務解鎖款）＝成就條件解鎖，**不是**用金幣買（欄位/機制留待 Q 系列圖到位時再設計，
//     避免現在建沒東西可用的空機制）
//   P（鑽石車款）＝正式上線後走真錢 IAP（Google Play Billing），**目前 Billing 未接**，
//     先用「鑽石」這個新軟通貨頂替（見下方 DIAMONDS_KEY）。鑽石目前沒有任何獲取方式
//     （無廣告/任務/完賽獎勵），只有開發者測試帳號會補到 99999——等 IAP 接上後才會有
//     正式的「花台幣買鑽石」購買頁，屆時鑽石車款的真實售價/是否保留鑽石中介層再決定。
// 2026-07-04：五台車重新量測（原圖全數重生，來源＝public/bikes/Grok_Original/ →
// For_Gaming/ 手動去背+去底部陰影 → 這裡的成品）。改用 OpenCV HoughCircles 直接在
// alpha 遮罩上找兩個輪胎圓（純幾何、不吃顏色），不再靠色塊偵測——q1/q3 車身裝飾跟
// 輪圈同色系時色塊法會誤判，圓形偵測不受影響。offsetY 的地板間隙補償也改成算出來的
// （量到的輪胎視覺半徑 − 物理 wheelRadius=6，換算成 local 單位後從 offsetY 扣除），
// 不再是憑經驗的固定 -2。量測腳本用完即丟，未進版控。
export const BIKE_SKINS: BikeSkin[] = [
  { id: "default", name: "原廠霓虹", desc: "出廠標準塗裝", price: 0, hueRotateDeg: 0 },
  {
    id: "b2-cafe-racer", name: "復古咖啡騎士", desc: "橘棕配色 + 皮革坐墊，復古跑車魂",
    price: 500, hueRotateDeg: 0, src: "bikes/b2-cafe-racer.png",
    spriteW: 75.3, spriteOffsetX: -0.3, spriteOffsetY: -5.6,
  },
  {
    id: "b1-street-white", name: "街頭通勤小白", desc: "簡潔白色速克達，親民出廠首選",
    price: 500, hueRotateDeg: 0, src: "bikes/b1-street-white.png",
    spriteW: 83.8, spriteOffsetX: -1.1, spriteOffsetY: -8.3,
  },
  // Q 系列（任務解鎖，locked:true＝不自動擁有，靠 unlockAchievementSkin() 解鎖，
  // 見 achievements.ts 對應同一組 id）。
  {
    id: "q1-bull", name: "多頭鬥牛", desc: "深紅巡航塗裝，金色輪圈燃燒多頭氣勢",
    price: 0, locked: true, hueRotateDeg: 0, src: "bikes/q1-bull.png",
    spriteW: 67.8, spriteOffsetX: -0.8, spriteOffsetY: -5.0,
  },
  {
    id: "q2-bear", name: "空頭獵手", desc: "暗夜獵殺者塗裝，毒液綠電路紋",
    price: 0, locked: true, hueRotateDeg: 0, src: "bikes/q2-bear.png",
    spriteW: 72.0, spriteOffsetX: -0.3, spriteOffsetY: -4.4,
  },
  {
    id: "q3-phoenix", name: "不死鳥", desc: "熔金鳳凰塗裝，浴火重生",
    price: 0, locked: true, hueRotateDeg: 0, src: "bikes/q3-phoenix.png",
    spriteW: 80.0, spriteOffsetX: -1.5, spriteOffsetY: -5.7,
  },
  // 鑽石車款（P 系列，5 台全數生圖完成）。
  // 量測方式同 Q 系列：OpenCV HoughCircles 找 alpha 遮罩上的兩個輪胎圓，換算 spriteW/offsetX/Y；
  // 價格為暫定佔位值（IAP 真實定價待 Billing 接上後再決定，見上方註解）。
  // 2026-07-07 使用者拍板重新排序+改名（陣列宣告順序＝ Garage.tsx 卡片顯示順序，
  // 未額外排序），id 維持不動（避免動到已擁有玩家的擁有清單/伺服器白名單 key）：
  {
    id: "p1-crimson", name: "赤紅暴走", desc: "旗艦全整流罩仿賽，霓虹紅賽車魂",
    price: 300, currency: "diamond", hueRotateDeg: 0, src: "bikes/p1-crimson.png",
    spriteW: 74.7, spriteOffsetX: -0.2, spriteOffsetY: -5.7,
  },
  {
    id: "p4-samurai", name: "電馭武士", desc: "電馭武士甲，冰藍電路紋",
    price: 380, currency: "diamond", hueRotateDeg: 0, src: "bikes/p4-samurai.png",
    spriteW: 73.8, spriteOffsetX: -0.7, spriteOffsetY: -6.3,
  },
  {
    id: "p3-gold", name: "黃金期貨", desc: "黑金巡航旗艦，排行榜霸主座駕",
    price: 450, currency: "diamond", hueRotateDeg: 0, src: "bikes/p3-gold.png",
    spriteW: 75.1, spriteOffsetX: -2.9, spriteOffsetY: -6.4,
  },
  {
    id: "p5-phantom", name: "匿蹤幽靈", desc: "暗夜匿蹤，血色微光",
    price: 520, currency: "diamond", hueRotateDeg: 0, src: "bikes/p5-phantom.png",
    spriteW: 73.7, spriteOffsetX: -0.3, spriteOffsetY: -2.8,
  },
  {
    id: "p2-galaxy", name: "銀河鍍鉻", desc: "鏡面鍍鉻概念車，內嵌流轉星河",
    price: 600, currency: "diamond", hueRotateDeg: 0, src: "bikes/p2-galaxy.png",
    spriteW: 73.3, spriteOffsetX: -0.4, spriteOffsetY: -2.7,
  },
  // 黑天鵝（隱藏車款，見 LOTTERY_DESIGN.md §3）：locked:true 沿用 Q 系列「不自動
  // 擁有」機制，但解鎖來源是抽獎 lottery_spin() RPC，不是成就系統。取得前 Garage.tsx
  // 用全黑剪影渲染（濾鏡處理，不用另外做美術），src 待 Grok 出圖完成後補上。
  {
    id: "hidden-blackswan", name: "黑天鵝", desc: "萬中無一的異象降臨，抽獎極稀有大獎",
    price: 0, locked: true, hueRotateDeg: 0, src: "bikes/hidden-blackswan.png",
    spriteW: 75, spriteOffsetX: 0, spriteOffsetY: -5,
  },
];

const COINS_KEY = "tr_garage_coins";
const DIAMONDS_KEY = "tr_garage_diamonds";
const OWNED_KEY = "tr_garage_owned";
const ACTIVE_KEY = "tr_garage_active";
const ADS_REMOVED_KEY = "tr_ads_removed";
const TICKETS_KEY = "tr_garage_tickets"; // 廣告券（LOTTERY_DESIGN.md §6），伺服器權威同 coins/diamonds

// 目前裝備車皮（ACTIVE_KEY）帳號隔離：跟 coins/diamonds/owned 不同，這個偏好從來
// 沒有存在伺服器上（純本地選擇），舊版是單一全域 key，登出時 resetWalletCache() 會
// 重設成 "default" 防止跨帳號污染，副作用是同一帳號登出再登入也會被一起洗掉
// （2026-07-16 使用者回報）。改成比照 wallet_daily_att_{uid|guest} 的慣例帳號隔離，
// 各帳號各自的 key 天生不會互相污染，登出不再需要重設，同帳號重登入記得原本的車。
function activeSkinKey(uid: string | null): string {
  return `${ACTIVE_KEY}_${uid ?? "guest"}`;
}

async function getUid(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user.id ?? null;
}

// 把伺服器回應寫進本地快取（覆寫，不是疊加——伺服器永遠是最新真相）
export function writeCoinsCache(n: number): void {
  try { localStorage.setItem(COINS_KEY, String(Math.max(0, n))); } catch { /* 靜默 */ }
}
export function writeDiamondsCache(n: number): void {
  try { localStorage.setItem(DIAMONDS_KEY, String(Math.max(0, n))); } catch { /* 靜默 */ }
}
function writeOwnedCache(owned: string[]): void {
  try { localStorage.setItem(OWNED_KEY, JSON.stringify(owned)); } catch { /* 靜默 */ }
}
function writeAdsRemovedCache(v: boolean): void {
  try { localStorage.setItem(ADS_REMOVED_KEY, v ? "1" : "0"); } catch { /* 靜默 */ }
}
export function writeTicketsCache(n: number): void {
  try { localStorage.setItem(TICKETS_KEY, String(Math.max(0, n))); } catch { /* 靜默 */ }
}

// 永久去廣告：復活廣告/每日拿金幣廣告/每日排名賽後 3 次挑戰的廣告標籤，購買後全部跳過
// （見 App.tsx/GameCanvas.tsx/Garage.tsx/DailyChallenge.tsx 的判斷點）。未登入一律 false
// （去廣告是真錢購買，只有已登入玩家能買，訪客沒有這個狀態）。
export function getAdsRemoved(): boolean {
  try { return localStorage.getItem(ADS_REMOVED_KEY) === "1"; } catch { return false; }
}

// 已登入時把伺服器錢包（金幣/鑽石/擁有清單/成就進度/streak）同步進本地快取；
// 未登入/RPC 失敗靜默略過（App.tsx 登入後呼叫一次；Garage.tsx 掛載時也呼叫一次，
// 確保換裝置/換帳號登入時不會卡在舊快取——這正是 2026-07-05 帳號污染 bug 的修復核心：
// 每次登入都整包覆寫，不管裝置上原本殘留哪個帳號的資料）。
export async function syncWalletFromServer(): Promise<void> {
  const uid = await getUid();
  if (!uid) { console.warn("[wallet] syncWalletFromServer 略過：目前沒有登入 session"); return; }
  const { data, error } = await supabase.rpc("wallet_get");
  if (error) console.error("[wallet] wallet_get 失敗，本地快取沿用舊值", error);
  if (error || !data || !data[0]) return; // RPC 尚未建立/未登入/網路失敗：本地快取先頂著
  const row = data[0] as {
    coins: number; diamonds: number; owned: string[];
    bull_finishes: number; bear_finishes: number;
    streak_count: number; last_session_key: string | null;
    collection: string[]; ads_removed: boolean; tickets: number;
    total_flips: number; total_perfect: number;
  };
  writeCoinsCache(row.coins);
  writeDiamondsCache(row.diamonds);
  writeOwnedCache(row.owned);
  writeAchievementsCache(row.bull_finishes, row.bear_finishes, row.total_flips, row.total_perfect);
  writeStreakCache(row.last_session_key, row.streak_count);
  writeCollectionCache(row.collection ?? []);
  writeAdsRemovedCache(row.ads_removed ?? false);
  writeTicketsCache(row.tickets ?? 0);
}

// 每局結束呼叫（App.tsx handleGameOver，任何模式完賽/摔車都算，跟 Q 系列同一套
// 「不分模式累計」哲學）：累加終身翻轉圈數/完美落地次數，供稱號成就解鎖判斷。
export async function recordRunStats(flips: number, perfect: number): Promise<void> {
  const uid = await getUid();
  if (!uid) return;
  const { data, error } = await supabase.rpc("record_run_stats", { p_flips: flips, p_perfect: perfect });
  if (error || !data || !data[0]) return;
  const row = data[0] as { total_flips: number; total_perfect: number };
  writeRunStatsCache(row.total_flips, row.total_perfect);
}

// 一般/長征模式結算時的機率型票券獎勵（8% 機率、每日上限 3 張，見
// wallet_maybe_earn_ticket() 註解）。回傳 true=有中，false=沒中或已達上限。
export async function maybeEarnTicket(): Promise<boolean> {
  const uid = await getUid();
  if (!uid) return false;
  const { data, error } = await supabase.rpc("wallet_maybe_earn_ticket");
  if (error || !data || !data[0]) return false;
  const row = data[0] as { granted: boolean; tickets: number };
  writeTicketsCache(row.tickets);
  return row.granted;
}

// 購買永久去廣告成功後呼叫（garage.ts 以外的地方買完直接寫快取，不用整包重新同步）。
export function markAdsRemoved(): void {
  writeAdsRemovedCache(true);
}

// 登出時呼叫：把錢包/成就/streak/圖鑑快取全部歸零成訪客預設值，避免下一個登入的帳號
// （或登出後的訪客畫面）看到上一個帳號的金幣/鑽石/擁有清單/成就/收集殘影。
// 裝備車皮（ACTIVE_KEY）不在這裡處理——已改帳號隔離（見 activeSkinKey()），各帳號
// 各自的 key 天生不會互相污染，不需要也不應該在登出時重設。
export function resetWalletCache(): void {
  writeCoinsCache(0);
  writeDiamondsCache(0);
  writeOwnedCache(["default"]);
  resetAchievementsCache();
  resetStreakCache();
  resetCollectionCache();
  writeAdsRemovedCache(false);
  writeTicketsCache(0);
}

export function getTickets(): number {
  try {
    return parseInt(localStorage.getItem(TICKETS_KEY) ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

// 完賽時呼叫（App.tsx，僅已登入玩家；未登入走 achievements.ts 本地 recordFinish）。
// 伺服器自己查當期 TAIEX 漲跌決定算 bull 還是 bear，不信任客戶端傳的 mood。
export async function recordMarketFinish(): Promise<void> {
  const uid = await getUid();
  if (!uid) return;
  const { data, error } = await supabase.rpc("record_market_finish");
  if (error || !data || !data[0]) return;
  const row = data[0] as { bull_finishes: number; bear_finishes: number };
  writeAchievementsCache(row.bull_finishes, row.bear_finishes);
}

export function getCoins(): number {
  try {
    return parseInt(localStorage.getItem(COINS_KEY) ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

// 加幣（完賽/任務獎勵呼叫），回傳最新餘額
export function addCoins(n: number): number {
  const next = Math.max(0, getCoins() + n);
  try {
    localStorage.setItem(COINS_KEY, String(next));
  } catch { /* localStorage 不可用時略過 */ }
  return next;
}

// 鑽石：目前沒有任何獲取管道（無廣告/任務/完賽獎勵），只有開發者測試帳號會補滿——
// 之後接上 IAP 購買頁才會開放一般玩家取得。
export function getDiamonds(): number {
  try {
    return parseInt(localStorage.getItem(DIAMONDS_KEY) ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

export function addDiamonds(n: number): number {
  const next = Math.max(0, getDiamonds() + n);
  try {
    localStorage.setItem(DIAMONDS_KEY, String(next));
  } catch { /* 靜默 */ }
  return next;
}

// 發幣入口（完賽/摔車/長征/任務/看廣告呼叫）：先用 addCoins() 本地樂觀更新（不管有沒有
// 登入都立刻反映在畫面上，體感零延遲），已登入時再背景呼叫伺服器 RPC 覆寫成真實餘額——
// 若伺服器判定當日該管道已達上限，樂觀加的量會被這次覆寫收回，不留竄改空間。
// p_amount 只有 kind==="long_crash" 才會用到（依行駛距離比例的變動金額，伺服器仍會
// clamp 在 0~30，不信任前端傳的數字超出範圍）；其餘 kind 一律由伺服器決定固定面額。
//
// 回傳值：true=伺服器真的加了錢；false=伺服器明確拒絕（當日該管道已達上限）；
// null=沒登入／RPC 失敗／網路斷（樂觀值先頂著，無法判定）。呼叫端拿到 false 時應該
// 明確告訴玩家「今日已達上限」——2026-07-10 真機實測發現，看完 30 秒廣告卻只看到
// 金幣數字閃一下就被伺服器權威值蓋回去、毫無提示，體感像是被吃錢（見 migration_20260710.sql）。
export async function earnCoins(
  kind: "finish" | "crash" | "long_finish" | "long_crash" | "quest" | "ad",
  amount?: number,
): Promise<boolean | null> {
  const uid = await getUid();
  // 2026-07-09 診斷：wallet_earn_log 對某些帳號完全查不到任何一筆紀錄，代表問題可能
  // 發生在「連 RPC 都沒送出去」這個更早的環節（getUid() 拿到 null，Supabase session
  // 遺失/尚未還原），而不是「RPC 送出去但被拒絕」。用 console.warn（非 error，guest
  // 玩家沒登入本來就會走這條，不算異常）先把這個分支印出來，區分兩種情況。
  if (!uid) { console.warn(`[wallet] earnCoins(${kind}) 略過：目前沒有登入 session`); return null; }
  const { data, error } = await supabase.rpc("wallet_earn", { p_kind: kind, p_amount: amount ?? null });
  if (error) console.error(`[wallet] wallet_earn(${kind}) 失敗，伺服器沒有記到這筆`, error);
  if (error || !data || !data[0]) return null; // RPC 尚未建立/網路失敗：樂觀值先頂著
  const row = data[0] as { coins: number; diamonds: number; granted?: boolean };
  writeCoinsCache(row.coins);
  writeDiamondsCache(row.diamonds);
  // granted 是 migration_20260710.sql 才加的欄位；舊版 RPC 還沒跑 migration 時會是
  // undefined，此時回 null（＝「無法判定」）而不是 false，避免對還沒更新 DB 的環境
  // 誤報「已達上限」。
  return typeof row.granted === "boolean" ? row.granted : null;
}

// 伺服器認定的「今日已用次數」（看廣告拿金幣次數 / 排名賽挑戰次數）。
// 前端的次數原本只存 localStorage，清除資料/重裝/換殼（TWA→Capacitor 讓 web origin
// 從 pages.dev 變成 localhost）都會歸零，跟伺服器對不起來——真正的上限一直是伺服器
// 在把關（清資料刷不出額外金幣/場次），但畫面會誤導玩家「還能再看 2 次廣告」。
// 進車庫/進排行榜時呼叫這支覆蓋本地計數，畫面才會反映真實剩餘次數。
// 回傳 null 代表未登入／RPC 失敗（呼叫端沿用本地計數即可，訪客本來就是純本地）。
export async function fetchDailyUsage(): Promise<{ adClaims: number; attemptsUsed: number } | null> {
  const uid = await getUid();
  if (!uid) return null;
  const { data, error } = await supabase.rpc("wallet_daily_usage");
  if (error) { console.error("[wallet] wallet_daily_usage 失敗，沿用本地次數快取", error); return null; }
  if (!data || !data[0]) return null;
  const row = data[0] as { ad_claims: number; attempts_used: number };
  return { adClaims: row.ad_claims, attemptsUsed: row.attempts_used };
}

export function getOwnedSkins(): string[] {
  try {
    const raw = localStorage.getItem(OWNED_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return list.includes("default") ? list : ["default", ...list];
  } catch {
    return ["default"];
  }
}

export function isOwned(id: string): boolean {
  const skin = BIKE_SKINS.find((s) => s.id === id);
  if (skin && skin.price === 0 && !skin.locked) return true; // 免費車款一律視為已擁有，不用走購買流程
  return getOwnedSkins().includes(id);
}

// Q 系列成就解鎖：不扣金幣，直接加入擁有清單（由 Garage.tsx 偵測 achievements.ts
// 進度已達成時呼叫，冪等——重複呼叫不影響已擁有狀態）。已登入時改走
// wallet_unlock_achievement RPC 寫回伺服器擁有清單（v1 仍信任客戶端算的成就進度，
// 見 migration_20260705.sql 註解；未登入維持純本地）。
export async function unlockAchievementSkin(id: string): Promise<boolean> {
  if (isOwned(id)) return true;
  const skin = BIKE_SKINS.find((s) => s.id === id);
  if (!skin) return false;

  const uid = await getUid();
  if (uid) {
    const { data, error } = await supabase.rpc("wallet_unlock_achievement", { p_skin_id: id });
    if (!error && data && data[0]) {
      writeOwnedCache((data[0] as { owned: string[] }).owned);
      return true;
    }
    // RPC 失敗（尚未跑 migration/網路問題）：退回本地寫入，下次登入同步時會被伺服器覆寫
  }
  const owned = getOwnedSkins();
  owned.push(id);
  writeOwnedCache(owned);
  return true;
}

// 購買：餘額足夠才扣款+加入擁有清單，回傳是否成功（依 currency 欄位扣金幣或鑽石）。
// 已登入時改走 wallet_spend_skin RPC（伺服器驗證價格與餘額，本地無法竄改）；
// 未登入維持純本地（上不了排行榜，接受）。
export async function purchaseSkin(id: string): Promise<boolean> {
  if (isOwned(id)) return true;
  const skin = BIKE_SKINS.find((s) => s.id === id);
  if (!skin) return false;
  const currency = skin.currency ?? "coin";

  const uid = await getUid();
  if (uid) {
    const { data, error } = await supabase.rpc("wallet_spend_skin", { p_skin_id: id });
    if (error || !data || !data[0]) return false; // RPC 尚未建立/網路失敗：不放行購買（避免免費解鎖）
    const row = data[0] as { coins: number; diamonds: number; owned: string[]; ok: boolean };
    writeCoinsCache(row.coins);
    writeDiamondsCache(row.diamonds);
    writeOwnedCache(row.owned);
    return row.ok;
  }

  if (currency === "diamond") {
    if (getDiamonds() < skin.price) return false;
    addDiamonds(-skin.price);
  } else {
    if (getCoins() < skin.price) return false;
    addCoins(-skin.price);
  }
  const owned = getOwnedSkins();
  owned.push(id);
  writeOwnedCache(owned);
  return true;
}

// 開發者測試帳號補滿金幣+鑽石+成就進度+streak（wallet_dev_grant RPC，JWT email 綁定，
// 取代舊的前端 devSetProgress()/devForceStreak() 本地寫死）。非開發者帳號呼叫會被伺服器靜默拒絕。
export async function grantDevWallet(): Promise<void> {
  const uid = await getUid();
  if (!uid) return;
  const { data, error } = await supabase.rpc("wallet_dev_grant");
  if (error || !data || !data[0]) return;
  const row = data[0] as {
    coins: number; diamonds: number;
    bull_finishes: number; bear_finishes: number;
    streak_count: number; last_session_key: string | null;
  };
  writeCoinsCache(row.coins);
  writeDiamondsCache(row.diamonds);
  writeAchievementsCache(row.bull_finishes, row.bear_finishes);
  writeStreakCache(row.last_session_key, row.streak_count);
}

export function getActiveSkinId(uid: string | null = null): string {
  try {
    const id = localStorage.getItem(activeSkinKey(uid));
    return id && isOwned(id) ? id : "default";
  } catch {
    return "default";
  }
}

// 選用：只有已擁有的車皮能選
export function setActiveSkin(id: string, uid: string | null = null): boolean {
  if (!isOwned(id)) return false;
  try {
    localStorage.setItem(activeSkinKey(uid), id);
  } catch { /* 靜默 */ }
  return true;
}

// GameCanvas 繪車時讀取目前選用的完整車皮設定
export function getActiveBikeSkin(uid: string | null = null): BikeSkin {
  return BIKE_SKINS.find((s) => s.id === getActiveSkinId(uid)) ?? BIKE_SKINS[0];
}

// ============================================================
// 抽獎轉輪 + 鑽石新出口（LOTTERY_DESIGN.md）——只有已登入玩家能用（跟鑽石一樣，
// 訪客沒有伺服器錢包可寫入）。中獎結果一律伺服器 lottery_spin() 決定，前端
// 只負責播動畫，見文件 §8 技術要求。
// ============================================================

export interface LotterySpinResult {
  ok: boolean;
  prizeKind: "diamond" | "skin" | "ticket" | null;
  prizeId: string | null; // 鑽石/票券數量（文字）或車款 id
  diamonds: number;
  tickets: number;
  owned: string[];
}

// p_paid=false：消耗今日免費額度（上限 2，超過 ok=false）；p_paid=true：扣 20 鑽石抽一次。
export async function lotterySpin(paid: boolean): Promise<LotterySpinResult | null> {
  const uid = await getUid();
  if (!uid) return null;
  const { data, error } = await supabase.rpc("lottery_spin", { p_paid: paid });
  if (error || !data || !data[0]) { console.error("[lottery] lottery_spin 失敗", error); return null; }
  const row = data[0] as {
    ok: boolean; prize_kind: "diamond" | "skin" | "ticket" | null; prize_id: string | null;
    diamonds: number; tickets: number; owned: string[];
  };
  writeDiamondsCache(row.diamonds);
  writeTicketsCache(row.tickets);
  writeOwnedCache(row.owned);
  return { ok: row.ok, prizeKind: row.prize_kind, prizeId: row.prize_id, diamonds: row.diamonds, tickets: row.tickets, owned: row.owned };
}

// 今日已用的免費抽獎次數（進抽獎畫面時呼叫，決定按鈕顯示「看廣告抽」還是「20鑽石/次」）。
export async function lotteryState(): Promise<number | null> {
  const uid = await getUid();
  if (!uid) return null;
  const { data, error } = await supabase.rpc("lottery_state");
  if (error || !data || !data[0]) return null;
  return (data[0] as { free_spins_used: number }).free_spins_used;
}

// 購買鑽石新出口道具（暱稱顏色/稱號/前綴圖示/尾焰特效顏色/鬼影顏色），id 前綴見
// LOTTERY_DESIGN.md §4 白名單。黑天鵝專屬項目不在白名單內，伺服器會靜默拒絕。
export async function walletSpendItem(itemId: string): Promise<boolean> {
  if (isOwned(itemId)) return true;
  const uid = await getUid();
  if (!uid) return false;
  const { data, error } = await supabase.rpc("wallet_spend_item", { p_item_id: itemId });
  if (error || !data || !data[0]) return false;
  const row = data[0] as { diamonds: number; owned: string[]; ok: boolean };
  writeDiamondsCache(row.diamonds);
  writeOwnedCache(row.owned);
  return row.ok;
}

// 花 1 張票券跳過廣告（用於「復活」這類非貨幣型獎勵，扣成功後前端照既有
// 「看完廣告」邏輯繼續走）。
export async function consumeTicket(): Promise<boolean> {
  const uid = await getUid();
  if (!uid) return false;
  const { data, error } = await supabase.rpc("consume_ticket");
  if (error || !data || !data[0]) return false;
  const row = data[0] as { ok: boolean; tickets: number };
  writeTicketsCache(row.tickets);
  return row.ok;
}

// 花 1 張票券直接領取原本要看廣告才有的貨幣獎勵（車庫拿金幣/結算雙倍，含長征模式）。
// p_amount 只有 kind==="long_crash" 才會用到，同 earnCoins() 的既有慣例。
export async function earnViaTicket(
  kind: "finish" | "crash" | "long_finish" | "long_crash" | "quest" | "ad",
  amount?: number,
): Promise<boolean> {
  const uid = await getUid();
  if (!uid) return false;
  const { data, error } = await supabase.rpc("wallet_earn_via_ticket", { p_kind: kind, p_amount: amount ?? null });
  if (error || !data || !data[0]) return false;
  const row = data[0] as { ok: boolean; coins: number; diamonds: number; tickets: number };
  writeCoinsCache(row.coins);
  writeDiamondsCache(row.diamonds);
  writeTicketsCache(row.tickets);
  return row.ok;
}

// 看廣告換 1 張票券，每日上限 2 張。
export async function earnTicket(): Promise<boolean | null> {
  const uid = await getUid();
  if (!uid) return null;
  const { data, error } = await supabase.rpc("wallet_earn_ticket");
  if (error || !data || !data[0]) return null;
  const row = data[0] as { ok: boolean; tickets: number };
  writeTicketsCache(row.tickets);
  return row.ok;
}

// ── 個人化裝備（稱號/暱稱顏色/前綴圖示/尾焰特效顏色/鬼影顏色）：純本地偏好，
// 帳號隔離，比照 activeSkinKey() 的既有慣例（見該函式註解——這類「目前裝備中」
// 的展示偏好不是安全/公平性敏感資料，只有「擁有清單」才需要伺服器權威）。
function cosmeticActiveKey(kind: string, uid: string | null): string {
  return `tr_${kind}_active_${uid ?? "guest"}`;
}
export function getActiveCosmetic(kind: "title" | "nickcolor" | "badge" | "trail" | "ghostcolor", uid: string | null = null): string | null {
  try {
    const id = localStorage.getItem(cosmeticActiveKey(kind, uid));
    return id && isOwned(id) ? id : null;
  } catch {
    return null;
  }
}
export function setActiveCosmetic(kind: "title" | "nickcolor" | "badge" | "trail" | "ghostcolor", id: string | null, uid: string | null = null): boolean {
  if (id !== null && !isOwned(id)) return false;
  try {
    if (id === null) localStorage.removeItem(cosmeticActiveKey(kind, uid));
    else localStorage.setItem(cosmeticActiveKey(kind, uid), id);
  } catch { /* 靜默 */ }
  return true;
}
