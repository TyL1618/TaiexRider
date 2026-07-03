// 每日排名賽「連續參賽」streak（localStorage，Duolingo 式損失規避鉤子）。
// 期別 = resolveSessionDate 的 session key（map_date）：連假整段同一期，玩過即算該期參賽。
// 連續判定：新一期與上一期相差 ≤ 5 天視為相鄰期（涵蓋週末與一般連假）。
// 已知取捨：超長連假（過年 >5 天）恢復交易後日差過大會誤重置一次，
// 精確判定需查 daily_map 期別序列，v1 不做。
// 日期運算一律 Date.UTC 純整數（時區踩雷筆記：不可用本地 Date 差值）。

const KEY = "tr_daily_streak";

interface StreakData {
  last: string;  // 上次參賽的 session key（YYYY-MM-DD）
  count: number; // 連續期數
}

function load(): StreakData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as StreakData;
    return typeof d.last === "string" && typeof d.count === "number" ? d : null;
  } catch {
    return null;
  }
}

function save(last: string, count: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ last, count }));
  } catch { /* localStorage 不可用時略過 */ }
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  if (!ay || !by) return NaN;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// 進入每日排名賽遊戲時呼叫：記錄本期參賽並回傳最新 streak
export function recordStreak(sessionKey: string): number {
  const d = load();
  if (!d) { save(sessionKey, 1); return 1; }
  if (d.last === sessionKey) return d.count; // 同期重複玩不重複累計
  const diff = daysBetween(d.last, sessionKey);
  const count = diff > 0 && diff <= 5 ? d.count + 1 : 1;
  save(sessionKey, count);
  return count;
}

// 顯示用：今天已參賽 → count；上一期仍在延續窗內 → count（顯示「保持中」）；否則 0
export function getStreak(sessionKey: string): number {
  const d = load();
  if (!d) return 0;
  if (d.last === sessionKey) return d.count;
  const diff = daysBetween(d.last, sessionKey);
  return diff > 0 && diff <= 5 ? d.count : 0;
}

// 顯示輔助：目前 streak 是否已含「本期」（false = 今天還沒玩，streak 待延續）
export function playedThisSession(sessionKey: string): boolean {
  return load()?.last === sessionKey;
}

// 開發者測試帳號專用：直接寫死 streak 數字，繞過真的連續參賽 N 天（見 App.tsx dev 帳號效果）
export function devForceStreak(sessionKey: string, count: number): void {
  save(sessionKey, count);
}
