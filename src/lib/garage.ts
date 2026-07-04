// 車庫系統：軟通貨（金幣）+ 車皮解鎖/選用。設計見 GARAGE_DESIGN.md。
// 物理與貼圖完全分離，換皮不動手感/難度/排行榜公平性。
// 兩種車皮類型：
//   - 無 src：套用預設 bike.png + hueRotateDeg 濾鏡（零成本色彩過渡方案）
//   - 有 src：獨立圖檔，spriteW/spriteOffsetX/spriteOffsetY 覆蓋 constants.ts 的
//     全域 BIKE.spriteW/spriteOffsetX/spriteOffsetY——每張 AI 生圖的車身佔畫布比例
//     不同，靠這三個數字讓貼圖的兩個輪子精準對齊物理輪子位置（見下方各車皮註解，
//     數值由 scripts 量測輪圈色塊中心點算出，不是憑感覺調的）。
// localStorage 慣例同 medals.ts / streak.ts：try/catch 靜默 fallback，無版本欄位。

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
    price: 200, hueRotateDeg: 0, src: "bikes/b2-cafe-racer.png",
    spriteW: 75.3, spriteOffsetX: -0.3, spriteOffsetY: -5.6,
  },
  {
    id: "b1-street-white", name: "街頭通勤小白", desc: "簡潔白色速克達，親民出廠首選",
    price: 150, hueRotateDeg: 0, src: "bikes/b1-street-white.png",
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
  // 鑽石車款（P 系列，2 台已生圖可測；P3~P5 尚未生圖，維持 Garage.tsx 的「敬請期待」清單）。
  // 量測方式同 Q 系列：OpenCV HoughCircles 找 alpha 遮罩上的兩個輪胎圓，換算 spriteW/offsetX/Y；
  // 價格為暫定佔位值（IAP 真實定價待 Billing 接上後再決定，見上方註解）。
  {
    id: "p1-crimson", name: "赤紅暴走", desc: "旗艦全整流罩仿賽，霓虹紅賽車魂",
    price: 300, currency: "diamond", hueRotateDeg: 0, src: "bikes/p1-crimson.png",
    spriteW: 74.7, spriteOffsetX: -0.2, spriteOffsetY: -5.7,
  },
  {
    id: "p2-galaxy", name: "銀河鍍鉻", desc: "鏡面鍍鉻概念車，內嵌流轉星河",
    price: 380, currency: "diamond", hueRotateDeg: 0, src: "bikes/p2-galaxy.png",
    spriteW: 73.3, spriteOffsetX: -0.4, spriteOffsetY: -2.7,
  },
];

const COINS_KEY = "tr_garage_coins";
const DIAMONDS_KEY = "tr_garage_diamonds";
const OWNED_KEY = "tr_garage_owned";
const ACTIVE_KEY = "tr_garage_active";

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
// 進度已達成時呼叫，冪等——重複呼叫不影響已擁有狀態）
export function unlockAchievementSkin(id: string): boolean {
  if (isOwned(id)) return true;
  const skin = BIKE_SKINS.find((s) => s.id === id);
  if (!skin) return false;
  const owned = getOwnedSkins();
  owned.push(id);
  try {
    localStorage.setItem(OWNED_KEY, JSON.stringify(owned));
  } catch { /* 靜默 */ }
  return true;
}

// 購買：餘額足夠才扣款+加入擁有清單，回傳是否成功（依 currency 欄位扣金幣或鑽石）
export function purchaseSkin(id: string): boolean {
  if (isOwned(id)) return true;
  const skin = BIKE_SKINS.find((s) => s.id === id);
  if (!skin) return false;
  const currency = skin.currency ?? "coin";
  if (currency === "diamond") {
    if (getDiamonds() < skin.price) return false;
    addDiamonds(-skin.price);
  } else {
    if (getCoins() < skin.price) return false;
    addCoins(-skin.price);
  }
  const owned = getOwnedSkins();
  owned.push(id);
  try {
    localStorage.setItem(OWNED_KEY, JSON.stringify(owned));
  } catch { /* 靜默 */ }
  return true;
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
