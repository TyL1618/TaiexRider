// 看廣告拿金幣：每日次數上限（localStorage，key 帶裝置本地日曆日 → 隔天自動失效）。
// 車庫頁與結算畫面共用同一組計數（同一天合計最多 MAX_CLAIMS 次，不是各自 2 次），
// 避免玩家瘋狂重複點擊灌金幣，也貼近未來真廣告 SDK 的每日曝光上限概念。

export const AD_COIN_REWARD = 20;
export const MAX_AD_COIN_CLAIMS_PER_DAY = 2;

function storageKey(day: string): string {
  return `tr_ad_coin_claims_${day}`;
}

export function getAdCoinClaims(day: string): number {
  try {
    const n = parseInt(localStorage.getItem(storageKey(day)) ?? "0", 10);
    return isNaN(n) ? 0 : Math.min(n, MAX_AD_COIN_CLAIMS_PER_DAY);
  } catch {
    return 0;
  }
}

export function incrementAdCoinClaims(day: string): void {
  try {
    const n = getAdCoinClaims(day);
    if (n < MAX_AD_COIN_CLAIMS_PER_DAY) localStorage.setItem(storageKey(day), String(n + 1));
  } catch { /* 靜默 */ }
}
