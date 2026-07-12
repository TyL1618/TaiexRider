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

export function classicPb(classicId: string, uid: string | null = null): number {
  try {
    return parseInt(localStorage.getItem(`tr_pb_classic_${classicId}_${uid ?? "guest"}`) ?? "0", 10) || 0;
  } catch {
    return 0;
  }
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
