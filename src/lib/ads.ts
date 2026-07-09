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

// ── 看廣告拿獎勵（金幣雙倍 / 復活）─────────────────────────────
// TWA：本機 loopback HTTP server 橋接原生 AdMob（見 android/…/AdBridgeService.kt
// 檔頭說明——androidbrowserhelper 的 LauncherActivity 不暴露 CustomTabsSession，
// 官方 PostMessage for TWA 走不通，改用這支不碰 TWA session 的做法）。
// 網頁：AdSense 插頁式廣告暫緩（見 CLAUDE.md 廣告雙軌架構），先直接發獎勵。
//
// ⚠️ 真機實測追加：一開始讓 AdBridgeService 收到 fetch 後自己 startActivity 顯示廣告，
// 被 Android 的 Background Activity Launch 限制擋下（前景服務也不算豁免條件，只有
// 「由目前可見的前景 App 發起」才會放行）。改成：按鈕點擊當下（使用者手勢、Chrome 是
// 前景 App）用一個 <a> 導轉到自訂 URL scheme 啟動 AdActivity，網頁這邊改成輪詢本機
// server 的 /ad/result 拿結果，server 只是被動的結果暫存區查詢站。
const AD_BRIDGE_PORT = 47591; // ⚠️ 需與 AdBridgeService.kt 的 PORT 常數保持一致
const AD_BRIDGE_POLL_INTERVAL_MS = 500;
const AD_BRIDGE_TIMEOUT_MS = 60000; // 廣告載入+一支 15~30s 影片+使用者關閉，留寬裕時間

export type RewardedAdKind = "coin" | "revive";

export function requestRewardedAd(kind: RewardedAdKind): Promise<boolean> {
  if (detectEnv() !== "twa") return Promise.resolve(true);
  return requestTwaRewardedAd(kind);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestTwaRewardedAd(kind: RewardedAdKind): Promise<boolean> {
  try {
    // 清掉上一次殘留的結果，避免輪詢一開始就誤讀到舊狀態（fire-and-forget，
    // 不 await——導轉那一行必須跟按鈕的使用者手勢留在同一個同步呼叫堆疊內，
    // Chrome 才會放行自訂 scheme 導轉，不會被當成背景彈出而擋掉）。
    fetch(`http://127.0.0.1:${AD_BRIDGE_PORT}/ad/reset`).catch(() => {});

    // ⚠️ 真機實測：用 <a>.click() 在同一份文件內導轉，TWA 會判定成「要離開目前受信任
    // 的網站」跳出確認框，按「離開」直接把整個 TWA 關掉（不是只離開去開廣告）。改用
    // window.open 開一個新的瀏覽情境去嘗試導轉——原本這份 TWA 文件本身不會跳走，
    // 新視窗解析到系統交給 Android 意圖解析（自訂 scheme 沒有網頁可顯示），不會觸發
    // TWA 的離開確認框。
    console.info(`[ads] 導轉 taiexrider-ad://show?type=${kind}，開始輪詢結果`);
    window.open(`taiexrider-ad://show?type=${kind}`, "_blank");

    const result = await pollAdResult();
    console.info(`[ads] 輪詢結束，granted=${result}`);
    return result;
  } catch (err) {
    console.error("[ads] TWA 原生廣告橋接失敗", err);
    return false;
  }
}

async function pollAdResult(): Promise<boolean> {
  const deadline = Date.now() + AD_BRIDGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(AD_BRIDGE_POLL_INTERVAL_MS);
    try {
      const res = await fetch(`http://127.0.0.1:${AD_BRIDGE_PORT}/ad/result`);
      if (res.ok) {
        const data = await res.json();
        if (data.done) return !!data.granted;
      } else {
        console.warn(`[ads] /ad/result 回應非 ok: ${res.status}`);
      }
    } catch (err) {
      console.error("[ads] 輪詢廣告結果失敗", err);
    }
  }
  console.warn("[ads] 輪詢逾時，視為未獲得獎勵");
  return false;
}
