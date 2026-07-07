// 玩遊戲（完賽/摔車/長征/看廣告雙倍）獲得金幣的單日總量上限——2026-07-07 使用者拍板：
// 完賽/摔車獎勵調降（10→5／3→2）後再加一個組合上限，避免玩短賽道無限刷；
// 2026-07-08 再拍板：上限 50→100（長征模式一場最高 60，兩場就能吃滿全天額度，
// 用意是拉高長征模式的誘因），看廣告雙倍本局金幣也算在這桶內（不算獨立管道）。
// 範圍只算完賽/摔車/長征/雙倍，每日任務/週任務/車庫看廣告各自獨立不受影響（各自已有
// 自己的每日次數上限，見 quests.ts/weeklyQuests.ts/adRewards.ts）。排行榜賽事/經典模式
// 不給金幣（改給鑽石，見 App.tsx handleGameOver 排除邏輯）。
// 伺服器端同一套規則見 supabase/migration_20260708.sql 的 wallet_earn()（finish/crash/
// long_finish/long_crash 共用 kind='play' 的 wallet_earn_log，累計「金幣數」而非次數，
// 上限同為 100）——這裡是給未登入玩家（純本地）以及已登入玩家「本地樂觀顯示」用，
// 已登入時 earnCoins() 背景呼叫伺服器 RPC 才是真正權威，本地這份頂多讓樂觀顯示不會
// 超前伺服器太多。

export const PLAY_REWARD_DAILY_CAP = 100;

// 完賽/摔車（含長征）的金幣公式，GameCanvas（結算畫面顯示/雙倍按鈕）跟 App.tsx
// （實際發幣）共用同一份，避免兩邊算出不同數字。
// 長征模式：完賽固定 30（一般模式 5 的 5 張圖份量 25 + 額外 5 當誘因），摔車依「跑到
// 全程的百分比」等比例給（progressPct 0~1，跟死亡熱點用的 xr 是同一個座標概念）。
export function computePlayReward(isLong: boolean, finished: boolean, progressPct: number): number {
  if (isLong) {
    return finished ? 30 : Math.round(30 * Math.max(0, Math.min(1, progressPct)));
  }
  return finished ? 5 : 2;
}

// 2026-07-08 晚間修正：key 原本沒帶 uid，同裝置切換帳號（例如開發者測試帳號重度測試後
// 登出改玩訪客）會沿用「前一個使用者」當天已經衝到滿的額度，訪客那邊看起來變成「怎麼玩
// 都 0 元」——跟 challengeAttempts.ts 2026-07-07 修過的同一種跨帳號快取污染問題，這裡補上
// 同樣的 uid 隔離（訪客固定用 "guest"）。
function storageKey(uid: string | null, day: string): string {
  return `tr_play_reward_${uid ?? "guest"}_${day}`;
}

function getEarnedToday(uid: string | null, day: string): number {
  try {
    const n = parseInt(localStorage.getItem(storageKey(uid, day)) ?? "0", 10);
    return isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
}

// 依當日已賺金額扣抵，回傳「這次實際能拿到的金幣數」（可能是 0，也可能小於 amount）。
export function grantPlayReward(day: string, amount: number, uid: string | null = null): number {
  try {
    const earned = getEarnedToday(uid, day);
    const remaining = Math.max(0, PLAY_REWARD_DAILY_CAP - earned);
    const granted = Math.min(amount, remaining);
    if (granted > 0) localStorage.setItem(storageKey(uid, day), String(earned + granted));
    return granted;
  } catch {
    return amount;
  }
}
