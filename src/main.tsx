import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./pwa"; // 註冊 Service Worker + 自動更新

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 開機 splash 淡出移除：等 React 首次 paint（雙 rAF）後再淡出，避免閃白。
const splash = document.getElementById("boot-splash");
if (splash) {
  const fadeOut = () => {
    splash.classList.add("hide");
    splash.addEventListener("transitionend", () => splash.remove(), { once: true });
    setTimeout(() => splash.remove(), 600); // 保險：transitionend 沒觸發時也移除
  };
  requestAnimationFrame(() => requestAnimationFrame(fadeOut));
  setTimeout(fadeOut, 1500); // 後備：背景分頁 rAF 被節流時也會移除，不卡在 splash
}
