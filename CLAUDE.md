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

### 🔁 跨機器同步 Android Studio 專案（家裡/公司輪流開發時）

repo 內的 `android/` 資料夾（git 追蹤）跟本機 `AndroidStudioProjects/TaiexRider/`（**不進版控**，
純手動複製維護）是兩個分開的東西。`git pull` 只會更新前者，後者要手動同步才會反映最新程式碼。
兩台電腦上 `AndroidStudioProjects/TaiexRider/` 的實際路徑可能不同，開工時直接掃這台電腦找即可，
不用預設固定路徑。

**每次要在新機器上建置/測試 android/ 改動前**，做這件事：
1. 確認 repo 已 `git pull` 到最新。
2. 在**這台電腦**上找到本機的 Android Studio 專案資料夾（通常是
   `%USERPROFILE%\AndroidStudioProjects\TaiexRider\`，但不同機器路徑可能不一樣，找不到就搜尋
   含 `TaiexRider` 且有 `app\build.gradle.kts` 的資料夾）。
3. 把 repo 的 **`android/app/src`**（整個資料夾，用鏡像覆蓋，包含刪除本機多出來、repo 裡沒有的
   舊檔案）和 **`android/app/build.gradle.kts`** 複製覆蓋到該 Android Studio 專案的
   `app/src`、`app/build.gradle.kts`。
4. **絕對不要碰**該專案裡的 `local.properties`、`.idea/`、`.gradle/`、`app/build/`——這些是機器
   本地設定（SDK 路徑、IDE 快取、建置產物），本來就沒有進 git 版控，兩台電腦本來就該各自保留
   自己的版本，覆蓋過去反而可能讓 Gradle Sync 失敗。
5. 複製完回 Android Studio 視窗做一次 Gradle Sync（右上角提示，或 File → Sync Project with
   Gradle Files）。

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

### 🎯 現在的狀態（2026-07-09 晚，Fable 5 交接清單三項全部執行完畢）

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

### ⚠️ 待真機驗證清單（累積中，測完劃掉）

- [ ] ~~vc17 三條廣告路徑 + 通知短暫存活行為~~：**使用者 2026-07-10 決定跳過真機測試，
  直接上傳 vc17 到 Play Console 封測、信任已完成的 code review**（不接線測，省時間）。
- [ ] 排行榜第 3~5 次「看廣告開始」真的觸發廣告（需已登入、真的打到第 3 次；修復見
  已完結索引 7/9）。
- [ ] 已買永久去廣告帳號：結算畫面顯示「🎁 領取 獎勵 ×2」且點擊立即雙倍入帳
  （車庫「🎁 領取 +40 金幣」已驗證過）。
- [ ] `claim_weekly_quest()`（週任務領獎）與 `grant_iap_diamonds()`（真錢鑽石）的 42702
  修復——與已實測的 `wallet_earn()` 同款修法，使用者接受同理推斷；有機會實測一次更安心。
- [ ] 狂暴盤日事件（需等到 TAIEX 單日 |漲跌| ≥ 2.5% 才驗得到）。
- [ ] 預測性返回手勢動畫（需手勢導覽的手機從螢幕邊緣滑動才看得出）。

### 📌 待辦（非阻塞，依時機做）

1. **上架前必做**：`AdActivity.kt` 的 `TEST_REWARDED_AD_UNIT_ID` 換成真實廣告單元 ID
   （revive_reward: `ca-app-pub-8981745966447649/1679422480`；coin_reward:
   `ca-app-pub-8981745966447649/2170377077`，依 `intent.data` 的 `type` 分流）。
   AdMob App 也要回「應用程式設定」補 Play 商店 listing 連結+完成放送資格審核。
2. **正式上架時**：跑 [supabase/prelaunch_cleanup.sql](supabase/prelaunch_cleanup.sql)
   清玩家遊戲數據（動手前跟使用者逐表再確認一次；絕不動帳號/錢包/iap_purchases）。
3. **查封測期歷史交易**：若 7/9（42702 修復）之前有真人付錢買過鑽石，那筆錢有扣但鑽石
   沒入帳——查 Play Console 交易紀錄決定補發/退款。
4. **反作弊 Phase B**（DB 端次數上限＋離群偵測）等正式上架後；Phase C（操作事件序列）
   跟 Ghost 回放一起設計。見 [ANTICHEAT_DESIGN.md](ANTICHEAT_DESIGN.md)。
5. **RETENTION 第三批**（週聯賽 30 人分組升降級、Ghost 回放）：長期，未排期。
   見 [RETENTION_PLAN.md](RETENTION_PLAN.md)。
6. **AdSense 網頁版**：暫緩，偵測到網頁玩家變多再評估（`ads.ts` 分流已備好，填
   `ADSENSE_PUB_ID` 即開通，記得同步補 CSP 白名單）。
6b. **Capacitor 遷移實驗（2026-07-10 動工，骨架＋Google 登入已建好，⚠️ 待真機驗證）**：
   使用者用 CyberMind 專案先試過 Capacitor 打包、體感非常好（有原生感、不跳 Chrome
   提示），決定讓 TaiexRider 也做同樣的實驗。骨架建在平行資料夾
   `C:\Users\tyl16\Documents\Private\TaiexRider-cap\`（不進 git 版控），
   `applicationId=com.tylapp.taiexrider.captest`，已裝 `@capacitor/android` +
   `@capgo/capacitor-social-login`（原研究段建議的 `@codetrix-studio/capacitor-google-auth`
   不支援 Capacitor 8，臨時換這顆），`auth.ts` 已串好原生 Google 登入分流，本機
   `gradlew assembleDebug` 已 BUILD SUCCESSFUL。**下一步待辦（卡在使用者手動操作，
   非 code）**：去 Google Cloud Console 註冊 Android OAuth Client（package name +
   debug SHA-1，完整步驟在 [CAPACITOR_EXPERIMENT.md](CAPACITOR_EXPERIMENT.md) 待辦區）
   → 才能真機側載驗證登入是否連回同一顆 Supabase 帳號。AdMob／Play Billing 兩座橋
   使用者要求先緩，驗完登入+原生手感有信心後同一天下午可能接著做。完整細節/踩雷見
   [CAPACITOR_EXPERIMENT.md](CAPACITOR_EXPERIMENT.md)。
   🔴 **真的要正式切 Capacitor 出貨時，先讀 CAPACITOR_EXPERIMENT.md 的「正式遷移
   Google 登入 checklist」**：Android OAuth Client 要註冊 **Google Play 簽署金鑰的
   SHA-1**（不是上傳金鑰 `taiexrider-release.jks`），漏了會「自己側載測全過、玩家從
   商店下載全部登不進去」，且 Play Console 不能回滾版本。跟當年 assetlinks.json 是
   同一個坑。使用者已明示不需自己記細節，由 Claude 負責在該時機主動提醒＋執行。
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
[CAPACITOR_EXPERIMENT.md](CAPACITOR_EXPERIMENT.md) Capacitor 遷移研究（未動工）・
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
