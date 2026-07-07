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
import { writeAchievementsCache, resetAchievementsCache } from "./achievements";
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
];

const COINS_KEY = "tr_garage_coins";
const DIAMONDS_KEY = "tr_garage_diamonds";
const OWNED_KEY = "tr_garage_owned";
const ACTIVE_KEY = "tr_garage_active";
const ADS_REMOVED_KEY = "tr_ads_removed";

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
  if (!uid) return;
  const { data, error } = await supabase.rpc("wallet_get");
  if (error) console.error("[wallet] wallet_get 失敗，本地快取沿用舊值", error);
  if (error || !data || !data[0]) return; // RPC 尚未建立/未登入/網路失敗：本地快取先頂著
  const row = data[0] as {
    coins: number; diamonds: number; owned: string[];
    bull_finishes: number; bear_finishes: number;
    streak_count: number; last_session_key: string | null;
    collection: string[]; ads_removed: boolean;
  };
  writeCoinsCache(row.coins);
  writeDiamondsCache(row.diamonds);
  writeOwnedCache(row.owned);
  writeAchievementsCache(row.bull_finishes, row.bear_finishes);
  writeStreakCache(row.last_session_key, row.streak_count);
  writeCollectionCache(row.collection ?? []);
  writeAdsRemovedCache(row.ads_removed ?? false);
}

// 購買永久去廣告成功後呼叫（garage.ts 以外的地方買完直接寫快取，不用整包重新同步）。
export function markAdsRemoved(): void {
  writeAdsRemovedCache(true);
}

// 登出時呼叫：把錢包/成就/streak/圖鑑快取全部歸零成訪客預設值，避免下一個登入的帳號
// （或登出後的訪客畫面）看到上一個帳號的金幣/鑽石/車皮/成就/收集殘影。
export function resetWalletCache(): void {
  writeCoinsCache(0);
  writeDiamondsCache(0);
  writeOwnedCache(["default"]);
  try { localStorage.setItem(ACTIVE_KEY, "default"); } catch { /* 靜默 */ }
  resetAchievementsCache();
  resetStreakCache();
  resetCollectionCache();
  writeAdsRemovedCache(false);
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
export async function earnCoins(
  kind: "finish" | "crash" | "long_finish" | "long_crash" | "quest" | "ad",
  amount?: number,
): Promise<void> {
  const uid = await getUid();
  if (!uid) return; // 未登入：addCoins() 樂觀更新已經是最終結果，不用再校正
  const { data, error } = await supabase.rpc("wallet_earn", { p_kind: kind, p_amount: amount ?? null });
  if (error) console.error(`[wallet] wallet_earn(${kind}) 失敗，伺服器沒有記到這筆`, error);
  if (error || !data || !data[0]) return; // RPC 尚未建立/網路失敗：樂觀值先頂著
  const row = data[0] as { coins: number; diamonds: number };
  writeCoinsCache(row.coins);
  writeDiamondsCache(row.diamonds);
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

export function getActiveSkinId(): string {
  try {
    const id = localStorage.getItem(ACTIVE_KEY);
    return id && isOwned(id) ? id : "default";
  } catch {
    return "default";
  }
}

// 選用：只有已擁有的車皮能選
export function setActiveSkin(id: string): boolean {
  if (!isOwned(id)) return false;
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch { /* 靜默 */ }
  return true;
}

// GameCanvas 繪車時讀取目前選用的完整車皮設定
export function getActiveBikeSkin(): BikeSkin {
  return BIKE_SKINS.find((s) => s.id === getActiveSkinId()) ?? BIKE_SKINS[0];
}
