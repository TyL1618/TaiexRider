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
  price: number; // 0 = 預設，一開始就擁有
  hueRotateDeg: number; // 無 src 時套用；有 src 則忽略
  src?: string;             // 相對 BASE_URL 的圖檔路徑
  spriteW?: number;         // 覆蓋 BIKE.spriteW（該車皮的繪製寬度，遊戲 px）
  spriteOffsetX?: number;   // 覆蓋 BIKE.spriteOffsetX
  spriteOffsetY?: number;   // 覆蓋 BIKE.spriteOffsetY
}

export const BIKE_SKINS: BikeSkin[] = [
  { id: "default", name: "原廠霓虹", desc: "出廠標準塗裝", price: 0, hueRotateDeg: 0 },
  // 輪圈位置由 rear/front 橘色光暈色塊中心點量測（1168×784 原圖 17.84%/79.86%w,
  // 71.8~73.9%h），換算成對齊物理輪子（wheelBaseHalf=22, wheelDropY=7）的 scale+offset。
  {
    id: "b2-cafe-racer", name: "復古咖啡騎士", desc: "橘棕配色 + 皮革坐墊，復古跑車魂",
    price: 80, hueRotateDeg: 0, src: "bikes/b2-cafe-racer.png",
    spriteW: 71, spriteOffsetX: 0.8, spriteOffsetY: -3.9,
  },
  // 輪圈位置由 rear/front 青色光暈色塊中心點量測（23.92%/77.81%w, 71.0~71.1%h）。
  {
    id: "b1-street-white", name: "街頭通勤「小白」", desc: "簡潔白色速克達，親民出廠首選",
    price: 80, hueRotateDeg: 0, src: "bikes/b1-street-white.png",
    spriteW: 82, spriteOffsetX: -0.7, spriteOffsetY: -4.5,
  },
];

const COINS_KEY = "tr_garage_coins";
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
  return getOwnedSkins().includes(id);
}

// 購買：餘額足夠才扣款+加入擁有清單，回傳是否成功
export function purchaseSkin(id: string): boolean {
  if (isOwned(id)) return true;
  const skin = BIKE_SKINS.find((s) => s.id === id);
  if (!skin) return false;
  if (getCoins() < skin.price) return false;
  addCoins(-skin.price);
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
