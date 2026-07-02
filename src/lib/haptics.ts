// 震動回饋（原生體驗）：navigator.vibrate 純前端，不支援的裝置全部靜默略過。
// iOS Safari / 部分桌機不支援 vibrate；TWA (Android Chrome) 支援。

const canVibrate =
  typeof navigator !== "undefined" &&
  "vibrate" in navigator &&
  typeof navigator.vibrate === "function";

function vibrate(pattern: number | number[]): void {
  if (!canVibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* 部分瀏覽器在非使用者手勢時會 throw，一律吞掉 */
  }
}

export const haptics = {
  /** 按鈕點擊：極短單震 */
  tap: () => vibrate(8),
  /** 撞車：短促強震 */
  crash: () => vibrate(120),
  /** 完美落地：節奏感雙震 */
  perfect: () => vibrate([28, 45, 55]),
};

// 全域按鈕震動：事件委派一次搞定所有 <button>（含未來新增的），
// 不用逐顆接。capture + passive 不影響既有 onClick。
export function initButtonHaptics(): void {
  if (!canVibrate) return;
  document.addEventListener(
    "pointerdown",
    (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("button")) haptics.tap();
    },
    { passive: true, capture: true },
  );
}
