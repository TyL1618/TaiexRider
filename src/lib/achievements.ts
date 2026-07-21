// Q 系列任務解鎖車款的成就計數。Q1 多頭鬥牛／Q2 空頭獵手＝大漲/大跌日「完賽」累計次數；
// Q3 火鳳凰（原名不死鳥，2026-07-07 改名）沿用既有 streak.ts 連續參賽天數，不重複記一份。
//
// 2026-07-06：已登入玩家改以伺服器 player_achievements 表（migration_20260706.sql）
// 為權威來源，這裡的 localStorage 只當「顯示用快取」——登入時由 garage.ts
// syncWalletFromServer() 覆寫（writeAchievementsCache），登出時清零
// （resetAchievementsCache）。背景：舊版純本地+不分帳號，導致同裝置切換 Google
// 帳號時，舊帳號的假進度被新帳號讀到，Garage.tsx 甚至因此誤呼叫解鎖 RPC 把
// Q 車款寫進新帳號的伺服器擁有清單（tommyisboy08 誤解鎖事件，2026-07-05）。
// 未登入玩家維持純本地 recordFinish() 累計（無法上排行榜，接受）。

const KEY = "tr_achv_market";

interface MarketAchv {
  bullFinishes: number; // 大盤大漲日完賽累計次數
  bearFinishes: number; // 大盤大跌日完賽累計次數
  totalFlips: number;   // 終身累計翻轉圈數（稱號解鎖用，見 §稱號成就）
  totalPerfect: number; // 終身累計完美落地次數
}

function load(): MarketAchv {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { bullFinishes: 0, bearFinishes: 0, totalFlips: 0, totalPerfect: 0 };
    const d = JSON.parse(raw) as Partial<MarketAchv>;
    return {
      bullFinishes: d.bullFinishes ?? 0, bearFinishes: d.bearFinishes ?? 0,
      totalFlips: d.totalFlips ?? 0, totalPerfect: d.totalPerfect ?? 0,
    };
  } catch {
    return { bullFinishes: 0, bearFinishes: 0, totalFlips: 0, totalPerfect: 0 };
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

// 已登入時由伺服器覆寫本地顯示快取（登入同步 / 完賽後 record_market_finish 回應 /
// 開發者測試帳號 wallet_dev_grant 回應，三處呼叫端見 garage.ts）。totalFlips/
// totalPerfect 只有 syncWalletFromServer（wallet_get 回應）才帶得到，其餘兩處
// 呼叫端沒有這兩個數字，省略時保留原本已存的值，不要覆寫成 0。
export function writeAchievementsCache(
  bullFinishes: number, bearFinishes: number,
  totalFlips?: number, totalPerfect?: number,
): void {
  const prev = load();
  save({
    bullFinishes, bearFinishes,
    totalFlips: totalFlips ?? prev.totalFlips,
    totalPerfect: totalPerfect ?? prev.totalPerfect,
  });
}

// 登出時呼叫：清零本地快取，避免下一個登入的帳號看到上一個帳號的進度殘影。
export function resetAchievementsCache(): void {
  save({ bullFinishes: 0, bearFinishes: 0, totalFlips: 0, totalPerfect: 0 });
}

// record_run_stats RPC 回應專用（garage.ts recordRunStats()）：只覆寫終身翻轉/
// 完美落地累計，保留既有 bullFinishes/bearFinishes 不動。
export function writeRunStatsCache(totalFlips: number, totalPerfect: number): void {
  const prev = load();
  save({ ...prev, totalFlips, totalPerfect });
}

export const Q1_BULL_TARGET = 10;
export const Q2_BEAR_TARGET = 10;
export const Q3_STREAK_TARGET = 30;

// 稱號成就目標（LOTTERY_DESIGN.md 更新：連勝狂魔/排行榜常客/空中飛人/
// 地心引力挑戰者/完美落地大師，改成跟 Q 系列一樣達標自動解鎖，不可購買）。
export const TITLE_WIN_STREAK_TARGET = 7;         // 連勝狂魔：連續參賽天數
export const TITLE_LEADERBOARD_TARGET = 50;       // 排行榜常客：大漲/大跌日完賽合計次數
export const TITLE_AIR_WALKER_TARGET = 200;       // 空中飛人：終身累計翻轉圈數
export const TITLE_GRAVITY_TARGET = 500;          // 地心引力挑戰者：終身累計翻轉圈數（進階）
export const TITLE_PERFECT_LANDING_TARGET = 100;  // 完美落地大師：終身累計完美落地次數

export interface AchvTitleView {
  id: string;
  name: string;
  desc: string;
  target: number;
  progress: number;
  unlocked: boolean;
}

// streakDays 由呼叫端傳入，跟 getAchievementBikes() 同一套慣例（避免這裡重複算連續期別）
export function getAchievementTitles(streakDays: number): AchvTitleView[] {
  const m = load();
  const totalFinishes = m.bullFinishes + m.bearFinishes;
  return [
    {
      id: "title:win-streak", name: "連勝狂魔", desc: `連續參賽 ${TITLE_WIN_STREAK_TARGET} 天`,
      target: TITLE_WIN_STREAK_TARGET, progress: Math.min(TITLE_WIN_STREAK_TARGET, streakDays),
      unlocked: streakDays >= TITLE_WIN_STREAK_TARGET,
    },
    {
      id: "title:leaderboard-regular", name: "排行榜常客", desc: `大漲/大跌日完賽合計 ${TITLE_LEADERBOARD_TARGET} 次`,
      target: TITLE_LEADERBOARD_TARGET, progress: Math.min(TITLE_LEADERBOARD_TARGET, totalFinishes),
      unlocked: totalFinishes >= TITLE_LEADERBOARD_TARGET,
    },
    {
      id: "title:air-walker", name: "空中飛人", desc: `終身累計翻轉 ${TITLE_AIR_WALKER_TARGET} 圈`,
      target: TITLE_AIR_WALKER_TARGET, progress: Math.min(TITLE_AIR_WALKER_TARGET, m.totalFlips),
      unlocked: m.totalFlips >= TITLE_AIR_WALKER_TARGET,
    },
    {
      id: "title:gravity-challenger", name: "地心引力挑戰者", desc: `終身累計翻轉 ${TITLE_GRAVITY_TARGET} 圈`,
      target: TITLE_GRAVITY_TARGET, progress: Math.min(TITLE_GRAVITY_TARGET, m.totalFlips),
      unlocked: m.totalFlips >= TITLE_GRAVITY_TARGET,
    },
    {
      id: "title:perfect-landing", name: "完美落地大師", desc: `終身累計完美落地 ${TITLE_PERFECT_LANDING_TARGET} 次`,
      target: TITLE_PERFECT_LANDING_TARGET, progress: Math.min(TITLE_PERFECT_LANDING_TARGET, m.totalPerfect),
      unlocked: m.totalPerfect >= TITLE_PERFECT_LANDING_TARGET,
    },
  ];
}

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
      id: "q3-phoenix", name: "火鳳凰", desc: `連續參賽 ${Q3_STREAK_TARGET} 天`,
      target: Q3_STREAK_TARGET, progress: Math.min(Q3_STREAK_TARGET, streakDays),
      unlocked: streakDays >= Q3_STREAK_TARGET,
    },
  ];
}
