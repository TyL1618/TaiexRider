// 車庫系統：軟通貨（金幣）+ 車皮解鎖/選用。設計見 GARAGE_DESIGN.md。
// 物理與貼圖完全分離，換皮不動手感/難度/排行榜公平性——車皮目前只是對預設
// bike.png 做 canvas hue-rotate 濾鏡當「零成本過渡方案」，正式 AI 生圖到位後
// 把 hueRotateDeg 換成真正的 src 圖檔路徑即可，不用動其他任何邏輯。
// localStorage 慣例同 medals.ts / streak.ts：try/catch 靜默 fallback，無版本欄位。

export interface BikeSkin {
  id: string;
  name: string;
  desc: string;
  price: number; // 0 = 預設，一開始就擁有
  hueRotateDeg: number; // canvas ctx.filter hue-rotate 過渡色（之後可加 src 換真圖）
}

// v1 只有預設 + 2 台色彩變體（GARAGE_DESIGN.md 的 B1/B2 正式圖到位前的過渡）。
// 任務/付費車款等真圖生成後再擴充這份清單。
export const BIKE_SKINS: BikeSkin[] = [
  { id: "default", name: "原廠霓虹", desc: "出廠標準塗裝", price: 0, hueRotateDeg: 0 },
  { id: "amber", name: "琥珀塗裝", desc: "暖色調變體（過渡色，之後換正式車皮圖）", price: 80, hueRotateDeg: 45 },
  { id: "violet", name: "紫羅蘭塗裝", desc: "冷紫色調變體（過渡色，之後換正式車皮圖）", price: 80, hueRotateDeg: -70 },
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

// GameCanvas 繪車時讀取目前選用車皮的 hue-rotate 角度（0 = 不套濾鏡）
export function getActiveBikeHue(): number {
  const active = BIKE_SKINS.find((s) => s.id === getActiveSkinId());
  return active?.hueRotateDeg ?? 0;
}
