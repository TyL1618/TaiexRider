// 玩遊戲（完賽/摔車）獲得金幣的單日總量上限——2026-07-07 使用者拍板：完賽/摔車獎勵
// 調降（10→5／3→2）後再加一個 50 金幣/日的組合上限，避免玩短賽道無限刷。
// 範圍只算完賽/摔車，每日任務/週任務/看廣告各自獨立不受影響（各自已有自己的每日
// 次數上限，見 quests.ts/weeklyQuests.ts/adRewards.ts）。
// 伺服器端同一套規則見 supabase/migration_20260707c.sql 的 wallet_earn()（finish/crash
// 共用 kind='play' 的 wallet_earn_log，累計「金幣數」而非次數，上限同為 50）——這裡是
// 給未登入玩家（純本地）以及已登入玩家「本地樂觀顯示」用，已登入時 earnCoins() 背景
// 呼叫伺服器 RPC 才是真正權威，本地這份頂多讓樂觀顯示不會超前伺服器太多。

export const PLAY_REWARD_DAILY_CAP = 50;

function storageKey(day: string): string {
  return `tr_play_reward_${day}`;
}

function getEarnedToday(day: string): number {
  try {
    const n = parseInt(localStorage.getItem(storageKey(day)) ?? "0", 10);
    return isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
}

// 依當日已賺金額扣抵，回傳「這次實際能拿到的金幣數」（可能是 0，也可能小於 amount）。
export function grantPlayReward(day: string, amount: number): number {
  try {
    const earned = getEarnedToday(day);
    const remaining = Math.max(0, PLAY_REWARD_DAILY_CAP - earned);
    const granted = Math.min(amount, remaining);
    if (granted > 0) localStorage.setItem(storageKey(day), String(earned + granted));
    return granted;
  } catch {
    return amount;
  }
}
