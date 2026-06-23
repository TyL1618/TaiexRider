// ============================================================
// 廣告載入與環境偵測（雙軌變現：Android TWA → AdMob / 網頁 → AdSense）
//
// 設計見 CLAUDE.md「廣告雙軌架構」。本檔負責「網頁層」：
//   - 偵測是否在 TWA（Android Play 安裝版）內執行
//   - 只有「非 TWA」才載入 AdSense；TWA 內一律不載（廣告由 Android 原生層 AdMob 處理）
//   → 避免 Play 玩家同時看到 AdSense + AdMob 雙重廣告
//
// ⚠️ 第一階段（目前）：ADSENSE_PUB_ID 留空 → 任何環境都「不載入任何廣告」。
//    純粹放偵測骨架，先在真機 TWA 驗證偵測正確擋住。
//    驗證 OK + AdSense 審核通過後，第二階段才填入真實 pub ID 與廣告版位。
// ============================================================

// 第二階段填入，例："ca-pub-8981745966447649"。留空 = 不載入任何廣告（第一階段）。
const ADSENSE_PUB_ID = "";

// TWA 偵測結果快取鍵：一旦偵測到是 TWA 就記住，
// 防止「TWA 內重整後 document.referrer 變空」而漏判成網頁 → 廣告漏進 App。
const TWA_FLAG = "tr_is_twa";

// 是否在 TWA（Android Play 安裝版）內執行。
// TWA 啟動時 document.referrer = "android-app://com.tylapp.taiexrider"。
// 但只有「首次載入」才有此 referrer，SPA 內重整/導航後可能消失，故偵測到後寫入 localStorage 記住。
export function isInsideTWA(): boolean {
  try {
    if (localStorage.getItem(TWA_FLAG) === "1") return true;
  } catch {
    /* localStorage 不可用時忽略，往下走 referrer 判斷 */
  }
  const ref = typeof document !== "undefined" ? document.referrer : "";
  if (ref.startsWith("android-app://")) {
    try {
      localStorage.setItem(TWA_FLAG, "1");
    } catch {
      /* 寫入失敗無妨，本次仍正確回傳 true */
    }
    return true;
  }
  return false;
}

export type AdEnv = "twa" | "web";

export function detectEnv(): AdEnv {
  return isInsideTWA() ? "twa" : "web";
}

// 初始化廣告（網頁層）。只有「非 TWA」且「已設定 pub ID」才載入 AdSense。
export function initAds(): void {
  const env = detectEnv();
  // 真機無法看 console，但桌機 devtools 可用此確認偵測；環境也顯示在設定面板供真機驗證。
  console.info(`[ads] env=${env} referrer="${typeof document !== "undefined" ? document.referrer : ""}"`);

  if (env === "twa") return; // TWA：不載 AdSense（AdMob 由原生層處理）
  if (!ADSENSE_PUB_ID) return; // 第一階段：無 pub ID → 不載入任何廣告
  loadAdSense(ADSENSE_PUB_ID);
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
