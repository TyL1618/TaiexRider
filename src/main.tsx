import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./pwa"; // 註冊 Service Worker + 自動更新
import { initAds } from "./lib/ads"; // 廣告雙軌偵測（第一階段：只偵測不載入）
import { initButtonHaptics } from "./lib/haptics"; // 全域按鈕震動（不支援裝置自動 no-op）
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";

// Capacitor 原生殼：原生 SplashScreen（底色 #05080f）負責蓋住「App 行程啟動 → WebView
// 首次 paint」這段冷啟動空窗；一旦 JS 跑起來（此時 index.html 的品牌動畫 boot-splash
// 已經在底下 paint 好了），就把原生層淡出，露出正在播放的 boot-splash 動畫，兩層同底色
// 無縫接。launchAutoHide 設 false（見 capacitor.config.ts）由這裡手動 hide。
if (Capacitor.isNativePlatform()) {
  SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});
}

// 廣告初始化：偵測 TWA/網頁環境。第一階段 pub ID 留空 → 不顯示任何廣告。
initAds();
initButtonHaptics();

// [DEV ONLY] 把上次在調參面板拖出來的手感值套回 constants 物件。動態 import 讓正式
// 建置完全不會包含這支檔案。GameCanvas 要等玩家從首頁點進遊戲才掛載，這個 promise
// 早就 resolve 了，不會有「世界已建好才套用參數」的時序問題。
if (import.meta.env.DEV) {
  void import("./game/devTuning").then((m) => m.loadSavedTuning());
}

// 原生體驗：擋掉長按跳出的瀏覽器右鍵/內容選單（user-select:none 不保證擋得住，
// 部分 Android WebView 長按圖片/canvas 仍會跳選單，是最容易穿幫像網頁的地方之一）。
document.addEventListener("contextmenu", (e) => e.preventDefault());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 開機 splash 淡出移除。刻意「強制最短顯示時間」而不是 React 一 paint 就淡出——
// 遊戲其實開很快，秒開反而讓品牌動畫來不及播完、感覺廉價。boot-splash 的一次性動畫
// （折線畫出→輪子→字+slogan→讀取條）約 2.0s 播完，這裡壓到 2200ms 讓動畫完整播完
// 再淡出。但仍以「React 已首次 paint」為前提（雙 rAF），避免慢裝置上淡出後露出未掛載
// 的空畫面；兩者取較晚者。
const splash = document.getElementById("boot-splash");
if (splash) {
  const MIN_SPLASH_MS = 2200;
  const start = performance.now();
  let faded = false;
  const fadeOut = () => {
    if (faded) return;
    faded = true;
    splash.classList.add("hide");
    splash.addEventListener("transitionend", () => splash.remove(), { once: true });
    setTimeout(() => splash.remove(), 700); // 保險：transitionend 沒觸發時也移除
  };
  // React 首次 paint 後，再等到「至少顯示滿 MIN_SPLASH_MS」才淡出。
  const scheduleFade = () => {
    const remaining = Math.max(0, MIN_SPLASH_MS - (performance.now() - start));
    setTimeout(fadeOut, remaining);
  };
  requestAnimationFrame(() => requestAnimationFrame(scheduleFade));
  // 後備：背景分頁 rAF 被節流／React 遲遲沒 paint 時也一定會淡出，不卡在 splash。
  setTimeout(fadeOut, MIN_SPLASH_MS + 1500);
}
