// 遊戲中防止螢幕自動變暗/鎖屏（原生體驗，PWA/TWA 都常見的破綻——網頁預設不會保持螢幕喚醒）。
// Screen Wake Lock API：不支援的瀏覽器/裝置直接 no-op，不拋錯。
// 規格特性：分頁隱藏時瀏覽器會自動釋放 lock，須在 visibilitychange 恢復可見時重新取得。

let sentinel: WakeLockSentinel | null = null;

async function acquire(): Promise<void> {
  if (!("wakeLock" in navigator)) return;
  try {
    sentinel = await navigator.wakeLock.request("screen");
  } catch {
    /* 使用者手勢限制/裝置省電模式拒絕時靜默略過，不影響遊戲 */
  }
}

async function release(): Promise<void> {
  try {
    await sentinel?.release();
  } catch {
    /* 已釋放或不支援時忽略 */
  }
  sentinel = null;
}

// 遊戲畫面掛載時呼叫，回傳的函式在卸載時呼叫做清理
export function startWakeLock(): () => void {
  void acquire();
  const onVisible = () => {
    if (document.visibilityState === "visible") void acquire();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    void release();
  };
}
