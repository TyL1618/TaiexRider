// 每日排名賽「連續參賽」streak（Duolingo 式損失規避鉤子）。
// 期別 = resolveSessionDate 的 session key（map_date）：連假整段同一期，玩過即算該期參賽。
// 連續判定：新一期與上一期相差 ≤ 5 天視為相鄰期（涵蓋週末與一般連假）。
// 已知取捨：超長連假（過年 >5 天）恢復交易後日差過大會誤重置一次，
// 精確判定需查 daily_map 期別序列，v1 不做。
// 日期運算一律 Date.UTC 純整數（時區踩雷筆記：不可用本地 Date 差值）。
//
// 2026-07-06：已登入玩家改以伺服器 player_streak 表（migration_20260706.sql）為
// 權威來源，consume_attempt() RPC 在「進入每日排名賽」當下順便算好新 streak 回傳，
// 這裡的 localStorage 只當顯示快取（writeStreakCache 覆寫、resetStreakCache 登出清零）。
// 背景：舊版純本地+不分帳號，同裝置切換 Google 帳號會讓新帳號讀到舊帳號的假 streak，
// 連帶影響 Q3 不死鳥的解鎖判斷（見 achievements.ts 開頭說明）。未登入玩家維持純本地
// recordStreak() 累計（無法上排行榜，接受）。

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

// 已登入時由伺服器覆寫本地顯示快取（登入同步 / consume_attempt 回應 /
// 開發者測試帳號 wallet_dev_grant 回應，三處呼叫端見 garage.ts）。
// last 可能是 null（該帳號從未在伺服器留下參賽紀錄）：清空本地快取即可，
// getStreak()/playedThisSession() 對「沒有快取」的處理本來就是回傳 0/false。
export function writeStreakCache(last: string | null, count: number): void {
  if (last === null) { resetStreakCache(); return; }
  save(last, count);
}

// 登出時呼叫：清零本地快取，避免下一個登入的帳號看到上一個帳號的 streak 殘影。
export function resetStreakCache(): void {
  try { localStorage.removeItem(KEY); } catch { /* 靜默 */ }
}
