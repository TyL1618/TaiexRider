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
//
// ⚠️ 2026-07-10 cap 沙盒新增第三種環境「native」（Capacitor 原生殼，非 TWA）：
//    廣告改走 @capacitor-community/admob 直接呼叫原生 SDK，不需要 TWA 那套
//    loopback server + 自訂 scheme 橋接（那整塊坑是 androidbrowserhelper 專屬）。
// ============================================================

import { Capacitor } from "@capacitor/core";
import { AdMob, RewardAdPluginEvents } from "@capacitor-community/admob";

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

export type AdEnv = "native" | "twa" | "web";

// Capacitor 原生殼（cap 沙盒／未來若正式遷移）：跟 TWA 是兩條不同的原生橋接路徑，
// 要分開判斷，不能沿用 isInsideTWA() 的 display-mode 訊號（Capacitor 系統 WebView
// 不一定回報 standalone/fullscreen）。
function isCapacitorNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function detectEnv(): AdEnv {
  if (isCapacitorNative()) return "native";
  return isInsideTWA() ? "twa" : "web";
}

// 初始化廣告（網頁層）。只有「非 App」且「已設定 pub ID」才載入 AdSense。
export function initAds(): void {
  const env = detectEnv();
  console.info(`[ads] env=${env} ${getAdDebugInfo()}`);

  if (env !== "web") return; // App（native/twa）：不載 AdSense（廣告由原生層處理）
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
// 從頭到尾一次都沒連上本機 server 就提早放棄的門檻：涵蓋「vc17 起 server 由 AdActivity
// 啟動、點擊後要 1~3 秒才起來」跟「行程被系統砍掉重啟」的正常晚起情況之後仍然綽綽有餘。
// 若連 15 秒都完全連不上，代表橋接整條不可用（未來 Chrome PNA 政策擋掉公開網頁對
// loopback 的請求，就會是這個症狀），不用讓玩家的按鈕卡滿 60 秒。
const AD_BRIDGE_UNREACHABLE_BAIL_MS = 15000;

export type RewardedAdKind = "coin" | "revive" | "lottery";

export function requestRewardedAd(kind: RewardedAdKind): Promise<boolean> {
  const env = detectEnv();
  if (env === "native") return requestNativeRewardedAd(kind);
  if (env === "twa") return requestTwaRewardedAd(kind);
  return Promise.resolve(true); // 網頁版：直接發獎勵（見檔頭說明）
}

// ⚠️ 真機實測：廣告全螢幕顯示時，原本的 TWA 分頁對 Chrome 來說變成「背景分頁」，
// setTimeout 會被大幅節流（最慢節流到每分鐘才跑一次）——單純用 setTimeout 輪詢，
// 廣告關閉後网頁端要等超久才會醒來檢查一次，即使伺服器早就準備好結果。改成同時
// 監聽 visibilitychange：分頁一恢復可見就立刻醒來檢查，不受計時器節流影響。
function waitOrWake(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    const onVisible = () => {
      if (document.visibilityState === "visible") finish();
    };
    document.addEventListener("visibilitychange", onVisible);
    function finish() {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      resolve();
    }
  });
}

async function requestTwaRewardedAd(kind: RewardedAdKind): Promise<boolean> {
  try {
    // 清掉上一次殘留的結果，避免輪詢一開始就誤讀到舊狀態（fire-and-forget，
    // 不 await——導轉那一行必須跟按鈕的使用者手勢留在同一個同步呼叫堆疊內，
    // Chrome 才會放行自訂 scheme 導轉，不會被當成背景彈出而擋掉）。
    // vc17 起 server 平常不在跑（只在看廣告時短暫存活），這個 fetch 失敗是常態、
    // 可安全忽略：AdActivity.onCreate() 一定會自己 AdBridge.reset() 一次。
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
  const start = Date.now();
  const deadline = start + AD_BRIDGE_TIMEOUT_MS;
  let everReached = false; // 是否曾成功連上 server（拿到任何回應都算，不管 done 與否）
  let loggedFetchError = false;
  while (Date.now() < deadline) {
    await waitOrWake(AD_BRIDGE_POLL_INTERVAL_MS);
    try {
      const res = await fetch(`http://127.0.0.1:${AD_BRIDGE_PORT}/ad/result`);
      if (res.ok) {
        everReached = true;
        const data = await res.json();
        if (data.done) return !!data.granted;
      } else {
        console.warn(`[ads] /ad/result 回應非 ok: ${res.status}`);
      }
    } catch (err) {
      // server 還沒起來（vc17 起由 AdActivity 啟動，點擊後 1~3 秒才就緒）每輪都會
      // 進到這裡，只記第一次避免洗版；真正異常由下面的提早放棄/逾時 warn 收尾。
      if (!loggedFetchError) {
        console.error("[ads] 輪詢廣告結果失敗（同類錯誤只記第一次）", err);
        loggedFetchError = true;
      }
    }
    if (!everReached && Date.now() - start > AD_BRIDGE_UNREACHABLE_BAIL_MS) {
      console.warn("[ads] 從未連上本機橋接 server，提早放棄（服務未啟動或 loopback 被瀏覽器政策擋下）");
      return false;
    }
  }
  console.warn("[ads] 輪詢逾時，視為未獲得獎勵");
  return false;
}

// ── Capacitor 原生殼：@capacitor-community/admob，同進程 plugin bridge ──────────
// 不需要 TWA 那套 loopback server + 自訂 scheme 導轉——AdMob SDK 直接跑在同一個
// WebView 所在的原生行程裡，官方 API 就有 prepare/show，不用自己土炮繞背景服務。
//
// ⚠️ 廣告單元 ID 目前用 Google 官方測試單元（不受 AdMob 帳戶審核/廣告單元啟用狀態
// 影響，先把橋接跑通），跟 TWA 版 AdActivity.kt 目前的作法一致。上架前才換成真實
// 單元 ID（revive_reward: ca-app-pub-8981745966447649/1679422480；coin_reward:
// ca-app-pub-8981745966447649/2170377077，依 kind 分流；同時 isTesting 記得拿掉）。
const NATIVE_TEST_REWARD_AD_UNIT_ID = "ca-app-pub-3940256099942544/5224354917";
const NATIVE_AD_UNIT_IDS: Record<RewardedAdKind, string> = {
  coin: NATIVE_TEST_REWARD_AD_UNIT_ID,
  revive: NATIVE_TEST_REWARD_AD_UNIT_ID,
  // 抽獎轉輪的免費抽獎（LOTTERY_DESIGN.md）沿用 coin_reward 這組廣告單元，不另外
  // 在 AdMob 開新單元——都是「看廣告換遊戲內獎勵」的同類型版位。
  lottery: NATIVE_TEST_REWARD_AD_UNIT_ID,
};

let admobInitPromise: Promise<void> | null = null;
function ensureAdMobInit(): Promise<void> {
  if (!admobInitPromise) {
    admobInitPromise = AdMob.initialize({ initializeForTesting: true }).catch((err) => {
      admobInitPromise = null; // 初始化失敗不快取，下次重試
      throw err;
    });
  }
  return admobInitPromise;
}

// ── 原生廣告預載入 ─────────────────────────────────────────────────────────────
// prepareRewardVideoAd() 是實際跟 AdMob 伺服器要一支廣告的網路請求；舊版是「使用者
// 點下去才現場 prepare」，把整段網路延遲直接壓在使用者的點擊當下，網路差時要等很久。
// 改成進入會用到廣告的畫面（車庫/排行榜/遊戲中）時就在背景先 prepare 好，使用者真的
// 點擊時 showRewardVideoAd() 幾乎瞬開。備好的廣告 show 一次就消耗掉，播完要再備下一支。
// 只保留單一備載槽（同時間只會播一支廣告），種類不符時重備即可。
type PreparedAd = { kind: RewardedAdKind; promise: Promise<void> };
let preparedAd: PreparedAd | null = null;

function prepareNativeAd(kind: RewardedAdKind): Promise<void> {
  const p = ensureAdMobInit().then(() =>
    AdMob.prepareRewardVideoAd({
      adId: NATIVE_AD_UNIT_IDS[kind],
      isTesting: true,
      // immersiveMode:true 讓外掛顯示廣告當下自己套用沉浸式全螢幕，避免底部被系統三鍵
      // 導覽列蓋住（MainActivity 的沉浸式只套在自己的 window，AdMob 另開 Activity）。
      immersiveMode: true,
    }).then(() => {})
  );
  preparedAd = { kind, promise: p };
  // 備載失敗不留殘狀態，下次 preload/點擊會重備。
  p.catch(() => { if (preparedAd?.promise === p) preparedAd = null; });
  return p;
}

// 進入會用到廣告的畫面時呼叫，背景先把廣告備好（非原生殼＝no-op，網頁/TWA 各有自己路徑）。
// 同種已在備載中就不重複；種類不同會重備成新種類。
export function preloadRewardedAd(kind: RewardedAdKind): void {
  if (detectEnv() !== "native") return;
  if (preparedAd && preparedAd.kind === kind) return;
  prepareNativeAd(kind).catch((err) => console.warn("[ads] 廣告預載入失敗（點擊時會重試）", err));
}

// ⚠️ 外掛的 showRewardVideoAd() 回傳的 Promise 只在「使用者實際看完、拿到獎勵」時
// resolve（原生端 OnUserEarnedRewardListener 才呼叫 call.resolve，見外掛原始碼
// RewardedAdCallbackAndListeners.kt）。使用者中途關閉廣告（沒拿到獎勵）只會發
// Dismissed 事件，showRewardVideoAd() 的 Promise 永遠不會 settle——不能只 await
// 它，必須另外監聽 Dismissed/FailedToShow 事件才能涵蓋「沒看完」的路徑。
async function requestNativeRewardedAd(kind: RewardedAdKind): Promise<boolean> {
  try {
    // 優先用預載好的廣告（進畫面時已在背景 prepare）；沒有或種類不符就現場備一支
    // （fallback，行為等同舊版「點了才要」，只是多數情況已經被 preload 搶先備好了）。
    const prep = (preparedAd && preparedAd.kind === kind) ? preparedAd.promise : prepareNativeAd(kind);
    await prep;
    preparedAd = null; // 這支即將被 show 消耗掉，清空備載槽

    return await new Promise<boolean>((resolve) => {
      let rewarded = false;
      let settled = false;
      const handles: Array<{ remove(): void }> = [];
      const cleanup = () => handles.forEach((h) => h.remove());
      const finish = (granted: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        preloadRewardedAd(kind); // 播完立刻在背景備下一支，下次點擊也能瞬開
        resolve(granted);
      };

      AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
        rewarded = true;
      }).then((h) => handles.push(h));
      AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
        console.info(`[ads] 原生廣告關閉，granted=${rewarded}`);
        finish(rewarded);
      }).then((h) => handles.push(h));
      AdMob.addListener(RewardAdPluginEvents.FailedToShow, (err) => {
        console.error("[ads] 原生廣告顯示失敗", err);
        finish(false);
      }).then((h) => handles.push(h));

      AdMob.showRewardVideoAd().catch((err) => {
        console.error("[ads] 呼叫顯示原生廣告失敗", err);
        finish(false);
      });
    });
  } catch (err) {
    console.error("[ads] 原生廣告載入失敗", err);
    preloadRewardedAd(kind); // 備載失敗也重備一次，讓下次點擊有機會瞬開
    return false;
  }
}
