# TaiexRider — 專案守則與進度

> 把台股前一交易日走勢轉成 2D 霓虹機車賽道的單指小遊戲（PWA → TWA 上架 Google Play）。
> 完整設計規劃見 [DEVDOC.md](DEVDOC.md)。

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

---

## 每日地圖資料管線（daily_map）

- **排程**：GitHub Actions `fetch-daily-map.yml`，每日 **台灣 16:00**（cron `0 8 * * *` UTC）跑 `scripts/fetchDailyMap.ts`。收盤後 2.5h，提早跑是為了即使被 GitHub 延遲也不會跨過午夜。
- **資料源**：個股 + TAIEX 一律走 **Yahoo Finance**（個股 `{code}.TW`、大盤 `^TWII`，5 分 K、`range=1d`）。⚠️ 不用 TWSE `MI_5MINS_INDEX`——它對 GitHub runner 不穩定，曾整批失敗。TWSE `STOCK_DAY_ALL` 僅用來取「上市股票清單（代號+名稱）」。
- **map_date 算法（核心，別再改錯）**：
  - 交易日 `sessionDate` **從 Yahoo 回傳的 K 棒 timestamp + 時區偏移直接讀出**，不是用「執行當下時間」推算。
  - `map_date = sessionDate + 1 天`。app 在日曆日 D 查 `map_date = D`，顯示「前日盤勢」標成 `D-1`（= sessionDate）。
  - **為何不能用 `now+1`**：GitHub 排程常延遲，一旦跨午夜 `now` 會多跳一天、但抓到的盤仍是前一交易日 → 日期錯位 + 跳號。曾發生 6/17 的盤被存成 `map_date=2026-06-19`（建立時間卻是前天）。錨定 `sessionDate` 後即使延遲到隔天凌晨也不會錯。
- **休市/連假自動處理**：非交易日（六日、國定假）Yahoo `range=1d` 會回傳「最後一個交易日」→ `sessionDate` 不變 → `map_date` 不變（寫入端）。⚠️ 但**讀取端**必須用「最新一期」邏輯才撐得過連假——見下方「app 讀取（連假安全）」。下個交易日開盤當晚跑完才換新圖。
- **資料量不爆**：寫入用 upsert `Prefer: resolution=merge-duplicates`，衝突鍵 `(map_date, stock_code)`。連假多次跑都是「覆蓋同一批 ~1090 列」非新增；另每次清除舊資料。⚠️ **cutoff 錨定剛寫入的 `mapDate` 往前 7 天，不可錨「執行當下 now」**：長連假（過年/長颱風假 > 7 天）map_date 凍住但 now 一直走，用 now-7 會追過當前唯一在用的 map_date 把它刪掉（甚至同一次跑剛寫又刪）→ 掉回靜態盤。錨 mapDate 則當前盤永遠保留，任意長度連假都安全。
- **app 讀取（連假安全 + 午夜換圖）**：`src/lib/dailyMap.ts` 的 `resolveSessionDate()` 取「daily_map 中 `map_date ≤ **今天**（日曆日）的**最大值**」當「目前這一期」，三個 fetcher（hardest/list/stock）全對齊它。
  - **上界用「今天」而非 nextDay**：`map_date = sessionDate+1` 已內建「00:00 才生效」。週五 16:00 cron 把週五盤存成 `map_date=週六`，週五當天 `max(≤週五)` 仍是週四盤（不提早跳）；**週六 00:00** 起 `max(≤週六)=週六` 才切到週五盤＝午夜精準換圖。⚠️ 上界若用 `nextDay` 會讓週五下午就提早換圖（曾誤用）。
  - **連假 fallback**：日曆日超過最後交易日的 map_date 時，`lte + desc` 往回取「最近一期」→ 整段沿用最後交易日的盤。下個交易日（例：六日一連假後的週二）下午盤抓到、**隔天 00:00** 才換。（2026-06-20 週六曾因舊邏輯只查「今天/明天」精準比對 `[6/20,6/21]`、錯過 `map_date=6/19` 而掉回靜態 24 支。）
  - **盤勢沒變就沿用**：休市重抓同一 `sessionDate` → 寫入端 upsert 同一 `map_date` → 不產生新期，自然沿用，無新盤不換圖。
- **排行榜對齊（同一張榜跨連假）**：challenge key 也用 `resolveSessionDate()`（= `max(map_date ≤ 今天)`），讀取（`DailyChallenge`）、提交清快取（`leaderboard.ts`）、RPC 寫入（`submit_daily_score` 的 `v_today := coalesce(max(map_date)≤台灣今天, 台灣日曆日)`）三者同源 → 週末/連假整段成績累積在同一張榜，午夜才換新榜。**schema 改完要手動在 Supabase SQL Editor 跑 `create or replace function submit_daily_score`，push 不會更新 RPC。**

---

## 目前進度

### 🔖 交接（2026-06-20 v0.10.0 — 新增第四模式「經典模式」）

**開工第一件事：`git pull`。**

> **新增經典模式**：歷史著名股市盤勢做成永久趣味關卡（靜態、不更新）。
> - **資料**：`scripts/fetchClassics.ts`（一次性）從 Yahoo 歷史**日線**（`period1/period2`、`interval=1d`）抓取 + 降採樣到 ~140 點，metadata（事件名/期間/說明）在腳本內手動策展，輸出靜態 `src/data/classics.json`（12 條）。⚠️ **跑完 commit JSON 就不用再動**；要新增事件改腳本候選清單再跑一次。**台股 1990 萬點崩盤抓不到**（Yahoo `^TWII` 日線只回溯到 ~1997），其餘台股/美股/日股 12 條全有。
> - **關卡（12）**：台股 2000網路泡沫・2008海嘯・2020 COVID深V・2022空頭・319槍擊・2024最大單日跌點；美股 1987黑色星期一・2000那斯達克・2008海嘯・2020 COVID・GME軋空；日股 1989泡沫頂。（GME 因股票分割，價格被還原成 ~$87 而非 $483，但地形形狀完整。）
> - **程式**：`src/data/classics.ts`（型別 + `classicToTrack()`，HUD subtitle = 期間・標的，mode 用 `monthly` 保留走勢圖切換）；`src/screens/ClassicSelect.tsx`(+css)（卡片含 Sparkline 預覽 + 事件說明）；`Home.tsx` 加第 4 顆按鈕（紫色 `.classic`）+ `Screen` 加 `"classic"`；`App.tsx` 加路由 + 傳 `subtitle`；`GameCanvas.tsx` 加 `subtitle?` prop → HUD（`.hud-sub`）與結算畫面（`.overlay-track-sub`）顯示期間/標的。
> - typecheck + build 通過（preview 隱藏分頁無法截圖驗證，console 無 error）。**未真機試玩**，下次真人玩確認 12 條地形手感 OK、HUD 文字不過長。

---

### 🔖 交接（2026-06-20 v0.9.4 — 連假掉回靜態盤 + 排行榜跨連假同榜修正）

**開工第一件事：`git pull`。**

> **核心原則（使用者定調）**：「**一律讀最後一次抓到的盤**」。休市/連假/颱風/過年不分長度，永遠顯示最後一個有開的交易日盤勢，且只在**凌晨 00:00** 換圖。機制 = `map_date = sessionDate+1`（內建午夜生效）＋讀取端 `max(map_date ≤ 今天)`。
>
> **本次修的 bug（連假第二天觸發）**：週四(6/18)是最後交易日，週五六日連假。週五正常顯示週四盤；**週六**卻掉回最原始的靜態 24 支測試盤、排行榜也跑掉、日期標籤也錯。
> - **根因**：`map_date = sessionDate+1` 只覆蓋 session 後一天；app 舊讀取邏輯只試「今天/明天」(`[dailyKey, nextDay]`)。週六日曆日 6/20 的視窗 `[6/20,6/21]` 完全錯過存在 `map_date=6/19` 的週四盤 → 查無 → fallback 靜態盤。排行榜同理：challenge key 用日曆日，週六換到空的 6/20 榜。
> - **修法一覽（本 session 全部 push 完成，唯 RPC 待手動跑）**：
>   1. **地圖讀取**：新增 `resolveSessionDate()`（`dailyMap.ts`）= daily_map 中 `map_date ≤ **今天**` 的 **max**（上界用「今天」非 nextDay，靠 `map_date=sessionDate+1` 內建午夜換圖；連假則 lte+desc 往回沿用最近一期）。三個 fetcher 改用它精準比對（不再 `[today,nextDay]` 迴圈）。
>   2. **排行榜同榜**：讀取/重整（`DailyChallenge`）、submit 清快取（`leaderboard.ts`）、App 預熱（`App.tsx`）全部改用 session key（= `max(map_date)`）。
>   3. **⚠️ RPC 待手動執行**：`supabase/schema.sql` 的 `submit_daily_score` 改 `v_today := coalesce((select max(map_date) from daily_map where map_date ≤ 台灣今天), 台灣日曆日)`。**push 不會更新 RPC，要進 Supabase SQL Editor 跑 `create or replace function submit_daily_score`** 才生效，否則寫入端仍用舊日曆日 → 連假成績仍掛錯 key。
>   4. **長連假不自刪**（`fetchDailyMap.ts`）：清理 cutoff 從「now − 7 天」改「剛寫入的 mapDate − 7 天」。否則過年/長颱風假 > 7 天時 cutoff 追過凍住的 map_date，剛 upsert 又被刪 → 掉回靜態盤。
>   5. **日期標籤錯位**：排名賽標題（`DailyChallenge`）、自選賽道圖池日期（`TrackSelect`）原本算「今天 − 1」，連假時 ≠ 實際盤勢日（週六 6/20−1=6/19，但盤是 6/18）。新增 `resolveSessionDisplayDate()`（= `resolveSessionDate − 1` = 實際交易日），兩處改用它。
>   6. **長征 HUD 重疊**：長征 `name` = 5 個股號串接過長，遊玩中橫向蓋住右上暫停/返回鈕。`.hud-corner` 加 `max-width` + `word-break` 自動換行（`GameCanvas.css`）。
> - typecheck 通過、版本 v0.9.4。詳見上方「每日地圖資料管線」段「app 讀取（連假安全 + 午夜換圖）」「排行榜對齊」「資料量不爆」。

---

### 🔖 交接（2026-06-19 — 連假回家：上架推進 + 一連串 UTC/時區 bug 修正）

**開工第一件事：`git pull`。**

> **本次完成（2026-06-19 深夜）**：
> - **Google Play 上架推進**：商店資訊 11 項全填完（類別＝賽車遊戲、廣告選「無」、目標年齡 18+、資料安全性＝收集名稱+使用者ID/OAuth、刪除帳號網址＝privacy 頁、聯絡 email）。AAB（version 5 / versionCode 5，公司已上傳含 TWA 全螢幕修正）有效，**不需重打包**（TWA 跑線上網頁，前端改動 push 即生效）。
> - **⚠️ 卡關：封閉測試門檻**。新開發者帳號要 **12 名測試者 + 連續測試 14 天**才能申請正式版。目前 1/12（自己帳號/家人不算，需真人 Android 用測試連結安裝、別退出）。連結＝封閉測試→「透過 Android 裝置加入測試」。14 天計時從第一人安裝起算，越早湊滿越好。
> - **Supabase migration 已執行**：`migration_user_profiles.sql`（改名同步排行榜生效）。
> - **遊戲內設定**：「音量（待實作）」→ 真音量滑桿（與首頁共用 localStorage key）；引擎聲音量調大（著地 0.11→0.32）。
> - **TWA 返回鍵/確認離開**：`leavingRef` 旗標讓 `doLeave` 後 popstate 不再重開視窗、history 自然耗盡 finish()。
> - **🐛 一連串 UTC/本地時區錯位 bug（同一類根因，已記入下方踩雷筆記）**：
>   - **daily_map 日期錯位**：`fetchDailyMap.ts` 原用「執行當下 +1」算 map_date，GitHub 排程延遲跨午夜就錯位+跳號（6/17 盤被存成 6/19）。改為**錨定 Yahoo 回傳的實際交易日 sessionDate**，map_date=sessionDate+1。TAIEX 也從 TWSE `MI_5MINS_INDEX`（runner 不穩）改 Yahoo `^TWII`。cron 21:05→16:00 TW。詳見「每日地圖資料管線」段。
>   - **排行榜成績錯位（同類）**：RPC `submit_daily_score` 原用 `current_date`（UTC），台灣午夜後成績被存到前一天 `challenge_date`，跟 app 讀的本地 `dailyKey()` 對不上 → 看似沒上榜（實際 204 成功有寫）。改 `(now() at time zone 'Asia/Taipei')::date`。前端 `leaderboard.ts` 提交後清快取也從 `toISOString()`(UTC) 改 `dailyKey()`。**schema 改完要手動在 Supabase SQL Editor 跑 `create or replace function`，push 不會自動更新 RPC。**

---

### 🔖 交接（2026-06-18 — TWA 全螢幕確認修復 + 準備正式上架）

**開工第一件事：`git pull`。**

> **今日全部完成項目**：
>
> **✅ TWA 問題全修**
> - **assetlinks.json**：改為 Google Play 簽署金鑰 SHA-256 → TWA 驗證通過，全螢幕無網址列。
> - **全螢幕 immersive（已確認手機生效）**：
>   - themes.xml：`DarkActionBar` → `NoActionBar` + windowFullscreen + 透明系統列
>   - AndroidManifest.xml：`DISPLAY_MODE=sticky-immersive`（⚠️ 正確值是 `sticky-immersive`，不是 `immersive-sticky`，字串顛倒 androidbrowserhelper 直接 fallback 到 DefaultMode）
>   - `MainActivity.kt`：新增自訂 Activity 繼承 LauncherActivity，`onCreate`/`onWindowFocusChanged` 直接設 `SYSTEM_UI_FLAG_IMMERSIVE_STICKY`（API<30）或 `WindowInsetsController`（API 30+）雙層保險。
> - **返回鍵 race condition**：`confirmLeaveRef.current` 在 `setConfirmLeave` 前同步更新，避免快速連按穿透。
> - **確認離開無效**：`window.close()` 在 TWA 被封鎖，改加 `history.go(-(length+5))` 耗盡 history。
>
> **✅ v0.9.3 功能**
> - 音量控制滑桿（master gain node，存 localStorage）
> - 首頁三按鈕文案更新，移除測試標記
> - 隱私權政策頁面（`taiexrider.pages.dev/privacy`）
> - ManageDataLauncherActivity 補宣告（修 2.7.1 閃退）
>
> **⚠️ 待家裡電腦完成（連假）**：
>
> **Android 最後一包 AAB（連假第一件事）**
> 1. 把 repo `android/` 內以下三個檔案複製到 Android Studio 專案：
>    - `app/src/main/java/com/tylapp/taiexrider/MainActivity.kt`（新建）
>    - `app/src/main/AndroidManifest.xml`（覆蓋）
>    - `app/src/main/res/values/themes.xml` + `values-night/themes.xml`（覆蓋）
> 2. `versionCode +1`，Generate Signed Bundle，上傳 Play Console
>
> **Play Store 商店資訊（還差）**
> - [ ] 主題圖片 1024×500（已用 Grok 生成，待上傳）
> - [ ] 手機截圖至少 2 張（開遊戲截圖上傳）
> - [ ] 內容分級問卷（Play Console → 政策 → 應用程式內容 → 內容分級）
> - [ ] 隱私權政策網址填入（`https://taiexrider.pages.dev/privacy`）
> - [ ] 類別選擇（遊戲 → 動作）
>
> **Supabase 待執行**
> - [x] `scripts/migration_user_profiles.sql` 已執行（2026-06-18，改名同步排行榜生效）
>
> **全部完成後**：Play Console 從「內部測試」升到「正式發布」→ 送審（通常 1-3 天）
>
> **Android Studio 同步提醒**：每次改 `android/` 後要手動複製到 `C:\Users\tyl16\AndroidStudioProjects\TaiexRider\`，`versionCode +1`，重新 Generate Signed Bundle 再上傳。
>
> **Google Play 現況**：
> - 帳號：Harold_Yun（tyl161803@gmail.com）
> - App：TAIEX RIDER（com.tylapp.taiexrider），內部測試軌道
> - Keystore：`C:\Users\tyl16\Documents\taiexrider-release.jks`（alias: taiexrider）⚠️ 僅在公司電腦，回家前複製到雲端硬碟
> - Google Play 簽署金鑰 SHA-256：`DB:F0:8B:8F:BA:71:10:51:92:DD:8F:83:B8:4D:92:91:85:34:B0:3E:5B:9B:2A:CA:92:E6:9E:9E:22:9F:57:DA`

---

### 🔖 交接（2026-06-18 v0.9.2 — PWA 自動更新 + 返回鍵三修 + 圖池日期/遊戲說明）

**開工第一件事：`git pull`。**

> **v0.9.2 本次完成（三個 PWA/TWA 體驗修正）**：
> - **#1 自動更新（不再需手動清快取）**：
>   - `vite.config.ts`：`registerType` 改 `"prompt"` + `injectRegister: null`；workbox 移除 `skipWaiting`/`clientsClaim`（prompt 模式需等待中的 SW 才能觸發 onNeedRefresh；skipWaiting 改由訊息觸發）。
>   - 新增 `src/pwa.ts`：用 `virtual:pwa-register` 手動註冊，每 60s `registration.update()` 主動檢查；偵測新版時 → 非遊玩中立即 `updateSW(true)`（skipWaiting + 自動 reload），**遊玩中先 defer**，待 `setPlaying(false)` 回首頁再套用。
>   - `main.tsx` import `./pwa`；`App.tsx` 進賽道 `setPlaying(true)`、離開 `setPlaying(false)`。
>   - 參考自家 SecureChat 的 controllerchange→reload 自動更新模式（virtual:pwa-register 內建處理）。
> - **#2 「確定離開」關不掉 App**：`App.tsx` `doLeave` 改 `window.close()`（正式 TWA/APK 才會結束 Activity；「加到主畫面」的安裝版 PWA 因瀏覽器限制可能無效＝測試環境正常現象，上架 TWA 不受影響）。移除原本永不重設的 `leavingRef`（會導致按確定離開後返回鍵失效→再按穿透關閉的 bug）。
> - **#3 子頁連按兩次返回直接關遊戲（race）+ 確認視窗返回鍵錯亂**：根因＝單一 listener + 純 state 切頁無真實 history 深度，且確認視窗開著時沒攔返回鍵。修法：① `handleNav` 進子頁 `pushState` 一層真 entry、`goHome` 改 `history.back()`；② popstate 只在「首頁→離開」邊界補推哨兵，「子頁→首頁」不補推；③ **確認視窗開著時按返回＝取消視窗並補推哨兵**（`confirmLeaveRef` 同步 state），不落到 E0 邊界被原生返回穿透。效果：模式連按兩次＝回首頁→跳確認；視窗開著按返回只會取消，要離開只能按「確定離開」。
> - **圖池日期顯示**：`TrackSelect.tsx` 前日盤勢/每日長征 tab 顯示對應股市日期（dailyKey 的前一天，格式 `m/d 走勢`）。
> - **遊戲說明**：`Home.tsx` 設定 modal 加「遊戲說明」按鈕（操作/計分/圖池更新規則/四種模式）。
>
> **⚠️ 待真機驗證**：三項都需 Android/TWA 真機測（preview 隱藏分頁無法測 popstate 與 SW 更新）。重點測：①部署後手機是否自動更新加快；②首頁確定離開能否關 App；③從三模式快速連按兩次返回是否會跳確認而非直接關閉。

---

### 🔖 交接（2026-06-18 — Phase 7 TWA 完成，等 Google Play 身分驗證）

**開工第一件事：`git pull`。**

> **今日進度（Phase 7 完成）**：
> - **Android TWA 專案**：手動在 Android Studio 建立（不用 Bubblewrap / PWABuilder），放在 `android/` 子資料夾，已進 repo。
>   - 使用 `androidbrowserhelper:2.7.1`，`LauncherActivity` 指向 `https://taiexrider.pages.dev`
>   - package ID：`com.tylapp.taiexrider`
> - **Keystore 已建立**：`C:\Users\tyl16\Documents\taiexrider-release.jks`（alias: `taiexrider`）
>   - ⚠️ **keystore 只在公司電腦**，回家要先把這個檔案複製到家裡電腦同路徑，否則無法 build release
>   - SHA-256：`83:FD:B6:0E:B0:B3:92:52:A4:34:0B:74:04:44:D2:5F:7F:30:07:62:43:8A:1E:01:4C:45:D1:E2:38:14:1B:4C`
> - **assetlinks.json**：`public/.well-known/assetlinks.json` 已部署，fingerprint 已是最新 keystore 的值
> - **Signed AAB**：已產出，位於 `C:\Users\tyl16\AndroidStudioProjects\TaiexRider\app\release\app-release.aab`
> - **Google Play 開發者帳號**：Harold_Yun（tyl161803@gmail.com），$25 已繳，身分驗證文件已送出等審核
>
> **🟠 等 Google 身分驗證通過（email 通知）後繼續**：
> 1. 進 Play Console → 建立應用程式
> 2. 上傳 `app-release.aab`
> 3. 填寫 store listing（說明、截圖、分類等）
> 4. 發布到正式軌道
>
> **⚠️ 注意事項**：
> - Node 24 兩台電腦都是，**不要用 Bubblewrap**（相容性問題）
> - PWABuilder 網頁版（pwabuilder.com）今天整天 queue 卡死，未來再試也可能不穩定，優先用手動 Android Studio 方案
> - JDK 查 fingerprint 要用 JDK 17（`C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot\bin\keytool.exe`），JDK 25 的 keytool 有 bug

### 🔖 交接（2026-06-17 v0.9.1 — 改名同步排行榜 + 每日長征 + v0.9.0 UI 大改）

**開工第一件事：`git pull`。**

> **v0.9.1 本次完成**：
> - **#1 改名同步排行榜（Method A）**：
>   - `scripts/migration_user_profiles.sql` — 需在 Supabase Dashboard SQL Editor 執行一次。建立 `user_profiles` table（RLS: 公開讀 / 只能 upsert 自己）及 `daily_scores_ranked` VIEW（COALESCE 取 user_profiles 最新暱稱覆蓋原快照名）。
>   - `src/lib/leaderboard.ts`：排行榜查詢改用 `daily_scores_ranked`（一字之差，其餘不變）。
>   - `src/lib/auth.ts`：新增 `updateProfileName(name)`，upsert 到 `user_profiles`。
>   - `src/screens/Home.tsx`：`handleSaveName` 呼叫 `updateProfileName`（fire-and-forget，不擋 UI）。
>   - **效果**：在設定視窗改暱稱後，過去所有成績在排行榜上立刻顯示新名稱。
>   - **⚠️ 待執行**：`scripts/migration_user_profiles.sql` 尚未在 Supabase 執行，目前改名仍無效。需進 Supabase Dashboard → SQL Editor → 貼上腳本 → Run。
> - **#9 每日長征**：
>   - `src/lib/longTrack.ts`：`fetchLongTrack(date)` — seeded LCG 從 `fetchDailyMapList` 全市場 pool 中選 5 支，各自 `fetchStockDailyMap` 取盤中走勢，正規化為開盤比值（開盤=1.0）後線性過渡串接（12pt connector），promise 快取同一天只打一次。
>   - `src/data/tracks.ts`：`TrackData.mode` 加 `"long"` union。
>   - `src/TrackSelect.tsx`：近月日線 tab 改為「每日長征」tab；搜尋/排序 toolbar 只在前日盤勢顯示；長征點擊後載入 → `onPick({ mode: "long", ... })`。
>   - `src/game/GameCanvas.tsx`：加 `hideMinimap?: boolean` prop；長征模式結算不顯示「走勢圖 →」切換（路線由多股組成，無單一走勢圖）。
>   - `src/App.tsx`：`hideMinimap={track.mode === "long"}` 傳入 GameCanvas。
>   - 自選賽道月線精選 24 支資料仍保留在 `tracks.ts`（RandomSlot 隨機 fallback 仍在用）。

> **v0.9.0 上次完成**：
> - 設定視窗大改版：暱稱確認鈕（字串有改才亮起）、登出移至底部加二次確認、版本號與更新日誌同排。
> - Phase 5 PWA 離線快取：每日地圖 StaleWhileRevalidate 24h，排行榜 NetworkFirst 5s timeout。
> - 夜景城市天際線背景（視差 0.12x，seeded 建築群無縫循環）。
> - HUD 左上顯示難度星等（★☆）。
> - 爆炸粒子強化：42 顆 + 雙速度層 + 品紅/紫色系。
> - 自選賽道排序按鈕加 ↑↓ 方向切換。
> - 排行榜時間顯示到毫秒（3 位小數）避免撞秒。

> **v0.8.0 本次完成**：
> - **Phase 6 音效（`src/game/audio.ts`）**：Web Audio API 純程式合成，不需外部音檔。5 個音效函式：`playFlip`（後空翻，sine 上揚）、`playPerfectLanding`（C5→E5→G5 琶音）、`playCrash`（白噪音爆炸聲）、`playFinish`（C4→E4→G4→C5 凱旋琶音）、引擎持續音（`startEngine/updateEngine/stopEngine`，鋸齒波動態調頻）。全部接入 `GameCanvas.tsx`。
> - **Android 返回鍵 race condition 根治**：History listener 集中至 `App.tsx` 單一 `useEffect([], [])`，消除子頁面 ↔ 首頁切換期間的 listener 空窗期。子頁的 `pushState/popstate` 全部移除（`DailyChallenge`、`RandomSlot`、`TrackSelect`、`Home`）。
> - **桌機 PWA 關視窗確認**：`beforeunload` listener 同在 App.tsx 單一 effect 中，關視窗時跳瀏覽器原生「離開網站？」確認框。
> - **排行榜重整鈕**：DailyChallenge 右上角 ↻ 按鈕，`invalidateDailyTop` 清快取後重抓。
> - **山峰頂點卡車 bug 修正**：`buildTerrainBodies` 偵測峰頂（左右鄰點都比當前頂點低），峰頂端點不加 `topExtra`，消除小突起牆。

> **v0.7.2 上次完成**：
> - **自選賽道 串 Supabase**：清單從 `daily_map` 動態讀取（~1000 支），前日盤中走勢 tab 不再侷限內建 24 支；無限捲動（每次多顯示 30 筆，`IntersectionObserver` sentinel）。
> - **隨機拉霸 串 Supabase**：pool 從 `fetchDailyMapList` 取得，每次轉動 30 格（29 隨機 + 1 得獎），不再只抽 24 支。
> - **nextDay UTC fix**：`nextDay()` 改用 `Date.UTC()` 純整數運算，修正 UTC+8 時區下 +1 天算出同一天的 bug（導致自選/隨機一直讀到空資料 fallback 24 支）。
> - **首頁返回鍵 fix**：`doLeave` 從 `history.go(-2)` 改 `go(-1)`，修正確定離開後仍留在頁面 + 返回鍵永久失效。
> - **Service Worker skipWaiting**：`vite.config.ts` 加 `skipWaiting: true` + `clientsClaim: true`，新版部署後重整一次即生效，不需關所有分頁。

> **v0.7.1 上次完成**：
> - **Google One Tap 登入**：`signInWithGoogle()` 改用 One Tap（hashedNonce = SHA-256 hex → GSI；rawNonce base64 → Supabase）；GSI 封鎖時 fallback redirect。首次登入自動帶入 Google 顯示名稱。
> - **DailyChallenge 排名賽頁**：未登入顯示 Google 登入按鈕；已登入顯示「以 [暱稱] 參賽」；⚙ 可改暱稱或登出。
> - **OAuth redirect 返回誤彈修正**：`Home.tsx` popstate 加 `isOAuthReturn` 偵測，壓制 OAuth 返回後第一次 popstate。
> - **每日地圖全台股**：GitHub Actions 每日 21:05（台灣時間）抓全台上市股（~1000 支）存 `daily_map`，難度最高者為當日排名賽地圖。
> - **排行榜快取**：Promise 快取零等待；提交成績後自動清除當日快取。

> **🟠 下一步選項**：
> - Phase 5：PWA 離線快取（Service Worker + IndexedDB）
> - Phase 6 視覺打磨（音效已完成 v0.8.0）：粒子特效優化、霓虹光暈、難度分級 UI
> - Phase 7：TWA 包裝 + Google Play 上架
> - 未來：ETF 含字母代號（00981A 等）納入每日地圖（filter 從 `/^\d{4}$/` 改 `/^\d{4}[A-Z]?$/` 即可）

---

### 🔖 交接（2026-06-16 v0.4.2 — 填滿地形 + discussion 14 點處理）

**開工第一件事：`git pull`。**

> **真機試玩回饋（已修，v0.4.1 + v0.4.2）**：使用者真機確認「整體非常像 Rider、流暢、K 棒風格 OK、返回邏輯正確」。修掉的 bug：
> - **卡 K 棒縫隙（高處落下偶發）**＝Matter.js internal-edge 卡頓。**兩段式修法**：
>   - **v0.4.1**：梯形**底部兩角各外擴 `overlap=segmentWidth`**（上窄下寬），相鄰梯形接縫正下方重疊成實心聯集 → 消除外露垂直內部邊。node 實測峰/谷 union 頂面與折線誤差=0，手感視覺不變。（大幅降低但仍極低機率殘留）
>   - **v0.4.2（root fix）**：`bike.ts` chassis 改 `collisionFilter:{ group, mask:0 }` → **車身完全不碰地、只由雙輪碰地**（Hill Climb 標準）。少了會在接縫頂點被夾的 chassis 碰撞體即根治。填滿地形無縫，故車身不碰地不會穿落。**注意**：`chassisContacts` 現恆 0（不影響著地判定，用前後輪）。
> - **首頁標題與排行榜/設定鈕重疊** → `.select-screen` padding-top 3.8rem；**遊戲內暫停鈕與返回鈕重疊** → `.pause-btn` top 3.4rem。
> - #7 決策：只做 robots.txt 不索引＋不宣傳網址；認 Play 包 Token 留到最後期。#8 資安僅記錄，以後處理。

> **本次大改（v0.4.0）**：依使用者整理的 `discussion.md`（14 點）一次處理。核心＝**地形碰撞體從「旋轉矩形沿法線偏移」改為「實心填滿梯形」**（使用者提案，視覺 A = K 棒柱）。

**v0.4.0 已完成（對應 discussion 編號）：**
- **#2/#4/#12 地形填滿（根治隱形牆／卡轉折）**：`buildTerrainBodies` 改成每段一個 `Bodies.fromVertices` 凸梯形——上緣=折線、兩側垂直、下緣拉到 `maxY+800`。相鄰梯形共用垂直邊 → 零縫、零凸角、頂面=折線本身。已用 node 實測 `fromVertices(Vertices.centre,...)` 世界頂點與輸入完全吻合（單一凸 part）。舊「矩形法線偏移」造成的頂點翹角＝隱形牆，已消除。**注意**：`buildTerrainBodies(track)` 不再吃 thickness 參數。
- **視覺 A**：`drawTrack` 每段填成 K 棒柱（漲紅/跌綠/平青，頂部實往下淡出）＝所見即所撞。若覺得醜可改 B（只留頂線）/C（漸層），fill 顏色在 `constants.ts` COLOR.fillUp/Down/Flat*。
- **#3 線段顏色**：`terrain.ts` 改用**最終頂點 y 方向**上色（dy<0=紅/dy>0=綠/平=青），不再用原始 price（夾平後會與視覺坡向不符）。
- **#1 死亡門檻**：新增 `RULES.crashTipCos=0`，crashZone 只在車身**翻過 90°**（cos<0）才啟動，與 `uprightCosThreshold`(0.55，後空翻計分用)分離。爬陡坡前傾不再被戳死。
- **#5 分數不倒退**：新增 `maxDistScore`，行進分只增不減（向後滑不扣回）。
- **#9 完賽顯示**：新增 `totalFlips`/`perfectLandings`，結算畫面顯示「翻轉 N 圈・完美落地 N 次」。
- **#11 首頁設定鈕**：右上版本號 → ⚙ 設定 modal（音量待實作＋版本＋更新日誌入口）。
- **#13 暫停＋返回確認**：遊戲右上「返回主選單」下方加暫停/繼續鈕（彈窗/暫停時凍結物理＋計時）；遊玩中按返回→確認彈窗；**裝置返回鍵**（popstate）：遊戲中→確認離開賽道、首頁→確認離開 App（leavingRef + `history.go(-2)`）。
- **#14 排行榜佔位**：首頁左上 🏆 排行榜鈕 → 「敬請期待」modal。

> **⚠️ 待真機驗證**：#13 裝置返回鍵（popstate 攔截）桌機 build/typecheck 過，但 **Android/TWA 實體返回鍵需真機測**。preview 隱藏分頁 rAF 暫停，無法驗證遊玩；用 `window.__test` 手動步進或真人可見分頁玩。
> **🟠 仍待討論（見對話末）**：#7 網頁版偷玩、#8 資安、#10 每日挑戰+廣告+IAP → 已記錄於「未來規劃」。另 chassis `mask=0`（只讓輪子碰地）為填滿方案的**備援保險**，本次未做（先看填滿是否已足夠）。

---

### 🔖 交接（2026-06-16 凌晨 v0.3.7）

**開工第一件事：`git pull`。**

> **⚠️ 圖片注意**：`public/bike.png`（610×409 去背霓虹重機）已在 repo，貼圖生效。
> 對位微調參數：`BIKE.spriteW / spriteOffsetX / spriteOffsetY`（在 `src/game/constants.ts`）。

> **⚙️ 驅動模型（重要）**：使用者確認 **Rider 是「街機定速」**—— 地面速 = 空中速 = 固定 N，不需要 boost。
> 故移除整個 launchBoost / groundedStreak 系統；低重力 0.3 取代 boost 給予充足空中翻轉時間。

**目前驅動 / 手感（定速引擎 + 兩輪取坡）：**
- **驅動（坡面切線鎖速）⭐ 核心模型**：著地按住 → 取「後輪→前輪連線方向（坡面切線，tx 永遠 > 0 = 恆朝前）」的速度分量，ease 到 `cruiseSpeed=5.76`（`groundLockEase=0.7`）。任何坡角同速；過坡頂保留垂直速度 → 自然飛出去。無 boost，地面速 = 空中速。
- **法線速度歸零（吸地消彈跳）**：著地時每步把「垂直坡面朝外」的速度分量歸零（法線=(ty,-tx)，只移除 vn>0 的離坡分量）。消除 Matter.js 碰撞微彈。
- **低重力**：`engine.gravity.y = 0.5`（飛行時間長，翻轉窗口寬）。
- **離地歸零殘留角速度**：消除爬坡貼坡帶上來的「莫名往後翻」。
- **空中操控**：按住＝後空翻（`airSpinMax=0.192`、`airSpinAccel=0.024`）；放開＝線性制動 (`airSpinBrakeAccel=0.06`, ~4步停) 再微微前壓（`airNoseForwardAccel=0.0006`、`airNoseForwardMax=0.008`）。
- **前壓配重**：前輪 `frontWheelDensity=0.0030` > 後輪 `0.0012`。
- **落地/對齊**：著地角速度朝坡面切線修正（`groundAlignGain=0.3`，夾 `groundedAvMax=0.15`）；`restitution=0.05`。
- **chassis 改圓形（`Bodies.circle(r=10)`）**：圓形碰撞體接觸力永遠過圓心 → 不產生旋轉力矩 → 不被坡頂稜角頂抖、不自動翻正；`friction=0, restitution=0`；已取消 `mask:0`（原修法造成 chassis 穿地 → constraint 把輪子也帶進縫隙穿落）。
- **地形**：`segmentWidth=80`、`heightRange=420`、`refPct=0.022`；折線維持原汁原味。
- **V 谷平底**：h1×h2 > segW² 的谷底插入 80px 平段。
- **地形碰撞體（零縫隙⭐新）**：矩形（法線偏移貼線）＋每個頂點加圓形（`Bodies.circle(r=13)`）填縫。圓心在頂點正下方 13px、圓頂與地形面齊平，數學上完全填滿任何角度的接縫，無台階。三角形方案（Bodies.fromVertices）已廢棄，因三角頂點附近極細（<1px），速度 6.9px/step 直接隧穿。
- **完美落地**：`airRotation > 1.7π` + 真實跳躍 + 坡面夾角 < `perfectLevelRad=0.55`(≈31°)。坡面角改用 `slopeAt(track, chassis.x)` 取代兩輪插值（更穩定）。計分 = `Math.max(1, flips) × 100`（依圈數，最少 100）。
- **結算迷你圖**：以 `prices[0]`（開盤價）為基準：高於開盤=紅、低於開盤=綠、等於=青；含虛線基準線。
- **結算畫面**：`.overlay-result`（透明讓出中段折線圖區域）；進結算 HUD 全隱藏；完賽車體凍住。
- **死亡判定（⭐車頂碰地即死）**：`BIKE.crashZone`（5 個局部座標點，前擾流→風鏡→油箱→座椅前/後緣）每 step 轉為世界座標，任一點 `worldY > terrainYAt(track, worldX)` → 判死（`crashUpsideDownSec=0.1s` 緩衝消除單幀誤判）。刻意不延伸到尾殼，避免陡坡朝上時屁股誤觸前一段地形。另保留 `stuckMidAir`（雙輪離地 + 速度<0.5）處理卡谷等邊緣情況。
- **`slopeAt` / `terrainYAt` 修正**：改二分搜尋，修正 V 谷插入後 x 不均勻時 `floor(x/segW)` 索引錯誤的既有 bug。
- `public/bike.png` 已就位（610×409 去背），貼圖生效。

**死亡特效（v0.3.4~0.3.5）：**
- 翻車觸發後 0.1s：車身位置爆出 28 顆粒子（琥珀/青/白），速度 1.5-5.5px/step，重力 0.1，1.5s 動畫
- 同時：白色全屏閃光（×0.72/幀）+ 鏡頭震動 8px（×0.82/幀，暫時偏移不汙染 camX/camY）
- `dying=true` 期間：HUD 全隱，鏡頭凍在爆炸現場；1.5s 後進結算
- crashZone 加 `!upright` 前提：正立不觸發，消除山峰刺穿誤判

**結算畫面切換（v0.3.6）：**
- 預設顯示賽道全覽（不疊走勢圖）
- 點擊中段大區域 → 瞬間切換走勢圖（黑底純折線）；再點切回
- 小膠囊 badge 顯示「走勢圖 →」/「← 賽道」提示

**地形碰撞修正（v0.3.7）：**
- 移除頂點填縫圓（`Bodies.circle` at vertices）→ 消除轉折點隱形牆彈射
- 矩形兩端各 +3px（`segLen+6`）重疊取代圓填縫，無凸角、無彈射

**否決狀態更新**：允許「放開＝緩緩前壓」這一種空中自動微旋；其餘不要。

---

#### 🟡 仍待辦

1. **手感 tune**（依試玩回饋調整 `src/game/constants.ts` 的 DRIVE/BIKE/TRACK）
2. （選配）Grok 建議的折線尖角 Catmull-Rom 平滑（本次未做，避免尖角卡輪）
3. ~~**Phase 3（三模式 UI）**~~ ✅ v0.5.0 完成（每日排名賽／隨機拉霸／自選）
4. 更多股票預抓（v0.4.3 已補到 24 支：原 14 + 長榮/陽明/萬海/台達電/日月光/中信金/富邦金/台塑/瑞昱/00878；可再補。指令 `node scripts/fetchTwse.ts monthly <code> 3` + `intraday <code>`，再接進 `tracks.ts`）
5. **v0.4.0 待真人試玩確認**：填滿地形是否徹底消除卡頓／隱形牆；若 chassis 仍偶卡谷底，啟用備援 chassis `mask=0`（只輪子碰地）。
6. **discussion #13 真機測**：Android/TWA 實體返回鍵的 popstate 確認流程。

#### 🟠 未來規劃（discussion 記錄，待決策／Phase 4 後端）

- **#7 網頁版偷玩**：`taiexrider.pages.dev` 永遠公開，TWA 只是包這個 URL，技術上封不掉。對策上限：robots.txt 不索引、不公開宣傳 URL、Phase 4 後端對每日資料加 Token（只認 Play 包請求）。MVP 不值得做，接受現實。
- **#8 資安**：目前純靜態 PWA 幾乎無風險（無後端、無 SQL、資料全公開股價）。風險點在 Phase 4 後端：Supabase RLS 要設對、API key 絕不放前端 bundle（走後端 proxy）。
- **#10 每日挑戰 + 廣告 + IAP（商業模式）**：基本分＝跑完即固定底分；加分＝完美落地次數×N；**同分用時間排名**（越短越前）；死亡→看 15s 廣告復活一次；IAP＝買斷永久去廣告。需 Phase 4 後端 + 排行榜 API；廣告 AdMob、IAP Google Play Billing。**結算已先備好 totalFlips/perfectLandings/timer 三項數據，排名所需欄位齊全。**

#### 已完成（Phase 2 至今）
- 抓資料腳本 `scripts/fetchTwse.ts`（`stock` 個股日線 / `taiex` 大盤每5秒降採樣，`node scripts/fetchTwse.ts ...` 直跑）。
- 4 條真實樣本 JSON（`src/data/sample-*.json`）＋ `tracks.ts` 清單 ＋ `TrackSelect` 選賽道畫面 ＋ `GameCanvas` 改吃 `prices/label/onExit` prop、可換賽道。
- 大盤 `MI_5MINS_INDEX` 格式已實測（每5秒 ~3241 點、欄位1=加權指數；見 DEVDOC 3.1）。

#### 還沒做 / 待續（讓明天的你/Claude 一目了然）
- 上面第 1~4 項回饋（第 5 項已修完）。
- Phase 2 收尾：每日大盤挑戰模式串接、更多代號/自由搜尋。
- in-app 即時抓取 → 需 **Phase 4** 後端（CORS）；現用打包樣本。
- Phase 3（三模式 UI）、Phase 5（離線快取）、Phase 6（視覺音效+難度分級）、Phase 7（TWA 上架）見 DEVDOC 第 8 節。

#### 測試提醒
preview 是隱藏分頁、`requestAnimationFrame` 被瀏覽器暫停 → 主迴圈不會跑（看起來像車不動）。用 `GameCanvas.tsx` 內 `import.meta.env.DEV` 的 `window.__test`（step/press/release/reset/state）手動步進驗證；真人用可見分頁玩一切正常。

---

- **Phase 0 ✅ 完成**（2026-06-14）：Vite+React+TS+PWA 骨架可跑，neon 標題畫面，`tsc -b` 零錯誤，首次 push 完成。
- **Phase 1 🟡 prototype 完成、待真人試玩調手感**（2026-06-14）：
  - 假資料 → 霓虹賽道地形（`terrain.ts`，正規化+斜率夾平）。
  - Matter.js 機車（`bike.ts`，車身+雙輪+軸約束）。
  - 單指操控：著地按住=前進力驅動、空中按住=後翻、放開=滑行/停轉（`GameCanvas.tsx`）。
  - 鏡頭跟隨、後空翻計分、摔車偵測、HUD、結束 overlay、R 重來。
  - 已驗證：可前進、空中可後翻、著地保持正立、無 console error。**手感數值（`constants.ts` 的 DRIVE/BIKE）待真人玩過再 tune**。
- **Phase 2 🟡 進行中**（2026-06-15）：
  - `scripts/fetchTwse.ts`：Node 24 直跑(.ts)，抓 TWSE `STOCK_DAY` 個股日線（後端/腳本抓無 CORS）。已驗證可抓真實資料。
  - 預抓 2330 近 3 個月 → `src/data/sample-2330.json`（50 個交易日，收盤 1810~2425，最大單日 +6.56%/-2.96%）。
  - `src/data/currentTrack.ts` 載入樣本 → 接進 `GameCanvas`（取代假資料）。
  - 已用 __test 驗證：可騎完整條真實 2330 賽道、得分 600、有完美落地。
  - **大盤 `MI_5MINS_INDEX` 格式已實測**：每5秒、一天 ~3241 列、欄位1=發行量加權股價指數；腳本降採樣到 110 點。
  - 預抓 4 條樣本：TAIEX(大盤,平緩) / 2330 / 0050 / 2454(投機飆股,狂野)。**資料性格**：個股越投機點間波動越大(2454 平均4.7%、天天漲跌停)；大盤盤中反而最平(0.12%)。
  - **賽道選擇畫面**(`TrackSelect`)：可選 4 條真實賽道進遊戲、可換賽道。已驗證選單↔遊戲往返正常。使用者選**保留原汁原味**(不放大地形)。
  - 待辦：更多代號/自由搜尋、每日大盤挑戰串接、in-app 即時抓取(Phase 4 後端解 CORS)、個股長度(現 3 個月)。
- 後續 Phase 2~7 見 [DEVDOC.md](DEVDOC.md) 第 8 節 Roadmap。

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

### 🧪 測試踩雷：preview 分頁是隱藏分頁，rAF 被瀏覽器暫停
- 用 preview 工具驗證時，分頁 `document.hidden=true` → `requestAnimationFrame` 不會 fire → 遊戲主迴圈整個停住（看起來像「車不會動」，其實是迴圈沒跑）。screenshot 也會 timeout。
- 解法：`GameCanvas.tsx` 有 `import.meta.env.DEV` 下的 `window.__test` 鉤子（step/press/release/reset/state），可**手動步進**物理來驗證，繞過 rAF。真人用可見分頁玩則一切正常。

### Phase 1 v2 調整（2026-06-14，依真人回饋）
- 速度 ×1.2；機車→**敞篷跑車**(露頭/小輪/寬輪距低重心)；假資料加**漲停/跌停級跳台**(真實滯空~1.6s)；分數移到**螢幕正中上方**；後空翻/完美落地有 toast。
- **完美落地**：真實跳躍後車身接近水平著地(`perfectLevelRad`≈28°，越小越嚴格)＝+200，**雙輪冒 cyan 擴散光環+火花特效**。註：陡跳台+單鍵控制使「完全水平」很難，故門檻設28°；已驗證可觸發(實測落地5°~-21°)。
- 手感終值：`airSpinMax`=0.12、`airSpinDelaySteps`=4(≈0.07s)。
- 已用 __test 手動步進驗證：前進/真實滯空/後空翻計分(2圈350)/重置 皆正常。車體外觀與手感需真人可見分頁試玩。
- **後翻敏感度修正**（依回饋）：加「騰空寬限」(`airSpinDelaySteps`)＝離地連續超過 ~0.08s 才開始後翻，小坡微彈跳不再亂翻（越小越靈敏）；後翻轉速調soft(`airSpinMax` 0.22→0.10，約 0.9 圈/秒)。後翻旋轉速與車速為**獨立參數**(旋轉=`airSpinMax/Accel`，車速=`accel/maxSpeed`)。已驗證平緩跑道穩定前進不亂翻、真實跳台仍可後翻。

### 待 Phase 2 實測確認
- `MI_5MINS_INDEX` 實際回傳欄位格式與解析度（5 分 vs 5 秒）。
- 個股賽道資料長度（固定近 3 個月，或讓玩家選 1/3 個月）。
