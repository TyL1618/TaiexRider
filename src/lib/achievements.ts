// Q 系列任務解鎖車款的成就計數（純本地 localStorage，設計見 GARAGE_DESIGN.md）。
// Q1 多頭鬥牛／Q2 空頭獵手＝大漲/大跌日「完賽」累計次數；Q3 不死鳥沿用既有 streak.ts
// 連續參賽天數，不重複記一份。美術（Grok 生圖）尚未到位，先做計數+UI 殼，
// 解鎖判定跑在前，圖到位時只需在 garage.ts BIKE_SKINS 補上對應 src。

const KEY = "tr_achv_market";

interface MarketAchv {
  bullFinishes: number; // 大盤大漲日完賽累計次數
  bearFinishes: number; // 大盤大跌日完賽累計次數
}

function load(): MarketAchv {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { bullFinishes: 0, bearFinishes: 0 };
    const d = JSON.parse(raw) as Partial<MarketAchv>;
    return { bullFinishes: d.bullFinishes ?? 0, bearFinishes: d.bearFinishes ?? 0 };
  } catch {
    return { bullFinishes: 0, bearFinishes: 0 };
  }
}

function save(d: MarketAchv): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch { /* 靜默 */ }
}

// 完賽時呼叫：依當期大盤漲跌 mood 累計對應次數（mood=null/flat 不計）
export function recordFinish(mood: "up" | "down" | "flat" | null): MarketAchv {
  const d = load();
  if (mood === "up") d.bullFinishes += 1;
  else if (mood === "down") d.bearFinishes += 1;
  else return d;
  save(d);
  return d;
}

// 開發者測試帳號專用：直接寫死次數，繞過真的要打 10 場大漲/大跌日（見 App.tsx dev 帳號效果）
export function devSetProgress(bullFinishes: number, bearFinishes: number): void {
  save({ bullFinishes, bearFinishes });
}

export const Q1_BULL_TARGET = 10;
export const Q2_BEAR_TARGET = 10;
export const Q3_STREAK_TARGET = 30;

export interface AchvBikeView {
  id: string;
  name: string;
  desc: string;
  target: number;
  progress: number;
  unlocked: boolean;
}

// streakDays 由呼叫端傳入（Q3 沿用 streak.ts，避免這裡重複算連續期別邏輯）
export function getAchievementBikes(streakDays: number): AchvBikeView[] {
  const m = load();
  return [
    {
      id: "q1-bull", name: "多頭鬥牛", desc: `大盤大漲日完賽累計 ${Q1_BULL_TARGET} 次`,
      target: Q1_BULL_TARGET, progress: Math.min(Q1_BULL_TARGET, m.bullFinishes),
      unlocked: m.bullFinishes >= Q1_BULL_TARGET,
    },
    {
      id: "q2-bear", name: "空頭獵手", desc: `大盤大跌日完賽累計 ${Q2_BEAR_TARGET} 次`,
      target: Q2_BEAR_TARGET, progress: Math.min(Q2_BEAR_TARGET, m.bearFinishes),
      unlocked: m.bearFinishes >= Q2_BEAR_TARGET,
    },
    {
      id: "q3-phoenix", name: "不死鳥", desc: `連續參賽 ${Q3_STREAK_TARGET} 天`,
      target: Q3_STREAK_TARGET, progress: Math.min(Q3_STREAK_TARGET, streakDays),
      unlocked: streakDays >= Q3_STREAK_TARGET,
    },
  ];
}
