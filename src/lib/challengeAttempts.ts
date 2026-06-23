// 每日排名賽挑戰次數管理（localStorage，key 帶 session date → 隔天自動失效）
// 規則：2 次免費 + 3 次看廣告解鎖 = 每日上限 5 次；復活不消耗次數。

export const MAX_ATTEMPTS = 5;
export const FREE_ATTEMPTS = 2;

function storageKey(sessionDate: string): string {
  return `tr_daily_att_${sessionDate}`;
}

export function getAttempts(sessionDate: string): number {
  try {
    const n = parseInt(localStorage.getItem(storageKey(sessionDate)) ?? "0", 10);
    return isNaN(n) ? 0 : Math.min(n, MAX_ATTEMPTS);
  } catch { return 0; }
}

export function incrementAttempts(sessionDate: string): void {
  try {
    const n = getAttempts(sessionDate);
    if (n < MAX_ATTEMPTS) localStorage.setItem(storageKey(sessionDate), String(n + 1));
  } catch {}
}
