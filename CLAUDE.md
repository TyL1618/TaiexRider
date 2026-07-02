# TaiexRider — 專案守則與進度

> 把台股前一交易日走勢轉成 2D 霓虹機車賽道的單指小遊戲（PWA → TWA 上架 Google Play）。
> 完整設計規劃見 [DEVDOC.md](DEVDOC.md)。歷史交接紀錄（舊決策脈絡）見 [History.md](History.md)。

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

### 📊 Google Play 封閉測試進度（2026-07-02 更新）

- **12 名測試者已於 2026-06-25 湊齊**（滿足門檻，不再是卡關項目）。
- **連續 14 天計時從 2026-06-25 起算**，預計 **2026-07-08** 滿 14 天，之後可申請升正式版。
- 期間內不要讓測試者流失/退出安裝，維持連續達標。封測期間**求穩優先**，不動搖排行榜公平性與已上線功能穩定度。

### 🤝 本週交接（2026-07-02）：[FABLE5_HANDOFF.md](FABLE5_HANDOFF.md)

由 Fable 5 主責處理本週工作，任務清單（debug／監控／反作弊／內容／文件重整）整份在該檔，開工先讀那份。

### ✅ 本週進度（2026-07-02，Fable 5）

- **v0.12.1 已推**：Debug #1（完美落地漏判）+ Debug #2（卡地形夾縫）雙修，皆以 headless 模擬先驗證再動手：
  - 卡地形：`scripts/simStuck.ts`（esbuild 打包直吃遊戲本體 terrain/bike/constants，6000 局 × 3 種輸入 bot）。根因＝**淺尖 V 谷**（h2<80px 沒被舊平底規則涵蓋）輪子楔入。修法＝`terrain.ts` 淺尖谷插 40px 小平底，卡住率 7.4%→0.6%（內切圓方案實測無效已棄）。
  - 完美落地：`scripts/simPerfect.ts` 證實微觸地清空 airRotation 造成漏判 85%。修法＝`GameCanvas.tsx` 落地**延遲結算**（連續 4 步著地才給分、擦地不清旋轉不煞停），漏判 →5%。
  - 模擬工具保留（`sim-build/` 已 gitignore），改物理/地形後可回歸驗證：`./node_modules/.bin/esbuild scripts/simStuck.ts --bundle --platform=node --format=cjs --outfile=sim-build/simStuck.cjs && node sim-build/simStuck.cjs 2000 safe 1 none`。
  - **⚠️ 未真機試玩**：落地手感（67ms 延遲結算的 toast 時機）與淺谷平底的視覺需真人確認。
- **v0.12.2 已推**：全面資安檢查（報告 [SECURITY_REVIEW.md](SECURITY_REVIEW.md)，prod 依賴 0 漏洞、dev 漏洞已修餘 2 個接受）+ 監控雛形上線（`src/lib/analytics.ts` 打點 run_start/death/finish/revive，分析查詢 `supabase/analytics_queries.sql`，隱私權政策已同步補充匿名統計條款）。
  - **⚠️ 使用者待辦 ①**：Supabase SQL Editor 跑 **`supabase/migration_20260702.sql`**（events 表 + log_event RPC + 資安補強，一次跑完）。沒跑之前打點靜默失敗、不影響遊戲。
  - **⚠️ 使用者待辦 ②**：確認 `taiexrider-release.jks` + 密碼已備份雲端（SECURITY_REVIEW 🔴 項）。
  - **⚠️ 使用者待辦 ③**：Play Console 資料安全表單日後更新時補「App 互動資料（匿名統計）」聲明（非急件，正式版送審前弄即可）。
- **上架前置 + ASO**：[LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md)——技術面已遠端驗證 ✅（privacy/assetlinks/OG/CI 全正常），Play Console 目視清單 + 7/8 申請流程 + ASO 三版文案（建議：標題 A、簡短 B）供挑選。
- **設計文件**：[ANTICHEAT_DESIGN.md](ANTICHEAT_DESIGN.md)（四層防禦三階段 rollout，未實作）、[RETENTION_PLAN.md](RETENTION_PLAN.md)（留存三批實作排序，等勾選）。
- **v0.12.6 已推**（android/ 三項 + 深連結）：App 捷徑 shortcuts.xml、splash 品牌圖（SPLASH_IMAGE_DRAWABLE+FileProvider）、預測性返回 enableOnBackInvokedCallback；前端 `?goto=` 深連結（preview 實測 OK）+ PWA manifest shortcuts。**⚠️ android/ 部分 push 無效——需手動：複製 `android/` 改動到 Android Studio 專案 → versionCode 7 → Generate Signed Bundle → 上傳 Play Console**（詳 DEVDOC §9.1.1）。**⚠️ 重包後真機必測返回鍵**（預測性返回與 popstate 可能打架，出問題先拿掉該屬性）。
- **v0.12.5 已推**（曝光度）：index.html 補 meta description + OG + Twitter Card（`public/og-image.png` 由 `scripts/genOgImage.mjs` 生成，1200×630 霓虹 K 棒風）；結算畫面加「📤 分享成績」（navigator.share → 剪貼簿 fallback，文案連動股票名與完賽/摔車，`share` 事件有打點）。**⚠️ 分享按鈕/面板需真機測**（preview 隱藏分頁進不了結算畫面）。
- **v0.12.4 已推**（原生體驗+拉霸音效）：震動回饋（haptics.ts，按鈕全域委派/撞車/完美落地）、`overscroll-behavior:none`、GameCanvas+Matter.js 拆 chunk 延遲載入（主 bundle 560→452KB，2.5s 背景預熱）、拉霸機咖咖咖 tick+哐收尾音效（跨格觸發、35/s 上限、接音量系統）。preview 實測：lazy 進遊戲正常、__test 步進物理正常且新完美落地邏輯有觸發、console 零 error。**⚠️ 震動/音效手感需真機**。
- **v0.12.3 已推**（BETA #1+#3）：地形高度加「全日振幅」驅動分量（`ampRefPct=3.5%`，盤中賽道不再全壓在 heightMin；TAIEX 平緩盤不變；simStuck 回歸 0.7% 通過）；每日地圖選取對資料點 <50 的股票難度打 1 折（一字板失格，**下次 16:00 CI 起生效**）。查證：#3 選取公式（振幅×折返）6/23 已上線，本次只補失格條件；#1 舊縮放只看單步漲跌，對盤中資料無效是「太平緩」根因。**⚠️ 地形變高未真機試玩**，若手感過激回調 `ampRefPct`（調大=變矮）。

**本週已定案的補充決策（2026-07-02 與使用者討論）**：
- **監控**：Supabase `events` table + 前端 fire-and-forget 上報 + 附分析用 saved queries；之後做**遊戲內隱藏統計頁**（連點版本號 5 下開啟，權限用後端 `auth.uid()` 驗證，不做 PyQt6 桌面程式）。建表 SQL 需使用者手動在 Supabase SQL Editor 跑。
- **留存設計**：方向全數保留、分批實作（分享卡／經典獎牌制／streak／死亡熱點先行；週任務／股票圖鑑／經典週榜次之；週聯賽／ghost 回放長期），詳見留存規劃文件（待產出）。

---

## 待辦

- **本週任務**：見 [FABLE5_HANDOFF.md](FABLE5_HANDOFF.md)「建議優先順序」（debug 卡地形/完美落地、資安檢查、監控、內容改善、原生體驗、拉霸音效、OG/分享、反作弊設計、留存規劃、android/ 三項、上架檢查、ASO）。
- **封測回饋待辦**：見 [BETA_FEEDBACK.md](BETA_FEEDBACK.md)（#3 地圖選取邏輯、#1 波動率動態地形為高優先；#4 前翻、#2 多車型為中）。
- **廣告第二階段（正式上架後）**：填入真實 `ADSENSE_PUB_ID`（`ca-pub-8981745966447649`）→ 網頁版 AdSense 生效；復活按鈕先播廣告再 `requestRevive()`；Android 原生層串 AdMob Rewarded（TWA intent bridge）。
- **TWA splash 主解（A 方案，需重包 AAB）**：androidbrowserhelper splash 圖 + Android 12+ `windowSplashScreenBackground=#05080f`，徹底遮啟動網址列空窗（前端 B 方案 inline splash 已做，v0.11.1）。
- **待真機驗證累積項**：v0.12.0 懸空計時/復活、v0.11.0 TWA 返回離開、經典模式 12 條地形手感。

#### 🟠 未來規劃（discussion 記錄，待決策／Phase 4 後端）

- **#7 網頁版偷玩**：`taiexrider.pages.dev` 永遠公開，TWA 只是包這個 URL，技術上封不掉。對策上限：robots.txt 不索引、不公開宣傳 URL、Phase 4 後端對每日資料加 Token（只認 Play 包請求）。MVP 不值得做，接受現實。
- **#10 每日挑戰 + 廣告 + IAP（商業模式）**：基本分＝跑完即固定底分；加分＝完美落地次數×N；**同分用時間排名**（越短越前）；死亡→看 15s 廣告復活一次；IAP＝買斷永久去廣告。需 Phase 4 後端 + 排行榜 API；廣告 AdMob、IAP Google Play Billing。**結算已先備好 totalFlips/perfectLandings/timer 三項數據，排名所需欄位齊全。**

- **廣告雙軌架構（2026-06-23 決策，正式上架後實作）**：
  - **Android APK（TWA）** → AdMob 原生 SDK（Rewarded Ad，死亡復活）
  - **網頁版 / iOS Safari** → Google AdSense（Interstitial 插頁式）；iOS 用戶直接用 Safari 開 `taiexrider.pages.dev`，繞過 Apple 30% 抽成，不需上架 App Store
  - **避免雙重廣告**：TWA/網頁分流偵測已做（`src/lib/ads.ts`，display-mode 偵測，referrer 在此 TWA 不可靠）
  - **實作順序**：正式上架 → 同時申請 AdMob + AdSense（各 24-48h 審核）→ Android 串 AdMob Rewarded → 網頁串 AdSense + TWA 偵測 → IAP 去廣告買斷（Google Play Billing）
  - **宣傳時機**：正式上架即可宣傳，不用等廣告上線；廣告作為 2-3 週後的第二版更新，本身也是二次宣傳機會
- **ETF 含字母代號**（00981A 等）納入每日地圖：filter 從 `/^\d{4}$/` 改 `/^\d{4}[A-Z]?$/` 即可。

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

### 🧪 測試踩雷：preview 分頁是隱藏分頁，rAF 被瀏覽器暫停
- 用 preview 工具驗證時，分頁 `document.hidden=true` → `requestAnimationFrame` 不會 fire → 遊戲主迴圈整個停住（看起來像「車不會動」，其實是迴圈沒跑）。screenshot 也會 timeout。
- 解法：`GameCanvas.tsx` 有 `import.meta.env.DEV` 下的 `window.__test` 鉤子（step/press/release/reset/state），可**手動步進**物理來驗證，繞過 rAF。真人用可見分頁玩則一切正常。
