# Capacitor 遷移可行性實驗計畫（2026-07-10 動工，登入/原生手感真機驗證✅通過）

> **狀態：三項核心驗證目標全數通過（見下方「🎉 2026-07-10 下午：真機驗證結果」）。**
> 尚未做：AdMob、Play Billing 兩座橋（今天下午接著做）。

## 🎉 2026-07-10 下午：真機驗證結果（三項全過）

使用者側載 debug APK 到真機實測，逐項確認：

1. ✅ **原生手感**：執行順暢，無 Chrome 提示，比 TWA 更像原生 App。
2. ✅ **看廣告不跳前景服務通知**（研究段的核心假設成立——見下方研究結論表格；
   Capacitor 同進程 plugin bridge 不需要 TWA 那種跨進程前景服務）。
3. ✅ **Google 登入連回同一顆 Supabase 帳號**：Credential Manager 系統帳號選擇器登入後，
   車庫金幣、已擁有車皮清單、暱稱**跟 TWA 正式版完全一致**——驗證了「Supabase 認帳號靠
   Google `sub`、不管哪個 Client 發起登入」的推論成立。使用者回饋這個系統選擇器 UI
   「比 TWA 那個好看，確實大部分 App 看到的都是這種」。

**唯一的小瑕疵**：登出比網頁版稍慢——原因是 `signOut()` 會 `await
SocialLogin.logout()`，原生 Credential Manager 的 `clearCredentialState()` 要跟系統層
做一次同步清除，比網頁版純前端的 `google.accounts.id.cancel()` 多一截延遲。不影響正確性，
純體感問題，優先度低、暫不處理。

### 過程中修掉的三個坑（真機測試才會發現，記錄避免下次重踩）

1. **整體版面等比放大→標題撞設定鈕**：Capacitor 系統 WebView 會把使用者的系統字型縮放
   乘進預設 1rem（Chrome/TWA 不會）。修法：`MainActivity.java` 加
   `getBridge().getWebView().getSettings().setTextZoom(100)` 釘死 100%，`Home.css` 頂部
   padding 2rem→3.2rem 當安全邊界。
2. **Google 登入「按下去沒反應」**：`signInWithGoogleNative()` 傳了
   `options: { scopes: ["email","profile"] }`，但 `@capgo/capacitor-social-login` 的
   `GoogleProvider.java` **預設就已經加了** `userinfo.email` / `userinfo.profile` /
   `openid` 三個 scope——只要 `scopes` 陣列「有傳」（即使內容一樣）就會撞上它的守衛
   `if (!(activity instanceof ModifiedMainActivityForSocialLoginPlugin)) reject("You
   CANNOT use scopes without modifying the main activity")` 整個失敗。而呼叫端
   `Home.tsx` 是 fire-and-forget（沒 await/catch），例外變成 unhandled rejection，
   使用者只看到「按了沒反應」，錯誤被吞掉。**兩層修法**：① `signInWithGoogleNative()`
   改 `options: {}`（不傳 scopes，反正預設就夠）；② 加 try/catch，失敗時
   `alert()` 直接把原因顯示在畫面上（沿用 billing 紅色橫幅的思路，因為真機不方便看
   console）。**除錯關鍵**：`adb logcat -s GoogleProvider:V CapgoSocialLogin:V` 會印出
   實際送給 Google 的 `package=`/`signingSha1=`，一眼就能排除是不是 SHA-1 對不上。
3. **App icon 變成安卓預設機器人**：把 TWA 專案的 `drawable/ic_launcher_{background,
   foreground}.xml` 直接搬過來，結果那兩個檔案其實是 **Android Studio 從未被改過的
   預設樣板**（背景色 `#3DDC84` 就是 Android 官方綠），TaiexRider 真正的圖只存在
   `mipmap-*/ic_launcher.webp` 點陣圖裡；而 `mipmap-anydpi-v26/`（也一併搬了）在
   Android 8+ 優先於 webp，所以顯示成預設機器人。**修法**：不搬 TWA 的檔案，改寫
   `scripts/gen-android-icons.mjs` 用 sharp 直接從向量原稿 `public/favicon.svg`
   重新產一套 adaptive icon（背景層＝品牌色 `#05080f`、前景層＝去掉圓角底的線圖
   置中縮進 72dp 安全區、外加 5 種密度的 legacy 點陣後備圖）。裝新 icon 前記得
   `adb uninstall` 再裝，不然 launcher 會快取舊圖。

## 🔧 目前進度（2026-07-10 中午）

- **首次真機測試回饋（使用者側載 debug APK 實測）**：整體執行「真的很好」、**沒跳出任何
  Google 前景服務通知**（＝驗證了研究段的核心假設：Capacitor 同進程 plugin bridge 不需要
  TWA 那種跨進程前景服務，通知那整塊坑直接消失）。發現兩個問題，已修（見下方）：
  1. **整個畫面等比放大一點點** → 首頁標題變寬、跟右上角設定鈕重疊。**根因**：Capacitor 用
     系統 WebView，預設會把使用者的「系統字型大小 / 顯示大小」縮放乘進預設 16px（＝1rem），
     整個 rem 版面就放大；Chrome Custom Tabs（TWA）不吃這設定所以正式版沒事。**修法**：
     `MainActivity.java` 的 `onCreate` 加 `getBridge().getWebView().getSettings().setTextZoom(100)`
     把文字縮放釘死 100%，整體縮放就跟 TWA 一致。（CyberMind 之前同款問題同款解。）
     另在 `src/screens/Home.css` 把首頁頂部 padding 從 2rem→3.2rem 當版面安全邊界。
  2. 使用者要求**沉浸式全螢幕**（隱藏頂部狀態列＋底部三鍵導覽列）→ `MainActivity.java` 用
     `WindowInsetsControllerCompat.hide(systemBars())` +
     `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`（immersive sticky：從邊緣滑出的系統列短暫顯示後
     自動收回，不會把版面往下推），並 `WindowCompat.setDecorFitsSystemWindows(false)` edge-to-edge。
     `onWindowFocusChanged` 重新取得焦點時再套一次，避免系統列停留。
- **實驗專案位置**：`C:\Users\tyl16\Documents\Private\TaiexRider-cap\`（跟 `TaiexRider`
  平行的資料夾，**不在 git 版控裡**，純本機檔案；複製自 `TaiexRider` 的 `src/`、
  `public/`、`index.html`、`vite.config.ts`、`tsconfig*.json`，不含 `android/`）。
- `applicationId`：`com.tylapp.taiexrider.captest`（跟正式版完全隔離）。
- **已裝套件**：`@capacitor/core` `@capacitor/cli` `@capacitor/android`
  （v8.4.1）、`@capgo/capacitor-social-login`（v8.3.35，Google 登入用）。
- **⚠️ 外掛換人了**：原本研究段建議的 `@codetrix-studio/capacitor-google-auth` 只支援
  Capacitor 6（peer dep `^6.0.0`），跟現在裝的 Capacitor 8 對不上、`npm install` 直接
  ERESOLVE 報錯。改用 `@capgo/capacitor-social-login`（同一個 Capgo 團隊維護，跟
  IAP 那顆 `capacitor-native-purchases` 系出同門，明確標示相容 Capacitor 8）——功能一樣
  是走 Android Credential Manager 系統帳號選擇器，API 換了但邏輯不變。
- **`src/lib/auth.ts` 改法**：`signInWithGoogle()`/`signOut()` 用
  `Capacitor.isNativePlatform()` 分流——原生殼呼叫 `SocialLogin.login({provider:'google'})`
  拿 `idToken`，直接餵給 `supabase.auth.signInWithIdToken()`；網頁版原本的 GSI One
  Tap 邏輯完全不動。`webClientId` 沿用現有 Web Client ID（`899150298731-...`），
  Supabase 端的 Google provider 設定**不用改**（見下方「為什麼帳號會連到同一份資料」）。
  實驗階段先不帶 nonce（Credential Manager 的雜湊規則跟 Web GSI 不同，混用容易兜不起來；
  nonce 對 `signInWithIdToken` 是選配，先求打通，之後真要上生產線再補）。
- **本機 debug build 已驗證成功**：`cd android && ./gradlew assembleDebug` →
  `BUILD SUCCESSFUL`，`android/app/build/outputs/apk/debug/app-debug.apk`（~25MB）。
  過程踩了兩個純環境雷（跟程式邏輯無關，記下來避免重踩）：
  1. `android/local.properties` 手動建立時 SDK 路徑的反斜線要跳脫成 `\\`（Java
     Properties 格式），寫成單斜線會讓 AGP 的 `SdkLocator` 直接吃 `IOException`。
  2. Capacitor 8 的 AGP 要求 Java 21+ 編譯，本機系統 `JAVA_HOME` 預設是 JDK17（給其他
     專案用），CLI 建置這個實驗專案時在 `android/gradle.properties` 加了
     `org.gradle.java.home` 指向本機已裝的 Eclipse Adoptium JDK 25 才過。**這行只影響
     命令列建置，用 Android Studio 開這個資料夾時 IDE 有自己內建的 JBR，不受影響。**
- **本機 debug keystore SHA-1**（下面「待辦」要用）：
  `29:08:B4:C2:4A:CD:4B:FE:DA:ED:3E:83:10:8B:BA:05:60:16:BA:DC`
  （用 `cd android && ./gradlew signingReport` 現場確認過，這是這台機器所有 Android
  專案共用的 `~/.android/debug.keystore`，不是這個實驗專案獨有的）。

### 📋 待辦（Claude 無法自動化，需使用者手動做）

1. **Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID
   → Application type: Android**：
   - Package name：`com.tylapp.taiexrider.captest`
   - SHA-1：`29:08:B4:C2:4A:CD:4B:FE:DA:ED:3E:83:10:8B:BA:05:60:16:BA:DC`
   - 要在**跟現有 Web Client ID 同一個 Google Cloud 專案**底下建立。
   - 這個 Android Client ID 不用貼進任何程式碼——它的作用只是讓 Google 放行「這個
     package name + 這把簽章」呼叫 Credential Manager，程式碼裡 `webClientId` 繼續用
     現有 Web Client ID 不變。
2. **不用動 Supabase Dashboard**：因為 `webClientId` 沒換，ID token 的 `aud` 還是原本
   已授權的 Web Client ID，Supabase 那邊的 Google provider 設定完全不用碰。
3. 做完第 1 步後（Google 那邊生效可能要等幾分鐘到幾小時），拿
   `android/app/build/outputs/apk/debug/app-debug.apk` 側載到手機（或用 Android Studio
   開 `TaiexRider-cap/android` 直接跑），實測：① 有沒有原生感、跳不跳 Chrome 提示、
   ② 點 Google 登入是否叫出系統帳號選擇器、③ 登入後有沒有連回同一顆 Supabase 帳號
   （用同一顆 Google 帳號比對車庫金幣/紀錄是否跟現有 TWA 版一致）。

### 為什麼帳號會連到同一份資料

Supabase 認帳號是靠 Google 的 `sub`（帳號唯一識別碼），不是靠哪個 App/哪個 Client ID
發起登入。只要 ID token 的 `aud` 落在 Supabase 已授權的 Client ID 清單內（這裡沿用
現有 Web Client ID，所以清單不用改），同一顆 Google 帳號在網頁版/cap 版登入都會
resolve 到同一筆 `auth.users`，錢包/紀錄/成就自然共用。

---

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
| **🔴 Google 登入（新發現，原本沒設想到）** | GSI One Tap + Supabase OAuth redirect（`src/lib/auth.ts`），現在能用是因為 TWA＝真正的 Chrome | ~~@codetrix-studio/capacitor-google-auth~~ → **[@capgo/capacitor-social-login](https://github.com/Cap-go/capacitor-social-login)**（2026-07-10 動工時發現前者只支援 Capacitor 6、跟現裝的 Capacitor 8 對不上，改用這個 Capgo 維護的 fork，明確標示相容 Capacitor 8） | **Google 從 2021 年起明確政策：內嵌 WebView 裡的 Google OAuth 一律擋下回 `disallowed_useragent`**（[官方公告](https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/)，防中間人攔截登入憑證，無 flag 可繞過）。現有登入方式原封不動搬進 Capacitor 系統 WebView，**大機率直接無法登入**。這個外掛走 Android Credential Manager（系統帳號選擇器 intent），不經過 WebView 內 OAuth 頁面，能繞過此限制，但**需要網頁版（現有 GSI script）跟 App 版（這個原生外掛）兩套登入邏輯並存**，是額外工程量。**已於 `src/lib/auth.ts` 串接完成，見上方「目前進度」。** |

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
- 簽章用**本機 debug keystore**（`~/.android/debug.keystore`，Android Studio 自動產生、
  全機共用），完全不碰正式版 `taiexrider-release.jks`。
- **Supabase 後端完全不用動**——RPC/schema 是前端無關的，不管前端被 TWA 還是
  Capacitor 包，打的 API 一樣（IAP 的 `verify-iap-purchase` Edge Function 也一樣，
  頂多前端傳過去的 purchase_token 取得方式不同）。
- 只有正式決定要切換成 Capacitor 出貨時，才把 `applicationId` 換回真實的
  `com.tylapp.taiexrider` + 用正式簽署金鑰——DEVDOC §10 已確認過這個時間點才做
  不會讓 Play Console 封測歸零（Google Play 只認 applicationId + 簽署金鑰）。

---

## 📋 實驗步驟（1~3、Google 部分的 4~5 已完成，見上方「目前進度」）

1. ✅ 開新資料夾（`TaiexRider-cap/`，跟 `TaiexRider` 平行），複製現有 `src/`、
   `public/`、`vite.config.ts` 等前端檔案（不含 `android/`，那是 TWA 專屬）。
2. ✅ `npm install @capacitor/core @capacitor/cli @capacitor/android`，
   `npx cap init`（`applicationId` 用 `com.tylapp.taiexrider.captest`），
   `npx cap add android`。
3. ✅ `npm run build` 產生 `dist/` → `npx cap sync` 把 web 產物同步進 Capacitor 的
   Android 專案。
4. Google 登入：✅ 已裝 `@capgo/capacitor-social-login`、已串 `auth.ts`、本機
   debug build 成功。⬜ AdMob（`@capacitor-community/admob`）、⬜ Play Billing
   （`Cap-go/capacitor-native-purchases`）——使用者 2026-07-10 決定先驗證登入+原生
   手感即可，金流/廣告晚點再做，屆時比照同樣模式（裝套件→依文件走原生設定）。
5. **優先驗證順序**（照這個順序做，已完成的部分打勾）：
   - ✅ Google 登入串接＋本機 build 成功
   - ✅ **真機側載驗證通過**：Credential Manager 系統選擇器登入成功，車庫金幣/車皮/
     暱稱跟 TWA 正式版完全一致，詳見上方「🎉 真機驗證結果」。
   - ⬜ 下一步：Play Billing（跟現有 Edge Function 對接）
   - ⬜ 最後測 AdMob 獎勵廣告（現有 8 層坑最多，最想擺脫的部分，但風險相對較低——
     壞了頂多看不到廣告，不影響核心遊玩）
6. 三項都跑順 + 效能主觀感受可接受，才算「驗證成功」，回頭評估是否要讓 vc18+
   正式切換過去（屆時另外規劃遷移步驟：改回真實 applicationId、正式簽署金鑰、
   完整走一次 Play Console 上傳流程）。

---

## 🚨 正式遷移到 Capacitor 出貨時的 Google 登入 checklist（**做錯會讓全體玩家登不進去**）

> 寫於 2026-07-10。使用者當下不需要理解細節，真的要切換時**照著這份做**即可。
> 這一節只講 Google 登入的簽章問題，其他遷移事項（applicationId、AAB 上傳）見下方。

### 為什麼實驗版做過一次，正式版還要再做

Google 的 **Android OAuth Client** 綁的是「**package name + 簽章 SHA-1**」這組配對。
從實驗版切到正式版，**這兩個值都會變**，所以實驗版建的那顆 OAuth Client 到時候完全用不上：

| | 實驗版（2026-07-10 已建） | 正式版（切換時要重建） |
|---|---|---|
| package name | `com.tylapp.taiexrider.captest` | `com.tylapp.taiexrider` |
| 簽章 | 本機 debug keystore | 見下方「兩把金鑰」 |

### ⚠️ 兩把金鑰：`taiexrider-release.jks` 不是玩家手機上那把

專案有啟用 **Google Play App Signing**，所以有兩把金鑰（DEVDOC §9.2 已記錄）：

| 金鑰 | 誰持有 | 做什麼 |
|---|---|---|
| **上傳金鑰** `taiexrider-release.jks`（alias `taiexrider`） | 使用者本人 | 簽署「上傳到 Play Console 的 AAB」 |
| **Google Play 簽署金鑰**（SHA-256 `DB:F0:8B:8F:...`） | Google | Google 收到 AAB 後**重新簽一次**；**玩家手機上實際安裝的是這把簽的** |

**這正是 TWA 時代 `assetlinks.json` 踩過的同一個坑**（DEVDOC §9.2 第 511 行：「Google Play
App Signing 重新簽署 AAB，assetlinks.json 必須用 Google Play 的 SHA-256（上傳金鑰不同）」）。
當年填 jks 的指紋導致 DAL 驗證不過、網址列一直冒出來，改成 Play 簽署金鑰才好。
**Android OAuth Client 的 SHA-1 是完全相同的道理**——Google 檢查的是「實際裝在手機上那支
APK 是誰簽的」，不是「上傳前是誰簽的」。

### 正式切換時要建的 Android OAuth Client（package 一律填 `com.tylapp.taiexrider`）

1. 🔴 **Play 簽署金鑰的 SHA-1** ← **最重要**。玩家從商店下載的版本靠這個。
   來源：Play Console → **應用程式完整性 (App integrity)** → 應用程式簽署金鑰憑證（該頁
   SHA-1 / SHA-256 都會列出來）。
2. 🟠 **上傳金鑰 `taiexrider-release.jks` 的 SHA-1** ← 自己側載 signed release APK 測試時靠這個。
   來源：`keytool -list -v -keystore taiexrider-release.jks -alias taiexrider`
3. ⚪（選配）實驗版那顆 debug 的，留著繼續開發測試用，不刪也無害。

> ⚠️ **DEVDOC §9.2 記的是 SHA-256**（assetlinks 用的格式），但 OAuth Android Client 要的是
> **SHA-1**，兩者是不同雜湊、**不能換算**，到時候必須重新抓一次 SHA-1。

### 🔴 最惡劣的失敗模式（務必照順序做）

若**漏建第 1 顆（Play 簽署金鑰的 SHA-1）**：

- 你自己側載 signed release APK 測 → **完全正常**（因為那支是上傳金鑰簽的，SHA-1 有註冊）
- 玩家從 Play 商店下載 → **一律登不進去**（那支是 Google 的金鑰簽的，SHA-1 沒註冊）
- 而且 Cloud Console 改動要等 **5 分鐘 ~ 數小時**生效，加上
  **Play Console 不能回滾版本**（只能用更高 versionCode 的新版蓋掉）——出事成本極高。

**正確順序**：
1. Play Console 抄到 **App Signing 憑證的 SHA-1**
2. 去 Cloud Console **建好 Android OAuth Client**（+ 上傳金鑰那顆）
3. **等生效**（至少數十分鐘，保險起見隔一段時間再測）
4. **才**上傳新版 AAB

### 不會變的部分（不用動）

- **`webClientId` 不用換**：`src/lib/auth.ts` 裡那顆 Web Client ID
  （`899150298731-tj4fjbobqcmc...`）一路沿用，Android Client ID **不會出現在程式碼裡**。
- **Supabase Dashboard 完全不用動**：ID token 的 `aud` 還是那顆 Web Client ID，沒變。
- **Play Console 封測不會歸零**：DEVDOC §10 已確認，只要 `applicationId`
  （`com.tylapp.taiexrider`）+ 上傳金鑰（`taiexrider-release.jks`）維持原本那組即可。

---

## 相關文件

[DEVDOC.md](DEVDOC.md) §9.2（兩把簽署金鑰／assetlinks 同款坑）、§9.4c（AdMob 8 層問題鏈）、
§2.7（IAP 除錯鏈）、§10（"最終保底：整專案換 Capacitor" 段落，含 applicationId 不影響封測的確認）・
[CLAUDE.md](CLAUDE.md)「目前進度」
