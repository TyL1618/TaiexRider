# Capacitor 遷移可行性實驗計畫（2026-07-10 研究完成，⚠️ 尚未動工）

> **狀態：純研究/規劃階段，未建立任何專案骨架、未動任何 code。**
> 之後要開始這個實驗時，直接讀這份檔案接續即可，不用重新搜尋一次。

## 背景與動機

現行 TWA（Trusted Web Activity）架構為了串 AdMob 獎勵廣告 + Play Billing，疊了
8+7 層 workaround（見 [DEVDOC.md](DEVDOC.md) §9.4c、§2.7 的問題鏈全文）——根因是
`androidbrowserhelper` 的 `LauncherActivity` 沒有官方 PostMessage 橋接可用，每加一個
原生功能都要自己土炮繞路。使用者擔心這種架構長期維護風險高（"心毛毛的"），且跳出
Chrome 分頁的體驗不夠美觀，想評估改用 Capacitor 是否能讓整體架構更穩定、更好維護。

**評估原則**：不直接把正式專案改掉，而是另開一個**實驗性專案**（如
`TaiexRider(cap)`），複製現有 PWA 前端、用 Capacitor 包一次，實測看看三個最關鍵的
原生橋接是否比現在更順、更穩。如果驗證成功，之後 vc18 或更後面的版本才考慮正式切換。
**測試階段完全不影響現在的 TWA 正式版與 Play Console 封測**（見下方「風險隔離」）。

---

## 🔍 研究結論（2026-07-10 搜尋確認，結論：值得驗證，但範圍比原本設想的大一項）

### 好消息

**Canvas/WebGL 渲染是 Capacitor 官方支援的一等公民**——[官方文件](https://capacitorjs.com/docs/guides/games)
明確說「broad support for WebGL and canvas rendering...high-performance game
experiences」，現有 Canvas 2D + Matter.js 架構理論上不會因換殼報廢。

### ⚠️ 三座橋（不是原本以為的兩座）都有成熟外掛可用，但都要重新接

| 項目 | 現況 | 建議外掛 | 備註 |
|---|---|---|---|
| **AdMob 獎勵廣告** | 土炮 loopback server + 8 層 workaround | [capacitor-community/admob](https://github.com/capacitor-community/admob) | 持續維護中，最新 v8.0.0（2025-12），`prepareRewardVideoAd()`/`showRewardVideoAd()` 官方 API，50 個 open issues（社群外掛正常量級）。文件提到「測試廣告不觸發 SSV 回呼」等已知細節坑，屬於「有文件記載」等級，比自己土炮好排查。 |
| **Play Billing（IAP）** | Digital Goods API + PaymentRequest（僅 TWA 支援的小眾 API） | [Cap-go/capacitor-native-purchases](https://github.com/Cap-go/capacitor-native-purchases) | 免費、自包含、811 commits 活躍維護，支援 Play Billing 7.x 一次性商品（不只訂閱）。**文件明確建議「自己接 Google Play Developer API 做伺服器驗證」——正是現在 `verify-iap-purchase` Edge Function 已經在做的事，後端驗證邏輯幾乎可整包留用，只是前端呼叫方式從 Digital Goods API 換成這個外掛的 API**。⚠️ 不要選 [RevenueCat purchases-capacitor](https://github.com/RevenueCat/purchases-capacitor)——強制走 RevenueCat 自己的後端服務，跟現有 Supabase 架構衝突。 |
| **🔴 Google 登入（新發現，原本沒設想到）** | GSI One Tap + Supabase OAuth redirect（`src/lib/auth.ts`），現在能用是因為 TWA＝真正的 Chrome | [@codetrix-studio/capacitor-google-auth](https://github.com/CodetrixStudio/CapacitorGoogleAuth) | **Google 從 2021 年起明確政策：內嵌 WebView 裡的 Google OAuth 一律擋下回 `disallowed_useragent`**（[官方公告](https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/)，防中間人攔截登入憑證，無 flag 可繞過）。現有登入方式原封不動搬進 Capacitor 系統 WebView，**大機率直接無法登入**。這個外掛走 Android 原生 Google Sign-In SDK（系統帳號選擇器 intent），不經過 WebView 內 OAuth 頁面，能繞過此限制，但**需要網頁版（現有 GSI script）跟 App 版（這個原生外掛）兩套登入邏輯並存**，是額外工程量。 |

### 效能：TWA 目前實測略勝，但差距可接受

2026 年實測（Galaxy S24）：TWA 啟動 1.2s / 60fps 捲動，Capacitor 啟動 1.8s / 58fps。
原因是 TWA 用真正 Chrome 渲染引擎，Capacitor 用系統 WebView（效能因廠牌/Android
版本而異；已知問題：裝置開啟輔助功能 App 時 WebView 會建立平行無障礙樹拖累主執行緒，
Custom Tabs/Chrome 不受此影響）。差距不算致命，但不會「更快」。

**App 體積**：Capacitor 基底 ~4MB vs TWA ~800KB——對已有大量車皮圖片素材的本專案可忽略。

### 風險隔離（確保測試不影響正式版）

- 實驗專案用**不同的 `applicationId`**（例：`com.tylapp.taiexrider.captest`），可以
  跟正式 TWA 版同時裝在同一支手機比對，完全不碰 Play Console 現有 listing。
- 測試階段**不需要上傳 Play Console**：`npx cap sync` 產生 Android 專案後直接 Android
  Studio 建 debug/未簽署 APK，`adb install` 側載到手機測試即可。
- 用**全新的測試用 keystore**，不要跟正式版 `taiexrider-release.jks` 混用。
- **Supabase 後端完全不用動**——RPC/schema 是前端無關的，不管前端被 TWA 還是
  Capacitor 包，打的 API 一樣（IAP 的 `verify-iap-purchase` Edge Function 也一樣，
  頂多前端傳過去的 purchase_token 取得方式不同）。
- 只有正式決定要切換成 Capacitor 出貨時，才把 `applicationId` 換回真實的
  `com.tylapp.taiexrider` + 用正式簽署金鑰——DEVDOC §10 已確認過這個時間點才做
  不會讓 Play Console 封測歸零（Google Play 只認 applicationId + 簽署金鑰）。

---

## 📋 之後動工時的實驗步驟（尚未執行，先列出來）

1. 開新資料夾（例：跟 `TaiexRider` 平行的 `TaiexRider-cap/`），複製現有 `src/`、
   `public/`、`vite.config.ts` 等前端檔案（不含 `android/`，那是 TWA 專屬）。
2. `npm install @capacitor/core @capacitor/cli @capacitor/android`，
   `npx cap init`（`applicationId` 用 `com.tylapp.taiexrider.captest`），
   `npx cap add android`。
3. `npm run build` 產生 `dist/` → `npx cap sync` 把 web 產物同步進 Capacitor 的
   Android 專案。
4. 裝三個外掛：`@capacitor-community/admob`、`Cap-go/capacitor-native-purchases`、
   `@codetrix-studio/capacitor-google-auth`，依各自文件走原生設定（`AndroidManifest.xml`
   meta-data、Google Cloud OAuth client 等）。
5. **優先驗證順序建議**：先測 Google 登入（風險最高、最容易被忽略、卡關代表玩家整個
   進不去遊戲）→ 再測 Play Billing（跟現有 Edge Function 對接）→ 最後測 AdMob 獎勵
   廣告（現有 8 層坑最多，最想擺脫的部分，但風險相對較低——壞了頂多看不到廣告，
   不影響核心遊玩）。
6. 三項都跑順 + 效能主觀感受可接受，才算「驗證成功」，回頭評估是否要讓 vc18+
   正式切換過去（屆時另外規劃遷移步驟：改回真實 applicationId、正式簽署金鑰、
   完整走一次 Play Console 上傳流程）。

---

## 相關文件

[DEVDOC.md](DEVDOC.md) §9.4c（AdMob 8 層問題鏈）、§2.7（IAP 除錯鏈）、§10（"最終保底：
整專案換 Capacitor" 段落，含 applicationId 不影響封測的確認）・
[CLAUDE.md](CLAUDE.md)「目前進度」
