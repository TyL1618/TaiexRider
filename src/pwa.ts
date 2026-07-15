// PWA Service Worker 註冊與自動更新——僅網頁/PWA 端生效，Capacitor 原生殼跳過。
// 流程：每次啟動 + 每 60 秒主動檢查新版 SW；偵測到新版時：
//   - 遊玩中 → 先記下，等回首頁（setPlaying(false)）再 reload，避免把玩家踢出賽道
//   - 非遊玩中 → 立即 updateSW(true)（skipWaiting + 自動 reload 套用新版）
// 對齊 SecureChat 的自動更新體驗，但多了「遊玩中 defer」這層保護。
//
// ⚠️ 原生殼不能註冊這個 Service Worker：Capacitor App 每次更新拿到的就已經是最新
// 打包進 APK 的檔案，SW 快取機制在這裡只有壞處沒有好處——舊版 SW 會殘留在 WebView
// 儲存空間裡（APK 更新不會清掉），導致更新後第一次開啟：WebView 先被舊 SW 攔截，
// 短暫顯示舊版首頁 → 瀏覽器偵測到新版 SW → 觸發這支檔案的自動 reload → 新版重新
// 跑一次開場動畫 → 才回到（新版）首頁，體感是「首頁→splash→首頁」的詭異閃爍。
// 只在原生殼發生一次（reload 後 SW 版本追平，下次冷啟動就正常），2026-07-15 抓到。

import { Capacitor } from "@capacitor/core";

const CHECK_INTERVAL_MS = 60_000;
const isNative = Capacitor.isNativePlatform();

let playing = false;
let pendingReload = false;
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;

if (!isNative) {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    updateSW = registerSW({
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
  });
}

function applyUpdate() {
  if (!updateSW) return;
  // 標記為「程式觸發的重載」，讓 App.tsx 的 beforeunload 攔截器放行，
  // 不要跳瀏覽器原生「要重新載入網站嗎？」確認框（那個是給桌機關視窗用的）。
  (window as { __taiexAutoReload?: boolean }).__taiexAutoReload = true;
  void updateSW(true);
}

// App 進出賽道時呼叫：離開賽道若有待套用的新版，立即 reload（原生殼下 no-op，
// 因為根本沒有註冊 SW，pendingReload 永遠不會被設為 true）。
export function setPlaying(value: boolean) {
  playing = value;
  if (!value && pendingReload) {
    pendingReload = false;
    applyUpdate();
  }
}
