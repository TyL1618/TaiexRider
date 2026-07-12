// 經典模式獎牌制（Trackmania 式）：每關依「個人最佳分數」授銅/銀/金牌。
// 不需新儲存——直接讀 PB 的 localStorage（tr_pb_classic_{id}_{uid|guest}，GameCanvas
// checkPb 寫入，key 帶 uid 隔離避免同裝置切換帳號沿用前一個使用者的 PB）。
// 門檻 v1 為全關卡統一值（銅=完賽底分、銀=完賽+基本特技、金=高手線），
// 之後可依 events 完賽分數分佈改成每關獨立門檻。

export type Medal = "gold" | "silver" | "bronze";

export const MEDAL_THRESHOLDS: { medal: Medal; score: number }[] = [
  { medal: "gold",   score: 2200 },
  { medal: "silver", score: 1500 },
  { medal: "bronze", score: 1000 }, // 完賽即銅（行進分滿 1000）
];

export const MEDAL_ICON: Record<Medal, string> = {
  gold: "🥇",
  silver: "🥈",
  bronze: "🥉",
};

// PB 讀取（含一次性舊 key 沿用）：vc28 起 key 帶 {uid|guest} 隔離，vc28 前的舊 key
// （tr_pb_ 開頭、不帶帳號尾碼）在第一次讀取時複製進目前帳號的新 key——沒有這步，
// 更新後所有玩家的 PB/獎牌顯示會歸零（舊紀錄變孤兒資料），體感像進度被清掉。
// 用「複製」不用「搬移」：同裝置多帳號時每個帳號第一次讀都各自沿用一次舊值
// （舊 key 本來就是所有帳號共用的，這只是把舊行為凍結下來，之後各自獨立成長）。
export function readPb(pbKey: string, uid: string | null): number {
  try {
    const scoped = `tr_pb_${pbKey}_${uid ?? "guest"}`;
    const v = localStorage.getItem(scoped);
    if (v !== null) return parseInt(v, 10) || 0;
    const legacy = localStorage.getItem(`tr_pb_${pbKey}`);
    if (legacy !== null) {
      localStorage.setItem(scoped, legacy);
      return parseInt(legacy, 10) || 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

export function classicPb(classicId: string, uid: string | null = null): number {
  return readPb(`classic_${classicId}`, uid);
}

export function medalFor(score: number): Medal | null {
  for (const t of MEDAL_THRESHOLDS) if (score >= t.score) return t.medal;
  return null;
}

// 下一個目標獎牌（已金牌回 null），供卡片顯示「距 🥇 還差 X 分」
export function nextMedalTarget(score: number): { medal: Medal; score: number } | null {
  for (let i = MEDAL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (score < MEDAL_THRESHOLDS[i].score) return MEDAL_THRESHOLDS[i];
  }
  return null;
}
