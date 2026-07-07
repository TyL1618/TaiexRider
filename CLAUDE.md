# TaiexRider — 專案守則與進度

> 把台股前一交易日走勢轉成 2D 霓虹機車賽道的單指小遊戲（PWA → TWA 上架 Google Play）。
> 完整設計規劃見 [DEVDOC.md](DEVDOC.md)。歷史交接紀錄（舊決策脈絡）見 [History.md](History.md)。

> 🗓️ **7/6（禮拜一）起分批處理清單見 [NEXT_BATCH_PLAN.md](NEXT_BATCH_PLAN.md)**——換公司電腦開工時，
> 先讀那份再讀本檔「目前進度」。這是 2026-07-04 晚盤點的完整待辦（資安 + 遊戲內容），
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

### 🌙 2026-07-07 收工總覽（明天公司電腦接手，先看這段再看下面細節）

今天橫跨兩條主線：① Play Console 封測門檻危機 + 付費找測試人員，② 挖出一個潛伏一個多月
的金幣/鑽石發放 SQL bug。細節分別寫在下面對應的日期段落，這裡只列**明天要接續處理的
待辦清單**：

**A. Play Console / 上架流程**
1. **確認 Testers Community 的 15 位測試人員能不能真的加入封測**——這件事昨晚沒有
   得到明確答案：Play Console 的封測名單機制是「Email 清單」或「Google 群組」二選一，
   陌生人光點 opt-in 連結不一定會自動放行，要看你自己的測試軌道設定。**待辦**：去自己
   Play Console 的「測試人員」設定確認是哪一種，如果是 Email 清單，可能需要主動跟
   Testers Community 要這 15 人的 email 手動加進去；如果不確定，直接用左下角
   Contact support 問清楚「你們的測試人員怎麼被加進我的 Play Console 名單」。
2. **確認測試人數是否已經回升到 12 以上、14 天倒數是否已經開始正常累積**（不再卡在
   「1 天」）。
3. **接下來 16 天測試期內，記得刻意排 2~3 次小改版重新上傳 AAB**（不是網頁 push 自動
   部署那種，是走「Android Studio 重 build signed AAB → versionCode +1 → 上傳 Play
   Console」的完整流程），版本說明要寫具體改了什麼——這是 Testers Community 教學裡
   拿到正式版權限的關鍵步驟之一，14 天後要用「Production Access Report」（Reports
   分頁）的建議答案去填 Google 的正式版申請表單。
4. Testers Community 承諾幾天內會提供測試回饋報告，收到後記得查看。

**B. IAP 鑽石購買（今晚最後在處理的部分）**
昨晚发现车庫「購買鑽石」卡在灰色「暫無法購買」超過 24 小時（IAP 是 7/6 17:00 串起來的，
遠超過商品剛建立的正常生效延遲）。查到真正原因：**Play Console 的「授權測試」
(License Testing) 名單**——這跟「封測測試人員」是完全不同的兩份名單，App 還沒正式上架
到 Production 前，Google Play Billing API 只對這份名單裡的帳號開放，即使該帳號能正常
安裝玩遊戲也一樣。已引導使用者：① 在 Play Console → 設定 → 授權測試，把自己的清單
（畫面上看到 Harold/Jane/Yun 三份清單，使用者的應該是 Yun）**打勾啟用**；② 授權回應
選 **RESPOND_NORMALLY**；③ 按儲存變更。**這個設定生效通常幾分鐘到半小時，不需要
像商品剛建立那樣等 24~48 小時**。**待辦：睡醒/明天到公司後第一件事，確認存檔後鑽石
價格是否已經正常顯示、購買流程是否走得通**——如果存完超過 1 小時還是不行，就不是等待
時間問題，要回頭檢查清單有沒有勾對/email 有沒有加對。**這個授權測試名單限制只在封測
期間才存在，正式上架到 Production 後，所有真實使用者都能直接購買，不需要任何名單**，
不用擔心到時候要手動把全台灣使用者加進名單。

**C. 金幣/鑽石發放 bug（今天最重大的發現，已修復並實測確認金幣正常）**
詳見下方 v0.12.40~43 那幾段。**簡短結論**：`wallet_earn()`/`claim_weekly_quest()`/
`grant_iap_diamonds()` 這三支 RPC 從 **2026-07-05 伺服器端錢包上線那天就有 bug**
（`returns table(coins int,...)` 讓 `coins`/`diamonds` 變成 PL/pgSQL 函式輸出變數，
跟資料表欄位同名衝突，導致 `set coins = coins + x` 語法歧義、整個函式呼叫直接失敗
rollback）——**代表上線以來，所有玩家的金幣獎勵、週任務金幣、真錢購買鑽石，從來沒有
一次真的寫進資料庫過**。修復 SQL `supabase/migration_20260709b.sql` **已執行**，
金幣路徑（完賽/摔車/長征/任務/看廣告）已實測確認修復正常；週任務金幣、真錢購買鑽石
用同一種修法但**未實測**，合理推斷一併修好。**待辦**：有機會的話找時間實測一次週任務
領獎跟真的走一次鑽石購買流程（現在剛好卡在上面 B 項的授權測試名單問題，等 B 項解決
就能順便測到）；另外**如果封測期間曾經有真人透過 Google Play Billing 真的付錢買過
鑽石**，那筆交易當時很可能扣了錢但鑽石沒有真的入帳，需要額外查 Play Console 交易紀錄
決定要不要手動補發/退款。

### 🚨 2026-07-07 晚間：14 天封測連續天數被打回「1 天」+ 付費找測試人員（未完待續，家裡/公司都要看這段）

**背景**：14 天封測倒數原本已經到第 13 天（見早些的 Play Console 截圖），今晚 8 點左右
使用者發現「至少 12 名測試人員」的門檻底下的天數計數器**被打回「目前已有 12 名測試人員
參加測試 1 天」**——等於連續天數整個歸零重來。同一時間收到 Google AdMob 帳戶核准通知
（好消息，跟這件事是兩條獨立的軌道，互不影響）。

**根因判斷**：Google Play 這個「至少 12 人、連續 14 天」的門檻，看行為判斷應該是**每天
動態檢查「當下測試人數是否仍 ≥12」**，不是「曾經湊到過 12 人就永久算數」——只要某一天
實際測試人數跌破 12，計數就會重置回 1。使用者這幾天一直在觀察的「裝置數從 12 掉到
11」、「朋友解除安裝延遲才顯示」等現象（見稍早對話關於 Play Console 圖表延遲的討論），
一開始 Claude 判斷是報告延遲、不用擔心，但**這次的重置結果證明底層測試人數確實曾經真的
跌破 12**，之前的「不用擔心，只是延遲」判斷需要修正——延遲是真的，但延遲不代表沒有實際
影響，人數真的跌破門檻時，即使圖表顯示落後，門檻計算仍會如實歸零。

使用者懷疑這跟一位朋友的行為有關（過去有過結怨，使用者認為對方是故意解除安裝來搞破壞），
但這部分屬於人際判斷，Claude 沒有直接證據，不列入技術結論，僅記錄使用者的懷疑脈絡。

**應對方式：付費找真人測試人員補人數**——使用者花錢訂閱 **Testers Community**
（testerscommunity.com，Starter 方案 NT$399，Dcard 上有人推薦），會安排 **15 位真人**
透過 Google Play 官方的封測 opt-in 連結（`https://play.google.com/apps/testing/
com.tylapp.taiexrider`，注意**不是**一般商店頁 `store/apps/details?id=...`，兩者外觀
類似但功能完全不同，只有前者能讓人真正加入封測）實際安裝遊戲，把測試人數從當時的 10 人
拉到穩定超過 12（建議之後長期維持在 15~18 人左右的緩衝，避免未來再有人退出就又跌破
12 觸發歸零）。

**這筆錢沒有浪費**：目前的「1 天」不是一個已經鎖定、回不了頭的倒數，而是「當下即時狀態」
的顯示——只要這 15 人補進來、人數穩定站上 12 以上，14 天會從那天開始正常往上算，不會
因為「之前顯示過 1 天」而受影響或被視為已經開始又中斷。

**Testers Community 服務內容 + 後續待辦（申請正式版前務必再讀一次）**：
服務完成後會寄一封確認信，附上一篇部落格文章「[Google Play 正式版權限被拒怎麼辦]
(https://www.testerscommunity.com/blog/google-play-production-access-rejected)」，
重點整理：
1. **正式版申請常見被拒原因**：表單填得不夠具體／沒有依測試回饋更新版本／測試人員參與
   度太低。
2. **拿到正式版權限的三步驟**：
   - ① **14 天測試期間內至少要再發布 3 個新的封閉測試版本**（重新上傳 AAB，不是網頁
     `git push` 那種自動部署——哪怕小改動也要重新上傳，版本說明要具體寫改了什麼，不要
     只寫「小修復」這種空泛字眼，目的是讓 Google 看到「有持續根據回饋迭代」的證據）。
   - ② 提升 App 品質：UI/UX 專業、無明顯 bug；檢查 Play Console 的 Pre-launch report
     自動測試報告，把列出的問題修掉，問題總數盡量壓在 10 個以內。
   - ③ 正式版申請表單認真填：10 題跟 App/測試流程相關的問題，**每題至少 250~300 字**，
     具體寫怎麼招募測試人員、收到什麼回饋、根據回饋做了哪些改進、為什麼覺得準備好上
     正式版了。
3. **對應這個專案的具體行動**：接下來這輪 14 天倒數期間，**建議刻意排 2~3 次小改版
   重新走一次「Android Studio 重 build signed AAB → versionCode +1 → 上傳 Play
   Console 封測軌道」的完整流程**（不能只靠平常網頁那種 push 自動部署，那個不會顯示為
   「新的封測版本」），每次版本說明具體寫改了什麼，到時候申請表單才有實際「持續迭代」
   的證據可以寫。Testers Community 也承諾幾天內會提供測試回饋報告和申請表單建議答案，
   收到後要整合進申請流程。

**目前狀態**：15 位測試人員的加入/安裝流程剛啟動，人數尚未確認回升到 12 以上；14 天
倒數尚未真正開始有效累積；Testers Community 的回饋報告與申請表單建議答案尚未收到。
**下次開工先看這裡有沒有更新**——如果人數已經穩定超過 12、天數開始正常往上跑，或收到
了 Testers Community 的回饋報告，都要記得回來補這段。

### 🐛 2026-07-09（追加）：v0.12.40 修完仍未解決——加上診斷 log 等真機再現（v0.12.41）

使用者用 v0.12.40 修完後再測，回報**仍然一樣**，並提供更精準的證據：① 故意玩完一場、回
首頁確認畫面顯示 +金幣後，直接去 Supabase 後台查表，**資料根本沒進去**——代表問題不是
「本地快取被競速蓋掉」，而是 `wallet_earn()` RPC 這次呼叫從頭到尾就沒有成功寫進資料庫；
② 進排名賽/隨機賽道/自選賽道/經典模式再退出來，首頁金幣都還在，**只有進車庫才會瞬間歸
零**——這其實是車庫頁掛載時會呼叫 `syncWalletFromServer()` 主動重新整包同步（其他畫面
不會），車庫看到的「歸零」正確反映了伺服器端真正的（沒被寫入的）餘額，車庫本身沒有錯，
只是最先揭穿「伺服器根本沒收到這筆錢」的畫面。

v0.12.40 修的 `[user]`→`[user?.id]` 是另一個真實存在的競速 bug（背景 token 刷新蓋掉剛
寫入的新值），但**不是**這次的主因——這次是寫入本身就失敗，不是寫入之後被蓋掉。查了
`wallet_earn()`/`consume_attempt()` 的 SQL 邏輯與呼叫端程式碼，語法/簽名都對不出明顯
問題，但呼叫端全部把 RPC 失敗**靜默吞掉**（`if (error || ...) return`，這是全站慣例的
「失敗就讓本地樂觀值頂著」防禦寫法），導致完全看不到 Supabase 實際回傳的錯誤訊息。
v0.12.41 在三個關鍵點（`garage.ts` 的 `syncWalletFromServer`/`earnCoins`、
`challengeAttempts.ts` 的 `consumeAttemptServer`）加上 `console.error`，不改變任何
現有 fallback 行為，只是讓失敗原因會印在 console。**下次重現時麻煩用桌機瀏覽器登入測試
（可開 devtools 直接看 console），或手機用 `chrome://inspect` 遠端連 TWA 的 WebView
看 console，把 `[wallet]` 開頭的錯誤訊息回報回來**——有了實際錯誤內容（RLS 拒絕/函式不
存在/網路逾時/資料驗證失敗等）才能鎖定真正原因，目前純看程式碼找不出更多線索。

### 🔴🎉 2026-07-09（真正抓到了）：金幣/鑽石發放從 7/5 上線以來全部沒真的寫進資料庫！
### 根因＝SQL 欄位參照不明確，**需要立刻手動跑 `supabase/migration_20260709b.sql`**

使用者實測「車庫看廣告拿金幣」，用桌機瀏覽器 devtools 直接看到 RPC 回傳的 400 錯誤內容：

```
code: "42702"
message: "column reference \"coins\" is ambiguous"
details: "It could refer to either a PL/pgSQL variable or a table column."
```

**根因**：`wallet_earn()`／`claim_weekly_quest()`／`grant_iap_diamonds()` 這三支函式都用
`returns table(coins int, ...)` 或 `returns table(diamonds int, ...)`——PL/pgSQL 會把
`coins`/`diamonds` 這兩個輸出欄位名稱當成函式內的隱含變數。函式內部又寫
`update player_wallet set coins = coins + v_amount`，右邊那個 `coins` 到底是指
`player_wallet.coins` 這個資料表欄位、還是函式輸出變數，Postgres 無法判斷，**整個函式
呼叫直接拋例外中止**（連前面已經 insert 的 `wallet_earn_log` 那筆也會一起被 rollback，
這正是為什麼查 `wallet_earn_log` 完全零筆——不是沒執行到，是執行到一半被回滾）。玩家端
完全看不到任何錯誤（呼叫端把 RPC 失敗靜默吞掉），只會安靜地拿不到錢。

**影響範圍比想像中大很多**：查證這個 bug 從 **`migration_20260705.sql` 的第一版
`wallet_earn()` 就存在**（2026-07-05 伺服器端錢包剛上線那天），一路被複製貼上到每一次
改版（20260706b/20260707c/20260708/20260709）都沒被發現，代表：
- **所有玩家從 7/5 以來，完賽/摔車/長征/任務/看廣告的金幣獎勵，從來沒有一次真的寫進
  資料庫過**——畫面上看到的加幣全部只是前端 `addCoins()` 的樂觀顯示，一旦任何畫面重新
  跟伺服器同步（例如進車庫），就會被打回原本（沒增加過）的真實餘額。這正是這幾天「金幣
  回車庫/首頁歸零」報告的**真正根因**，跟 v0.12.40 修的 App.tsx 背景 token 競速是兩個
  疊加的獨立問題（v0.12.40 那個是真實存在的 bug，但不是這次案例的主因）。
- **週任務金幣獎勵（`claim_weekly_quest`）同樣的 bug，從來沒發過**。
- **真錢購買鑽石（`grant_iap_diamonds`，Google Play Billing IAP）也是同樣的 bug**——
  如果已經有玩家真的付錢買過鑽石包，錢有扣但鑽石可能沒有真的到帳，這點務必优先確認
  Play Console 有沒有實際交易紀錄，若有需要額外處理退款/補發。
- **沒有受影響、一直正常運作的**：`settle_daily_diamonds()`（排行榜名次鑽石）／
  `settle_classic_weekly()`（經典模式週結算鑽石）——這兩支函式 `returns void`，沒有
  跟 `diamonds` 撞名的輸出變數，從頭到尾都沒有這個問題，玩家應該有正常收到過這兩條路徑
  的鑽石。`wallet_spend_skin()`（購買車皮）／`wallet_dev_grant()`（開發者測試帳號）也
  沒事，因為都是先把運算結果存進 `v_coins`/`v_diamonds` 這種明確命名的區域變數，再一次
  賦值回欄位，從未直接寫 `coins = coins + x` 這種會撞名的寫法。

**✅ 修復 SQL 已寫好並已跑：[supabase/migration_20260709b.sql](supabase/migration_20260709b.sql)**
——三支函式的 UPDATE 敘述改成 `set coins = player_wallet.coins + v_amount`（明確加上
資料表名稱前綴，跟函式輸出變數 disambiguate），業務邏輯/金額/上限完全不變，逐字照舊。

**驗證狀態（2026-07-09）**：
- **✅ `wallet_earn()` 已實測確認修復**——使用者跑完 migration 後真機測試看廣告拿金幣，
  金幣有正確入帳，這條路徑（也涵蓋完賽/摔車/長征/任務）確認修好。
- **`claim_weekly_quest()`／`grant_iap_diamonds()` 未實測，但採用完全相同的修法**
  （欄位加資料表名稱前綴消歧義），語法結構跟已驗證有效的 `wallet_earn()` 一致，合理
  推斷一併修好，使用者接受同理推斷、不強求實測。**⚠️ 唯一提醒**：如果封測期間曾經有
  真的玩家透過 Google Play Billing 付錢購買鑽石包（`grant_iap_diamonds` 那條真錢
  路徑），那筆錢當時很可能扣了但鑽石沒有真的入帳——若之後查 Play Console 發現有這種
  歷史交易紀錄，需要額外手動補發鑽石或退款，不會因為這次修好 SQL 而自動回溯處理。

### 🐛 2026-07-09（再追加）：SQL 直查排除「migration 沒跑」，鎖定範圍到「session 遺失」（v0.12.42）

使用者懷疑是不是自己漏跑 SQL，直接在 Supabase SQL Editor 查證：
`pg_get_functiondef('public.wallet_earn(text, int)')` 顯示 `'ad'` case 是
`v_amount := 40`——證明資料庫裡目前生效的就是最新的 `migration_20260709.sql` 版本
（`create or replace function` 是整段原子性替換，不會「改一半」，能看到新數字就代表
整支函式都已更新），**排除「SQL 漏跑」的可能**。

進一步直接查媽媽帳號（`z0923372899@gmail.com`）的實際資料：
- `player_wallet`：`coins=0`、`updated_at=2026-07-06 11:22:55`——這個帳號的錢包從
  7/6 之後**到現在為止一次都沒有被成功寫入過**，不是「今天寫入又被蓋掉」。
- `wallet_earn_log`：**該帳號從有紀錄以來完全零筆**（"Success. No rows returned"）——
  代表 `wallet_earn()` 這支函式**從來沒有真正執行到寫入那幾行**，範圍比原本以為的
  更早、更嚴重：不是「RPC 送出去被拒絕」，很可能是**呼叫端 `getUid()` 拿到 `null`，
  代表當下 Supabase 根本沒有有效 session，`earnCoins()`/`syncWalletFromServer()`/
  `consumeAttemptServer()` 在呼叫 RPC 之前就直接 return**——這種情況完全不會觸發
  v0.12.41 加的 `console.error`（那個 log 只在「RPC 真的送出去但失敗」時才會印），
  是先前完全沒設想到的盲點。

v0.12.42：在 `garage.ts` 的 `earnCoins()`/`syncWalletFromServer()`、
`challengeAttempts.ts` 的 `consumeAttemptServer()`，對「uid/session 為 null」這個
分支加上 `console.warn("[wallet] ... 略過：目前沒有登入 session")`（用 warn 不用
error，因為訪客玩家本來就會正常走到這條分支，不算異常，只是需要能跟「已登入但 RPC
失敗」區分開）。**下次重現時看 console 裡出現的是 `[wallet] ... 略過：目前沒有登入
session`（代表要查為什麼登入中的帳號 session 會遺失，可能是 token 過期/裝置儲存空間
被清/PWA 背景太久沒回來）還是 `[wallet] wallet_earn(...) 失敗`（代表要查 Supabase
端錯誤），才能決定下一步方向。**

### 🐛 2026-07-09：金幣回車庫/首頁歸零 + 連續參賽延遲觸發（v0.12.40）

使用者用媽媽的帳號+不同手機測試，回報「不管用什麼方式拿到金幣，回到車庫或回到首頁都
會歸零」，另外也回報媽媽玩排行模式「玩到第 2、3 場才觸發連續參賽」。查出兩者是**同一個
根因**：[App.tsx:66-68](src/App.tsx:66) 的 `syncWalletFromServer()` effect 依賴陣列
原本是 `[user]`（物件參照）——跟 7/8 修過的 `grantDevWallet` bug（見上方 v0.12.38）
一模一樣的模式，但 7/8 那次**只改了 `grantDevWallet` 那支、漏改緊接在它上面這支管全體
玩家錢包同步的 effect**。[auth.ts:134-139](src/lib/auth.ts:134) 的 `onAuthStateChange`
對 Supabase 送出的任何事件（包含背景 token 自動刷新、分頁從背景回前景這類根本不是使用者
登入/登出動作的事件）都會給一個全新的 `user` 物件，導致這支 effect 反覆觸發
`syncWalletFromServer()` 打 `wallet_get()`。如果玩家剛用 `earnCoins()`（金幣）或
`consume_attempt()`（streak）寫入新值，而這支背景重觸發的 `wallet_get()` 恰好比較晚
回來，就會把剛寫入的新值蓋回舊值——金幣看起來歸零、streak 看起來沒觸發，回車庫/回首頁
這類畫面切換常伴隨分頁焦點變化，正是容易誘發背景 token 刷新的時間點，因此使用者「不管
用什麼方式」都會遇到。修法比照上次：依賴陣列改成 `[user?.id]`，只有真的登入/登出/換
帳號才重新整包同步。typecheck 過，preview 驗證訪客路徑零回歸（不需要真實登入 session
就能確認沒有語法/渲染錯誤）。**⚠️ 這個 bug 本質是競速，preview 環境無法模擬真實 Supabase
背景 token 刷新的時間點，需使用者真機/多帳號多裝置測試確認金幣不再歸零、streak 第一場
就正確顯示**。

另外使用者確認：稍早回報的「排行榜第一場 2379 分」是**結算分數滾動動畫**的舊 bug
（2026-07-07 已在公司修過，見下方對應段落——衝線太快時動畫還沒跑完就被截斷結算，顯示
分數偏低），下午確認修好過，剛剛回來又疑似遇到一次，使用者要求先觀察後續是否再出現，
這次不列入待辦，暫不動。

### 💰 2026-07-09：看廣告拿金幣獎勵 20 → 40（v0.12.39）

使用者拍板調高車庫/結算畫面「看廣告拿金幣」單次獎勵。前端 `AD_COIN_REWARD`
（[adRewards.ts](src/lib/adRewards.ts)）與伺服器權威版 `wallet_earn()` 的
`'ad'` case 同步改 20→40，每日上限維持 2 次不變（單日這桶最高 80）。
**⚠️ `supabase/migration_20260709.sql` 尚未確認是否已在 Supabase SQL Editor 執行**
——這份是 2026-07-07 傍晚趕在 token 用盡前 push 的收尾提交，本檔案（CLAUDE.md）當時
沒能及時同步更新，2026-07-08 補寫。已登入玩家在 migration 跑之前，伺服器端仍會用舊的
20 上限覆寫，看起來像「獎勵沒變」——**下次開工請先確認這份 migration 是否已執行**。

### 🐛 2026-07-08 深夜：開發者帳號背景重複補滿金幣（v0.12.38）

使用者用 tyl161803@gmail.com 登入狀態故意自摔測試（預期只 +2），結果回首頁 +77，且
確認任務清單前後完全沒變化（排除任務重複發獎的可能）。查出真正原因：
[App.tsx:76-79](src/App.tsx:76) 的 `grantDevWallet()`（開發者帳號登入自動補滿金幣至
99999，絕對值設定非累加）依賴陣列原本是 `[user]`（物件參照）——Supabase
`onAuthStateChange` 連 token 背景自動更新（非真的登入/登出）都會給一個全新的 `user`
物件，導致這支 effect 反覆觸發。如果先前測試（買車皮等）讓餘額降到 99999 以下，背景
一觸發就會把餘額無預警拉回滿格，被誤以為是這場遊戲給的獎勵，跟遊戲獎勵/任務系統本身
無關。改成依 `user?.email`（穩定字串）比較，只有真的登入/登出/換帳號才觸發。
**這個 bug 只影響開發者測試帳號本身**（一般玩家/訪客不會觸發 `grantDevWallet`），
但也代表：**之後測試金幣經濟公式正確性時不要用 tyl161803@gmail.com**，因為這個帳號
本來就設計成「餘額異常也會被靜默拉回 99999」，測不出真實發放數字，要測請用訪客或
一般 Google 帳號。

### 🐛 2026-07-08 晚間：金幣經濟大改版後回歸測試抓到跨帳號快取污染 bug（v0.12.34/35）

使用者真機/桌機測試新經濟系統時回報三個問題，逐一排查：

- **UI 微調（v0.12.34）**：結算畫面廣告按鈕文字太長，改短成「📺 觀看廣告 獎勵 ×2」；
  旁邊新增「本局收益 X 金幣」常駐顯示（[GameCanvas.tsx](src/game/GameCanvas.tsx)），
  領取雙倍後原地更新成 2 倍數字+勾勾，不用等回首頁才看得到差異。
- **金幣異常 +80/+85 的真正原因（v0.12.35）**：使用者一開始懷疑任務可以無限重複領獎，
  直接寫腳本模擬「同一天玩 3 次」驗證任務防重複邏輯本身是對的（第 2、3 次都正確回傳
  「沒有新完成的任務」）。真正root cause 是**跨帳號快取污染**：`playRewards.ts`（遊玩金幣
  上限）／`quests.ts`（每日任務）／`weeklyQuests.ts`（週任務本地 fallback）／
  `adRewards.ts`（車庫看廣告）四個 localStorage key **原本都不分帳號**，同裝置用開發者
  測試帳號重度測試後登出改玩訪客，訪客會沿用「前一個帳號」當天已經衝到滿的每日上限——
  這才是使用者看到「訪客第一場 +75、之後每場都 0」的真正原因（不是任務重複發，是遊玩
  獎勵桶＋任務桶都被前一個帳號的測試量吃光了）。修法：比照 2026-07-07 修過的
  `challengeAttempts.ts`（`tr_daily_att_{uid|guest}_{sessionDate}`）同一套模式，四個
  key 全部加上 `{uid|guest}` 隔離，`grantPlayReward`/`getDailyQuests`/`recordRun`/
  `getWeeklyQuests`/`recordWeeklyRun`/`getAdCoinClaims`/`incrementAdCoinClaims` 簽名
  都加上 uid 參數，`GameCanvas.tsx` 新增 `uid` prop（結算頁雙倍金幣要用）、
  `Garage.tsx` 新增 `user` prop（車庫看廣告拿金幣要用，之前完全沒有這個 prop）。
  順便發現並修正登出流程的競速問題：`Home.tsx` 的 `handleSignOut` 原本沒等
  `signOut()`（內含 `resetWalletCache()` 清成就/streak/金幣快取）跑完就關閉設定面板，
  手速快的話有機會在快取清乾淨前就切去玩訪客——改成 `await signOut()` 才關面板。
- **驗證狀態**：typecheck + build 皆過，preview 驗證任務清單正確顯示已完成勾勾、無
  console 錯誤。**⚠️ 跨帳號情境（登入重度測試→登出玩訪客）需要使用者真機再測一次確認
  金幣不再卡 0**，preview 環境無法模擬真實登入/登出的 Supabase session 切換。

### 💰 2026-07-08：金幣/鑽石經濟大改版（使用者拍板 6 項，Sonnet 一次動工完成，v0.12.33）

使用者提出完整經濟設計討論後拍板，一次做完六批（每批各自小範圍，但因彼此高度相關這次
合併一次 commit）。**✅ 4 份 migration 使用者已確認在 Supabase SQL Editor 跑過**（2026-07-09
確認，此前 CLAUDE.md 一直沒補上這筆確認，文件曾一度落後於實際進度）：
`migration_20260708.sql`（wallet_earn 上限+長征金幣／wallet_spend_skin 定價）、
`migration_20260708b.sql`（週任務新欄位+RPC）、`migration_20260708c.sql`（排行榜每日
鑽石結算）、`migration_20260708d.sql`（經典模式週結算+鑽石）。

1. **金幣公式改版**：一般/自選模式維持完賽 5／摔車 2；長征模式（5 支股票串接）改成
   完賽固定 30、摔車依「跑到全程的比例」等比例給（`playRewards.ts` 新增
   `computePlayReward()` 共用公式，用死亡當下的賽道位置比例算，跟死亡熱點用的 xr 同一個
   座標概念）。排行榜賽事跟經典模式改成完全不給金幣（改給鑽石，見第 5、6 項）。
2. **結算畫面看廣告拿金幣 → 改「雙倍本局金幣」**：原本任何模式結算畫面都有的固定
   +20 看廣告按鈕移除，改成非排行榜/經典模式才顯示的「雙倍本局金幣」（`GameCanvas.tsx`），
   車庫頁原本的看廣告拿金幣按鈕不變。
3. **單日「遊玩」金幣總量上限 50→100**（`playRewards.ts` + `wallet_earn()`），長征模式一場
   最高 60、兩場就吃滿，用意是拉高長征模式的誘因；看廣告雙倍也算在這桶內。
4. **咖啡騎士／通勤小白定價 200/150 → 500/500**（`garage.ts` + `wallet_spend_skin()`）。
5. **每日/週任務池從 5 種擴充到 10 種**：新增「累計完賽 N 場」「玩一場長征/經典模式」
   「在上漲/下跌盤完賽」等類型（`quests.ts`/`weeklyQuests.ts`），週任務因為需要伺服器權威
   進度，多了 `finish_count`/`long_finish_count`/`classic_finish_count`/
   `up_day_finish_count`/`down_day_finish_count` 五個新欄位+對應 RPC 改造。
6. **排行榜（每日挑戰）改鑽石制**：不再給金幣，改成前一期（連假安全，仿 `resolveSessionDate`
   算法用 `daily_map` 找「上一期 session」，不會在連假中途提早結算）參與 +3 鑽石、名次
   第1名+80／第2名+50／第3~4名+20／第5~10名+10，可疊加。新增 `settle_daily_diamonds()`
   RPC（只有 service_role 能呼叫）+ 每天台灣 00:00 的 GitHub Actions
   （`.github/workflows/settle-daily-rewards.yml` → `scripts/settleDailyRewards.ts`）+
   玩家端結算彈窗（`DailyChallenge.tsx`，查 `get_pending_daily_settlement()`，看過後
   `ack_daily_settlement()` 不再跳）。
7. **經典模式從永久霸榜改成每週重置+前三名發鑽石（30/20/10）**：`classic_records` 加
   `week_key`（ISO 週別）、複合主鍵改三欄，每次提交裁剪到「該關該週」前三名；新增
   `settle_classic_weekly()`（跟排行榜結算掛同一支排程），找出「已結束但還沒結算」的週別
   逐關發鑽石，舊週資料不立刻刪、跟其他清理一樣留 2 週後由 `cleanup_old_wallet_logs()`
   清掉。**`fetchClassicRecords()` 讀取端同步加上 `week_key` 篩選**，避免清理排程還沒跑掉的
   上週殘留資料混進來變成每關看到 6 筆而不是 3 筆。
- **驗證狀態**：typecheck + 全站 build 皆過；preview 實測 Garage 定價顯示 500/500 正確、
  DailyChallenge 任務池新種類（「在今日下跌盤完賽一場」「本週完賽 3 場長征模式」）正確
  隨機抽出顯示、console 零錯誤；GameCanvas 物理迴圈用 `__test` 手動步進驗證翻轉計分/碰撞
  結算邏輯正常運作。**⚠️ 結算畫面「雙倍本局金幣」按鈕、排行榜鑽石結算彈窗、經典模式週
  結算實際發鑽石**這三項因為需要真機才能看到完整死亡動畫轉場（preview 隱藏分頁 rAF 暫停
  的已知限制），migration 已確認跑過，但**尚未見到使用者回報真機測試結果**——待真機/
  桌機實測確認。

### 🐛 2026-07-07 晚間：結算分數滾動動畫抓錯終點 + 圖鑑分母不一致

- **✅ 結算分數動畫終點錯誤已修復**：使用者真機回報「衝線瞬間結算數字沒跑完就停住」——
  車速快時停在 96，減速後停在 98，理論上完賽應該是整數（如 1600）。根因：結算畫面「0→終值」
  的滾動動畫（[GameCanvas.tsx:238](src/game/GameCanvas.tsx:238)）讀的是 `hud.points`，
  但即時 HUD 是**每 5 幀才節流同步一次**（效能考量，見 `hudTick % 5 === 0`），衝線/摔車瞬間
  這個節流值可能落後真實分數 1~4 幀——車速越快、每幀走的分數越多，落差越大，完美解釋
  「快=96、慢=98」的規律。真正即時、每步正確更新的是另一個變數 `points`（非 React state），
  `onGameOver` 回呼本來就是傳這個正確值，只有結算動畫的「終點目標」抓錯來源。
  修法：新增 `finalScoreRef`，在 `points` 每次更新的同一行同步（不節流，見
  [GameCanvas.tsx:159](src/game/GameCanvas.tsx:159) 宣告處），結算動畫改讀這個 ref 當終點
  （[GameCanvas.tsx:243](src/game/GameCanvas.tsx:243)），不動任何計分公式本身（行進分/翻轉分/
  完美落地都完全不變）。**⚠️ preview 隱藏分頁 rAF 暫停測不到完整的衝線流程，待真機確認滾動
  動畫終點正確**。
- **✅ 圖鑑分母不一致已解決（移除車庫內重複顯示）**：使用者發現首頁「📖 圖鑑」按鈕（開
  `Encyclopedia.tsx`，讀 `stock_registry` 永久登記表，1367）跟車庫頁的「📖 圖鑑 X/Y」小字
  （讀 `daily_map` 當期清單，1259）分母不同——前者是「史上總數（絕版制，只增不減）」，後者
  是「今天實際有走勢資料的股票數」，兩個概念本來就不同，不是抓取錯誤。使用者判斷車庫內這行
  沒有必要（跟首頁按鈕功能重複），**直接移除 Garage.tsx 的圖鑑小字顯示**，保留首頁按鈕做為
  唯一入口，不用處理兩個分母如何統一的問題。

### 🔧 2026-07-07 下午批次：訪客鎖定 + 金幣經濟調整 + 車款改名排序 + 1000 支股票 bug

使用者這天用 Sonnet 主機發現並修復幾個小問題（純前後端小改動，非架構級）：

- **✅ 排行榜訪客鎖定**：`DailyChallenge.tsx` 原本未登入玩家只顯示「登入後成績才會上榜」提示，
  按鈕實際仍可點、還會消耗每日 5 次額度——現已改成 `canPlay` 要求 `!!user`，未登入按鈕顯示
  「登入才能挑戰」並 disabled。同想玩免登入版本走自選賽道即可，排行榜直接要求登入更單純。
- **✅ 跨帳號本機次數快取隔離**：發現 `tr_daily_att_{sessionDate}` key 不分帳號，同裝置切換
  A/B 帳號（或訪客）會沿用前一個使用者當天用掉的次數（真正的伺服器端把關 `consume_attempt()`
  per-uid 沒問題，只有本地顯示快取跑掉）。改成 key 加 uid（`tr_daily_att_{uid|guest}_{sessionDate}`），
  `challengeAttempts.ts`/`DailyChallenge.tsx` 對應更新，帳號切換時（`user?.id` 變化）重新讀取。
- **✅ 金幣經濟調整**：完賽/摔車獎勵原本 10/3、且各自用「次數」算每日上限 30 次（等於單日最多
  300/90 金幣），太容易靠刷短賽道無限賺。改成完賽 5／摔車 2，兩者合併算「金幣數」單日上限 50
  （`src/lib/playRewards.ts` 前端樂觀顯示版 + `supabase/migration_20260707c.sql` 的
  `wallet_earn()` 伺服器權威版，兩邊都要改否則已登入玩家會被伺服器覆寫回舊數字）。每日/週任務、
  看廣告的各自每日上限不受影響（使用者明確要求範圍只算完賽/摔車）。
- **✅ 廣告次數獨立性確認**：查證車庫「看廣告拿金幣」（`tr_ad_coin_claims_{day}`）跟排行榜
  第 3~5 次挑戰的「看廣告開始」標籤完全是兩組獨立 key/邏輯，沒有共用狀態，如使用者預期，
  不用改。
- **✅ 車款改名+重新排序定價**：`garage.ts` 的 `BIKE_SKINS` P 系列（陣列宣告順序＝ Garage.tsx
  顯示順序，id 不變）改成赤紅暴走300／電馭武士380／黃金期貨450（原黃金大亨）／匿蹤幽靈520
  （原幽靈匿蹤）／銀河鍍鉻600（原本最便宜 380，現在改成最貴）；Q3「不死鳥」改名「火鳳凰」
  （`achievements.ts` 的 `AchvBikeView` 名稱要跟 `garage.ts` 分開改，兩處各自獨立宣告容易漏改）。
  伺服器端 `wallet_spend_skin()` 白名單同步更新（同一份 `migration_20260707c.sql`）。
  **✅ `migration_20260707c.sql` 已跑（2026-07-07 使用者確認）**，已登入玩家的扣款/發幣
  改用新數字生效。
- **✅ 「1000 支股票」謎團解開，非程式碼問題**：`RandomSlot.tsx`/`Garage.tsx` 顯示的股票池
  總數卡在剛好 1000 這個整數超過一個月，即使股票代號涵蓋範圍擴大（`/^\d{4,6}[A-Z]?$/`）
  應該要多出 ~200 筆也沒反應——原因是 **Supabase Data API 的「Max Rows」設定預設 1000**，
  不管 `dailyMap.ts` 的 `fetchDailyMapList()` 客戶端要求 `limit=2000` 多少，伺服器端都會
  默默把回傳砍到 1000 筆，不報錯。**使用者已自行到 Supabase Dashboard（Settings → Data API →
  Settings → Max rows）改成 2000**，改完後圖鑑總數立即從 1000 變成 1259，證實修復成功。
  這是 Supabase 專案設定，不是程式碼，repo 內無需任何變動。

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
- [x] 留存④：全服死亡熱點 已完成（v0.12.11 已推。**✅ `supabase/migration_20260702b.sql` 已跑**（含熱點 RPC + 統計頁 admin RPC，一份搞定）。`src/lib/deathHeatmap.ts` + DailyChallenge 20 格熱度條（對齊走勢圖）+ 遊戲內 top3 ☠️×N 標記；RPC 未建/無資料時優雅隱藏，preview 驗證 OK）
- [x] 隱藏統計頁 已完成（v0.12.12 已推。設定→連點版本號 5 下→StatsScreen；資料走 `admin_stats` RPC 綁 email，未登入/非 admin 顯示無權限。依賴的 migration_20260702b.sql 已跑，真機用開發者帳號登入後驗證有數據）
**待辦進度**：
1. **✅ `supabase/migration_20260702b.sql` 已跑**（死亡熱點 + 統計頁 RPC；第一份 migration_20260702.sql 也已跑過）。
2. **✅ vc10 AAB 已於 2026-07-02 晚上傳封測軌道，真機驗證開機正常**。splash 圖／長按捷徑／返回鍵操作皆已真機確認 OK（2026-07-03）。**唯獨「預測性返回手勢動畫」本身還不確定是否測到**（需用手勢導覽從螢幕邊緣滑動才看得出效果，若手機是按鍵導覽則無從驗證）。
3. **✅ 真機測 v0.12.7~12 已確認**：完美落地合併 toast、PB 徽章、streak、分享圖卡（面板帶圖）、死亡熱點、統計頁，皆 OK（2026-07-03）。

**剩餘任務**：
- [x] **平地縫隙卡輪** 已完成（v0.12.13 已推，2026-07-03 公司）。模擬結論顛覆原假設：「平地-平地接縫」定點落下矩陣（新增 `scripts/simDrop.ts`，5000+ 組合）0 卡住；真因＝凹角/凸角/峰頂的**機械性卡死**（油門把輪子壓進轉角縫，放開即脫困）。修法＝GameCanvas **卡縫自動脫困 watchdog**（0.67s 零前進→自動放油門 1s→恢復），模擬驗證難度零影響（完賽率 1727 vs 1711/2000）。地形側 lip 方案會讓摔車率 14.5%→4.5%（難度大變）→ **封測期間不動，記錄在 DEVDOC §5.4b 供正式版後決策**。**⚠️ 待真機試玩確認脫困手感**（preview 無法造出卡死情境）。
- [x] **三項問題修復** 已完成（v0.12.14 已推，2026-07-03 公司，使用者當場回報）：
  1. 翻轉計分改線性＋倍率定案：每圈固定 +100（移除舊遞增制 `flipScoreStep`），完美落地＝剛才那趟翻轉分 ×2（2圈普通 200／完美 400）。preview 實測 toast 已驗證「完美落地 1 圈 +200」符合公式。
  2. 修正「尾段飛起來、飛越終點線時人還在空中」漏算翻轉分：完賽判定舊邏輯不管是否著地就立刻凍結車身，該趟翻轉/完美落地永遠沒機會落地結算。改為越線瞬間若翻轉未結算，用當下狀態強制呼叫共用的 `settleFlip()`（與一般落地路徑同一份邏輯，已驗證）。**⚠️ 此情境 preview 無法重現（需飛越終點線瞬間仍在空中，且 headless 難精準engineered），待真機試玩確認**。
  3. 修正摔車/完賽瞬間結算面板按鈕被誤觸（分享成績等）：面板出現後 350ms 內 `pointer-events:none`，避免手指還按著油門時面板換出、抬指剛好點到新按鈕。
  - `RULES.flipScoreStep`、`RULES.perfectBonus`（已無引用，死碼）一併移除。
- [ ] 留存後續批次見 [RETENTION_PLAN.md](RETENTION_PLAN.md)（週任務/圖鑑已上線；經典週榜/好友邀請比較/週五馬拉松/Web Push 2026-07-07 已決定取消，詳見待辦第 4 項）
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
  - **✅ `supabase/migration_20260702.sql` 已跑**（events 表 + log_event RPC + 資安補強，一次跑完）。
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

> **2026-07-04 全面盤點**：[FABLE5_HANDOFF.md](FABLE5_HANDOFF.md) 清單裡 debug/監控/內容改善/原生體驗/拉霸音效/OG分享/留存規劃/android三項/上架檢查/ASO **全部已完成並上線**；[BETA_FEEDBACK.md](BETA_FEEDBACK.md) 的 #1/#2/#3 也都已解決。反作弊 Phase A 已於 2026-07-04 下午實作完成（migration 已跑）——見下方「真正還沒做的事」第 1 項。

- **廣告第二階段（正式上架後）**：填入真實 `ADSENSE_PUB_ID`（`ca-pub-8981745966447649`）→ 網頁版 AdSense 生效；復活按鈕先播廣告再 `requestRevive()`；Android 原生層串 AdMob Rewarded（TWA intent bridge）；車庫「看廣告拿金幣」也要換掉 `ads.ts requestRewardedCoins()` 的 stub。
- **✅ 待真機驗證累積項已確認（2026-07-03）**：v0.12.0 懸空計時/復活、v0.11.0 TWA 返回離開、經典模式 12 條地形手感、v0.12.3 地形變高手感、v0.12.4 震動/拉霸音效手感，皆 OK。

### 🎯 真正還沒做的事（2026-07-04 盤點，非本週交接清單順序）

1. **反作弊機制**：✅ **Phase A 已實作**（2026-07-04 下午，Fable 5）——`supabase/migration_20260704.sql`（submit_daily_score / submit_classic_record 加欄位間物理一致性驗證 + 10s 提交冷卻 + 經典 level_id 白名單），**✅ 已在 Supabase SQL Editor 跑過生效**。上線前已拿線上真實資料回測（27 筆 daily + 12 筆 classic，0 誤殺）；與 ANTICHEAT_DESIGN.md 原公式有三處刻意偏差（照抄會誤殺 16/27 筆真實成績）：分數上限加 slack +500 容忍 v0.12.14 前舊計分制的未更新客戶端（普及後可收緊）／時間下限改用「分數隱含行進比例」因摔車也會提交、不能假設完賽／冷卻 30s→10s 因實測完賽時間中位數僅 17s。理由全寫在 migration 檔頭與 ANTICHEAT_DESIGN.md 檔頭。Phase B（DB 端次數上限＋離群偵測）等正式上架後；Phase C（操作事件序列＋Ghost）跟留存規劃的 Ghost 回放一起做。**同日第二輪資安檢查也完成**（[SECURITY_REVIEW.md](SECURITY_REVIEW.md) 新增 2026-07-04 段落，涵蓋車庫/金幣/quests 等新系統；最重要結論：**P 系列 IAP 上線時擁有權必須伺服器端驗證**，不可沿用 localStorage 擁有清單，否則改個 localStorage 就免費解鎖付費車）。**同日晚場（使用者指示「漏洞不留到上架」）追加修補**：`supabase/migration_20260704b.sql`（log_event 三層節流修灌爆面 + cleanup_old_scores_if_needed 收權，**✅ 已跑**；收權後 cron-job.org 的 cleanup 排程可刪、keepalive 保留，CI fetchDailyMap.ts 已接手每日呼叫）＋ `public/_headers`（nosniff/XFO/Referrer-Policy/Permissions-Policy＋CSP——先 Report-Only 部署、使用者桌機 PWA 走完登入/遊玩/分享全流程 console 零違規後**已轉正式執法**；日後加 AdSense 等新外部資源要先補 CSP 白名單）＋ GitHub Actions pin SHA。migration_20260704b 使用者當晚已跑、cron-job.org cleanup 排程已處理。**localStorage 金幣/擁有清單竄改問題使用者明確不接受擱置**——同晚拍板伺服器端錢包＋每日 5 次上限搬 DB，原訂 7/5 動工，**使用者當場改口「不用等 7/5，現在就處理」，2026-07-04 當晚已提前實作完成**：`supabase/migration_20260705.sql`（`player_wallet`/`wallet_earn_log`/`wallet_daily_attempts` 三表 + `wallet_get`/`wallet_earn`/`wallet_spend_skin`/`wallet_unlock_achievement`/`wallet_dev_grant`/`consume_attempt` 六個 RPC，鑽石車款 P1/P2 也一併納入 `wallet_spend_skin` 白名單），客戶端 `garage.ts`（`syncWalletFromServer`/`earnCoins`/`purchaseSkin`/`unlockAchievementSkin`/`grantDevWallet` 全改成「已登入→伺服器 RPC 為權威，本地只當顯示快取；未登入→維持純本地」）+ `App.tsx`（dev grant 改走 RPC）+ `Garage.tsx`/`GameCanvas.tsx`（發幣改呼叫 `earnCoins`）+ `DailyChallenge.tsx`/`challengeAttempts.ts`（開局改先問 `consume_attempt()` RPC，伺服器判定達上限則擋，清 localStorage 對已登入玩家不再有效）皆已改完，typecheck 過、preview 驗證未登入路徑零回歸（購買/裝備/進遊戲皆正常）。完整規劃見 [WALLET_PLAN.md](WALLET_PLAN.md)（已加註完成狀態）。**✅ `migration_20260705.sql` 已跑生效**，已登入玩家的購買/發幣/次數限制皆由伺服器端把關。
1b. **🐛 登出/切帳號不刷新 bug** ✅ **已修復**（2026-07-06）：不只是 `signOut()` 沒清錢包快取，
    追加討論後發現暱稱/Q 系列成就/streak 三個裝置共用 key 也不分帳號、也沒清，且已導致
    tommyisboy08@gmail.com 測試帳號被誤解鎖 Q 車款（伺服器端真實資料，使用者已手動 SQL 清除）。
    修法/驗證狀態詳見 [NEXT_BATCH_PLAN.md](NEXT_BATCH_PLAN.md) 批次 1，核心是 `supabase/migration_20260706.sql`
    （新增 `get_player_name`/`record_market_finish`/`player_achievements`/`player_streak`，
    `wallet_get`/`consume_attempt`/`wallet_unlock_achievement`/`wallet_dev_grant` 改造）+
    `auth.ts`/`garage.ts`/`achievements.ts`/`streak.ts`/`challengeAttempts.ts`/`DailyChallenge.tsx`/
    `Garage.tsx`/`App.tsx` 客戶端配合。**✅ `migration_20260706.sql` 已跑**。
2. **鑽石車款（P 系列，5 台）＋鑽石購買頁**：✅ **2026-07-07 五台全數生圖完成上線**——P1赤紅暴走/P4電馭武士/P3黃金期貨（原黃金大亨）/P5匿蹤幽靈（原幽靈匿蹤）/P2銀河鍍鉻，車庫「鑽石車款」區塊皆可購買/裝備。**同日下午使用者拍板重新排序定價**（銀河鍍鉻改成最貴）：赤紅300／武士380／黃金期貨450／匿蹤幽靈520／銀河鍍鉻600（id 不變，IAP 真實定價待穩定後再決定）。**✅ `supabase/migration_20260707b.sql` + `migration_20260707c.sql` 皆已跑**（b 先補上 P3~P5 白名單，c 再重排定價，create-or-replace 疊加生效）。鑽石真錢購買頁（`diamonds_100/350/1200` IAP）已於 2026-07-06 上線，但截至 2026-07-07 早上「暫無法購買」——判斷是 Play Console 商品剛建立+商家帳戶剛核准的正常同步延遲（首次設定常見 24~48 小時），已確認商品狀態「有效」、測試人員 opt-in 正常，非設定錯誤，持續觀察中。
3. **RETENTION_PLAN 第二批**：✅ **2026-07-06 使用者點頭 schema 後全部動工完成（v0.12.29 已推）**——狂暴盤日事件（門檻 2.5%，用 TAIEX 近 2 年實測資料校準）、股票圖鑑（`player_collection` 表，自選/長征騎過的個股永久收集）、週任務（`player_weekly_quest` 表，仿每日任務放大成週尺度）、經典模式前三名（取代原「Top N + 百分位」規劃，使用者拍板簡化成單純前 3 名不算百分位）。schema 全部寫在 `supabase/migration_20260706b.sql`。歷史紀念日事件使用者 2026-07-06 決定不做（效益不大、無法涵蓋全年）；經典週榜原本待規劃，**2026-07-07 使用者決定直接取消**（更完整的賽季式競爭感留給批次 6 週聯賽分組）。詳見 [NEXT_BATCH_PLAN.md](NEXT_BATCH_PLAN.md) 批次 5。
   **✅ 2026-07-06 真機驗證**：圖鑑換裝置正常、經典前三名運作正確、週任務正常運作；狂暴盤待實際遇到 ≥2.5% 交易日才能驗證。
   **股票圖鑑 2026-07-06/07 討論後升級成完整彈窗（v0.12.30 已推，批次 5b）**：首頁「📖 圖鑑」按鈕（跟收藏車庫同一行）開啟 `Encyclopedia.tsx` 彈窗，兩欄卡片＋依代號排序＋篩選未收集/已收集/全部＋已收集打星星；分母改「絕版制」（下市股票標記絕版但永久保留，總數只增不減），新增 `stock_registry` 永久登記表（`supabase/migration_20260707.sql`），`fetchDailyMap.ts` 每天 upsert 官方上市清單維護（含安全防呆：清單過短不執行絕版判定）。**✅ `migration_20260706b.sql` + `migration_20260707.sql` 皆已跑**。
4. **RETENTION_PLAN 第三批**（週聯賽分組、Ghost 回放、排行榜 emoji 反應）：長期規劃，工程量大，未排入近期；Ghost 回放依規劃需跟反作弊第四層一起設計，屬 Fable 5 範圍。~~好友邀請比較~~、~~週五馬拉松~~ 使用者 2026-07-07 決定取消（前者沒有實際需求、後者概念了無新意），週聯賽分組（30 人小組升降級）確認是之後想做的「更完整聯賽系統」，取代這兩者。
5. ~~**BETA #4（前翻/煞車鈕操控）**~~：**2026-07-04 使用者決定不做，取消**（見 [BETA_FEEDBACK.md](BETA_FEEDBACK.md) #4）。
6. ~~**Web Push 通知**~~：**使用者 2026-07-07 決定取消**——判斷「想玩的玩家會自己來玩」，且遊戲類推播通知自己也不太會點，加上需另申請 Firebase/FCM 專案工程量不小，投報率不划算，不再規劃。
7. **殼版本更新提示**：設計已備妥（DEVDOC §9.5b 方案 A），**2026-07-07 使用者決定不必單獨為此重包一次 AAB，改成「下次不管什麼原因需要重包 AAB 時（例如之後 AdMob 原生串接需要動 android/），順便一起包進去」**。
8. **廣告正式串接**（見上方「廣告第二階段」）：技術阻塞在「必須先正式上架」，非能力問題。
9. **📌 正式上架後：清空伺服器所有玩家「玩過的遊戲數據」**——**✅ 2026-07-09 SQL 已寫好備用**：
   [supabase/prelaunch_cleanup.sql](supabase/prelaunch_cleanup.sql)，清 `daily_scores`／
   `classic_records`／`events`／`daily_diamond_settlement`／`classic_diamond_settlement`
   五表；明確不動 `daily_map`/`stock_registry`（遊戲需要的資料）、`player_wallet`（金幣鑽石，
   使用者交代不用清）、`user_profiles`（帳號）、`iap_purchases`（金流防重放憑證）。
   `wallet_earn_log`/`wallet_daily_attempts`/`player_weekly_quest` 本來就有滾動清理排程，
   不需要手動清；`player_achievements`/`player_streak`/`player_collection` 這次使用者沒
   點名要清，維持不動。**尚未執行**，由使用者自行決定時機（上架前/上架當天皆可）在
   Supabase SQL Editor 手動跑，不會自動觸發。

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
  5. ~~**Web Push 通知**~~（中期，需接 FCM）：**2026-07-07 使用者決定取消**，見文件開頭待辦第 6 項。
  - ❌ **明確排除**：完美落地慢動作/hitstop（使用者不要這項）
- [x] **全站盤勢主題氛圍** 已完成（v0.12.18 已推）。`src/lib/marketMood.ts`＋首頁小字說明「今日盤勢為 X/X 之盤勢，收盤上漲/下跌」。只疊背景色調不動品牌互動色，詳見 RETENTION_PLAN.md「盤勢事件化」段落。preview 用真實資料驗證通過。
- **每日任務系統 v1** 已完成（v0.12.16 已推，[x]）：`src/lib/quests.ts`，每日 3 個任務（seeded by 裝置本地日曆日，全服同一天同一組任務池，各自進度獨立），完成自動發金幣，UI 在 DailyChallenge 頁面 streak 下方。**v1 只用 GameOverStats 既有欄位**（分數/翻轉/完美/時間），不含股票類股/模式限定任務——那類需要額外資料，留給 v2。
- **反作弊實作**：✅ Phase A 已完成且 migration 已跑（2026-07-04）——詳見文件開頭「## 待辦」→「🎯 真正還沒做的事」第 1 項，避免重複維護同一件事的兩份說明。
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

- [x] **P1/P2 開放測試 + 鑽石/金幣雙通貨 + 車款分級調整** 已完成（v0.12.27 已推，2026-07-04）。使用者確認 P1/P2 圖檔品質已達標，不應再是「敬請期待」佔位卡：
  1. 車庫「付費車款」區塊改名「**鑽石車款**」（「付費」字眼太直接）。
  2. 新增**鑽石**軟通貨（`garage.ts` `getDiamonds`/`addDiamonds`，key＝`tr_garage_diamonds`，邏輯與金幣對稱）。**目前鑽石沒有任何獲取管道**（無廣告/任務/完賽獎勵）——之後要接 Google Play Billing 才會開一個「購買頁」讓玩家花台幣分別買鑽石或金幣，鑽石車款的真實售價/是否保留鑽石中介層屆時再決定。**目前只有開發者測試帳號（`tyl161803@gmail.com`）登入會補滿 99999 鑽石**（`App.tsx`，跟金幣同一段邏輯），所以現階段鑽石車只有使用者能裝備，符合預期。
  3. P1 赤紅暴走／P2 銀河鍍鉻正式從「敬請期待」佔位卡改成可購買/裝備的正式車皮：用 OpenCV HoughCircles 對 `public/bikes/For_Gaming/P1_ClassicRed.png`／`P2_Galaxy.png` 的 alpha 遮罩量測兩輪中心（跟 v0.12.26 五台同一套方法論），算出 `spriteW`/`spriteOffsetX`/`spriteOffsetY` 登記進 `garage.ts`（`currency:"diamond"`，價格暫定 P1 300／P2 380，待 IAP 真實定價後再調），並用 Python 依 GameCanvas 繪圖公式疊圖驗證輪位對齊（見下方踩雷筆記）。P3~P5 尚未生圖，維持「敬請期待」不變。
  4. 車款分級再調整：復古咖啡騎士／街頭通勤小白從 v0.12.20 的「免費」改回**金幣購買**（咖啡騎士 200／小白 150，使用者拍板收回免費）；街頭通勤小白移除名稱裡的「」符號，改純文字「街頭通勤小白」。
  - **⚠️ preview 只能驗證購買/裝備流程與圖片載入無 404（已用 preview_snapshot/eval 實測 OK），輪位對齊手感同 v0.12.26 仍需真機/可見視窗確認**。
  - **📌 使用者交代的重要提醒（尚未執行，等使用者正式申請通過 Google Play 正式版時才動手）**：正式上架時要把伺服器上所有玩家「玩過的遊戲數據」清空歸零（daily_scores/daily_scores_ranked 每日排名榜歷史成績、classic_records 經典模式紀錄、events 統計事件等），讓路人拿到乾淨的新遊戲；**但絕對不能動已註冊的 Google 帳號/user_profiles**（帳號本身要保留，只清「玩過的記錄」）。屆時動手前務必先跟使用者逐表確認要清哪些、跟使用者一起看過 schema 再清，不要自行判斷。

#### 🟠 未來規劃（discussion 記錄，待決策／Phase 4 後端）

- **#7 網頁版偷玩**：`taiexrider.pages.dev` 永遠公開，TWA 只是包這個 URL，技術上封不掉。對策上限：robots.txt 不索引、不公開宣傳 URL、Phase 4 後端對每日資料加 Token（只認 Play 包請求）。MVP 不值得做，接受現實。
- **#10 每日挑戰 + 廣告 + IAP（商業模式）**：基本分＝跑完即固定底分；加分＝完美落地次數×N；**同分用時間排名**（越短越前）；死亡→看 15s 廣告復活一次；IAP＝買斷永久去廣告。需 Phase 4 後端 + 排行榜 API；廣告 AdMob、IAP Google Play Billing。**結算已先備好 totalFlips/perfectLandings/timer 三項數據，排名所需欄位齊全。**

- **廣告雙軌架構（2026-06-23 決策，2026-07-07 調整優先序）**：
  - **Android APK（TWA）** → AdMob 原生 SDK（Rewarded Ad，死亡復活）**優先做**。
  - **網頁版 / iOS Safari** → Google AdSense（Interstitial 插頁式）**暫緩，不急**——2026-07-07 使用者說明：目前沒打算公開 `taiexrider.pages.dev` 網址宣傳，網頁版只給認識的 iOS 朋友玩，量很小，先不串 AdSense 也沒差；**之後如果偵測到網頁玩家變多再加**（`src/lib/ads.ts` 的 TWA/網頁分流偵測已做好，屆時隨時可補上 `ADSENSE_PUB_ID` 開通，不用重新設計）。
  - **避免雙重廣告**：TWA/網頁分流偵測已做（`src/lib/ads.ts`，display-mode 偵測，referrer 在此 TWA 不可靠）
  - **實作順序（調整後）**：申請 AdMob → Android 串 AdMob Rewarded（死亡復活/每日拿金幣/排名賽額外挑戰，取代目前 `requestRewardedCoins()` 的秒發獎勵 stub）→ AdSense 等網頁流量成長再評估。
  - **✅ AdMob 帳戶+應用程式+廣告單元已建立（2026-07-07 下午）**：App 名稱 `TAIEX RIDER`（Android，尚未連結 Play 商店 listing，因還在封測——待正式上架後回 AdMob「應用程式設定」補連結+完成放送資格審核）。
    - App ID：`ca-app-pub-8981745966447649~3758790919`
    - 廣告單元 `revive_reward`（死亡復活用）：`ca-app-pub-8981745966447649/1679422480`
    - 廣告單元 `coin_reward`（看廣告拿金幣用）：`ca-app-pub-8981745966447649/2170377077`
    - 帳戶審核+廣告單元啟用最多需 24 小時，Google 端跑；真正串 SDK 進 `android/` 專案仍照原計畫排在正式上架過審後。
  - **宣傳時機**：正式上架即可宣傳，不用等廣告上線；廣告作為之後的更新，本身也是二次宣傳機會
- ~~ETF 含字母代號納入每日地圖~~：✅ **已完成（2026-07-06）**。實際拉 TWSE 資料驗證後範圍
  比預期大很多——1368 支上市證券裡有 278 支（~20%）不是純 4 位數字（ETF 4/5/6 位數、
  槓桿反向 K/L/R/T/U 字母尾、多幣別計價 A~I 字母尾），舊版 `/^\d{4}$/` 全部濾掉。改成
  `/^\d{4,6}[A-Z]?$/`（`scripts/fetchDailyMap.ts`），驗證後僅 1 支特別股例外不處理。
  下次 16:00 排程執行後生效。

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
