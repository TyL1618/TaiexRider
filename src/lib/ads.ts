// ============================================================
// 廣告載入與環境偵測（雙軌變現：Android TWA → AdMob / 網頁 → AdSense）
//
// 設計見 CLAUDE.md「廣告雙軌架構」。本檔負責「網頁層」：
//   - 偵測是否在 Android App（TWA / Play 安裝版）內執行
//   - 只有「非 App」才載入 AdSense；App 內一律不載（廣告由 Android 原生層 AdMob 處理）
//   → 避免 Play 玩家同時看到 AdSense + AdMob 雙重廣告
//
// ⚠️ 偵測訊號（2026-06-23 真機實測結論）：
//   - 本專案 TWA **不送** `android-app://` referrer（送的是網站自己網址），referrer 偵測不可靠。
//   - 改用 **display-mode**：TWA（themes.xml + manifest 皆 fullscreen）回報 fullscreen；
//     一般瀏覽器回報 browser；PWA 加到主畫面回報 standalone/fullscreen。
//   - 規則：「**Android 且 display-mode 非 browser**」→ 視為 App，不載 AdSense。
//     · Android 瀏覽器開網頁 = browser → 照載 AdSense（Android 網頁用戶仍有廣告）
//     · iOS（Safari / 加到主畫面）非 Android → 一律照載 AdSense（繞過 Apple 抽成的目標客群）
//     · Android 加到主畫面 PWA = fullscreen → 不載（罕見，可接受，無 Play 違規風險）
//   - 不快取結果：TWA(Custom Tabs) 與 Chrome 瀏覽器同機共用 localStorage，
//     快取會讓「先開 TWA 再用瀏覽器」的用戶被誤判 → display-mode 每次即時讀即可。
//
// ⚠️ 第一階段（目前）：ADSENSE_PUB_ID 留空 → 任何環境都「不載入任何廣告」。
//    純粹放偵測骨架，先在真機驗證偵測正確分流。
//    驗證 OK + AdSense 審核通過後，第二階段才填入真實 pub ID 與廣告版位。
// ============================================================

// 第二階段填入，例："ca-pub-8981745966447649"。留空 = 不載入任何廣告（第一階段）。
const ADSENSE_PUB_ID = "";

function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
}

// display-mode 是否「非瀏覽器分頁」（fullscreen / standalone / minimal-ui 之一）
function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return (
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches
  );
}

// 是否在 Android App（TWA / Play 安裝版）內執行。
// 主訊號：Android 且 display-mode 非 browser。輔助：referrer android-app://（若這版 TWA 有送）。
export function isInsideTWA(): boolean {
  const ref = typeof document !== "undefined" ? document.referrer : "";
  if (ref.startsWith("android-app://")) return true;
  if (isAndroid() && isStandaloneDisplay()) return true;
  return false;
}

export type AdEnv = "twa" | "web";

export function detectEnv(): AdEnv {
  return isInsideTWA() ? "twa" : "web";
}

// 初始化廣告（網頁層）。只有「非 App」且「已設定 pub ID」才載入 AdSense。
export function initAds(): void {
  const env = detectEnv();
  console.info(`[ads] env=${env} ${getAdDebugInfo()}`);

  if (env === "twa") return; // App：不載 AdSense（AdMob 由原生層處理）
  if (!ADSENSE_PUB_ID) return; // 第一階段：無 pub ID → 不載入任何廣告
  loadAdSense(ADSENSE_PUB_ID);
}

// 診斷用：回報偵測訊號原始值，供真機驗證分流是否正確。
export function getAdDebugInfo(): string {
  const ref = typeof document !== "undefined" ? document.referrer : "";
  const standalone =
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(display-mode: standalone)").matches
      : false;
  const fullscreen =
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(display-mode: fullscreen)").matches
      : false;
  const dm = fullscreen ? "fs" : standalone ? "sa" : "browser";
  const os = isAndroid() ? "android" : "other";
  return `os=${os} dm=${dm} ref="${ref || "(空)"}"`;
}

function loadAdSense(pubId: string): void {
  if (document.querySelector("script[data-adsense]")) return; // 已載入過
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${pubId}`;
  s.crossOrigin = "anonymous";
  s.setAttribute("data-adsense", "1");
  document.head.appendChild(s);
}

// ── 看廣告拿金幣（第一階段 stub）───────────────────────────────
// TODO 正式串接時：TWA → AdMob Rewarded intent bridge；網頁 → AdSense/其他 rewarded
// SDK，等「使用者看完整支影片」的 callback 再 resolve(true)；中途關閉/失敗 resolve(false)。
// 現在還沒有任何廣告 SDK 串接，直接 resolve(true) 讓呼叫端立刻發幣，
// 純粹先把「按鈕位置 + 呼叫時機」卡好，之後只需替換這個函式本體。
export function requestRewardedCoins(): Promise<boolean> {
  return Promise.resolve(true);
}
