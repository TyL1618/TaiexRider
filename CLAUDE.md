# TaiexRider — 專案守則與進度

> 把台股前一交易日走勢轉成 2D 霓虹機車賽道的單指小遊戲（PWA → TWA 上架 Google Play）。
> 完整設計規劃/架構/踩雷結論見 [DEVDOC.md](DEVDOC.md)。歷史交接紀錄（舊決策脈絡）見 [History.md](History.md)。
> 因使用者跨機器（家裡/公司）工作、Claude 本機 memory 不會同步，**一律以 repo 內的 .md 為準**。

---

## 🔴 開發守則（每次開工都要遵守）

1. **沒說動工，只討論分析，不動 code**
   - 使用者提問、討論方向、評估做法 → Claude 只分析回覆，**不主動改任何檔案**。
   - 使用者明確說「動工」「開始做」「幫我改」等指令後，才進入實作模式。

2. **說動工後，每次改 code 必同步：文件 + 部署**
   只要動到程式碼，就要：
   ① 一併更新 [DEVDOC.md](DEVDOC.md)（規格有變動時）與本檔「目前進度」；
   ② `git add -A && git commit && git push`；
   ③ push 會自動觸發 **GitHub Actions** → 部署到 `taiexrider.pages.dev`（無需手動操作）。
   不要累積一堆改動才一次推——小步提交、隨手 push。

3. **跨機器開發（家裡 / 公司輪流）——以 repo 為單一事實來源**
   - 重要決策、進度、規格 **一律寫進 repo 內的 .md**（CLAUDE.md / DEVDOC.md），因為 Claude 的本機 memory（`~/.claude`）**不會跨電腦同步**。
   - **每次開工第一件事：`git pull`**；收工前確認已 `git push`。
   - 換機器接手時，讀 CLAUDE.md「目前進度」即可無縫接續。

4. **不要污染上層 repo**：本資料夾是獨立 git repo，遠端 = `TyL1618/TaiexRider`。
   上層 `Coding/Project` 是 VictoryMatrix 的 repo，與本專案無關。

---

## 技術棧速查

React 18 + Vite 5 + TypeScript ・ Canvas 2D 渲染 ・ Matter.js 物理 ・
vite-plugin-pwa (Workbox) ・ idb (IndexedDB 快取) ・ Supabase（Phase 4 起）。
資料源＝TWSE 開放端點（後端抓、瀏覽器只讀，避 CORS）。

指令：`npm run dev`（開發）/ `npm run build`（打包）/ `npm run typecheck`。

## 部署架構

- **線上網址**：`taiexrider.pages.dev`（Cloudflare Pages）
- **CI/CD**：GitHub Actions（`.github/workflows/deploy.yml`）
  - 觸發：push to `main` → 自動 build + `wrangler pages deploy ./dist`
  - Token：`CLOUDFLARE_API_TOKEN` 存在 GitHub repo Secrets（有 Cloudflare Pages: Edit 權限）
  - 帳號 ID：`aa30f8795c349575164c118e5876ec60`
- **不使用** Cloudflare 本身的 CI（曾因 token 權限問題改為 GitHub Actions）
- ⚠️ `android/` 原生專案改動 **push 無效**：要生效必須手動在 Android Studio 重 build signed AAB、`versionCode +1`、上傳 Play Console。
- ⚠️ Supabase 的 migration/RPC/Edge Function 也是 **push 不會生效**：migration 要手動在
  SQL Editor 跑；Edge Function 要 `npx supabase functions deploy verify-iap-purchase`。

### 🔁 跨機器開發（家裡/公司輪流）——2026-07-10 起改用更簡單的方式

> **TWA 時代的「兩份資料夾手動同步」流程已作廢**（舊版流程見 git 歷史/History.md，
> 這裡不留舊內容避免有人照著舊步驟做）。改用 Capacitor 之後，Android 專案改成**直接
> 開 repo 裡的 `android/` 資料夾**，不用再手動複製維護一份獨立的
> `AndroidStudioProjects/TaiexRider/`。

**原因**：Capacitor 的原生外掛（AdMob/Play Billing/登入）不是用 Maven 座標抓的，
是用 `capacitor.settings.gradle`（自動產生、不能手動改）裡的**相對路徑**指到
`../node_modules/@capacitor/...`——這代表 Android 專案資料夾**天生要跟它的網頁
專案（`node_modules` 所在位置）綁在一起**，不能像 TWA 時代那樣獨立搬到別的路徑開
（搬過去會出現 `Failed to resolve: project :capacitor-android` 這類 Gradle Sync
錯誤，2026-07-10 切換到 Capacitor 時實測踩過）。

**新流程**（每次要在新機器上建置/測試 android/ 改動）：
1. `git pull` 到最新（`npm install` 確保 `node_modules` 也是最新）。
2. 直接用 Android Studio 開 `<repo 路徑>/android`（例如
   `C:\Users\tyl16\Documents\Private\TaiexRider\android`）——**不用複製到別的資料夾**，
   repo 本身就是唯一要維護的版本。
3. 首次在新機器開，或大改動之後，Android Studio 會自動跳 Gradle Sync 提示，跑完即可；
   跑起來怪怪的話 File → Invalidate Caches / Restart。
4. `local.properties`（SDK 路徑）、`.idea/`、`.gradle/`、`app/build/` 這些機器本地產物
   本來就不進 git 版控，每台電腦第一次開會自動生成，不用管。
5. ⚠️ 看到「Project update recommended / Start AGP Upgrade Assistant」之類的升級提示
   **先不要點**，目前版本是 Capacitor 產生時已驗證過的，先不要動它。

（2026-07-10 前用過的舊 `AndroidStudioProjects/TaiexRider/` 資料夾已不再是主要工作
目錄，連同它的備份 `AndroidStudioProjects/TaiexRider-TWA-backup/` 可以放著不用管，
之後想清理再刪即可，不影響任何東西。）

---

## 每日地圖資料管線（daily_map）——速記

完整寫入/讀取邏輯見 **DEVDOC §3**（3.1 寫入、3.1b 讀取端連假安全、3.2 端點）。改這塊前必讀。
最容易改錯的三條鐵律：

- **`map_date` 錨定 Yahoo K 棒 timestamp 讀出的實際交易日 +1，絕不用「執行當下時間」推算**
  （GitHub 排程延遲跨午夜會錯位跳號，曾發生過）。
- **清舊資料 cutoff 錨定剛寫入的 `mapDate − 7 天`，不可錨 `now − 7 天`**（長連假會把當前
  唯一在用的盤刪掉）。
- **讀取端上界用「今天」取 `max(map_date ≤ 今天)`，不可用 nextDay**（會提早半天換圖）；
  排行榜 key 與讀取/提交/RPC 三者同源（`resolveSessionDate()`），連假整段同一張榜。

---

## 目前進度

> ## 🆕 2026-07-10（週五）家裡電腦晚場：三項體驗優化已完成 + 真機驗證全過，待打包 vc23
>
> vc22 已上傳「內部測試」軌道蓋掉殘留的舊 `1.4.0`（那是持續觸發 AD_ID 宣告警告的
> 真兇——內部測試軌道的舊 TWA 版沒有 AD_ID 權限，Play Console 做全 App 範圍檢查時
> 一直抓到它；換成 vc22 後該軌道上傳新版不再報錯，驗證假設成立）。接著動工三項體驗
> 優化，**程式碼全部完成、typecheck 過、web 預覽無 error，2026-07-10 晚已側載 APK
> 真機驗證三項全部正常**，待打包簽署版 vc23 上封閉測試：
>
> 1. ✅ **Android 實體返回鍵修好（真機驗證過）**：換殼後返回鍵沒反應的根因是 Capacitor
>    把實體返回鍵委派給 `@capacitor/app` 的 `backButton` 事件，而這外掛沒裝。已裝
>    `@capacitor/app`，`App.tsx` 在原生殼註冊 backButton listener → `window.history.back()`，
>    交給既有的 popstate 邏輯（子頁→首頁、首頁→確認離開、確認→`CapApp.exitApp()`），跟
>    TWA 時代行為一致。（manifest 旗標 `enableOnBackInvokedCallback` 保留；真機驗證
>    正常，沒用到「拿掉旗標退回 legacy」的備案。）
> 2. ✅ **廣告預載入優化（真機驗證過）**：舊版點下去才 `prepareRewardVideoAd()`（把網路
>    延遲壓在點擊當下）。`ads.ts` 新增 `preloadRewardedAd(kind)`，進車庫/排行榜/遊戲時就
>    背景備好，播完自動再備下一支；`requestNativeRewardedAd` 優先用備好的、沒有才
>    fallback 現場備。呼叫點：Garage 進場備 coin、DailyChallenge 進場備 coin、GameCanvas
>    進場備 revive、結算彈出備 coin。
> 3. ✅ **動畫開屏 Splash（真機驗證過，取代舊「icon 閃一下」廉價感）**：`index.html` 的
>    boot-splash 升級成一次性品牌動畫（favicon 折線自己畫出→琥珀輪子彈入→TAIEX RIDER +
>    slogan 淡入→霓虹讀取條），`main.tsx` 改成強制最短顯示 2200ms（原本 React 一 paint
>    就淡出＝秒開沒質感），仍以 React 已 paint 為前提避免露空畫面。裝
>    `@capacitor/splash-screen` 做原生冷啟動層（純色 `#05080f`，`drawable/splash_solid.xml`
>    + 改 `styles.xml` launch theme 背景 + `capacitor.config.ts` 設
>    `androidSplashResourceName`），`main.tsx` 原生殼 JS 一跑就 `SplashScreen.hide()` 交棒
>    給 boot-splash，全程同底色無縫接。
>
> **下一步**：三項已真機驗證全過，`versionCode 23`/`versionName 1.23` 已設好。剩下
> **打包簽署版 AAB 上封閉測試**（打包前若又動過網頁碼，務必先 `npm run build` 再
> `npx cap sync android`，見「Capacitor 換殼」踩雷）→ Android Studio Generate Signed
> Bundle → 上**封閉測試**軌道。
>
> ## 🏠 2026-07-10（週五）交接：回家繼續前必讀
>
> 今天在**公司電腦**上把 TaiexRider 從 TWA **正式切換到 Capacitor**（見待辦 6b 完整
> 細節）。使用者週末（7/11~7/12）會在**家裡電腦**接續，那台電腦完全沒看過今天的
> 任何進度——**當作新 session 從頭讀這份文件即可**，以下是最濃縮的接手指南：
>
> **① 家裡電腦第一件事**：
> ```
> git pull        # 拿到今天全部變動（android/ 整個換成 Capacitor、src/lib 三支
>                  # 檔案改動、capacitor.config.ts、package.json 等）
> npm install      # 補齊新增的 5 個 Capacitor npm 套件
> ```
> **不用**在家裡電腦重建 `TaiexRider-cap` 沙盒資料夾或任何 TWA 備份——那些都是
> 公司電腦本機專屬的工作痕跡（沙盒的成果已經併進 repo 了，備份純粹是保險，不影響
> 家裡電腦的工作）。
>
> **② Android 專案怎麼開（今天發現的新規則，適用所有機器）**：直接用 Android
> Studio 開 **`<repo 路徑>\android`**（例如家裡電腦可能是
> `C:\Users\tyl16\Documents\...\TaiexRider\android`，實際路徑找家裡那台的 repo
> 位置）。**不要**再用舊的 `AndroidStudioProjects\TaiexRider` 那套獨立資料夾模式
> ——Capacitor 外掛靠相對路徑指到 `node_modules`，搬到獨立資料夾會
> `Failed to resolve: project :capacitor-android` 炸掉（今天在公司電腦踩過）。
> 詳見下方「🔁 跨機器開發」整節。
>
> **③ 進度更新：三座橋已在簽署版真機驗證全過，比早上寫這段交接時又往前推進了**：
> 1. ✅ Google Cloud Console 2 顆 Android OAuth Client 已建好且**已生效確認**
>    （Play 簽署金鑰 SHA-1＝`87:74:F0:B1:43:BD:43:C3:47:E2:20:C4:5A:D0:AA:DC:63:CF:14:64`、
>    上傳金鑰 SHA-1＝`6B:18:63:B2:BB:59:D4:F6:13:43:CC:1B:DD:B2:01:57:AF:3B:7C:4C`）。
> 2. ✅ 用 Android Studio「Generate Signed Bundle/APK」打出簽署版 APK，`adb install`
>    側裝真機（舊 TWA 簽章不同要先 `adb uninstall com.tylapp.taiexrider`，正常現象）。
> 3. ✅ **簽署版真機驗證：登入成功、Play Billing 真實購買流程打通**（applicationId
>    對得上 Play Console 既有商品）——這是三座橋裡唯一 cap 沙盒階段沒測到的，現在
>    補上了，三座橋全部在正式環境驗證完畢。
> 4. 🐛✅ **過程順便抓到一個真實 bug 並修好**：進車庫自動對帳會誤把「舊的已失效測試
>    購買記錄」當成錯誤跳出來嚇人（不管登入哪個帳號都會跳，因為對帳查的是裝置
>    Play Store 帳號的購買歷史，不是 App 登入帳號）。已修（`billing.ts`
>    `reconcilePurchasesNative()`）、重新打包簽署版、真機驗證確認不再誤跳。
> 5. ✅✅✅ **當天再往前推進到終點**：上傳簽署版 AAB 時抓到並修好兩個 Capacitor
>    專屬坑（Play Console「廣告 ID 宣告」報錯缺 `AD_ID` 權限；預測性返回手勢動畫
>    合併時漏掉的 manifest 屬性），`versionCode` 因為中途撞號改成 **19**，
>    **`versionCode 19`（Capacitor 首版）已打包簽署版 AAB、上傳 Play Console
>    封閉測試軌道、使用者已送出審查**。上傳過程那個 AD_ID 警告一路留到最後，追查
>    後發現是**vc16（TWA）manifest 本來就沒這條權限**、Play Console 拿現行軌道版本
>    一起比對造成的過渡性警告，不是 v19 本身的問題（已拆開 `.aab` 逐位元組驗證過
>    兩次確認權限都在）——用「未經許可直接發布」略過這個過渡性警告成功送出。
>    **今天的目標（TWA→Capacitor 正式切換並送審）已經達成**，剩下純粹等審查結果。
> 6. ⬜（選配、不急）App 長按捷徑／開屏 Splash Screen 目前還沒搬到 Capacitor，
>    非阻塞，見 CAPACITOR_EXPERIMENT.md「已知功能落差」。AdMob 廣告單元 ID 換真實值
>    使用者已決定暫緩到公開上線前（AdMob 放送資格審核還沒做）。
> 7. ✅ 2026-07-10 晚已用 adb 實機驗證 `com.google.android.gms.permission.AD_ID:
>    granted=true`，眼見為憑確認生效，結案。
> 8. ✅ **`supabase/migration_20260710.sql` 已跑**（`wallet_daily_usage()`、
>    `wallet_earn()` 的 `granted` 欄位）。**另外抓到 `consume_attempt()` 的 42702
>    撞名 bug（排名賽每日 5 次上限曾經完全沒在伺服器寫入），已用
>    `supabase/migration_20260710b.sql` 修復並真機驗證次數正確累加**，完整經過見
>    上方「🏠 2026-07-10 晚：家裡電腦交接後續」。
>
> ⚠️ **今天公司電腦一度因為接了公司有線網路擋住 GitHub push**（防火牆問題，拔線
> 就好，不是帳號或程式碼問題）——如果家裡電腦 `git pull` 發現少了最新的
> commit，代表公司電腦收工前忘記確認 push 成功，回頭找使用者確認。
>
> **④ 其他背景**：vc16（TWA 版）已上傳 Play Console 封測、仍在跑審核，**跟
> Capacitor 的 vc19 是兩條獨立的審查/軌道記錄**，不受今天的架構切換影響，繼續
> 等結果即可，不用特別去管它。**vc17/vc18 都沒有真的上傳過**（vc17 TWA 版準備好
> 但中途改切 Capacitor、vc18 是打包時撞號被 Play Console 拒絕改成 19）——之後的
> 新版號都會建立在 Capacitor 之上，接續 19 往上加。
>
> 完整細節、踩雷紀錄、決策脈絡全部在
> [CAPACITOR_EXPERIMENT.md](CAPACITOR_EXPERIMENT.md)，這份摘要只是最速版，
> 遇到不確定的地方回頭讀那份文件。

### 🏠 2026-07-10（週五）晚：家裡電腦交接後續——v20 出包、修好後 v21，另抓到一個真實伺服器 bug

當天稍早在公司電腦送出 vc19 審查後，使用者晚上回家繼續在家裡電腦處理 migration +
v20 打包，過程中連環發生三件事，全部已排除，記錄避免重踩：

1. 🐛✅ **`npm run build` 步驟被跳過，v20 包到 7/4 的舊網頁內容**：家裡電腦第一次
   `git pull` 後，Claude 只跑了 `npm install` + `npx cap sync android` 就幫忙 sync
   Android 專案，**漏了 `npm run build`**——`dist/` 資料夾不受 git 版控
   （`.gitignore` 排除），`cap sync` 只會複製「目前 `dist/` 裡現有的東西」，不會
   自動重新編譯。家裡電腦的 `dist/` 是好幾天前（7/4 19:23）的舊產物，於是打包出來
   的 v20（`versionCode 20`）**原生殼是新的 Capacitor，但包進去的網頁內容是一週前
   的舊快照**（車款 P3~P5、IAP 串接、金幣修復全部消失）——上傳審核通過、真人測試者
   已經下載到這個壞版本。**修法**：`npm run build` 重新產生新鮮 `dist/` →
   `npx cap sync android` → `versionCode` 直接跳到 **21**（20 已經燒掉不能重傳）→
   重新打包簽署版上傳蓋掉。**教訓見下方新增的踩雷筆記**：Capacitor 打包前一定要
   `npm run build`，這步不會報錯、只會靜靜包舊內容，非常隱蔽。
2. ✅ **AD_ID 權限用 adb 實機驗證 `granted=true`**：CLAUDE.md 待辦第 7 項確認完成
   （`adb shell dumpsys package com.tylapp.taiexrider | grep -i AD_ID`）。v20 上傳時
   跳的 AD_ID 過渡性警告跟這無關（manifest 權限一直都在），照舊用「未經許可直接
   發布」跳過即可。
3. 🐛✅ **真正的伺服器 bug：`consume_attempt()` 的 42702 撞名，排名賽次數上限
   從沒真的寫進資料庫**：跟今天稍早 `wallet_daily_usage()` migration 一起真機測試時
   發現，不管玩幾場排名賽都卡在 1/5、第 3~5 次看廣告解鎖從未觸發。查
   `public.wallet_daily_attempts` 當天完全零筆紀錄。根因：`consume_attempt()`
   （`migration_20260706.sql`）內的 `select last_session_key, streak_count into
   v_last, v_count from public.player_streak where player_id = v_uid` 沒加表別名，
   跟函式自己 `returns table(..., streak_count int, last_session_key date)` 的輸出
   參數同名歧義 → 42702 → 整支 rollback。前端 `consumeAttemptServer()`
   （`challengeAttempts.ts`）是 fail-open 設計，錯誤只印 console 就放行遊戲，
   **導致「排名賽每日 5 次上限」這道伺服器防線實際上完全失效**（非經濟漏洞但是
   反作弊防線破洞，屬於要立刻修不能擱置的等級）。**已修**：
   `supabase/migration_20260710b.sql` 幫那行 SELECT 加 `ps.` 別名，執行後真機驗證
   `wallet_daily_attempts` 正確寫入、畫面次數正確累加。**跟 CLAUDE.md 已記錄的
   42702 踩雷是同一類地雷，但這次是 SELECT INTO 不是 UPDATE**——以後新寫/修改任何
   `returns table(...)` 的 PL/pgSQL 函式，**內部所有 SELECT/UPDATE 引用到跟輸出
   欄位同名的資料表欄位，一律要加表別名**，不只 UPDATE 要注意。

### 🎯 現在的狀態（2026-07-09 晚，Fable 5 交接清單三項全部執行完畢——TWA 時代快照）

- **vc16 已上傳 Play Console 封測軌道，等審核結果**（AdMob 橋接 + 通知權限修復版）。
- **vc17 程式碼已完成、已同步本機 AS 專案，⚠️ 待真機測試後擇時上傳**：`AdBridgeService`
  改「只在看廣告時短暫存活」（常駐通知消失，只在點看廣告→播完後幾秒出現）。細節見
  DEVDOC §9.4b/§9.4c。**測試重點**：debug build 走三條廣告路徑（車庫拿金幣/復活/結算
  雙倍），確認 ① 獎勵正常發放 ② 通知只在看廣告期間出現、播完約 8 秒後消失 ③ 連續看
  兩次廣告（第二次緊接著點）也正常。
- **vc18（下一版）**：殼版本更新提示（設計 DEVDOC §9.5b 方案 A），跟 vc17 之後任何
  需要重包的機會一起做。
- **IAP 金流二次稽核**（報告全文在 [FABLE5_HANDOFF_20260709.md](FABLE5_HANDOFF_20260709.md) 底部）：
  1. 🔴✅ **2026-07-10 已修＋已部署上線**：`supabase/functions/verify-iap-purchase/index.ts`
     加了 `productId` 比對（Google 回應的 `productId` 跟前端聲稱的 `sku_id` 不符就拒絕），
     堵住「買便宜包冒充貴包」的真錢漏洞。`npx supabase functions deploy
     verify-iap-purchase --project-ref cjnwwtrpveejhbwalncy` 已成功部署（Dashboard 確認）。
     **這個缺口已完全結案。**
  2. 🟠 退款後無收回機制——建議封測期接受，正式上架後視退款率再決定接 Voided Purchases API。
  3. 🟡 三個小項（Google 5xx 誤標、防重放並發 500、replay 分支假設錢包存在）——皆會
     自我修復或機率極低，可不修，詳見報告。
- **封測 14 天倒數**：以 Testers Community 儀表板為準（不是 Play Console 天數），等他們
  通知即可，不用焦慮盯人數。期間注意：①收到他們的測試回饋報告後整合進正式版申請表單；
  ②申請表單 10 題每題至少 250~300 字，具體寫招募/回饋/迭代；③14 天內至少發布 3 個新
  封測版本（vc15/16 已算 2 次，vc17 上傳後即達標）。

### ⚠️ 待真機驗證清單（2026-07-10 晚整理：程式碼皆已確認存在，非阻塞）

以下幾條在 TWA 時代列為「待真機驗證」，2026-07-10 晚查過程式碼（migration 檔案/UI
文字/呼叫點）都確認**邏輯已經寫好、沒有遺失**，使用者評估不需要逐條再花時間重新
真機驗證，非阻塞：

- ~~vc17 三條廣告路徑 + 通知短暫存活行為~~：TWA vc17 最終沒上傳，直接跳去 Capacitor，
  這條連同「前景服務通知」問題本身一起作廢（Capacitor 天生沒有這個問題）。
- 排行榜第 3~5 次「看廣告開始」觸發廣告——`DailyChallenge.tsx` 呼叫
  `requestRewardedAd("coin")` 邏輯確認在。
- 已買永久去廣告帳號結算畫面「🎁 領取 獎勵 ×2」——`GameCanvas.tsx` 對應 UI 文字與
  「不用看廣告、點擊直接領取雙倍」邏輯確認在。
- `claim_weekly_quest()`/`grant_iap_diamonds()` 的 42702 修復——`migration_20260709b.sql`
  確認存在。
- 狂暴盤日事件——`marketMood.ts`/`weeklyQuests.ts`/`App.tsx` 相關程式碼確認在。
- 預測性返回手勢動畫——**2026-07-10 晚合併 Capacitor 時發現的真實 regression**：
  舊 TWA manifest 的 `android:enableOnBackInvokedCallback="true"` 併過來時漏掉了
  （cap 沙盒的 manifest 本來就沒有這個），已補回
  `android/app/src/main/AndroidManifest.xml` 的 `<application>` 標籤，跟著這次
  修 AD_ID 權限一起重新 build。

### 📌 待辦（非阻塞，依時機做）

1. **上架前必做**：`src/lib/ads.ts` 的 `NATIVE_AD_UNIT_IDS` 換成真實廣告單元 ID
   （revive_reward: `ca-app-pub-8981745966447649/1679422480`；coin_reward:
   `ca-app-pub-8981745966447649/2170377077`）。**使用者確認**：現在還在封測階段，
   AdMob 帳戶那邊「連結 Play 商店 listing + 完成放送資格審核」也還沒做，現在換真實
   ID 也不保證能穩定放送，換了反而白工——**先維持測試單元，等要真的公開上線時再
   一起處理**（AdMob App 也要回「應用程式設定」補 Play 商店 listing 連結）。
2. **正式上架時**：跑 [supabase/prelaunch_cleanup.sql](supabase/prelaunch_cleanup.sql)
   清玩家遊戲數據（**使用者會自己找時機手動跑**，不用 Claude 主動提醒/催促；動手前
   跟使用者逐表再確認一次；絕不動帳號/錢包/iap_purchases）。
3. ~~查封測期歷史交易~~：**使用者確認不需要**——封測期間所有交易都是用 Google Play
   授權測試名單的假信用卡刷的，不是真人真錢，正式上線前會把這些測試交易紀錄
   （`iap_purchases` 等）整批清掉，不需要逐筆去 Play Console 對帳查是否有真人受害。
4. **反作弊 Phase B**（DB 端次數上限＋離群偵測）等正式上架後；Phase C（操作事件序列）
   跟 Ghost 回放一起設計。見 [ANTICHEAT_DESIGN.md](ANTICHEAT_DESIGN.md)。
5. **RETENTION 第三批**（週聯賽 30 人分組升降級、Ghost 回放）：長期，未排期。
   見 [RETENTION_PLAN.md](RETENTION_PLAN.md)。
6. **AdSense 網頁版**：暫緩，偵測到網頁玩家變多再評估（`ads.ts` 分流已備好，填
   `ADSENSE_PUB_ID` 即開通，記得同步補 CSP 白名單）。
6b. **✅ 2026-07-10：已正式切換到 Capacitor，TWA 時代結束**：
   Capacitor 沙盒（登入/AdMob/Play Billing 三座橋皆真機驗證通過後）已正式併回主專案
   `TaiexRider`——`android/` 整個換成 Capacitor 版本（舊 TWA 的
   `AdActivity.kt`/`AdBridgeService.kt`/`DelegationService.kt` 等土炮橋接檔案移除，
   仍完整保留在備份與 git 歷史）、`applicationId` 轉回正式的
   `com.tylapp.taiexrider`（沿用 TWA 版本來就在用的那個，Play Console
   listing/封測名單/AdMob App/IAP 商品全部不用重建）、`versionCode` 接續到 18。
   兩顆必要的 Google OAuth Android Client 已建好且生效，**登入／AdMob／Play Billing
   三座橋都在簽署版真機驗證過**。**舊 TWA 專案完整備份在
   `C:\Users\tyl16\Documents\Private\TaiexRider-TWA-backup\`**（含完整 git 歷史，
   要回退隨時可用）。完整合併細節、踩雷紀錄見
   [CAPACITOR_EXPERIMENT.md](CAPACITOR_EXPERIMENT.md)「🔀 正式合併進主專案」。
   - 🔑 **架構認知（使用者已確認接受）**：Capacitor 版是把網頁內容**打包進 APK**
     （`capacitor.config.ts` 沒設 `server.url`），跟 TWA「即時開網站」不一樣——
     以後只改網頁邏輯、`git push` 部署到 Cloudflare Pages，Capacitor 版玩家**不會**
     馬上看到更新，要重新打包上傳 Play Console、玩家更新 App 才會生效。使用者評估
     遊戲完成度已高、之後（尤其正式上線後）不會太頻繁改版，**這個特性可以接受，
     不用特別再設計「殼版本更新提示」**（原本 DEVDOC §9.5b 的 vc18 構想，
     現在視為非必要）。
   - 🐛✅ **上傳 Play Console 封測時抓到並修好兩個 Capacitor 專屬坑**：
     ① Play Console 報「廣告 ID 宣告」錯誤——新版 `play-services-ads` SDK 不會自動
     帶 `com.google.android.gms.permission.AD_ID` 權限，`@capacitor-community/admob`
     外掛的 manifest 也沒帶，手動補在 `AndroidManifest.xml`。
     ② 上面提到的「預測性返回手勢動畫」manifest 屬性合併時漏掉，已補回。
     兩個都已修好，**下一步要重新打包簽署版 AAB 上傳**（覆蓋掉之前那次沒修的）。
7. **選配資安收尾**：Google Cloud 舊服務帳號金鑰（`aabce7b...`，2026-07-06 建、私鑰已
   遺失）新金鑰已驗證能用、可去 GCP 刪除；Google 登入 OAuth client_secret 曾在對話中
   顯示過，封測期風險低，在意的話可 rotate。
8. 使用者會另外用 Fable 思考新方向，屆時任務可能再增加。

### 📚 已完結索引（詳細結論已整併進 DEVDOC，這裡只留一行導航；更早見 History.md / git log）

- **7/9 AdMob 獎勵廣告橋接打通（8 層坑）**→ DEVDOC §9.4c（含問題鏈全文）。vc15/16 的
  通知權限三層坑（沒要權限→同步啟動搶跑→TWA 蓋掉對話框）→ DEVDOC §9.4b。
- **7/9 IAP 金流打通（7 層坑）＋兩個真錢缺口修補＋訪客擋購買** → DEVDOC §2.7
  （含除錯鏈、金流安全網、稽核缺口）。
- **7/9 金幣/鑽石發放 42702 大 bug**（7/5 起所有 wallet_earn/週任務/IAP 鑽石從沒真的
  寫進 DB）→ DEVDOC §2.5 PL/pgSQL 踩雷段。`migration_20260709b.sql` 已跑、wallet_earn
  已實測修復。
- **7/9 events.player_id 全 NULL**（7/2 起 377 筆無法回溯）→ DEVDOC §12。
- **7/9 排行榜第 3~5 次廣告從未真的觸發**（半成品補完）＋離開賽道警告文字補強
  （排行榜模式明示次數不歸還）→ 待真機驗證清單。
- **7/9 買去廣告後拿金幣/雙倍按鈕消失** → 改「免看廣告直接領取」→ DEVDOC §2.7。
- **7/8 金幣/鑽石經濟大改版**（6 項，v0.12.33）→ DEVDOC §2.8 總覽。4 份 migration
  （20260708/b/c/d）已確認跑過。
- **7/8 跨帳號快取污染**（playRewards/quests/weeklyQuests/adRewards 四組 localStorage
  key 加 `{uid|guest}` 隔離）＋開發者帳號背景補幣 effect 依賴修正（`[user]`→穩定值）。
- **7/7~7/9 封測人數危機**：14 天倒數被打回 1 天（人數真的跌破 12，非顯示延遲）→ 付費
  Testers Community（NT$399，15 位真人）補人 → 客服確認以他們儀表板 14 天為準、人數
  不足的日子不計入不白算、100% 成功率不過全額退款。
- **7/7 結算分數滾動動畫終點錯**（節流 HUD vs 即時 ref）、圖鑑分母移除車庫重複顯示、
  排行榜訪客鎖定、金幣經濟調整（完賽 5/摔車 2/日上限 50→後改 100）、車款改名排序、
  「1000 支股票」＝Supabase Data API Max Rows 預設 1000（Dashboard 已改 2000，非程式碼）。
- **7/5~7/6 伺服器端錢包/成就/streak/暱稱權威化＋登出清快取** → DEVDOC §2.5；IAP 骨架
  → DEVDOC §2.7；留存第二批（狂暴盤/圖鑑/週任務/經典前三）→ DEVDOC §2.6。
- **7/4 反作弊 Phase A**（migration_20260704.sql 已跑，含 0 誤殺回測與三處刻意偏差）＋
  第二輪資安檢查 → [SECURITY_REVIEW.md](SECURITY_REVIEW.md)＋CSP/_headers 執法。
- **7/2~7/4 本週交接 13 項全完成**（v0.12.1~27：模擬驗證雙修/監控打點/留存四件套/
  車庫系統/車皮管線 OpenCV 重建/原生體驗）→ [FABLE5_HANDOFF.md](FABLE5_HANDOFF.md)、
  DEVDOC 各節。vc9 啟動崩潰事故已結案（→ 踩雷筆記 TWA 段）。
- **已取消不做**：Web Push、週五馬拉松、好友邀請比較、排行榜 emoji 反應、BETA #4
  前翻/煞車鈕、歷史紀念日事件、經典週榜（併入週聯賽構想）。
- **鑽石車款 P 系列 5 台**：✅ 全數上線已核實（2026-07-09 用程式碼再確認過），無待辦，
  **不要再問**。IAP 真實售價 TWD 31/94/280/72。

### 📂 文件地圖

[DEVDOC.md](DEVDOC.md) 架構/規格/踩雷結論 ・ [History.md](History.md) 舊交接紀錄 ・
[NEXT_BATCH_PLAN.md](NEXT_BATCH_PLAN.md) 7/6 批次清單（多數已完成，看勾選）・
[FABLE5_HANDOFF_20260709.md](FABLE5_HANDOFF_20260709.md) 7/9 交接＋IAP 稽核報告 ・
[CAPACITOR_EXPERIMENT.md](CAPACITOR_EXPERIMENT.md) Capacitor 遷移全紀錄（✅ 2026-07-10 已正式切換、vc19 送審）・
[SECURITY_REVIEW.md](SECURITY_REVIEW.md) ・ [ANTICHEAT_DESIGN.md](ANTICHEAT_DESIGN.md) ・
[RETENTION_PLAN.md](RETENTION_PLAN.md) ・ [WALLET_PLAN.md](WALLET_PLAN.md) ・
[GARAGE_DESIGN.md](GARAGE_DESIGN.md) ・ [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) ・
[BETA_FEEDBACK.md](BETA_FEEDBACK.md)

---

## 踩雷筆記

### 🕐 時區踩雷：日期一律用「台灣本地」，絕不用 UTC（重蹈過兩次）
- **症狀**：台灣午夜~早上 8 點之間，伺服器/UTC 算出來的日期比台灣少一天 → 資料被掛到前一天的 key → 跟 app 讀的本地日期對不上 → 「看似沒資料/沒上榜」，實際有寫只是 key 錯。
- **後端（Supabase RPC / SQL）**：不可用 `current_date` / `now()::date`（UTC）。用 `(now() at time zone 'Asia/Taipei')::date`。
- **腳本（fetchDailyMap）**：不可用「執行當下時間」推日期（GitHub 排程延遲會跨午夜）。錨定資料源回傳的**實際交易日**（Yahoo K 棒 timestamp）。
- **前端（JS）**：算「今天 key」一律用 `dailyKey()`（本地 `getFullYear/Month/Date`），**不可用 `toISOString()`**（那是 UTC）。`nextDay()` 也要用 `Date.UTC()` 純整數避免時區 +1 算成同一天。
- 對齊原則：客戶端 `dailyKey()`＝裝置本地（台灣）日期 ⇄ 後端寫入＝台灣日期 ⇄ daily_map map_date＝台灣交易日+1。三者全部錨在台灣時區才一致。

### ⚙️ 物理踩雷筆記（避免重蹈）
- Matter.js 對 torque/force 會乘上 `delta²`(~278×)，自訂扭矩極易爆量。**旋轉控制改用 `Body.setAngularVelocity` 直接給 rad/step**（直覺好調），不要用 torque。
- 輪子 `frictionStatic` 別設太高(>3)會黏住不滾。
- 手感參數全集中在 `src/game/constants.ts`。

### 📱 TWA/androidbrowserhelper 踩雷
- **meta-data 的 `android:value` vs `android:resource` 不能混用**：`SPLASH_SCREEN_BACKGROUND_COLOR` 必須 `android:resource="@color/..."`——用 `android:value="#05080f"` 會被函式庫當「資源 ID」查表 → `Resources$NotFoundException` 點開秒崩（vc9 事故）。而 `FADE_OUT_DURATION`（要毫秒 int）、`DEFAULT_URL`/`FILE_PROVIDER_AUTHORITY`（@string 引用會自動解析）用 `android:value` 是對的。**改 TWA meta-data 時查 androidbrowserhelper 文件確認該欄位要 value 還是 resource。**
- **沉睡地雷效應**：函式庫很多讀取是條件觸發（如背景色只在有 SPLASH_IMAGE_DRAWABLE 時才讀），錯誤寫法可能潛伏多版不發作。**android/ 有任何改動，上傳 AAB 前一律先 signed APK + `adb install -r` 真機開機驗證。**
- **Play Console 不能回滾版本**：壞版本只能用更高 versionCode 的新版蓋掉，出事成本高，更要上傳前驗證。
- **TWA release 版無法 chrome://inspect**（Chrome 安全限制，不是設定沒開）：真機除錯靠
  `adb logcat` 抓原生 tag、或把失敗原因顯示在畫面上（billing 紅色橫幅的由來）。

### 🔑 IAP/Supabase secret 踩雷：多行私鑰別用 --env-file 直接塞
- **症狀**：Edge Function 呼叫 Google API 前 `importPrivateKey()` 拋
  `DOMException DataError: ASN.1 DER message is incomplete ... at DER byte 0`（DER 0 bytes）。
- **根因**：服務帳號 PEM 私鑰是**多行**的，`supabase secrets set --env-file` 的 dotenv 解析
  遇到值裡的實體換行會**只吃第一行**（`-----BEGIN PRIVATE KEY-----`），其餘被當成別的
  entry 丟掉 → secret 只剩開頭 → strip 完 base64 body 是空的。
- **正解**：私鑰要保持**單一實體行**寫進 env-file，用 `JSON.stringify(json.private_key)`
  產生「`\n` 轉義 + 外層雙引號」的形式（正好是 JSON 原始字串的樣子），Edge Function 端再
  `.replace(/\\n/g, "\n")` 還原（就算 dotenv 有把 `\n` 展開成真換行也沒差，`importPrivateKey`
  會 strip 掉所有 `\s`）。設完長度應 1600~1800 字元、開頭 `-----BEGIN PRIVATE KEY-----`。
- **延伸雷**：private_key 只在「真的有付款」時才被 `getGoogleAccessToken()` 用到，setup 當下
  只 curl 測「未登入」不會觸發 → 壞了也不會馬上發現。**設完 secret 後要真的走一次付款**
  才算驗證過。金鑰 JSON 私鑰 Google 只在建立當下給下載一次，遺失只能重建新金鑰。

### 🗄️ PL/pgSQL 踩雷：RPC 輸出欄位跟資料表欄位撞名（42702）
- `returns table(coins int, ...)` 的輸出欄位是函式內隱含變數，`set coins = coins + x`
  會歧義炸掉整個呼叫（rollback 且前端慣例靜默吞錯，玩家只是「安靜拿不到錢」）。
  **UPDATE/WHERE 一律加資料表名前綴**。完整事故經過見 DEVDOC §2.5。
- **不只 UPDATE 會中招，SELECT INTO 一樣會**：2026-07-10 晚在 `consume_attempt()`
  抓到同款地雷的 SELECT 版本——`select last_session_key, streak_count into v_last,
  v_count from public.player_streak where player_id = v_uid` 沒加表別名，跟函式
  自己 `returns table(..., streak_count int, last_session_key date)` 的輸出參數
  撞名，一樣 42702 rollback，且前端 fail-open 吞錯，導致「排名賽每日 5 次上限」
  這道伺服器防線悄悄失效了好幾天都沒被發現。**通則**：任何 `returns table(...)`
  的 PL/pgSQL 函式，內部所有 SELECT/UPDATE 只要引用到跟輸出欄位同名的資料表欄位，
  一律要加表別名前綴，不分語句種類。修復見 `supabase/migration_20260710b.sql`。

### 📦 Capacitor 踩雷：換殼＝換 web origin，localStorage 全部歸零
- Capacitor 把網頁打包進 APK，用 `https://localhost` 當 origin（TWA 是真的開
  `https://taiexrider.pages.dev`）。**兩者 localStorage 完全不互通**，玩家從 TWA 更新到
  Capacitor 版時，所有本地快取（登入 session、每日次數計數…）都像全新安裝一樣歸零。
- **後果**：凡是「只存 localStorage 的每日次數」都會顯示成沒用過。2026-07-10 真機實測
  抓到：車庫「看廣告 +40 金幣 (0/2)」按鈕又亮了，但伺服器記得今天已領滿
  （`wallet_earn_log.kind='ad'` 的 `n` 已經是 4，上限 2）→ 玩家看完 30 秒廣告，金幣
  數字閃一下就被伺服器權威值蓋回去，**毫無提示，體感像被吃錢**。排名賽挑戰次數同理。
- **原始設計是「不是經濟漏洞」**：`wallet_earn` 的每日上限、`consume_attempt()` 的 5 次
  上限本來都該在伺服器端硬性把關，清資料刷不出額外金幣/場次——**但 2026-07-10 晚發現
  `consume_attempt()` 當時因為下面那則 42702 撞名 bug 實際上完全沒在寫入資料庫，這道
  防線曾經真的失效過**，已修復（見下方 42702 踩雷筆記 + `migration_20260710b.sql`）。
  以後這類「本地計數 vs 伺服器把關」的修復上線後，**要實際玩一次＋查資料庫確認真的有
  寫入**，不能只看前端顯示正常就當作沒事。
- **修法（migration_20260710.sql + 前端）**：新增 `wallet_daily_usage()` 讓前端進車庫/
  排行榜時把本地計數覆寫成伺服器認定的次數；`wallet_earn()` 多回一個 `granted` 欄位，
  前端拿到 `false` 就顯示「今日領取次數已用完」而不是靜默回捲。
- **通則**：任何「每日次數/額度」類的本地計數都只能當**顯示快取**，權威值一律問伺服器，
  且進入畫面時要對帳一次。清 localStorage、重裝、換殼都會讓它歸零。

### 📦 Capacitor 踩雷：打包前一定要 `npm run build`，`cap sync` 不會幫你重新編譯
- `dist/` 資料夾不受 git 版控（`.gitignore` 排除），`npx cap sync` 只會把「目前
  `dist/` 資料夾裡現有的東西」複製進 `android/app/src/main/assets/public`，**不會
  自動重新編譯網頁**。如果本機 `dist/` 是好幾天前的舊產物（例如換一台好幾天沒同步
  的機器，`git pull` 只會更新 `src/` 等有版控的原始碼，`dist/` 完全不會變），直接
  跑 `cap sync` 再進 Android Studio 打包，包出來的原生殼是新的，**裡面的網頁內容
  卻是舊快照**——不會報錯、不會有任何警示，安裝起來看外觀正常，只有實際玩才會發現
  功能全部倒退。
- **2026-07-10 晚實際發生過**：家裡電腦 `dist/` 是 7/4 的舊產物，忘記 `npm run
  build` 就直接 `cap sync` + 打包，v20（`versionCode 20`）上傳審核通過、真人測試者
  已下載到這個「殼新、內容舊一週」的壞版本，車款 P3~P5／IAP／當週所有修復全部消失。
  發現後 versionCode 直接跳號到 21（20 已經燒掉不能重傳）。
- **正確順序，每次要打包 Android 前都要走一遍**：`git pull` → `npm install` →
  **`npm run build`**（重新編譯 `dist/`）→ `npx cap sync android` → Android Studio
  打包。**漏掉 `npm run build` 這一步是最容易忘記、後果卻最嚴重的環節。**

### 🧪 測試踩雷：preview 分頁是隱藏分頁，rAF 被瀏覽器暫停
- 用 preview 工具驗證時，分頁 `document.hidden=true` → `requestAnimationFrame` 不會 fire → 遊戲主迴圈整個停住（看起來像「車不會動」，其實是迴圈沒跑）。screenshot 也會 timeout。
- 解法：`GameCanvas.tsx` 有 `import.meta.env.DEV` 下的 `window.__test` 鉤子（step/press/release/reset/state），可**手動步進**物理來驗證，繞過 rAF。真人用可見分頁玩則一切正常。

### 🚧 常設禁區/慣例（不分日期，永遠有效）
- **`public/bikes/Grok_Original/`、`For_Lobby/`、`For_Gaming/` 三個資料夾 Claude 只能讀，
  禁止寫入/修改**（使用者手動去背維護；曾有自動去背腳本把圖弄壞整包 revert 的前科）。
  AI 生圖量測/登記流程見 [GARAGE_DESIGN.md](GARAGE_DESIGN.md)。
- **測金幣經濟數字不要用 `tyl161803@gmail.com`**：開發者帳號登入會自動把餘額拉回
  99999（金幣+鑽石）並解鎖 Q 系列成就，測不出真實發放；用訪客或一般帳號測。
- **廣告/每日次數類 localStorage key 一律帶 `{uid|guest}` 隔離**（曾發生跨帳號污染）；
  session 相關 effect 依賴陣列用 `user?.id`/`user?.email` 穩定值，**不可用 `[user]`
  物件參照**（Supabase 背景 token 刷新會給新物件，反覆觸發）。
