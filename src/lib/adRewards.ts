// 看廣告拿金幣：每日次數上限（localStorage，key 帶裝置本地日曆日 → 隔天自動失效）。
// 車庫頁與結算畫面共用同一組計數（同一天合計最多 MAX_CLAIMS 次，不是各自 2 次），
// 避免玩家瘋狂重複點擊灌金幣，也貼近未來真廣告 SDK 的每日曝光上限概念。
//
// 2026-07-08 晚間修正：key 原本不分帳號，同裝置切換帳號會沿用「前一個使用者」當天
// 用掉的次數（跟 quests.ts/playRewards.ts/challengeAttempts.ts 修過的同一種跨帳號
// 快取污染問題），補上 uid 隔離（訪客固定用 "guest"）。

export const AD_COIN_REWARD = 20;
export const MAX_AD_COIN_CLAIMS_PER_DAY = 2;

function storageKey(uid: string | null, day: string): string {
  return `tr_ad_coin_claims_${uid ?? "guest"}_${day}`;
}

export function getAdCoinClaims(day: string, uid: string | null = null): number {
  try {
    const n = parseInt(localStorage.getItem(storageKey(uid, day)) ?? "0", 10);
    return isNaN(n) ? 0 : Math.min(n, MAX_AD_COIN_CLAIMS_PER_DAY);
  } catch {
    return 0;
  }
}

export function incrementAdCoinClaims(day: string, uid: string | null = null): void {
  try {
    const n = getAdCoinClaims(day, uid);
    if (n < MAX_AD_COIN_CLAIMS_PER_DAY) localStorage.setItem(storageKey(uid, day), String(n + 1));
  } catch { /* 靜默 */ }
}
