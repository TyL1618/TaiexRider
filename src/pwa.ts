// PWA Service Worker 註冊與自動更新
// 流程：每次啟動 + 每 60 秒主動檢查新版 SW；偵測到新版時：
//   - 遊玩中 → 先記下，等回首頁（setPlaying(false)）再 reload，避免把玩家踢出賽道
//   - 非遊玩中 → 立即 updateSW(true)（skipWaiting + 自動 reload 套用新版）
// 對齊 SecureChat 的自動更新體驗，但多了「遊玩中 defer」這層保護。

import { registerSW } from "virtual:pwa-register";

const CHECK_INTERVAL_MS = 60_000;

let playing = false;
let pendingReload = false;

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    if (playing) {
      pendingReload = true; // 遊玩中：先擋，回首頁再套用
    } else {
      applyUpdate();
    }
  },
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      setInterval(() => { registration.update(); }, CHECK_INTERVAL_MS);
    }
  },
});

function applyUpdate() {
  // 標記為「程式觸發的重載」，讓 App.tsx 的 beforeunload 攔截器放行，
  // 不要跳瀏覽器原生「要重新載入網站嗎？」確認框（那個是給桌機關視窗用的）。
  (window as { __taiexAutoReload?: boolean }).__taiexAutoReload = true;
  updateSW(true);
}

// App 進出賽道時呼叫：離開賽道若有待套用的新版，立即 reload
export function setPlaying(value: boolean) {
  playing = value;
  if (!value && pendingReload) {
    pendingReload = false;
    applyUpdate();
  }
}
