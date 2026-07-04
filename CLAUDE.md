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

### 🚨 vc9 啟動崩潰事故（2026-07-02 晚，家裡，已修＝vc10）

- **症狀**：v9（versionCode 9）更新後點開秒退。adb logcat 定罪：`Resources$NotFoundException: Resource ID #0xff05080f` @ `LauncherActivity.getColorCompat`。
- **根因**：manifest 的 `SPLASH_SCREEN_BACKGROUND_COLOR` meta-data 用了 `android:value="#05080f"` 字面值——androidbrowserhelper 要求 `android:resource="@color/..."`（它把 int 當資源 ID 查表）。**6/22 c711996 就埋下**，但函式庫只在有設 `SPLASH_IMAGE_DRAWABLE` 時才讀背景色 → vc7/8 沉睡、vc9（v0.12.6 加品牌圖）引爆。**與兩台電腦不同步無關**，公司五檔複製忠實、AAB 打包完好。
- **修復**：manifest 改 `android:resource="@color/color_splash_bg"` + versionCode 10（repo `android/` 與 AS 專案已同步）。
- **✅ 已解決（2026-07-03 確認）**：家裡當晚已 Generate Signed Bundle 上傳 vc10 AAB 到 Play Console 封測軌道，真機更新後確認正常開機（不再閃退）。**vc9 事故已完全結案**。
- **公司 AS 專案已同步**：2026-07-03 把家裡帶回的 vc10 資料夾（`C:\Users\tyl16\Downloads\TaiexRider`）覆蓋到公司的 `C:\Users\tyl16\AndroidStudioProjects\TaiexRider\`（僅同步 `app/src` + `app/build.gradle.kts`，未動 `local.properties`/`.idea`/`.gradle` 等機器本地設定）。公司舊的壞版（vc9）備份在 `C:\Users\tyl16\AndroidStudioProjects\TaiexRider_old_vc9_broken`，確認無需回頭參考後可刪。**目前公司與家裡 AS 專案皆＝vc10 正統版本，且已上線**。
- **流程教訓**：上傳前先 Generate Signed APK 給 Claude `adb install -r` 真機驗證能開機，再上傳 AAB——不再盲上（此次事故正是繞過此步驟直接上傳才發生）。

### 🏠 帶回家待辦（2026-07-02 下午，家裡 Claude 從這裡接手）

> 開工：`git pull` → 讀這段。公司 session（Fable 5）已完成交接清單 13 項全部 + 下午加班場（見下方勾選）。

**已完成（下午加班場）**：
- [x] android/ 五檔已複製到 `C:\Users\tyl16\AndroidStudioProjects\TaiexRider\` + versionCode 9（repo 同步 9）。使用者負責 Generate Signed Bundle 上傳。⚠️ 裝機後必測返回鍵（預測性返回）＋splash 品牌圖＋長按捷徑。
- [x] Supabase `migration_20260702.sql` 使用者已跑（events 表已生效，數據開始累積）。

**待辦（照序做，每項完成必 commit+push）**：
- [x] 完美落地 A+C 已完成（v0.12.7 已推）
- [x] 留存①：PB 突破提示 + streak 連續參賽 已完成（v0.12.8 已推。PB=`tr_pb_{classic_id|mode_label}`，破舊紀錄結算亮 🎉；streak=`tr_daily_streak`，期別=sessionKey、≤5 天視為連續，DailyChallenge 顯示 🔥N 天+催玩提示，preview 驗證 OK）
- [x] 留存②：經典獎牌制 已完成（v0.12.9 已推。`src/lib/medals.ts` 從 PB（tr_pb_classic_*）推導 🥉1000/🥈1500/🥇2200 全關統一門檻，ClassicSelect 卡片顯示獎牌+我的最佳+下一目標，preview 驗證 OK。之後可依 events 分數分佈調每關門檻）
- [x] 留存③：分享卡視覺化 已完成（v0.12.10 已推。`src/lib/shareCard.ts` 1080² 離屏 canvas 圖卡（走勢紅綠+分數+統計+品牌），shareScore 三段 fallback：files share → 文字 share → 剪貼簿；動態 import 不進主 bundle；preview 像素抽樣驗證 OK。**⚠️ 真機測分享面板帶圖**）
- [x] 留存④：全服死亡熱點 已完成（v0.12.11 已推。**⚠️ 需使用者跑 `supabase/migration_20260702b.sql`**（含熱點 RPC + 統計頁 admin RPC，一份搞定）。`src/lib/deathHeatmap.ts` + DailyChallenge 20 格熱度條（對齊走勢圖）+ 遊戲內 top3 ☠️×N 標記；RPC 未建/無資料時優雅隱藏，preview 驗證 OK）
- [x] 隱藏統計頁 已完成（v0.12.12 已推。設定→連點版本號 5 下→StatsScreen；資料走 `admin_stats` RPC 綁 email，未登入/非 admin 顯示無權限。**⚠️ 依賴 migration_20260702b.sql；真機用開發者帳號登入後驗證有數據**）
**⚠️ 使用者待辦**：
1. ❓ Supabase SQL Editor 跑 **`supabase/migration_20260702b.sql`**（死亡熱點 + 統計頁 RPC；第一份 migration_20260702.sql 已跑過）——**尚未確認是否已執行**。
2. **✅ vc10 AAB 已於 2026-07-02 晚上傳封測軌道，真機驗證開機正常**。splash 圖／長按捷徑／返回鍵操作皆已真機確認 OK（2026-07-03）。**唯獨「預測性返回手勢動畫」本身還不確定是否測到**（需用手勢導覽從螢幕邊緣滑動才看得出效果，若手機是按鍵導覽則無從驗證）。
3. **✅ 真機測 v0.12.7~12 已確認**：完美落地合併 toast、PB 徽章、streak、分享圖卡（面板帶圖）、死亡熱點、統計頁，皆 OK（2026-07-03）。

**剩餘任務**：
- [x] **平地縫隙卡輪** 已完成（v0.12.13 已推，2026-07-03 公司）。模擬結論顛覆原假設：「平地-平地接縫」定點落下矩陣（新增 `scripts/simDrop.ts`，5000+ 組合）0 卡住；真因＝凹角/凸角/峰頂的**機械性卡死**（油門把輪子壓進轉角縫，放開即脫困）。修法＝GameCanvas **卡縫自動脫困 watchdog**（0.67s 零前進→自動放油門 1s→恢復），模擬驗證難度零影響（完賽率 1727 vs 1711/2000）。地形側 lip 方案會讓摔車率 14.5%→4.5%（難度大變）→ **封測期間不動，記錄在 DEVDOC §5.4b 供正式版後決策**。**⚠️ 待真機試玩確認脫困手感**（preview 無法造出卡死情境）。
- [x] **三項問題修復** 已完成（v0.12.14 已推，2026-07-03 公司，使用者當場回報）：
  1. 翻轉計分改線性＋倍率定案：每圈固定 +100（移除舊遞增制 `flipScoreStep`），完美落地＝剛才那趟翻轉分 ×2（2圈普通 200／完美 400）。preview 實測 toast 已驗證「完美落地 1 圈 +200」符合公式。
  2. 修正「尾段飛起來、飛越終點線時人還在空中」漏算翻轉分：完賽判定舊邏輯不管是否著地就立刻凍結車身，該趟翻轉/完美落地永遠沒機會落地結算。改為越線瞬間若翻轉未結算，用當下狀態強制呼叫共用的 `settleFlip()`（與一般落地路徑同一份邏輯，已驗證）。**⚠️ 此情境 preview 無法重現（需飛越終點線瞬間仍在空中，且 headless 難精準engineered），待真機試玩確認**。
  3. 修正摔車/完賽瞬間結算面板按鈕被誤觸（分享成績等）：面板出現後 350ms 內 `pointer-events:none`，避免手指還按著油門時面板換出、抬指剛好點到新按鈕。
  - `RULES.flipScoreStep`、`RULES.perfectBonus`（已無引用，死碼）一併移除。
- [ ] 留存後續批次見 [RETENTION_PLAN.md](RETENTION_PLAN.md)（週任務/圖鑑/經典週榜需使用者點頭 schema）
- [ ] **使用者稍後會用 Fable 思考其他新方向**，屆時任務可能再增加。

**計分定案（v0.12.14 取代 v0.12.7 A+C）**：圈數判定 `floor((|rot|+0.3π)/2π)`（差 0.3π 內進位）不變；翻轉分＝`圈數×100`（線性，不遞增）；完美落地＝翻轉分 ×2；toast 顯示合計。

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

> **2026-07-04 全面盤點**：[FABLE5_HANDOFF.md](FABLE5_HANDOFF.md) 清單裡 debug/監控/內容改善/原生體驗/拉霸音效/OG分享/留存規劃/android三項/上架檢查/ASO **全部已完成並上線**；[BETA_FEEDBACK.md](BETA_FEEDBACK.md) 的 #1/#2/#3 也都已解決。反作弊 Phase A 已於 2026-07-04 下午實作完成（待使用者跑 migration）——見下方「真正還沒做的事」第 1 項。

- **廣告第二階段（正式上架後）**：填入真實 `ADSENSE_PUB_ID`（`ca-pub-8981745966447649`）→ 網頁版 AdSense 生效；復活按鈕先播廣告再 `requestRevive()`；Android 原生層串 AdMob Rewarded（TWA intent bridge）；車庫「看廣告拿金幣」也要換掉 `ads.ts requestRewardedCoins()` 的 stub。
- **✅ 待真機驗證累積項已確認（2026-07-03）**：v0.12.0 懸空計時/復活、v0.11.0 TWA 返回離開、經典模式 12 條地形手感、v0.12.3 地形變高手感、v0.12.4 震動/拉霸音效手感，皆 OK。

### 🎯 真正還沒做的事（2026-07-04 盤點，非本週交接清單順序）

1. **反作弊機制**：✅ **Phase A 已實作**（2026-07-04 下午，Fable 5）——`supabase/migration_20260704.sql`（submit_daily_score / submit_classic_record 加欄位間物理一致性驗證 + 10s 提交冷卻 + 經典 level_id 白名單），**⚠️ 待使用者在 Supabase SQL Editor 手動跑才生效（push 不會更新 RPC）**。上線前已拿線上真實資料回測（27 筆 daily + 12 筆 classic，0 誤殺）；與 ANTICHEAT_DESIGN.md 原公式有三處刻意偏差（照抄會誤殺 16/27 筆真實成績）：分數上限加 slack +500 容忍 v0.12.14 前舊計分制的未更新客戶端（普及後可收緊）／時間下限改用「分數隱含行進比例」因摔車也會提交、不能假設完賽／冷卻 30s→10s 因實測完賽時間中位數僅 17s。理由全寫在 migration 檔頭與 ANTICHEAT_DESIGN.md 檔頭。Phase B（DB 端次數上限＋離群偵測）等正式上架後；Phase C（操作事件序列＋Ghost）跟留存規劃的 Ghost 回放一起做。**同日第二輪資安檢查也完成**（[SECURITY_REVIEW.md](SECURITY_REVIEW.md) 新增 2026-07-04 段落，涵蓋車庫/金幣/quests 等新系統；最重要結論：**P 系列 IAP 上線時擁有權必須伺服器端驗證**，不可沿用 localStorage 擁有清單，否則改個 localStorage 就免費解鎖付費車）。**同日晚場（使用者指示「漏洞不留到上架」）追加修補**：`supabase/migration_20260704b.sql`（log_event 三層節流修灌爆面 + cleanup_old_scores_if_needed 收權，**⚠️ 待使用者跑**；收權後 cron-job.org 的 cleanup 排程可刪、keepalive 保留，CI fetchDailyMap.ts 已接手每日呼叫）＋ `public/_headers`（nosniff/XFO/Referrer-Policy/Permissions-Policy 直接執法，CSP 先 Report-Only 觀察、真機 console 無違規後改名轉正）＋ GitHub Actions pin SHA。**localStorage 金幣/擁有清單竄改問題使用者明確不接受擱置**——同晚拍板：**伺服器端錢包＋每日 5 次上限搬 DB（consume_attempt），7/5 同一批動工**，完整實作計畫（schema/RPC/客戶端改動點/驗證方式）見 [WALLET_PLAN.md](WALLET_PLAN.md)。7/5 開工 session 直接讀那份。
2. **P 系列付費車款（5 台）**：P1（赤紅暴走）/P2（銀河鍍鉻）圖已生成上線（v0.12.26，車庫「付費車款」區塊先秀真圖預覽），P3~P5 尚未生圖；全部生完後還要接 Google Play Billing（IAP）才能真正販售，按鈕目前仍是「敬請期待」。
3. **RETENTION_PLAN 第二批**（經典模式 Top N/百分位、經典週榜、週任務、股票圖鑑、狂暴盤日事件）：經典 Top N/週榜牽動 classic_records schema/RPC，**等使用者點頭 schema** 才能動工；週任務／股票圖鑑／狂暴盤日事件本身零 schema（純前端＋localStorage），2026-07-04 已確認可由 Sonnet 先動工（狂暴盤日事件的「獎勵倍率」需先定案為金幣加成而非分數加成，避免碰到計分公平性）。
4. **RETENTION_PLAN 第三批**（週聯賽分組、Ghost 回放、排行榜 emoji 反應、好友邀請）：長期規劃，工程量大，未排入近期；Ghost 回放依規劃需跟反作弊第四層一起設計，屬 Fable 5 範圍。
5. ~~**BETA #4（前翻/煞車鈕操控）**~~：**2026-07-04 使用者決定不做，取消**（見 [BETA_FEEDBACK.md](BETA_FEEDBACK.md) #4）。
6. **Web Push 通知**：中期項目，工程量較大，未開始；需先決定是否申請 Firebase/FCM 專案。
7. **殼版本更新提示**：使用者明確要求正式上架後才做。
8. **廣告正式串接**（見上方「廣告第二階段」）：技術阻塞在「必須先正式上架」，非能力問題。

### 🆕 2026-07-03 使用者確認新增待辦（使用者計畫自己用 Sonnet 慢慢做，無優先順序）

- [x] **車庫系統 v1** 已完成（v0.12.16 已推）。`src/lib/garage.ts`（金幣＋擁有/選用車皮，localStorage）+ `src/screens/Garage.tsx`+ GameCanvas 繪車套用選用車皮的 hue-rotate 濾鏡。**目前只有 2 台過渡色車皮**（琥珀/紫羅蘭，靠 canvas hue-rotate 變色，不是正式 AI 圖）；正式 10 台圖（[GARAGE_DESIGN.md](GARAGE_DESIGN.md)）Grok 生成完成後，換掉 `BIKE_SKINS` 清單裡的 `hueRotateDeg` 改真圖路徑即可，其他邏輯不用動。金幣來源：完賽 +10／摔車 +3／每日任務完成額外 +15~25。preview 全流程驗證過（購買/裝備/hue-rotate 生效/entering game 無 console error）。
- [x] **UI 微調**（v0.12.17 已推，使用者截圖回報後修）：
  1. 金幣圖示改用 `src/components/CoinIcon.tsx`（金色漸層硬幣+走勢線浮雕+琥珀光暈 SVG），取代誤用的機車 emoji，Home/Garage/每日任務進度共用。
  2. 車庫入口從首頁左上角小徽章改成標題下方置中的大按鈕「🪙 金幣數・收藏車庫」——原本會跟「TAIEXRIDER」大標題疊在一起。**順手抓到一個真的版面 bug**：加這顆按鈕後首頁內容總高度變高，`.home-screen` 原本 `justify-content:center` 在矮螢幕（實測 viewport 695px 高）會把標題往上推出畫面外裁掉、且置中內容裁掉的頂部無法用捲動找回來——改成 `flex-start`＋`overflow-y:auto`（跟其他所有畫面本來就用的作法一致）才根治，不是只治這次加按鈕的症狀。
  3. 自選賽道選片、`GameCanvas` lazy-load 的「賽道載入中…」都補上淡入轉場，銜接前面畫面切換的動畫，不再是選完瞬間跳轉的生硬感。
- [x] **車庫首批正式車皮上線**（v0.12.19 已推）：琥珀/紫羅蘭過渡色換成真正的 B1/B2（[GARAGE_DESIGN.md](GARAGE_DESIGN.md) 定義的兩台基本車款）。流程：使用者用 Grok 生圖 → 自己手動去背（Python numpy flood-fill 自動去背第一次嘗試因誤判閾值把整台車吃掉，使用者改用自己的工具處理更乾淨）→ Claude 用色塊偵測量測輪圈中心座標 → 解方程式算出讓兩輪精準對齊物理輪位的 `spriteW`/`spriteOffsetX`/`spriteOffsetY` → 登記進 `garage.ts` 的 `BIKE_SKINS`。`GameCanvas.tsx` 車體貼圖邏輯從單一全域 `_bikeImg` 改成 per-src 快取（`getBikeImageEntry`），支援每台車皮各自的圖檔+校正值，預設車皮（bike.png）路徑完全沒變。preview 驗證：兩台車皮各自進遊戲跑物理迴圈都無錯誤；**⚠️ 精確視覺對齊（輪子是否剛好貼合物理輪位）需要真機/可見分頁確認**——preview 分頁隱藏、rAF 暫停，畫布拿不到最新渲染畫面（測試踩雷筆記那條），只能靠數學推導+無報錯間接驗證。剩餘 Q1~Q3/P1~P5 8 台車照這套流程量產即可。
- [x] **車款分級定案 + 開發者測試金幣**（v0.12.20 已推）：B（基本款）確認**免費**（`price:0` 自動視為已擁有，`isOwned()` 判斷邏輯已改）；Q（任務解鎖款）明確**不是**金幣購買，機制留待 Q 系列圖生成時再設計；P（付費款）走真錢 IAP，非金幣，價格待圖生成後決定。完整分級規則寫進 GARAGE_DESIGN.md §4。另外 App.tsx 加開發者測試帳號（`tyl161803@gmail.com`）登入自動補滿金幣至 99999，方便使用者真機測試車庫購買/裝備流程不用真的刷任務——純前端 email 比對，金幣沒有排行榜意義，無公平性風險。
- **原生體驗補強批次**（使用者要求「除了完美落地慢動作，其他全部都要」）：
  1. [x] **Wake Lock** 已完成（v0.12.16 已推）。`src/lib/wakeLock.ts`，遊戲畫面掛載即請求、分頁隱藏時瀏覽器會自動釋放、`visibilitychange` 恢復可見時重新取得，不支援裝置靜默 no-op。**⚠️ 待真機測試**（wakeLock 效果無法在 preview headless 環境驗證）。
  2. [x] **CSS 破綻修補** 已完成（v0.12.16 已推）。原本 `user-select`/`tap-highlight`/`touch-action`/`overscroll-behavior` 早就有了（v0.12.4），這次補上全域 `contextmenu` preventDefault（`main.tsx`），擋掉長按跳出瀏覽器選單。
  3. [x] **畫面轉場動畫** 已完成（v0.12.16 已推）。`index.css` 加 `screenFadeIn` keyframe，套用到所有子畫面根容器（home-screen/select-screen/daily-screen/slot-screen）；順便補齊 `.corner-btn`/`.back-btn` 原本沒有的 `:active` 按下回彈（其餘大部分按鈕早就有 :active scale，這次補漏網之魚）。
  4. [x] **結算畫面 juice** 已完成（v0.12.16 已推）。GameCanvas 結算面板：標題→分數→時間→統計依序 `overlayPop` 彈出（stagger delay）、分數改 0→終值 550ms ease-out 滾動動畫、PB 徽章加進場 pop（`pbPop`）再接原本的 pulse。
  5. **Web Push 通知**（中期，需接 FCM）：**尚未做**，工程量較大排在後面。
  - ❌ **明確排除**：完美落地慢動作/hitstop（使用者不要這項）
- [x] **全站盤勢主題氛圍** 已完成（v0.12.18 已推）。`src/lib/marketMood.ts`＋首頁小字說明「今日盤勢為 X/X 之盤勢，收盤上漲/下跌」。只疊背景色調不動品牌互動色，詳見 RETENTION_PLAN.md「盤勢事件化」段落。preview 用真實資料驗證通過。
- **每日任務系統 v1** 已完成（v0.12.16 已推，[x]）：`src/lib/quests.ts`，每日 3 個任務（seeded by 裝置本地日曆日，全服同一天同一組任務池，各自進度獨立），完成自動發金幣，UI 在 DailyChallenge 頁面 streak 下方。**v1 只用 GameOverStats 既有欄位**（分數/翻轉/完美/時間），不含股票類股/模式限定任務——那類需要額外資料，留給 v2。
- **反作弊實作**：✅ Phase A 已完成（2026-07-04，待使用者跑 migration）——詳見文件開頭「## 待辦」→「🎯 真正還沒做的事」第 1 項，避免重複維護同一件事的兩份說明。
- **殼版本更新提示**（設計見 DEVDOC §9.5b）：**使用者明確要求現在不做**——封測期網址未公開、影響範圍小。**正式上架後**排進待辦，走方案 A（`?shell=` 參數 + Supabase `app_config` 表比對）。
- [x] **拉霸音效降低音高** 已完成（v0.12.15 已推）。`playSlotTick()` 原 1500-2000Hz 方波改 150-240Hz 方波過 lowpass + 短噪音顆粒感，preview 驗證無 console error（音色本身無法用工具聽，麻煩使用者真機/桌機確認手感）。
- **2026-07-03 家裡批次（Sonnet，v0.12.21 已推）**，使用者 7 點討論全數動工（資安審視除外，交給 Fable 5 另開）：
  1. [x] b1/b2 車皮 offsetY 上移補地板間隙（`garage.ts`，未真機驗證，preview 隱藏分頁連 screenshot 都 timeout，只能數學推導）。
  2. [x] [GARAGE_DESIGN.md](GARAGE_DESIGN.md) Grok prompt 改寫：明確禁止陰影/尾焰/速度線等車外物件；Q1~P5 每台加 `VEHICLE TYPE` 鎖定不同車型（巡航/滑胎/速可達/仿賽/概念車/bagger/streetfighter/tracker），避免全部長得像同一台重機。**使用者可直接拿新版 prompt 重新生 Q/P 系列圖**。
  3. [x] 死亡熱點改連續漸層線（`DailyChallenge.tsx` `heatColor()`）：青(0死)→綠→黃橙→紅→紫，**HSL 色相插值**（非 RGB 直線插值——RGB 直補綠到紅中間會經過一段濁褐色，已在 preview eval 實測抓到並改掉）。
  4. [x] 拉霸「喀」聲改木頭響板音色（`audio.ts playSlotTick`）：白噪音打高 Q(7) bandpass 共振器＋快速降頻正弦，去掉原本悶電子方波感。**未實際試聽，需使用者真機/桌機確認**。
  5. [x] 「看廣告拿金幣」按鈕（結算畫面 +20、車庫頁 +40）：`ads.ts` 新增 `requestRewardedCoins()` stub（現在直接 resolve(true) 發幣，TODO 待 AdMob/AdSense 真串接時替換函式本體，呼叫端不用改）。
  6. [x] Q 系列成就計數＋UI 殼：新增 `src/lib/achievements.ts`（大漲/大跌日完賽次數 localStorage 計數，Q3 沿用既有 `streak.ts`），Garage 頁新增「🎯 任務解鎖車款」區塊顯示進度條，美術未到位前先用 🔒/🏆 佔位。**（2026-07-03 深夜起：美術已全數到位，見下方 v0.12.23/24，此條目的「佔位」狀態已結束）**
  7. [x] P 系列付費車款 UI 殼：Garage 頁新增「💎 付費車款」區塊，5 張卡「敬請期待」按鈕 disabled，待 Billing 串接與美術/定價到位。
  - **⚠️ 發現本機 `.env.local` 完全缺失**（Supabase URL/anon key 未設定）——導致 `npm run dev` 在這台機器上會直接白屏崩潰（`supabase.ts` 在 import 階段就 throw）。已補一份佔位 `.env.local`（`.gitignore`，不會進 repo）讓本機能跑，但排行榜/登入等後端功能在填入真實金鑰前都是壞的。**使用者需把真實 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` 貼進這台機器的 `.env.local`**（值同公司那台，anon key 設計上可公開分享不是密鑰）。**✅ 2026-07-03 深夜已補上真實金鑰，確認可連線（`daily_death_heatmap` RPC 實測回傳真實資料）**。
  - **⚠️ preview 隱藏分頁完全看不到 canvas 實際渲染**（screenshot 必 timeout、rAF 不 fire、`window.__test` 也只能拿數值不能逼出畫面）——這次改的視覺類項目（①③）都只能靠數學/console 驗證，真正的手感/配色需使用者在真實可見視窗確認。
- **2026-07-03 家裡批次二（Sonnet，v0.12.22 已推）**，使用者回報「廣告金幣 40 太多沒次數限制」+「Q 系列成就沒辦法馬上測」：
  1. [x] 看廣告拿金幣調整：新增 `src/lib/adRewards.ts`，獎勵 40→20、每日上限 2 次，**車庫頁+結算畫面共用同一組計數**（合計 2 次，不是各自 2 次），達上限按鈕 disable 顯示「今日已達上限」。
  2. [x] 開發者測試帳號（`tyl161803@gmail.com`）登入時，除了原本補滿金幣，**也直接解鎖 Q 系列成就進度**（`achievements.ts devSetProgress` + `streak.ts devForceStreak` 直接寫死大漲/大跌完賽 10/10、streak 30），不用真的刷條件就能看到解鎖 UI。
- **2026-07-03 深夜／07-04 車庫美術收尾（Sonnet，v0.12.23~24 已推）**，使用者陸續把 Grok 生的 Q1~Q3 圖丟進 `public/bikes/raw/`：
  1. [x] **v0.12.23**：發現「成就進度條滿了但選不了」——因為 v0.12.21 只做了進度 UI 殼，沒有真的量測登記車皮。補上 Node+sharp 色塊偵測量測腳本（掃描高亮高飽和像素找輪圈，量完即刪未進版控），q2-bear（空頭獵手）色相區隔夠大量測乾淨直接上線；q3-phoenix（不死鳥）前輪被同色系火焰裝飾污染，人工校正 cyPct 後上線。**同時修正一個真 bug**：`unlockAchievementSkin()` 只寫 localStorage 沒觸發 re-render，解鎖後會卡在「購買」按鈕不會變「裝備」，補上 `forceRender`。
  2. [x] **v0.12.24**：q1-bull（多頭鬥牛）重生三次才成功——第一次 Grok 生圖模型記憶體洩漏跑出 123RF 圖庫浮水印（reroll 排除，非版權問題不能用）；第二次仍是 bagger 側箱擋住後輪（推斷是 prompt 裡「chart motif on the side panel」措辭誘發側箱造型，跟「不要側箱」互相打架）；第三版明講禁側箱/panniers+chart 圖案改畫在油箱上才解決。最終色塊偵測乾淨，兩輪中心跟規格座標誤差 <2%，登記上線。**Q 系列三台（多頭鬥牛/空頭獵手/不死鳥）全數到齊可裝備，車庫共 5 台正式車皮（B×2+Q×3）**。
  3. [x] 使用者手動去除原始車款（`public/bike.png`）與不死鳥的車底陰影橢圓，裁切比對確認乾淨去除、輪子位置未變不用重新量測，直接換檔上線。
  - **經驗教訓（已寫進 GARAGE_DESIGN.md）**：AI 生圖車身色系跟輪圈發光色若同色系，色塊偵測會失敗（車身反光跟輪圈分不開），量測前務必先確認兩者色相有明顯區隔；車身描述避免「chart/裝飾畫在 side panel」這類措辭，容易誘發 Grok 生成側箱/長軸距造型擋住後輪。
- [x] **首頁車皮展示框** 已完成（v0.12.25 已推，2026-07-04）。使用者發現生出 P1/P2 後車款很好看但遊戲內貼圖只有 64~90px 看不出細節，提議在「今日盤勢為...」下方加一個接近螢幕寬度的展示框顯示目前裝備車款。`public/bikes/hires/{id}.png`（900px 寬，由 `raw/` 原圖處理，b1/b2/q1/q2/q3 五台，77~112KB／張，同一時間只載入目前裝備那一張不影響首頁載入效能）+ Home.tsx 讀 `getActiveBikeSkin()` 顯示對應 hires 圖，點擊直接導去車庫換車。**未生成 hires 版的車款（目前只有 default）直接退回原尺寸 `bike.png`**，不需要額外處理。preview 驗證：圖片正常載入無 404、mobile viewport(375px) 顯示框高 227px 合理、點擊正確導頁、console 零錯誤。**⚠️ 加這個框後首頁在矮手機（375×812）滾動高度略增（scrollHeight 1143 vs 812），首頁本來就是 `overflow-y:auto` 不會裂版面，只是要多滑一點才看到全部模式按鈕，真機看一下是否需要再收斂展示框高度**。

- [x] **車皮圖檔管線重建 + 五台重新對齊 + P1/P2 上架預覽** 已完成（v0.12.26 已推，2026-07-04）。背景：v0.12.26 舊嘗試（自動去背腳本）把圖弄壞，6 分鐘內整包 revert（`c84f3f7`→`90d1247`）；使用者接手手動處理，刪掉 `public/bikes/raw/`，改建三個版控資料夾＋明確禁止 Claude 修改：`Grok_Original/`（Grok 原圖）、`For_Lobby/`（手動去背＋留車底陰影，給首頁大圖）、`For_Gaming/`（手動去背＋去車底陰影，給遊戲內貼圖），順手把新生出的 P1/P2 也放了進來。Claude 這次只讀取這三個資料夾（未寫入/修改任何一張），處理流程：
  1. 量測方式全面換血：改用 OpenCV `HoughCircles` 直接在 alpha 遮罩上偵測兩個輪胎圓（純幾何形狀，不吃顏色），取代舊的色塊偵測——q1-bull／q3-phoenix 這種車身裝飾跟輪圈同色系的圖，色塊法會誤判，圓形偵測完全不受影響（7 台全部一次量測成功，無需人工校正）。
  2. offsetY 地板間隙補償公式化：舊做法是憑真機回報手動調的固定值（如 -2），這次改成「量到的輪胎視覺半徑 − 物理 wheelRadius=6」精確算出補償量，每台车各自算，不再共用一個猜測值。用 Python 依 `GameCanvas.tsx` 實際繪圖公式重繪疊圖驗證（紅圈標物理輪心、綠線標物理輪胎接地線），7 台輪位、接地全部對齊。
  3. B1/B2/Q1/Q2/Q3 五台輸出新的 `public/bikes/{id}.png`（520px 寬，遊戲貼圖）+ `public/bikes/hires/{id}.png`（900px 寬，首頁展示框），`src/lib/garage.ts` 的 `spriteW`/`spriteOffsetX`/`spriteOffsetY` 全部更新為新量測值。
  4. P1 赤紅暴走／P2 銀河鍍鉻（尚未接 IAP，不能裝備）也處理好圖檔並在 `Garage.tsx` 付費車款區塊换成真圖預覽（去飽和調暗）取代 💎 佔位圖示，按鈕仍 disabled；P3~P5 沒圖，維持原樣。
  - **⚠️ preview 隱藏分頁的已知限制**（見下方踩雷筆記）這次也踩到：GameCanvas 需要真人可見分頁才能看到實際渲染，本次靠「直接照抄 GameCanvas 繪圖公式在 Python 重算」數學驗證取代，車庫卡片/首頁展示框（非 canvas，一般 DOM img）則有用 preview snapshot 實際驗證通過（三台可裝備車皮切換、P1/P2 圖片 200 無 404）。**真機/可見視窗仍需使用者確認實際貼地手感**——理論上這次公式更精確（有算輪胎視覺半徑），但沒有真機回饋前不敢說一定比舊版好。
  - `.gitignore` 移除 `public/bikes/raw/` 規則，三個新資料夾改為進版控（不再是「處理壞了就救不回來」的裸資料）。

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

### 📱 TWA/androidbrowserhelper 踩雷
- **meta-data 的 `android:value` vs `android:resource` 不能混用**：`SPLASH_SCREEN_BACKGROUND_COLOR` 必須 `android:resource="@color/..."`——用 `android:value="#05080f"` 會被函式庫當「資源 ID」查表 → `Resources$NotFoundException` 點開秒崩（vc9 事故）。而 `FADE_OUT_DURATION`（要毫秒 int）、`DEFAULT_URL`/`FILE_PROVIDER_AUTHORITY`（@string 引用會自動解析）用 `android:value` 是對的。**改 TWA meta-data 時查 androidbrowserhelper 文件確認該欄位要 value 還是 resource。**
- **沉睡地雷效應**：函式庫很多讀取是條件觸發（如背景色只在有 SPLASH_IMAGE_DRAWABLE 時才讀），錯誤寫法可能潛伏多版不發作。**android/ 有任何改動，上傳 AAB 前一律先 signed APK + `adb install -r` 真機開機驗證。**
- **Play Console 不能回滾版本**：壞版本只能用更高 versionCode 的新版蓋掉，出事成本高，更要上傳前驗證。

### 🧪 測試踩雷：preview 分頁是隱藏分頁，rAF 被瀏覽器暫停
- 用 preview 工具驗證時，分頁 `document.hidden=true` → `requestAnimationFrame` 不會 fire → 遊戲主迴圈整個停住（看起來像「車不會動」，其實是迴圈沒跑）。screenshot 也會 timeout。
- 解法：`GameCanvas.tsx` 有 `import.meta.env.DEV` 下的 `window.__test` 鉤子（step/press/release/reset/state），可**手動步進**物理來驗證，繞過 rAF。真人用可見分頁玩則一切正常。
