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

> ## 🔧 2026-07-21（第八輪追加）：修 j 的「提交才更新」落差——排行榜裝備改即時查詢
>
> 使用者跑完第七輪的 `migration_20260721j.sql`、真機測試後回報：排行榜完全沒
> 顯示任何裝備，**連自己那列都沒有**——比 j 之前（純本地讀）還倒退。根因：j 把
> 裝備存成「提交成績當下」的快照，只有真的改善分數那次提交才會更新，使用者
> 當下已打完當日次數上限，沒機會刷新快照。深層原因：一開始就不該用快照繞過
> `daily_scores_ranked` VIEW 沒有權限 join `player_wallet` 的限制，該直接讓
> 查詢本身走 security definer RPC。已修：新增 `get_daily_top()` RPC 即時 join
> `player_wallet.equipped`，取代 VIEW 查詢；`get_daily_ghost_path()` 同步改
> 即時查詢；撤回 j 加的快照欄位/邏輯。**裝備變更現在立刻對所有人生效，不用交
> 新成績才刷新**。完整記錄見 [LOTTERY_DESIGN.md](LOTTERY_DESIGN.md) §15。
>
> typecheck/build/`cap sync android` 全過，preview 驗證無 console error。
> **使用者待辦**：Supabase SQL Editor 依序跑 `migration_20260721i.sql` →
> `j.sql` → `k.sql`（j 大部分被 k 撤回/改寫，但三份都要跑過一次）；下次重新
> 打包 Android（versionCode 已在上一輪推進到 37，這輪沒有再往上加）。
>
> ## 👀 2026-07-21（第七輪追加）：個人化裝備改成真的能被別人看到——vc36 之後
>
> 上一輪（第六輪）的伺服器權威修復打包上架（vc36）後，使用者追問一個更根本的
> 問題：「本來就該讓別人看得到才有這個價值」。查證後發現：這整批「個人化裝備」
> 從最初設計開始，**排行榜暱稱顏色/稱號/前綴圖示、鬼影顏色全部都是純自己手機
> 看自己的裝飾，別人完全看不到**——`DailyChallenge.tsx` 只在「排行榜這一列的
> 暱稱＝自己的暱稱」時套用**自己**裝備的東西；鬼影顏色也是讀「正在看的這個人
> 自己」的裝備，不是紀錄保持者的。花鑽石買的東西效果是「自己看自己爽」，不是
> 「秀給別人看」。
>
> **✅ 已修**：`daily_scores` 新增 `cosmetics jsonb`，`submit_daily_score` 提交
> 分數時直接讀伺服器權威 `player_wallet.equipped` 存快照（`daily_scores_ranked`
> VIEW／`get_daily_ghost_path()` 一併吐出）；`DailyChallenge.tsx` 拿掉「只認自己
> 那列」的比對邏輯，改成每一列直接讀該列自帶的裝備資料，任何人打開排行榜都看得
> 到別人裝備了什麼；`GameCanvas.tsx` 鬼影顏色改讀鬼影紀錄保持者自己的顏色（新增
> `ghostColorId` prop），不再是查詢者自己的偏好。範圍只做每日排名賽，經典模式
> 排行榜（`ClassicSelect.tsx`）版面窄、不同表，這次不動。完整記錄見
> [LOTTERY_DESIGN.md](LOTTERY_DESIGN.md) §14。
>
> typecheck/build/`cap sync android` 全過，preview 驗證訪客視角每日排名賽頁無
> console error（實際「別人看得到你裝備的東西」效果需兩個帳號都交過分數才能
> 驗證，preview 測不到，需真機/多帳號手動確認）。**使用者待辦**：① Supabase SQL
> Editor 依序跑 `migration_20260721i.sql`（如果還沒跑）→ `migration_20260721j.sql`；
> ② 下次重新打包 Android。
>
> ⚠️ **順便發現並修正一個版號追蹤落差**：對話中途發現使用者在 Android Studio
> 本機把 `build.gradle` 改到 36（跳過 35，兩次都直接在本機改、打包上傳，沒有
> commit 回 repo）——這代表 repo 版號紀錄跟 Play Console 實際狀態曾經對不起來
> 好幾輪（本檔先前寫「使用者已自行推進到 35」其實不準確，應為 36）。已把這個
> 未提交的本機改動一併撿起來、推進到 **37**（本輪修復要進的下一個號碼）跟著
> 這批一起 commit，避免下次又忘記回寫。**日後在 Android Studio 直接改版號後，
> 記得比照 CLAUDE.md 守則 2「動到程式碼就要 commit+push」，版號本身也算需要
> 回寫進 repo 的狀態，不要只停在本機**。
>
> ## 🔧 2026-07-21（第六輪追加）：個人化裝備「重開就消失」改伺服器權威 + 首頁入口鈕排版變形修復——vc35 之後
>
> 使用者 vc35（自行推進版號並打包上架）真機實測回報兩項問題：
>
> 1. **🔴✅ 真正的 bug：稱號/暱稱顏色/前綴圖示/尾焰特效顏色/鬼影顏色，裝備後重開
>    App 就回到未裝備的乾淨狀態**。診斷問句先確認範圍：車庫顯示「已擁有」正常
>    （框線在，購買紀錄沒丟），只是沒有裝備中的框——證實 `owned`（伺服器同步）
>    完全可靠，問題只在「目前裝備哪一個」這個狀態。根因：這個狀態上一輪刻意設計
>    成「純本地偏好」（`tr_${kind}_active_${uid}` 只寫 localStorage，比照車皮
>    選用 `activeSkinKey()` 的既有慣例），但車皮選用用了半個月沒事，這批全新
>    功能卻在使用者裝置上重開就丟——與其去猜是哪個 Android WebView/Capacitor
>    環節弄丟這個純本地 key，不如直接借用「`owned` 這條伺服器同步路徑在同一台
>    裝置上已證實 100% 可靠」這個事實：改成跟 `owned` 同一套「伺服器權威＋本地
>    只當顯示快取」機制。已改：`player_wallet` 新增 `equipped jsonb` 欄位、新
>    RPC `wallet_set_cosmetic()`（裝備前驗證必須在 `owned` 清單內）、`wallet_get()`
>    第四次擴充輸出欄位加回 `equipped`（完整複製前一版 12 欄位，只加尾端這個，
>    避免重演前三次漏抄舊欄位的事故）、`garage.ts getActiveCosmetic()`/
>    `setActiveCosmetic()` 改讀寫伺服器同步的本地快取（後者改 async）。完整記錄
>    見 [LOTTERY_DESIGN.md](LOTTERY_DESIGN.md) §13。
> 2. **✅ 首頁入口鈕排版變形**：真機窄螢幕下「收藏車庫」四個字被擠壓到逐字換行
>    （icon+金額+文字全塞同一行）。`Home.tsx`/`Home.css` 三顆入口鈕（收藏車庫/
>    圖鑑/幸運轉輪）改上下兩排（icon+數值一排、文字標籤另起一排），不受寬度擠壓。
>
> typecheck/build/`cap sync android` 全過，preview 驗證訪客車庫頁無 console
> error、入口鈕文字改成單行不換行（訪客看不到個人化裝備區塊，登入後的實際裝備/
> 重開持久化效果需真機或 PWA 走一次確認）。**使用者待辦**：① Supabase SQL
> Editor 跑 `migration_20260721i.sql`；② 下次重新打包 Android 才會生效
> （PWA push 後網頁版立即生效）。
>
> ## 🐛 2026-07-21（第五輪追加）：個人化裝備真機實測 5 個 bug 全修
>
> 使用者拿上一輪剛接進畫面的個人化裝備實測，回報 5 項問題，逐一排查後修復：
>
> 1. **✅ 機率表拿掉黑天鵝/看不見的手前面的 emoji**（`LotterySlot.tsx ODDS_TABLE`）
>    ——單純文案調整，跟其他獎項列的格式（無 emoji 前綴）一致。
> 2. **🔴✅ 真正的 bug：成就稱號（連勝狂魔等 5 個）解鎖後點「裝備」沒反應**。
>    根因：`garage.ts unlockAchievementSkin()` 原本寫死 `if (!BIKE_SKINS.find(...))
>    return false`——這支函式最初只給 Q 系列車皮解鎖用，2026-07-21 稍早擴充給
>    5 個成就稱號（`title:win-streak` 等，純 cosmetic id，本來就不在 `BIKE_SKINS`
>    裡）共用時忘記拿掉這條車皮限定的檢查，導致稱號「已達成」（純進度判斷）但
>    `owned` 清單從沒真的寫入，裝備按鈕內部呼叫 `setActiveCosmetic` 的
>    `isOwned` 檢查永遠失敗、靜默不做事。已移除該檢查（呼叫端本來就已經用
>    `achievements.ts` 的 unlocked 進度把關，不需要在這裡重查）。
> 3. **🔴✅ 真正的 bug：可購買稱號除了「台股股神」全部點了沒反應**。根因：
>    `wallet_spend_item()`（`migration_20260721.sql`）的 SQL 白名單還停在
>    2026-07-21「第一輪」的舊稱號目錄（連勝狂魔/排行榜常客/空中飛人/地心引力
>    挑戰者/完美落地大師/台股股神），但同一天稍晚「第二輪」已把可購買稱號整批
>    換成股市梗（新手騎士/台股股神/擦鞋童/擦鞋董/多空交戰/公園街友/財經皓角/
>    韭菜/第四大法人，原本那 5 個改成就解鎖不可購買），SQL 白名單忘記同步——
>    只剩「台股股神」剛好新舊版都有才正常。已用
>    `supabase/migration_20260721h.sql` 更新白名單跟 `Garage.tsx` 現況一致
>    （⚠️ 待使用者手動跑）。
> 4. **✅ 個人化裝備購買加確認彈窗**：`Garage.tsx handleCosmeticClick` 原本點擊
>    未擁有項目直接呼叫 `walletSpendItem` 扣鑽石，改成先跳確認彈窗（沿用既有
>    「消耗票券跳過廣告」彈窗同一套 `.modal-overlay`/`.slot-result` 樣式），
>    按「確定購買」才真的扣款，防手滑誤買。
> 5. **✅ 排行榜稱號改到暱稱下面第二排顯示**：`DailyChallenge.tsx`／`.css`
>    `.rk-user` 改成直向排列（暱稱+前綴圖示一行、稱號 pill 另起一行），不再
>    塞在暱稱後面被裁掉；`.rank-row` padding 微調給兩行內容留呼吸空間。
>    `ClassicSelect.tsx`（單行小卡×3名×12關）版面太窄，維持只套暱稱顏色不動。
>
> typecheck/build/`cap sync android` 全過，preview 確認 Garage 頁（訪客視角）
> 無 console error；登入相關流程（成就稱號裝備、稱號購買確認彈窗、排行榜自己
> 那列雙行顯示）因需要真實 Google OAuth，preview 環境無法完整驗證，程式碼邏輯
> 已仔細追根因（非臆測性修改），**使用者待辦**：① Supabase SQL Editor 跑
> `migration_20260721h.sql`；② 真機/PWA 走一次確認上述 3 項登入流程實際表現。
>
> ## 🖤 2026-07-21（第四輪追加）：兩台隱藏車款生圖定案登記 + 個人化裝備正式接進遊戲畫面
>
> 承接前一輪「抽獎轉輪 + 鑽石新出口」留下的兩個未完成項目：① 黑天鵝／看不見的手
> 美術尚未產出；② 尾焰特效顏色/鬼影顏色的實際視覺套用、暱稱顏色/稱號/前綴圖示
> 顯示在排行榜上，當時只做到「能買、能選、會記住」的資料層，沒接進畫面。這輪
> 使用者拿 Grok 生完圖、手動去背放進 `For_Lobby`/`For_Gaming` 後，兩件事一次動工：
>
> **✅ 黑天鵝／看不見的手兩台隱藏車款生圖過程**（過程有兩個生圖踩坑教訓，已寫進
> [GARAGE_DESIGN.md](GARAGE_DESIGN.md) 對應段落）：黑天鵝前幾版不是長出寫實天鵝
> 頭/喙/脖子（對「意象比喻」下抽象詞，模型會直接畫出動物解剖部位），就是矯枉過正
> 變成普通黑色機車（負面清單寫太保守把細節一起收斂掉）；看不見的手第一版被理解成
> 「拆殼透視圖」畫出整組引擎/車架骨架，改成完全不提「motorcycle」當主詞、只描述
> 「兩顆獨立輪子的靜物攝影」才成功。最終定案 prompt 存檔在 GARAGE_DESIGN.md。
>
> **✅ 已登記上線**：`sharp`（node_modules 既有套件）處理去背圖→ 520×347 壓縮
> 成品（42.3KB／24.3KB，遠低於 150KB 上限）；輪心位置用「extract 裁切+SVG 網格
> 疊圖+Read 工具讀座標」精確量測（兩張實際生成結果的輪子位置明顯偏離共用規格
> 假設的 15.6%/84.4%/71% 比例，不能直接套公式），算出 `spriteW`/`spriteOffsetX`/
> `spriteOffsetY` 登記進 [garage.ts](src/lib/garage.ts)；`hidden-invisiblehand`
> 正式排入 `lottery_spin()` 機率表（`supabase/migration_20260721g.sql`，⚠️ 待
> 使用者手動跑），跟黑天鵝同等稀有度 0.05%（從 5 鑽石機率切出來，5 鑽石
> 67.00%→66.95%）、重複補償同為 800 鑽石，沒有額外贈送專屬稱號/徽章（黑天鵝的
> 「黑天鵝目擊者」+🦢是當初設計就講好的專屬贈品，這台沒有對應設計，之後想加再說）。
> `Garage.tsx`/`LotterySlot.tsx` 對應顯示邏輯（隱藏車款卡片、機率表、視覺滾輪符號
> 池、稀有度特效判斷）同步從「只認 hidden-blackswan」改成兩台都認。
>
> **✅ 個人化裝備正式接進遊戲畫面**（[LOTTERY_DESIGN.md](LOTTERY_DESIGN.md) §4 當初
> 只做了「能買、能選、會記住」的資料層，這輪補上實際視覺套用）：
> - **尾焰特效顏色**：GameCanvas.tsx 原本完全沒有引擎尾焰/軌跡粒子系統（設計文件
>   誤以為「粒子軌跡本來就是即時畫的」，查證後發現只有死亡爆炸粒子，這是全新
>   功能）。新建 `trailParticles` 系統：貼地加速時從後輪冒出、往後飄散＋0.45秒
>   淡出，用玩家裝備的 `trail:*` 色票上色；沒裝備任何顏色＝完全不畫（沒有免費
>   預設特效，這是花鑽石解鎖的視覺道具）。
> - **鬼影顏色**：`drawGhost()` 疊一圈同色系半透明光暈（`globalCompositeOperation
>   "lighter"` + 純色 arc fill），**不取代真實車皮**（沿用 2026-07-15 拍板過的
>   「鬼影秀真實車款當購買誘因」決定，只加色調不整台換色）。刻意不用
>   `ctx.filter`/`shadowBlur`——那是 2026-07-13 修過的 Android WebView 已知昂貴
>   逐像素操作，這次沿用同一個教訓，只用便宜的向量 fill 疊加。
> - **暱稱顏色/稱號/前綴圖示顯示在排行榜**：`ScoreRow`（`leaderboard.ts`）**沒有
>   `player_id`**（anon key 讀不到，這是刻意的隱私設計），只能用「暱稱精確比對」
>   當作「是不是我」的判斷，跟 App.tsx 既有的即時名次比對同一套 heuristic（撞名
>   會誤判，但只是自己端的顯示裝飾，不影響任何分數/名次判定）。`DailyChallenge.tsx`
>   排行榜每一列比對 `player_name === 自己的暱稱`，是的話套用前綴圖示/暱稱顏色/
>   稱號 pill；`ClassicSelect.tsx` 版面窄（單行小卡×3名×12關），只套暱稱顏色避免
>   擠爆。新增 `garage.ts` `COSMETIC_LABELS`（id→顯示文字/色票的獨立小表，跟
>   `Garage.tsx` 購買 UI 的 `COSMETIC_CATALOG` 保持同步，沒有整個拆成單一資料源
>   是因為後者還帶著 price/購買邏輯，風險比大改 Garage.tsx 低）。
>
> typecheck/build/`cap sync android`（9 個外掛都在）全過，preview 驗證過首頁/車庫
> （兩張隱藏車款卡片正確顯示❓剪影）無 console error；GameCanvas 實際遊玩畫面因
> preview 分頁隱藏 rAF 凍結的既有環境限制（見本檔「測試踩雷」段）沒能跑滿一局，
> 但改動都是額外疊加、有 null-guard（沒裝備 cosmetic 就完全不進新程式碼路徑），
> 風險低。**使用者待辦**：① Supabase SQL Editor 跑 `migration_20260721g.sql`；
> ② `versionCode` 維持 **34** 不變（上一輪已推進、尚未打包，這輪內容直接併入同一次
> 打包，不用再往上加）；③ 尾焰/鬼影顏色實際遊玩效果、排行榜暱稱比對邏輯建議真機
> 或至少 PWA 網頁版走一次確認觀感（preview 環境限制下沒能截圖驗證動畫）。
>
> ## 🎰 2026-07-21：抽獎轉輪 + 鑽石新出口——設計+前後端全部動工完成
>
> 使用者拍板新方向：鑽石目前唯一出口是 P 系列車款，對車無興趣的玩家鑽石沒有
> 消費動機。討論定案完整規格後（見 [LOTTERY_DESIGN.md](LOTTERY_DESIGN.md)）
> 當天直接動工，前後端都做完了，不是只有規格書。
>
> **✅ 已完成**（typecheck/build/`cap sync android` 全過，preview 驗證過
> Home/Garage/LotterySlot/RandomSlot 四個畫面渲染正常、無 console error）：
> - 新畫面 [LotterySlot.tsx](src/screens/LotterySlot.tsx)：拉霸機沿用
>   `RandomSlot.tsx` 動畫機制，音效/配色獨立設計（金色高級感區隔於選賽道），
>   機率表彈窗、依稀有度分級的螢幕震動+音效收尾，首頁新增「🎰 幸運轉輪」入口。
> - `garage.ts`/`Garage.tsx`：黑天鵝隱藏車款分類（未解鎖全黑剪影+❓）、票券
>   貨幣列（金幣→鑽石→票券）、看廣告換票券、看廣告拿金幣前的「消耗票券跳過
>   廣告」彈窗、個人化裝備區塊（暱稱顏色/稱號/前綴圖示/尾焰特效顏色/鬼影顏色，
>   5 類多色票可購買/裝備/取消裝備）。
> - `GameCanvas.tsx`：復活、結算雙倍兩處廣告點都加了票券消耗彈窗。
> - `RandomSlot.tsx`：`VISIBLE` 7→5，滾輪變矮讓底部按鈕不再貼在畫面最下緣
>   （使用者這輪順手提的既有體驗小修，跟抽獎功能無關）。
> - SQL 分四份：`migration_20260721.sql`（主體）+ `b`（票券賺取 RPC）+
>   `c`（緊急修復：主檔重建 `wallet_get()` 時漏看它已擴充成 9 欄位，砍掉了
>   成就/連續天數/圖鑑/去廣告狀態，補回完整欄位）+ `d`（緊急修復：
>   `wallet_earn_via_ticket` 抄到 2026-07-05 最原始版 `wallet_earn` 金額表，
>   跟現行 2026-07-10 版本對不起來，且漏了長征模式，改成完全比照現行版本）。
>   **教訓已寫進 LOTTERY_DESIGN.md §10**：重建既有函式前要搜過全部 migration
>   檔案確認真的抓到最新版，不能只看第一份找到的檔案。
>
> **⏸️ 刻意先不做（已跟使用者說清楚，非隱藏遺漏）**：尾焰特效顏色/鬼影顏色的
> 「實際視覺套用」、暱稱顏色/稱號/前綴圖示「實際顯示在排行榜上」——目前只做到
> 「能買、能選、會記住」，接進遊戲畫面/排行榜顯示邏輯是下一輪工作。
>
> **➕ 同日第二輪追加**：使用者回饋修正兩點——① 票券來源太單一，改成三管道
> （看廣告/抽獎轉輪/一般+長征模式結算 8% 機率，各自獨立每日上限）；② 「連勝
> 狂魔/排行榜常客/空中飛人/地心引力挑戰者/完美落地大師」5 個稱號玩家自己花錢
> 買很奇怪，改成跟 Q 系列車款一樣**達標自動解鎖**（新增終身翻轉圈數/完美落地
> 次數兩個伺服器欄位），購買式稱號全部換成股市梗（擦鞋童/擦鞋董/多空交戰/
> 公園街友/財經皓角/韭菜/第四大法人+新手騎士/台股股神，統一 200 鑽）。
> 補了 `migration_20260721e.sql`（含**第三次**改 `wallet_get()` 輸出欄位——這次
> 有先完整複製 c 版正確內容才加新欄位，沒有再犯漏抄舊欄位的錯）。Garage 新增
> 「🎯 成就稱號」區塊，typecheck/build/cap sync/preview 都驗證過。完整記錄見
> [LOTTERY_DESIGN.md](LOTTERY_DESIGN.md) §11。
>
> **➕ 同日第三輪追加：真機實測 bug 修復**。使用者回報三件事：
> 1. 🔴 **轉輪動畫跑到一半圖示全部消失（真正的 bug，已修復）**——`SYMBOL_POOL`
>    只有 14 種符號但 `VISUAL_SIZE` 設 24，「不重複抽樣」湊不滿 24 格，實際
>    reel 只有 112 格但動畫數學是照 192 格算的，捲到超出內容範圍的空白處。用
>    獨立 HTML 重現最小案例在瀏覽器裡實測確認（`reel length: 112`，消失時間點
>    精算落在 ~2.1 秒，跟回報的「兩三秒後」吻合），改成「有放回抽樣」修復。
> 2. 🟡 **抽到「450 鑽」查不到機率表**——不是 bug，是黑天鵝之外重複保護觸發時
>    畫面沒說明。拍板：依然要顯示車款本身+補說明「您已擁有，已換成等值鑽石」。
>    `lottery_spin()` 新增 `duplicate_of` 欄位（`migration_20260721f.sql`）。
> 3. 移除車庫「看廣告換票券」（只剩抽獎轉輪+一般/長征結算兩管道）、機率表拿掉
>    P1/P4 等代號跟「（最稀有）」、首頁選單重排（每日→自選→隨機→經典）、抽獎
>    入口從模式清單移到車庫/圖鑑那排（粉色系）。
>
> typecheck/build/cap sync/preview 都驗證過，完整記錄見
> [LOTTERY_DESIGN.md](LOTTERY_DESIGN.md) §12。
>
> **⚠️ 使用者待辦**：① Supabase SQL Editor 依序跑
> `migration_20260721b/c/d/e/f.sql`（主檔 `.sql` 已跑過）；② 黑天鵝
> `public/bikes/hidden-blackswan.png` 美術尚未產出（`garage.ts` 已登記路徑，
> 圖到位前車庫該卡片剪影會是破圖，不影響其他功能，風格定案「黑天鵝」黑金神秘
> 配色，交給 Grok 出圖即可）；③ 下次重新打包 Android 才會生效（PWA push 後
> 網頁版立即生效）。

> ## 🔔 2026-07-21：修每日提醒通知狀態列圖示顯示「i」符號——併入下次打包（未打包上傳）
>
> **2026-07-21 上午 9:03 已送出 Play Console 正式版權限申請**（審查通常 7 天內完成，
> 見 [[project-beta-testing]] memory）。使用者同時回報：每日提醒通知運作正常，但
> **手機狀態列預覽圖示是系統預設的小寫「i」**，不是遊戲 icon，下拉看完整通知才會看到
> 正確圖示。**根因**：Android 5.0+ 規定狀態列小圖示（small icon）必須是純白色去背
> 剪影，`notifications.ts` 原本刻意不指定 `smallIcon`（註解寫「避免指到不存在的資源
> 名」），外掛回退用彩色 App icon，系統無法把彩色圖轉剪影，只能顯示系統預設備用圖示
> ——跟下拉看到的完整通知圖示（用另一組資源，本來就正常）是兩回事。
>
> **✅ 已修（使用者拍板：現在動工改程式碼+做圖示資源，但不打包上傳）**：從
> `public/icon-512.png`（走勢線+雙輪造型）萃取前景線條，去背轉成純白剪影，產出
> `android/app/src/main/res/drawable-{m,h,xh,xxh,xxxh}dpi/ic_stat_notify.png` 五組
> 密度；`notifications.ts` 加上 `smallIcon: "ic_stat_notify"` + `iconColor: "#ffb300"`
> （品牌琥珀色，對應 `--neon-amber`）。
>
> typecheck/build 過、`npx cap sync android` 已跑（9 個外掛都在）。**這是原生殼專屬
> 改動，PWA 網頁版本來就沒有通知功能不受影響**；`git push` 只會觸發網頁版部署，不影響
> Android。**⚠️ 這批動工當下才發現 vc33 當天早上（申請正式版權限的同一天）已經打包
> 上傳且審核通過，客戶端已裝上 vc33**——代表這個通知圖示修復沒趕上 vc33，且
> **versionCode 33 這個號碼已燒掉**，已同步把 `android/app/build.gradle` 推進到
> **versionCode 34／versionName "1.34"**，避免下次打包撞號。**這次刻意不打包簽署版
> AAB、不上傳 Play Console**，通知圖示修復連同版號推進都先留在原始碼裡，等下次有
> 其他改動要一起打包時（v34）再處理，或使用者自行決定何時打包。真機驗證（狀態列圖示
> 是否正確顯示）要等 v34 真的打包裝上手機才能確認。
>
> **➕ 同日追加（併入 v34）——通知頻道中文命名 + 全專案「小體驗問題」體檢**：
> 使用者要求檢查「有沒有像通知圖示這種不影響遊戲進程但影響體驗的小問題」。體檢
> 結論——真正要修的只有一項：**每日提醒通知沒自建通知頻道**，Android 8+ 會落到外掛
> 內建的英文預設頻道，使用者去「設定→App→通知」看到看不懂的英文分類名。已修：
> `notifications.ts` 新增 `ensureChannel()` 建立中文頻道（id `daily_reminder`、名稱
> 「每日賽道提醒」、importance 3），`scheduleDaily()` 排程前先建頻道並帶 `channelId`。
> ⚠️ 一次性副作用：vc33 以前已收過通知的裝置，系統裡會殘留一個舊的英文預設頻道
> （Android 不會自動刪空頻道），新通知走新中文頻道，舊的閒置頻道會擱著不影響功能，
> 不值得寫程式碼去刪（風險高、預設頻道 id 不穩定）。
>
> **體檢過程另外撤回一個誤判**：原本以為「Android 狀態列顯示 Capacitor 預設藍紫色
> `colorPrimaryDark`」是 bug，做了 mockup 呈報——使用者實機（S24）回報是透明。查
> `MainActivity.java` 才發現 App **刻意做全螢幕沉浸模式**（`applyImmersive()`：
> hide systemBars + edge-to-edge，targetSdk 36 本就強制 edge-to-edge），該顏色設定
> 在此架構下是死值、根本沒作用機會。**非 bug、不用修、非 S24 特例**。教訓已記 memory：
> 診斷原生系統 UI 外觀前先讀 `MainActivity`，別只憑通用 Android 主題規則推論。
> PWA maskable icon 裁切問題使用者明確表示網址不外流、不管。

> ## 🗑️ 2026-07-18（v0.12.54）：移除全部靜態賽道樣本——修「熱門股永遠玩到 6/15 舊盤」重大 bug（併入 vc32）
>
> 7/17 台股史上最大跌，7/18 使用者發現 0050/2330 的地圖跟真實盤勢對不上、
> 但每日排名賽（1517 利奇）對得上。**根因**：Phase 2 時代打包進 build 的 24 支
> `sample-*.json`（2026-06-15 快照）在 `TrackSelect.tsx`/`RandomSlot.tsx` 是
> 「本地優先」短路——選/抽到那 24 支熱門股（TAIEX/2330/0050/2454/0056/鴻海…）
> 直接用舊快照、完全不查 daily_map；其他股票才走 Supabase。愈熱門愈舊，且畫面
> 日期標籤顯示的是 resolveSessionDate 的正確日期（07/17）、地形卻是 6/15 的，
> 雙重誤導。RandomSlot 更糟：抽中熱門股給的是**月盤**靜態資料，跟提示的
> 「前次盤中走勢」模式都不對。
>
> **✅ 已修（使用者拍板「刪掉靜態、不留 fallback」）**：
> - 刪 48 份 `src/data/sample-*.json`＋產生器 `scripts/fetchTwse.ts`＋無人引用的
>   Phase 1 遺物 `fakeData.ts`；`tracks.ts` 只剩 `TrackData` 型別；`pick.ts` 只剩
>   `dailyKey()`（`dailyTrack()`/`STOCK_POOL`/`randomTrack()` 隨靜態池一併移除）。
> - `TrackSelect`/`RandomSlot`：一律 `fetchStockDailyMap()` 即時抓（resolveSessionDate
>   本來就內建「沿用最近一期」，連假/資料延遲自動退最近的盤）；完全抓不到（離線）
>   顯示「需連線才能載入市場資料」，不再退靜態。
> - `DailyChallenge`：track 改 `TrackData | null`，地圖沒載到前開始鈕反灰顯示
>   「今日地圖載入中…」——排名賽榜是照真實地圖比的，絕不能讓玩家在靜態舊圖上交分數
>   （舊版 fallbackTrack 理論上有這個風險）。
>
> typecheck 過、preview 實測：自選賽道列表 1279 支（7/17 走勢）、點 0050 即時抓到
> 7/17 資料進場、每日排名賽正常（1517 利奇）、無 console error（拉霸轉輪動畫在
> preview 隱藏分頁因 rAF 凍結測不完，屬已知環境限制，程式路徑與自選賽道同一支
> fetcher）。`npm run build`＋`npx cap sync android` 已跑。**versionCode 已推進到
> 33**（vc32 使用者已打包上架、手機實裝確認，號碼已燒掉）。PWA push 即自動生效
> ——修復當天線上玩家就能玩到正確的 7/17 地圖。**✅ 2026-07-21：vc33 已打包上傳並
> 審核通過，客戶端已裝上**（跟同一天申請正式版權限同一批，見上方 2026-07-21 通知
> 圖示段落）——vc32 以前的舊版本選熱門股仍會玩到內建的 6/15 舊盤，vc33 起已修復。
>
> ⚠️ **本批是在「家裡電腦忘記先 git pull」的狀態下動工的**——push 時才發現遠端有
> 公司電腦 7/15~7/16 的進度（vc32/GhostRecord/殼版本更新提示/ASO），已當場
> `git pull --rebase` 合併、解掉三處衝突（CLAUDE.md／build.gradle 版號／
> DailyChallenge 的 GhostPathData→GhostRecord 改名）、合併後重新 typecheck+build+
> cap sync+preview 驗證才推上去，repo 已一致。教訓照舊：**每次開工第一件事
> `git pull`**（守則 3 本來就有寫，這次是使用者自己說太急忘了）。
>
> ## 📝 2026-07-16：Testers Community 測試報告出爐 + ASO 文案依報告修訂
>
> Testers Community 14 天封測期滿，交回兩份報告：**Testers Feedback Report**（測試
> 回饋，跨裝置/SDK 無任何當機或 bug，功能全數正常）＋ **Production Access
> Questionnaire**（申請正式版問卷範本，供之後送 Google Play 正式版申請時套用）。
> 回饋報告提出四項體驗優化建議：① 缺互動新手教學（⚠️ 與現況矛盾——2026-07-11 已因
> 卡關 bug 拔掉互動教學改靜態說明，測試者測試時間點可能早於那次或沒注意到入口，
> 未列入本次動工）② ASO 文案關鍵字不足 ③ 只能 Google 登入沒有 Email 選項 ④ 僅支援
> 中文無多語言。使用者拍板先處理 ②。
>
> **✅ ASO 已定案並上架**：Claude 先出過一版修訂草稿，**使用者接著自己在 Play
> Console 重新寫過一輪並已儲存**——應用程式名稱改成「TAIEX RIDER 台股騎士」
> （中英合併單一標題）、簡短說明「昨日台股，今日賽道。單指操作的免費特技賽車遊戲」、
> 完整說明大幅改寫（含使用者自己加的玩梗收尾句「情人節情人不陪沒關係，股票會賠」）。
> [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) §五 已同步成使用者最終定案內容（**這份
> 已經是 Play Console 目前存檔內容，不用再貼一次**，之後純粹當文件備份/换机器對照
> 用）。使用者同時也重新處理過應用程式的**遊戲標籤/分類**（Play Console 端設定，
> 不在程式碼或本文件範圍內，如有需要之後另外記錄實際選了哪些標籤）。
>
> Email 登入／多語言兩項體驗優化建議尚未拍板動工，待使用者之後決定是否要做。

> ## 🔧 2026-07-15（v0.12.53）：登入後首頁不即時更新 + 登出重登入車皮跑掉 + 帳號狀態顯示——vc32
>
> 使用者實測 vc31 時回報三項帳號相關體驗問題，討論後拍板修法動工：
>
> 1. **✅ 已修：登入後首頁金幣/資訊要切分頁再切回來才顯示**。根因：`Home.tsx`
>    的 `getCoins()`/`getActiveBikeSkin()` 直接在 render 裡同步讀 localStorage，
>    不是 React state；登入完成到 `syncWalletFromServer()` 真正把新值寫進
>    localStorage 之間有時間差，而這段非同步寫入不會觸發任何 React 重繪——首頁
>    從登入那刻起全程掛載著（不像車庫頁本來就有自己的掛載時同步 effect），只能
>    停在同步完成前讀到的舊值，直到切走再切回來、重新掛載才讀到新值。**已修**：
>    `App.tsx` 新增 `walletVersion` 純重繪訊號 state，`syncWalletFromServer()`
>    resolve 後 +1，往下傳給 `Home.tsx`（不需要真的讀它的值，純粹讓 React 知道
>    該重繪），首頁登入後金幣/裝備車皮現在會自己跳出來，不用手動切分頁。
> 2. **✅ 已修：登出再登入（同一帳號）裝備車皮跑回預設**。根因：目前裝備車皮
>    （`ACTIVE_KEY`）從來沒有存伺服器，是純本地偏好，且舊版是單一全域 key，
>    `resetWalletCache()`（登出時呼叫）會把它重設成 `"default"` 防止跨帳號污染
>    ——副作用是同一帳號登出再登入也被一起洗掉。**已修（採用戶拍板的方案 A，純
>    本地改動，不動 DB）**：`garage.ts` 新增 `activeSkinKey(uid)`，比照
>    `wallet_daily_att_{uid|guest}` 的既有慣例把 `ACTIVE_KEY` 改成帳號隔離
>    （`tr_garage_active_{uid|guest}`），`getActiveSkinId()`/`setActiveSkin()`/
>    `getActiveBikeSkin()` 全部加 `uid` 參數，呼叫端（`App.tsx`/`Garage.tsx`/
>    `Home.tsx`/`GameCanvas.tsx`）一併傳入 `user?.id ?? null`；`resetWalletCache()`
>    不再重設這個 key（各帳號各自獨立 key，天生不會互相污染，不需要也不應該在
>    登出時重設）。⚠️ **一次性代價**：這是純前端 localStorage key 改名，沒有寫
>    遷移邏輯，玩家更新到 vc32 後裝備車皮會重置一次（回到目前這個帳號的預設車，
>    需要重新去車庫裝備一次），之後就會正常記住，不影響擁有清單（那是伺服器權威，
>    不受影響）。跨裝置仍不會同步（純本地方案的既有限制，之後若要跨裝置一致需要
>    升級成伺服器同步，屬於方案 B，這次沒做）。
> 3. **✅ 新增：首頁顯示目前登入帳號狀態**（`Home.tsx` `.account-status`）。
>    車庫/圖鑑按鈕列下方新增一行「當前帳號：xxx」／「當前帳號：尚未登入」，
>    開發者測試帳號特別標示「開發者帳號（email）」，玩家一眼就能確認登入/登出
>    是否成功，不用點開設定面板才看得到。
>
> typecheck/build 過、`npx cap sync android` 已跑（9 個外掛都在）、preview 驗證過
> 帳號狀態列訪客文案正確渲染。**登入流程本身（第 1、2 項的實際效果）preview 無法
> 測（需真實 Google OAuth），需使用者真機/桌機驗證**：① 登入後首頁金幣/車皮應
> 立即顯示不用切分頁；② 同帳號登出再登入（重新裝備一次車皮後）應該記得住，換成
> 另一個帳號登入不應該看到這個帳號裝備的車。**versionCode 已推進到 32**，待打包。

> ## ✅ 2026-07-15：BGM 切背景自動暫停 + 通知改早上 8 點 + 鬼影還原紀錄保持者車皮
>
> 使用者回報三項體驗問題，動工修復並已 push（commit `251831d`）：
>
> 1. **BGM 切去背景不會自動暫停**：`audio.ts` 新增 `pauseBgm()`/`resumeBgm()`，
>    `App.tsx` 監聽 `@capacitor/app` 的 `appStateChange`（原生殼切去其他 App）+
>    `document.visibilitychange`（PWA/桌機分頁切走，兩邊都修，非原生限定）。
> 2. **每日提醒通知時間 20:00→8:00**：`notifications.ts` `REMINDER_HOUR` 改
>    8，文案維持「今日賽道已更新，上榜機會別錯過」（使用者拍板：早上發文案本來就
>    適合，不用改成「提醒還沒玩」）。
> 3. **鬼影改用紀錄保持者當下用的車，不是玩家自己的車**：`daily_scores` 新增
>    `skin_id` 欄位，`submit_daily_score` 存入、`get_daily_ghost_path` 回傳型別
>    從純 `jsonb` 改成 `table(path, skin_id)`（PostgREST 因此改回陣列，前端讀
>    `data[0]`，見 `leaderboard.ts fetchDailyGhostPath()`）。`GameCanvas.tsx
>    drawGhost()` 依 `ghostSkinId` 查 `BIKE_SKINS` 載入對應貼圖，**拿掉舊版去色
>    濾鏡**（半透明 0.32 已足夠跟玩家自己的車區分，且能看清對手真實車款/顏色——
>    也讓買車皮多一個「秀給別人看」的理由）。
>
> typecheck/build 過、`npx cap sync android` 已跑（9 個外掛都在）。**使用者
> 待辦**：① Supabase SQL Editor 跑 `supabase/migration_20260715.sql`（沒跑之前
> `submit_daily_score` 多帶的 `p_skin_id` 參數會被 PostgREST 拒絕，排名賽分數
> 交不出去——**跟 PWA push 同天要盡快跑，不要拖到隔天**，邏輯同過去幾次 replay
> 格式升級的教訓）；② 下次重新打包 Android（BGM 背景暫停 + 通知時間是原生殼才
> 有感，鬼影車皮兩端都要新版 app 才會用新 RPC）。三項皆為純程式碼修改，未真機
> 驗證（BGM 切背景/通知時間/鬼影新車皮渲染都建議實機或 PWA 走一次確認）。

> ## ✅ 2026-07-15 晚：修「更新後首次開啟閃一下首頁」bug + 殼版本更新提示
>
> 使用者回報「Play 商店更新後第一次開 App，會先看到首頁、才跳出開場動畫、又回到
> 首頁」，只有更新後第一次會這樣。動工修復並實作了順帶討論到的殼版本更新提示：
>
> 1. **✅ 已修：原生殼多餘的 Service Worker 註冊**。根因：`main.tsx` 的
>    `import "./pwa"` 沒有判斷是不是原生殼，Android App 的 WebView 裡也被註冊了
>    PWA 用的 Service Worker——App 更新後，舊版 SW 還留在 WebView 儲存空間裡
>    （APK 更新不會清掉），第一次開啟被舊 SW 攔截先顯示舊版首頁，接著瀏覽器偵測
>    到新版 SW 觸發 `pwa.ts` 的自動 reload，新版重新跑一次開場動畫才回到首頁——
>    這正是「首頁→splash→首頁」的成因。**已修**：`pwa.ts` 內部整個註冊流程包進
>    `Capacitor.isNativePlatform()` 判斷，原生殼完全不註冊 SW（`registerSW` 改成
>    動態 import，vite build 也確認拆出獨立 chunk，不會被打進原生殼會執行到的路徑）；
>    `setPlaying()` 在原生殼下自然變 no-op。網頁/PWA 版行為完全不變。
> 2. **✅ 新增：殼版本更新提示**（`src/lib/shellUpdate.ts` + `Home.tsx`）。
>    `supabase/migration_20260715b.sql` 新增 `app_config(key, value)` 表，
>    `@capacitor/app` 的 `App.getInfo().build` 讀本機 versionCode 跟
>    `app_config.latest_android_versioncode` 比對，落後就在首頁顯示可關閉的琥珀色
>    提示條，**不擋遊戲**，按鈕開 Play 商店頁（`window.open(url,'_system')`，
>    Capacitor 內建支援不用裝額外外掛）。關閉會記住版號，同版號不會重複跳。
>    這是 DEVDOC §9.5b 舊設計（TWA 時代靠 `DEFAULT_URL` 查詢參數）的重新實作——
>    舊機制 Capacitor 架構下已經失效，這次改用 `App.getInfo()` 直接讀原生版本號。
>
> typecheck/build 過、`npx cap sync android` 已跑（9 個外掛都在）、preview 驗證過
> `.shell-update-banner` 的 CSS 樣式正確（amber 主題、flex 排版）。**使用者待辦**：
> ① Supabase SQL Editor 跑 `migration_20260715b.sql`；② 下次打包 Android（兩項都是
> 原生殼才有效果，PWA 網頁版第 1 項本來就沒有這個 bug、第 2 項網頁版本來就不需要）；
> ③ **以後每次正式發布新版並確認生效後**，記得去 SQL Editor 更新
> `app_config.latest_android_versioncode`，這張表不會自動更新。

> ## 🧹 2026-07-15：repo 外圍清理——刪除 `Private\.git` 殘留 + 刪除 TWA 備份資料夾
>
> 跟開發本身無關的環境整理，使用者主動發起：
>
> 1. **`C:\Users\tyl16\Documents\Private\.git` 殘留已刪除**：查出是舊版 VaultMe 專案
>    當初意外在 `Private` 根目錄（而非子資料夾）`git clone`/`git init` 留下的殘留，
>    commit 歷史跟 `Private\VaultMe\.git`（有正確 remote）完全一致，刪除不遺失任何
>    紀錄。這個殘留的風險是 `Private` 底下所有其他專案資料夾都會被它當成「未追蹤
>    內容」，日後不慎在 `Private` 這層跑 `git clean` 之類指令有波及其他專案的風險。
>    **正確建新專案流程**：`git clone <url> <資料夾名>` 一行在 `Private` 底下跑，
>    一定要給明確目標資料夾名稱，不要用 `.` 或省略、更不要直接在 `Private` 裡
>    `git init`。
> 2. **`TaiexRider-TWA-backup\`（414MB，345 commits）已刪除**：2026-07-10 切換
>    Capacitor 時留的回退保險，Capacitor 版已從 vc19 穩定跑到 vc30、多次過審+
>    真機驗證，回退需求已過期。TWA 關鍵踩雷教訓（meta-data value/resource 混用、
>    沉睡地雷效應、Play Console 不能回滾、release 版無 chrome://inspect）本來就已
>    留在本檔「踩雷筆記」§TWA/androidbrowserhelper，遷移經過留在
>    [CAPACITOR_EXPERIMENT.md](CAPACITOR_EXPERIMENT.md)，刪備份不影響這些紀錄。
>
> 兩者皆不影響 TaiexRider 本身的原始碼/git 歷史，純粹是 `Private` 資料夾外圍環境清理。

> ## ✅ 2026-07-13 上午（公司電腦）：vc29 過審＋鬼影 v2 真機驗證通過＋收尾三項
>
> - **vc29 已過 Play Console 審核**，鬼影完整復刻 v2（空中軌跡/翻轉）真機驗證
>   運作正常，vc28 的掉幀卡頓也確認隨離屏預渲染修復消失。**鬼影功能相關工作
>   全部結案**。
> - 封測倒數天數 Play Console 與 Testers Community 儀表板顯示不一致（前者顯示
>   第六天、後者第四天）——兩者是不同系統各自的計數基準，不保證同步。**以
>   Play Console 封閉測試頁面本身跳出的「已符合資格」提示為準**，不要單純數
>   天數；有疑慮可直接問 Testers Community 客服兩邊算法的關係。
> - **✅ 已修：`prelaunch_cleanup.sql` +3 鑽石重複發放漏洞**——根因是該腳本
>   truncate 了 `daily_diamond_settlement`（`settle_daily_diamonds()` 防重複
>   發獎的擋板）但原本刻意不動 `wallet_daily_attempts`（留 14 天滾動自清），
>   若清完資料後 `settle-daily-rewards.yml`（開了 `workflow_dispatch` 允許
>   手動重跑）對同一天重新結算一次，會誤發參與獎。已改成 `wallet_daily_attempts`
>   一併 truncate，徹底消除這個重跑風險，不需要「小心不要手動重跑」這種容易
>   忘記的人為提醒。**下次跑 `prelaunch_cleanup.sql` 時用的就是修好的版本**
>   （這份腳本本來就是「先寫好、上架前才手動執行」，這次只是改內容，還沒跑）。
> - **✅ 已刪：`public/.well-known/assetlinks.json`**——確認整個專案（含
>   AndroidManifest 的 intent-filter）沒有任何地方引用，純 TWA 時代遺留（用來
>   隱藏網址列的網域驗證檔案），Capacitor 版打包進 APK 不需要這個機制。
> - **✅ 已修正文件措辭**：AdMob 真實廣告單元 ID 原本寫「使用者已決定等公開
>   上線前處理」，更正為「技術上必須等公開上架後才能換」——AdMob 的
>   「連結 Play 商店 listing」要查詢公開商店頁面，封測軌道不公開查不到，
>   跟使用者意願無關，避免以後誤以為這是可以隨時喬的選擇項。
> - 內容分級問卷有效期：Claude 沒有 Play Console 查詢權限，這條純粹提醒去
>   「應用程式內容→內容分級」頁面看有沒有警告 banner（因為 AdMob/IAP/排行榜
>   都是問卷可能初次填寫之後才加上的功能），不是已知有問題。
>
> 這批純文件+SQL 腳本修正，不涉及 App 程式碼，**不影響 dist/APK，不需要重新
> 打包**。

> ## ✅ 2026-07-13 深夜收工快照（回公司電腦先讀這段）
>
> 下面 v0.12.48~52 各段落裡標「⚠️ 待使用者手動跑／待打包」的項目**全部已完成**，
> 不要再提醒：
> - `migration_20260712.sql`／`20260712b.sql`／`20260713.sql`／`20260713b.sql`
>   四份全部已在 SQL Editor 跑過（20260713b 是 push 後立刻跑的，順序正確）。
> - **vc29 已打包簽署版 AAB 上傳 Play Console 送審**（2026-07-13 深夜），等審核結果。
>   vc28 稍早也上傳過（已被 vc29 蓋掉的概念，兩顆都在審核流程裡以最新為準）。
> - 鬼影功能已用 vc28 真機驗證過 v1 貼地版運作正常（使用者清掉當日榜、刷一筆
>   第一名後成功看到鬼影）；**v2 完整復刻（空中軌跡/翻轉）尚未真機驗證**——要等
>   vc29 過審裝上，或用 PWA 測（步驟：新版客戶端刷第一名 → 再玩一局開鬼影）。
> - vc28 開鬼影跑排行榜的掉幀卡頓使用者已確認存在，成因＝每幀 ctx.filter（vc29
>   已修成離屏預渲染），裝 vc29 後應消失，若仍卡頓再回報。
> - 當日排行榜已被使用者用「外科手術版 SQL」清過一次（只刪當期 daily_scores，
>   測鬼影用，不是跑 prelaunch_cleanup.sql——那份還沒跑過，留正式上架用）。
>
> 掛著不急的：三星 S24 每日 20:00 通知未收到（使用者說先不管）、
> AdMob 真實 ID（**技術上必須等公開上架後才能換**，AdMob「連結 Play 商店
> listing」要查詢公開商店頁面，封測軌道不公開查不到，不是使用者選擇要等）。
>
> ✅ **已修**：`prelaunch_cleanup.sql` 的 +3 鑽石重複發放小瑕疵——見下方
> 2026-07-13 補充段落。`assetlinks.json`（TWA 遺留、Capacitor 版無人引用）已刪除。
>
> ## 🎬 2026-07-13（v0.12.52）：鬼影完整復刻 v2 格式——併入 vc29
>
> 使用者真機測試 vc28 鬼影成功後拍板升級：鬼影要「完全複製原本遊玩的樣子」——
> 空中拋物線、後空翻轉速、落地姿態。v1 格式只錄 x（每 500ms）、貼地重建，做不到。
>
> 1. **✅ v2 錄製格式**（`GameCanvas.tsx`）：改錄 `[x, y, 累計旋轉角]` 三元組、每
>    250ms 一組（`REPLAY_SAMPLE_MS`），錄滿 2400 筆＝10 分鐘封頂（`REPLAY_MAX_SAMPLES`，
>    防掛機灌大 replay；正常一局 <1 分鐘 ≈240 筆 ≈5KB）。Matter 的 `body.angle` 本來
>    就不正規化、翻轉會累計，線性插值天然重現轉速。`drawGhost()` 雙格式：讀到 v1
>    （舊資料）退回貼地重建，v2 完整復刻（y/角度直接用錄的，不再過地形函式）。
> 2. **✅ `supabase/migration_20260713b.sql`（⚠️ push 後要立刻跑，順序重要）**：
>    `submit_daily_score` path 驗證改雙格式——v1（純數字、500ms）照舊、v2（三元組、
>    250ms、≤2400 筆）新增。**沒跑之前 vc29/新版 PWA 的提交會被 20260713.sql 的
>    「path 元素皆需為數字」整筆靜默拒絕**，而 PWA 是 push 即自動部署，所以這份
>    migration 不能拖到隔天。`get_daily_ghost_path` 不用改（格式判斷在客戶端）。
> 3. 型別鏈同步：`GhostPathData` 型別（`leaderboard.ts`）貫穿 App/DailyChallenge/
>    GameCanvas；`SubmitStats.replay.path` 改三元組型別。
>
> typecheck 過、preview 煙霧測試無 console error（完整鬼影軌跡需真機跑局驗證）、
> `npm run build`+`npx cap sync android` 已跑，versionCode 維持 **29**。**使用者
> 待辦**：① SQL Editor 立刻跑 `migration_20260713b.sql`；② Android Studio 打包
> vc29 上傳（本批＋同日稍早的體檢補強批次＋方案 A 都在裡面）。
>
> 📦 **replay 儲存量說明（使用者問「A 贏 B、C 贏 B 會不會無限疊加」）**：不會。
> `daily_scores` 主鍵是 `(challenge_date, player_id)`＝每人每天只有一列，upsert
> 改善分數時 replay **原地覆蓋**（自己的舊 replay 直接被新的取代）；被超車的人
> 那列還在但也只有他自己最好那局的一份。單日總量＝當日玩家數 × ~5KB，百人日
> ≈0.5MB；`cleanup_old_scores_if_needed()`（每日排程）在 DB >400MB 時自動清 90 天
> 前的舊列，免費額度 500MB 之前就會觸發，不會爆。
>
> ## 🩹 2026-07-13（v0.12.51）：全面體檢後的補強批次（🟠🟡 全修）——vc29
>
> 使用者要求 Fable 全面檢查 vc26~vc28 所有改動＋整個專案。體檢結論：**沒有會出事的
> bug**，兩份反作弊 migration 用 REST API 實測確認已生效（`get_daily_ghost_path` 回
> null＝函式存在、新欄位都在、既有資料零誤殺）、物理引擎再次確認零改動（使用者昨晚
> 「重力變小」體感已排除，見 memory：安裝後首次冷啟動的暫時現象，偶發掉幀先不追）。
> 體檢找到 🟠×2＋🟡×4，使用者拍板全修：
>
> 1. **✅ `supabase/migration_20260713.sql`（⚠️ 待使用者手動跑，純 SQL 不用重包）**：
>    - [C2] `p_replay` 防灌爆：整包 >64KB／events >150 筆／path 含非數字元素 → 拒絕
>      （舊版 events 只驗圈數加總，可塞幾萬筆垃圾事件灌爆單列 jsonb；path 垃圾值會
>      污染其他玩家看到的鬼影）。整個 replay 驗證包進 exception 靜默拒絕，格式惡意
>      不再回 SQL 400。
>    - z-score 統計加 `and not suspect`（舊版把已標記的作弊分算進 mean/sd，會掩護
>      其他離群值）。
>    - `get_daily_ghost_path` 改嚴格「真第一名」語意：第一名沒 replay 就回 null，
>      不再退而求其次回第二名的路徑（跟 UI「第一名鬼影」字面一致）。
> 2. **✅ PB 舊紀錄沿用**（`medals.ts` 新 `readPb()`，`classicPb()`/GameCanvas
>    `checkPb()` 都改走它）：vc28 的帳號隔離會讓所有老玩家 PB/獎牌顯示歸零——補上
>    「第一次讀取時把舊無隔離 key 複製進目前帳號的新 key」的一次性沿用（複製不搬移，
>    多帳號各自沿用一次）。preview 實測：塞舊 key 1777 → 經典模式卡片正確顯示
>    「🥈 我的最佳 1777 分」＋新 key 正確寫入。
> 3. **✅ 鬼影抓取 1.5s 逾時**（`DailyChallenge.tsx`）：網路卡住不擋「開始挑戰」，
>    逾時就不帶鬼影進場。
> 4. **✅ 鬼影去色改離屏預渲染**（`GameCanvas.tsx ghostSprite()`）：原本每幀設
>    `ctx.filter`（Android WebView Canvas2D 已知昂貴操作），改成首次要畫時烘一張
>    灰階車圖，之後每幀純 drawImage；順帶加 `Number.isFinite(gx)` 防禦。
>
> 體檢其餘結論：🔵 三項（anon 可讀 suspect 欄位／BGM 重試 edge／replay 只在改善時
> 落庫）確認不修；vc26 批次全部 diff 複查乾淨。typecheck 過、`npm run build`+
> `npx cap sync android` 已跑、**versionCode 29**（vc28 已上傳被燒掉）。**使用者
> 待辦**：① SQL Editor 跑 `migration_20260713.sql`（✅ 已跑）；② 下次打包 vc29。
>
> **同日追加（併入 vc29）——鬼影開關可用性提示（方案 A）**：使用者點出「排行榜沒人
> 玩／第一名沒 replay 時，打勾進場也沒鬼影，分不清是壞掉還是本來就沒有」。已改成
> 進頁面就查一次 `get_daily_ghost_path`：查不到 → 開關反灰＋文字改「🏆 第一名鬼影
> 暫不可用（今日第一名尚未留下鬼影紀錄）」；查到 → 路徑直接快取給開始挑戰用（省掉
> 第二次 RPC，逾時 race 只剩「查詢還沒回來就搶先按開始」的 fallback 情境）。preview
> 用真實線上資料驗證過反灰狀態正確渲染（現在第一名是舊版成績、無 replay）。
>
> ## 👻 2026-07-12（v0.12.50）：反作弊 Phase C + Ghost 鬼影賽跑——vc28
>
> 使用者「vc27 SQL 已跑完但還沒打包，想接著把 vc28 也做一做」，同一天接續動工。
> **versionCode 直接推進到 28**（vc27 從未打包上傳，兩批內容併進同一顆待打包版本）。
>
> 1. **✅ 反作弊 Phase C**（`supabase/migration_20260712b.sql`，⚠️ 待使用者手動跑）：
>    範圍比 ANTICHEAT_DESIGN.md 原始設計收斂——只錄「翻轉/完美落地事件（含時間戳+
>    圈數）」+「車身 x 座標每 500ms 取樣」，**沒做 press/release 完整合法性狀態機**
>    （成本/風險不成比例，事件數/取樣點數對得上回報值已足夠拉高偽造成本）。
>    `GameCanvas.tsx settleFlip()` 記事件、主迴圈記取樣，結算/摔車時整包
>    `{events,path}` 隨 `onGameOver` 傳出。`submit_daily_score` 新增 `p_replay`
>    參數（預設 null，向下相容尚未更新的舊客戶端），有帶時驗證事件/取樣數跟回報的
>    flips/perfect/time 對不對得上，離譜偏差靜默拒絕。
> 2. **✅ Ghost 鬼影賽跑**（同一份 migration）：使用者拍板範圍——**只跟當日目前第一名
>    賽跑**（鬼影來源即時查詢，打贏第一名鬼影就換人），`DailyChallenge.tsx` 進場前
>    一個開關「🏆 開啟第一名鬼影」（`tr_ghost_toggle`，純顯示偏好，不用帳號隔離），
>    **不做成獨立模式**。新 RPC `get_daily_ghost_path(p_date)` 回傳當日第一名（非
>    suspect）的路徑；`GameCanvas.tsx drawGhost()` 依 `raceTimeMs` 線性插值鬼影 x
>    座標，套用既有地形函式算貼地高度/傾角，半透明+去色濾鏡疊圖，不跑物理。⚠️ **上線
>    空窗期**：只有之後有人用新版客戶端交出帶 replay 的第一名成績，開關才有東西可看，
>    今天以前的舊成績沒有 replay 欄位，這是預期中的正常現象。
>
> typecheck 過，preview 驗證 `DailyChallenge` 開關 UI 正常渲染+切換+localStorage
> 正確持久化（`tr_ghost_toggle`），無 console error。**鬼影視覺疊圖/Phase C 一致性
> 驗證邏輯需要真機或已登入帳號實際跑一局才能完整驗證**（preview 未登入無法測試提交
> 流程）。`npm run build` + `npx cap sync android` 已跑。**使用者待辦**：Supabase SQL
> Editor 跑 `migration_20260712b.sql`。
>
> ## 🔒 2026-07-12（v0.12.49）：反作弊 Phase B + PB 帳號隔離殘留漏洞——併入 vc27
>
> 使用者拍板的版本規劃：vc27＝小型殘留資安項目＋反作弊 Phase B，vc28＝Phase C（＋
> Ghost 鬼影賽跑，跟第一名賽跑、可換人、開關形式，設計見討論記錄）。這批是 vc27 的
> 第二部分（第一部分是同一天稍早的分享面板修復，見上方 v0.12.48，versionCode 維持
> 27 不變，還沒打包，兩批直接併同一次上傳）。
>
> 1. **✅ 小型殘留資安：`tr_pb_*`（個人最佳紀錄）補帳號隔離**：盤點三個文件裡列的
>    「殘留 localStorage 帳號污染」項目時發現，`tr_quest_progress`/`tr_ad_coin_claims_*`
>    其實 2026-07-08 就已經修過（文件記錄過期），真正還沒修的只有 `tr_pb_*`
>    （`GameCanvas.tsx checkPb()` 寫入、`medals.ts classicPb()` 讀取）——同裝置切換
>    帳號會沿用前一個使用者的個人最佳紀錄。已補上 `{uid|guest}` 隔離，
>    `classicPb()`/`ClassicSelect.tsx` 一併更新簽章傳入 `user?.id`。
> 2. **✅ 反作弊 Phase B**（`supabase/migration_20260712.sql`，⚠️ 待使用者手動跑）：
>    - `daily_scores` 新增 `submit_count`：每次「真的改善分數」的提交 +1，單日 > 12
>      次 → `suspect = true`（不擋提交、只標記，防「額度內反覆 hill-climb 逼近物理
>      上限」）。
>    - `settle_daily_diamonds()` 結算前一期鑽石前，先跑 z-score 離群掃描（分數 > 平均
>      4 個標準差，樣本數 < 8 不判斷避免誤殺）→ `suspect = true`；同函式的名次獎排序
>      也排除 suspect（拿不到名次鑽石，參與獎不受影響）。**沒有另開新 GitHub
>      Actions**，複用既有的 `settleDailyRewards.ts` 每晚 00:00 排程。
>    - `daily_scores_ranked` VIEW 補 `where not suspect`，排行榜前端自動看不到可疑
>      分數。suspect 可在 Dashboard 人工復權，零成本復原。
>    - 「30 秒冷卻」review 後發現 Phase A 已經做了（10 秒，2026-07-04 依真實資料調
>      過），這次不重複改動；「提交次數 ≤ 消耗次數」逐筆對帳仍未做（改用 submit_count
>      門檻頂替，足以擋主要攻擊面，避免過度設計）。經典模式（`classic_records`）刻意
>      不動，攻擊模型不同（永久前三名、非單日制），之後有需要再另外設計。
>
> typecheck 過、preview 驗證經典模式頁面正常渲染無 console error（帳號隔離的實際
> 效果無法在單一瀏覽器 session 內驗證兩個帳號互不污染，需真機/多帳號手動確認）。
> `npm run build` + `npx cap sync android` 已跑。**使用者待辦**：Supabase SQL Editor
> 跑 `migration_20260712.sql`。
>
> ## 🔧 2026-07-12（v0.12.48）：修「分享後連跳兩個面板」——vc27
>
> vc26 上架後使用者真機驗證分享面板時發現：點「分享成績」跳出圖卡分享面板，
> **關掉之後又跳出第二個純文字分享面板**，體驗多此一舉。根因：`nativeShare.ts`
> 圖卡分享分支 `catch` 到任何錯誤（含使用者手動關閉/取消面板時原生 Intent 拋出
> 的 result-canceled）都會「往下走」再打一次純文字 `Share.share()`——這段 fallback
> 邏輯原本是為了處理「檔案分享真的失敗」設計的，但沒把「使用者取消」跟「真的失敗」
> 分開，導致取消也觸發第二次分享。同檔案內 web 版路徑（`GameCanvas.tsx`
> `AbortError` 分支）本來就有正確處理：使用者取消就直接結束、不 fallback，原生
> 路徑當初沒對齊。**已修**：圖卡分享 `catch` 到錯誤一律直接 `return false`，不再
> 落到純文字分享；純文字 fallback 只保留給「`renderShareCard` 圖卡產生失敗、
> blob 本身是 null」這種真正需要退路的情境。
>
> typecheck 過（此改動是原生殼專屬路徑，瀏覽器 preview 沒有 `@capacitor/share`
> 的 web 實作可測，跟這支檔案原本就記錄的限制一樣，需真機驗證）。`npm run build`
> + `npx cap sync android` 已跑（9 個外掛都在）、**`versionCode` 已推進到
> 27／`versionName "1.27"`**，待使用者下次進 Android Studio 打包簽署版上傳蓋掉
> vc26。⚠️ 待真機驗證：點「分享成績」只跳一次圖卡分享面板，關掉/選了 App 之後
> 不會再跳第二個。
>
> ## 📤 2026-07-12（v0.12.47）：分享面板修復 + LAUNCH_CHECKLIST.md 重寫
>
> 1. **✅ 分享功能改用 `@capacitor/share`**：修復 TWA→Capacitor 換殼後的體驗退化
>    （舊版分享完全靠 `navigator.share()`，Android System WebView 對帶檔案分享
>    支援不穩定常直接失敗，一路 fallback 到「複製剪貼簿」，玩家看不到系統分享
>    面板跟 LINE/FB/IG 捷徑圖示）。新增 `src/lib/nativeShare.ts`：原生殼先用
>    `@capacitor/filesystem` 把圖卡 Blob 轉 base64 寫進 `Directory.Cache`（原生
>    `Filesystem.writeFile` 的 `data` 參數在原生平台不接受 Blob，只吃 base64），
>    拿到 `file://` URI 交給 `Share.share({ files: [uri] })`——這是 Capacitor 官方
>    文件標準做法，`@capacitor/share` 內建會把同沙盒的 `file://` 轉 `content://`
>    過 FileProvider，不需要額外手動設定。`GameCanvas.tsx shareScore()` 依
>    `Capacitor.isNativePlatform()` 分流，web/PWA 版邏輯完全不變。⚠️ **這個改動
>    只能核對型別定義 + typecheck 過確認結構正確，無法在瀏覽器 preview 驗證原生
>    分享面板實際彈出行為**（preview 分頁隱藏導致 rAF 凍結，結算畫面 React state
>    轉不過去，跟本輪稍早驗證 BGM 時踩的是同一個環境限制；且 Capacitor 外掛本來
>    就沒有 web 版實作可測）——**需要使用者真機驗證**：結算畫面點「分享成績」，
>    確認跳出系統分享面板＋LINE/FB/IG 等捷徑圖示，不是只有複製連結。
> 2. **✅ `LAUNCH_CHECKLIST.md` 整份重寫**：舊版是 TWA 時代快照（vc11、7/8 申請日、
>    上一輪 12 人封測倒數），已對照現況全面更新——技術面核實項目（隱私政策/Data
>    Safety 表單/帳號刪除/IAP 定價全部標記已完成）、Play Console 待確認清單改用
>    👤 標記需使用者自己去後台核對（人數/天數這類即時狀態 Claude 沒有查詢權限）、
>    ASO 文案沿用舊稿但把「不用花一毛錢」改成「免費下載即可遊玩……選購項目」，
>    避免文案跟現在已上線的 IAP 互相矛盾。倒數天數改成從 **vc19**（Capacitor 首個
>    送審版本）起算，不再沿用 TWA 時代的舊日期。
>
> typecheck 過。這批屬於「web 分享路徑不變 + 文件」，不影響 Android 打包內容的
> 正確性判斷，但 `@capacitor/share`/`@capacitor/filesystem` 是新裝的原生外掛，
> **必須 `npx cap sync android` 才會進 vc26**（已跑，外掛數應為 9 個）。
>
> ## 🎮 2026-07-12（v0.12.46）：留存 UI/UX 批次全部動工完成（BGM/名次回饋/任務慶祝/訪客告知/鎖方向/通知深連結）
>
> 上一輪記錄的六項 UI/UX 待辦，使用者這輪逐項拍板後全部動工：
>
> 1. **✅ BGM**：使用者從 incompetech.com 選的兩首（CC-BY）已放進 `public/audio/`
>    （`galactic-rap.mp3`／`hiding-your-reality.mp3`，原始檔名有空格已改成 URL-safe）。
>    `audio.ts` 新增 `playMenuMusic()`/`playGameMusic()`——走
>    `MediaElementAudioSourceNode` 接進既有 `masterGain()`，跟音效共用同一顆音量
>    滑桿，不用整首解碼進記憶體。`App.tsx` 依 `track` 狀態切換：非遊玩畫面（首頁/
>    車庫/選單/每日排名賽列表等）放 Galactic Rap，實際跑賽道放 Hiding Your
>    Reality。⚠️ autoplay 政策：冷啟動首頁那次很可能被擋，`audio.ts` 內建一次性
>    `pointerdown` 監聽自動重試，使用者第一次點擊任何地方就會補播。PWA precache
>    `globPatterns` 確認不含 `.mp3`（不會把 10.7MB 音檔塞進離線快取）。
> 2. **✅ 排名賽即時名次回饋**：`App.tsx handleGameOver` 提交成功後重抓
>    `fetchDailyTop`（快取已被 `submitDailyScore` 內部清掉），用「精確比對分數+
>    時間」找自己那一列（`ScoreRow` 沒有 `player_id`，anon key 讀不到，用這個方式
>    唯一辨識足夠準）；找不到（100 名外或伺服器靜默拒絕）就不顯示，不臆測。新增
>    `dailyRank` prop 傳進 `GameCanvas`，結算畫面顯示「🏆 目前排名第 X 名」。
> 3. **✅ 任務完成結算慶祝**：`newlyDone`（每日任務，同步）+ `newlyDoneWeekly`
>    （週任務，async）合併進 `completedQuests` state，新增同名 prop 傳進
>    `GameCanvas`，結算畫面列出「✅ [任務標題] +X💰」，不浮誇、不擋按鈕、隨結算
>    畫面一起消失。
> 4. **✅ 訪客資料風險告知**：`Garage.tsx` 訪客狀態下顯示一行「⚠️ 訪客進度僅存於
>    本機…登入 Google 可雲端保存」。
> 5. **✅ 鎖螢幕方向為直式**：`AndroidManifest.xml` `MainActivity` 加
>    `android:screenOrientation="portrait"`（PWA manifest 早就有 `orientation:
>    "portrait"`，這次補齊原生殼）。
> 6. **✅ 每日提醒通知 deep link**：`notifications.ts` 新增
>    `onDailyReminderTapped()`（監聽 `localNotificationActionPerformed`，過濾
>    `REMINDER_ID` 避免誤觸發），`App.tsx` 註冊後導向每日排名賽畫面，不自動開局。
>
> **⏸️ 這輪明確跳過、之後再排**：分享面板換 `@capacitor/share`（修復
> TWA→Capacitor 退化的系統分享面板，這輪先維持現狀）。
>
> typecheck/build 過、`npx cap sync android` 已跑、Garage 訪客提示已用 preview
> 驗證正常渲染。**這批全部是要進下次 Android 打包才會生效**（BGM/名次回饋/任務
> 慶祝/deep link 都是原生殼裡才看得到差異，PWA 版今晚 push 後也會生效但沒有
> 通知/深連結那兩項，那兩項是 Capacitor 原生外掛專屬）。versionCode 維持 26
> 不變（上一批的 vc26 使用者尚未打包上傳，這批直接併進同一次打包）。
>
> ## 🔴 2026-07-11 第六批：修「排行榜洗榜印鑽石」漏洞 + UI/UX 討論記錄（未動工）
>
> **✅ 已修（使用者明確授權這一條動工）**：`submit_daily_score` 原本完全沒檢查「今天
> 有沒有消耗過排名賽次數」，可繞過 UI 直接打 API、每 10 秒洗一次物理上限內的分數；
> 每日排行榜名次直接發鑽石（真錢付費貨幣），等同免費印鑽石。已加
> `wallet_daily_attempts.attempts ≥ 1` 檢查，見 `supabase/migration_20260711c.sql`
> （⚠️ 待使用者手動跑）與 [ANTICHEAT_DESIGN.md](ANTICHEAT_DESIGN.md) 追加段落。
>
> **📌 過程中自我更正一次**：原本以為經典模式是「全服永久單一保持者」，查證後發現
> 7/8 就已經改成「每關每週前 3 名、週結算後重置」（`migration_20260708d.sql`），
> 舊分析的嚴重度判斷需下修，已記錄在 ANTICHEAT_DESIGN.md 避免下次又講錯。
>
> **✅ 已查證回答**：連假（五六日/國定連假）整段共用同一個 `map_date` session，
> 只在下一個真交易日收盤資料進來當晚結算一次，不會重複發獎；`daily_diamond_settlement`
> 用複合主鍵防重複，排程重跑多次也安全。
>
> **🔍 診斷（未動工）**：分享成績從 TWA 時代「跳出系統分享面板＋圖卡＋LINE/FB/IG
> 捷徑」退化成 Capacitor 版「只有複製連結」——根因是 TWA 走真正 Chrome 的
> `navigator.share()`（成熟、支援檔案），Capacitor 走 Android System WebView 的
> Web Share API（對帶檔案分享支援不穩定，常直接失敗），導致 `GameCanvas.tsx
> shareScore()` 的 fallback 鏈一路掉到剪貼簿。修法：換裝 `@capacitor/share`
> （官方套件，直接呼叫原生分享 Intent，不經過 WebView 的 Web Share API），圖片分享
> 需搭配 `@capacitor/filesystem` 先寫暫存檔（Blob 不能直接傳，多一道手續）。
>
> **⏸️ 待使用者統一拍板後才動工的 UI/UX 清單**：任務完成結算慶祝（不用久/不用浮誇）、
> 排名賽結算即時名次回饋（先做名次數字，玩家量大後再評估切百分比）、通知
> deep link（`?goto=daily`，機制已有現成的可以接）、鎖螢幕方向（manifest 一行，
> 建議跟下次重包一起做）、訪客資料風險告知（車庫頁一行小字）、分享面板換
> `@capacitor/share`（上面診斷段落那項）。BGM 素材由使用者自選 CC0/公開授權來源
> （建議 itch.io 免費音效包／incompetech.com），選好交檔案給 Claude 接進
> `audio.ts`。第二條（web 排名賽免費復活跟 Android 玩家不對等）使用者評估暫不擔心，
> 不追蹤為待辦。
>
> ## 💰 2026-07-11 第五批：IAP 顯示價含稅落差修正——最終定案售價 30/90/290/80
>
> 使用者實測發現 **Play Console「售價」輸入欄位跟玩家實際看到的顯示價不同**（含稅，
> 顯示價比輸入值高一截）——最早發現於 100 鑽石包：Console 輸入 30 元，玩家實際
> 看到 31 元。跟 Fable 5 討論後，使用者回推調整 Console 輸入值，讓**顯示價**精準
> 落在整數：
>
> | 商品 | Console 輸入 | 玩家實際看到（顯示價） |
> |---|---|---|
> | `diamonds_100`（100 鑽） | 29 元 | **30 元** |
> | `diamonds_350`（350 鑽） | 86 元 | **90 元** |
> | `diamonds_1200`（1300 鑽） | 279 元 | **290 元** |
> | `remove_ads_forever`（永久去廣告） | 76 元 | **80 元** |
>
> **鑽石三包的顯示價維持原定案（30/90/290）不變**，只是 Console 端輸入值下修去
> 抵掉稅差；**去廣告是真的漲價了**（原訂維持 72 元不動的決定被取代，顯示價定案為
> 80 元）。使用者已在 Play Console 改好全部四個商品的輸入值。
>
> **✅ 已同步進文件**：`DEVDOC.md` §2 鑽石來源表、`GARAGE_DESIGN.md` §4 車款分級、
> `src/lib/billing.ts` `DIAMOND_PACKS` 註解。程式碼本身不用改（`fetchPackPrices()`
> 一律動態向 Google 查詢顯示，從不寫死售價，只有註解記錄的參考數字要更新）。
> **之後任何地方提到「售價」一律指玩家實際看到的顯示價，不是 Console 輸入值**——
> 這是本輪最容易搞混的地方，日後再調價務必先用小額測試確認顯示價，不要直接假設
> Console 輸入值＝玩家看到的錢。
>
> 下一步（使用者已表明，非本輪）：UI/UX 與同類手遊的系統性比較、遊戲玩法本身的
> 漏洞/邊角案例掃描——這兩塊仍待另外排時間做，這輪只記錄到這裡。
>
> ## 📄 2026-07-11 第四批：隱私權政策補正 + Play Console Data Safety 對齊 + 文件盤點
>
> 核對 Play Console 資料安全性表單匯出的 CSV 時發現：廣告 ID／購買記錄兩項揭露正確
> （已勾收集+分享+廣告用途），但**「是否開放使用者要求刪除自己的資料」這題還停在
> 「否」**——跟剛做好的 App 內自助刪除帳號功能矛盾。使用者已在 Play Console 改成
> 「是」並補上刪除資料網址（沿用已填的 `https://taiexrider.pages.dev/privacy`）。
>
> **✅ 隱私權政策（`public/privacy.html`）同步修正**：原本寫「本遊戲目前不含任何廣告
> 或第三方追蹤器」是過時陳述（AdMob 早已上線），已改列 Google AdMob／Google Play
> 帳務服務的揭露段落；帳號刪除段落補上 App 內自助路徑，email 申請降為備援；補充
> 金流稽核紀錄（`iap_purchases`）不在使用者刪除範圍內的說明。
>
> **✅ 順便做了一次全站文件盤點**（使用者要求確認 MD 是否都最新）：`DEVDOC.md`／
> `GARAGE_DESIGN.md` 的鑽石定價表還停在 2026-07-06 的暫定佔位價（NT$30/90/270、
> 1200 顆、去廣告 NT$69），已更新成 07-11 定案值（NT$30/90/290、1300 顆、去廣告
> NT$72 不動）。`SECURITY_REVIEW.md` 補了第三輪複查段落記錄本輪＋上一輪的資安修復。
> `LAUNCH_CHECKLIST.md` 整份是 TWA 時代（vc11、舊封測 12 人倒數）的過期快照，**尚未
> 處理**——現在的 vc25/vc26 是 Capacitor 切換後全新一輪封測，這份文件如果要用於下次
> 申請正式版，需要整份重寫或至少加開「本輪」段落，待使用者決定是否現在動工。
>
> ## 🔧 2026-07-11 第三批（v0.12.45）：拔掉互動式首玩教學（卡關 bug）+ 靜態遊玩教學
>
> **bug 根因**：第二批做的互動教學要求「連續騰空滿 2.2 秒」才判定學會後空翻
> （`tutStage==="air"` 的 timeout），但實測物理下一般翻轉騰空時間遠短於 2.2 秒
> （玩家真實紀錄約 0.66 圈/秒），導致浮層幾乎不會消失——使用者實測回報「翻了也沒
> 反應、連分數都沒加到」證實。核心操作只有一個手勢，互動式狀態機的猜測性門檻本來
> 就不值得維護，改用靜態說明更穩妥。
>
> **✅ 已修**：`GameCanvas.tsx` 整個 `tutStage` 狀態機（state/兩個 useEffect/浮層渲染）
> + `GameCanvas.css` `.tut-hint` 全部移除，`tr_tutorial_seen` key 不再寫入（舊玩家
> 裝置上殘留的 key 是死資料，無需清理）。原本設定裡的「遊戲說明」按鈕**改名「遊玩
> 教學」**（沒有另開新按鈕——避免跟原內容重複，維持設定面板精簡），內容新增
> 「💰 金幣怎麼賺」「💎 鑽石怎麼賺」兩節，把完賽/摔車/長征/任務/看廣告/狂暴盤加倍
> 等所有金幣鑽石管道用白話寫清楚（數字取自 `playRewards.ts`/`migration_20260708c,d.sql`）。
>
> typecheck/build 過、`npx cap sync android` 已跑。
>
> **✅ 出貨狀態**：vc25（鑽石定價/帳號刪除/In-App Review/每日提醒/首玩教學第一版）
> 使用者已打包簽署版上傳，**審核通過、Play Console 已更新**。Play Console 三包鑽石
> 售價也已改成 30/90/290 定案值。緊接著在同一批發現首玩教學卡關 bug 並修好（見本節
> 標題），**`versionCode` 已推進到 26／`versionName "1.26"`**，`dist/` 已重新編譯、
> `cap sync` 已跑，待使用者下次進 Android Studio 打包簽署版上傳 vc26 蓋掉教學卡關版本。
>
> ## 🔧 2026-07-11：資安補洞 + 移除遊戲內更新日誌（Fable 5 全面體檢後動工）
>
> 使用者要求做一次全面體檢（資安/UI-UX/上架/遊戲漏洞/方向）。第一批已動工的：
>
> 1. **🔴✅ `claim_weekly_quest` 進度驗證洞（伺服器端）**：舊版發週任務金幣前只檢查
>    「quest_id 合法 + 本週沒領過」，**從不驗證進度是否達標**。這支 RPC 是
>    `grant to authenticated`，任何登入者直接打 API 帶任意合法 quest_id 就能無條件領走
>    該週金幣（一週可刷 ≈380 金幣不用玩）。金幣純外觀（只買車皮、不碰真錢/排行榜），
>    但牴觸「數值竄改零容忍」原則、且跟 `wallet_unlock_achievement` v2 早該一致的自驗
>    門檻同類。**已修**：`supabase/migration_20260711.sql` 加進度閘門（讀
>    `player_weekly_quest` %rowtype，依 quest_id 比對 target，未達標回 ok=false），
>    target/欄位對照與前端 `weeklyQuests.ts` POOL 一致，42702-safe。
>    ⚠️ **使用者要在 Supabase SQL Editor 手動跑這份**（push 不生效）。
> 2. **✅ 移除遊戲內「更新日誌」**：`version.ts` 的 CHANGELOG 寫到後面出現「SQL 欄位
>    參照不明確」「migration_xxx.sql」這種開發者內部字眼，玩家看到很怪。已刪掉
>    CHANGELOG 資料 + `Home.tsx` 的「更新日誌」按鈕/彈窗（保留「遊戲說明」）。`APP_VERSION` 保留。
> 3. **✅ CSP 收緊**：`public/_headers` 移除死掉的 `http://127.0.0.1:47591`（TWA 時代
>    AdMob loopback 橋接，Capacitor 版走同進程 plugin bridge 不再用）。
>
> typecheck 過。待使用者跑 migration_20260711.sql；`wallet_earn` 農場化屬 ANTICHEAT
> Phase B（正式上架後）。
>
> ## 🔧 2026-07-11 第二批（v0.12.44）：體檢後續六項全部動工完成
>
> 1. **✅ 首頁副標語移除**：`Home.tsx` 拔掉「把台股走勢騎成霓虹賽道」（boot splash 的
>    `bs-sub` 保留），標題 `margin-bottom` 補間距。
> 2. **✅ 帳號刪除（Play 合規）**：新 Edge Function `supabase/functions/delete-account`
>    （只信 JWT 只能刪自己；逐表刪 13 張含 player_id 的表，**iap_purchases 刻意保留**
>    金流稽核；最後刪 auth 使用者；任一表失敗即中止不刪 auth，可重試）。前端
>    `auth.ts deleteAccount()` + `Home.tsx` 設定面板「刪除帳號」低調連結 → 紅框警告
>    雙重確認 → 成功後清快取回訪客。⚠️ **要手動部署**：
>    `npx supabase functions deploy delete-account --project-ref cjnwwtrpveejhbwalncy`
> 3. **✅ In-App Review**：裝 `@capacitor-community/in-app-review@8`。`lib/review.ts`
>    `maybeRequestReview()`（自我節流：最多 3 次、間隔 14 天、破 PB 結算畫面延遲 1.5s
>    觸發）；GameCanvas 在 `(crashed||finished) && newPb` 時呼叫。原生殼限定。
> 4. **✅ 每日提醒（本地通知）**：裝 `@capacitor/local-notifications@8`。
>    `lib/notifications.ts`：每天 20:00 固定 id 9001（重排程冪等）。權限 UX：**冷啟動
>    不要權限**，第一局玩完（`App.tsx handleGameOver`）才問一次，拒絕不再煩；每次啟動
>    `ensureDailyReminder()` 只在已授權時默默重排程。不用 web push（無後端可維護性成本）。
> 5. **✅ 首玩教學浮層**：GameCanvas `tutStage` 狀態機（一生一次，`tr_tutorial_seen`）：
>    hold「👆 按住螢幕＝加速前進」→ 按住滿 1.2s 晉級 → 首次騰空顯示「🔄 空中持續按住＝
>    後空翻」撐滿 2.2s＝學會；air 階段沒學完就結束的局直接標記看過（不每局煩人）。
>    已用 preview `__test` 鉤子驗證 hold 顯示與晉級。
> 6. **✅ 鑽石定價定案**：售價 NT$30/90/290（**使用者要去 Play Console 手動改售價**）、
>    內容物 100/350/**1300**（大包 1200→1300，SKU id `diamonds_1200` 不改）。
>    `billing.ts` 已改；**`supabase/migration_20260711b.sql` 要手動跑**（grant_iap_diamonds
>    白名單 1300）。去廣告維持 NT$72 不動。
>
> typecheck/build 過、`npx cap sync android` 已跑（外掛 7 個含新增 2 個）——**這批要
> 進 vc25 打包才在 Android 生效**（In-App Review/本地通知是原生外掛，PWA 版無感）。
> 使用者待辦：① 跑 migration_20260711.sql + 20260711b.sql；② 部署 delete-account
> Edge Function；③ Play Console 改三包售價 30/90/290；④ 打包 vc25。
>
> ## ✅ 2026-07-10 深夜：「騎乘中車子陷進地形」已用穿透修正(de-penetration)根治，預設開啟
>
> iOS PWA 玩家回報車子沉進地形、被彈上來、有時候死掉（**跟 iOS 無關，Android 一樣會中**；
> 固定步長迴圈讓物理在各平台一致）。
>
> **根因**：`cruiseSpeed = 6.912 px/step` ≥ `wheelRadius = 6px`。Matter.js 沒有連續碰撞
> 偵測，車子以正常巡航速度接觸夠斜的下坡面時，**第一次偵測到接觸那一步輪子就已埋入約
> 4.9px（近乎整個半徑）**，接觸法線退化後 solver 把它愈推愈深 → 卡住或 `crashZone` 觸地判死。
> 不需要高速墜落。`simSinkScan.ts` 4500 局實測：正常玩法 **14.3% 的局會發生**。
>
> **試過但否決的兩條路**（都用面板/headless 實測過）：
> - `PHYSICS.subSteps=2/3`：headless 能修（深陷 15.3%→0%），但**使用者真機實測會掉幀 +
>   上不了坡**（每幀 2× 物理的先天成本），否決。程式碼保留在 `PHYSICS.subSteps`（預設 1）
>   當對照，不啟用。
> - 加大 `wheelRadius`：headless 顯示會**破壞車體幾何導致幾乎必死**（wr=7 → 792/800 摔車，
>   完賽 681→8），因為 `wheelDropY`/`chassisRadius`/`crashZone`/軸約束全繞著輪徑 6 調的。否決。
>
> **✅ 採用：穿透修正 de-penetration（`PHYSICS.depenetrate=1`，預設開）**：每幀 `Engine.update`
> 後偵測輪子有沒有陷進地表（`terrain.ts surfaceNormal()`），有的話沿地形法線推回表面 +
> 消掉往內速度。**不加子步(不掉幀)、不改手感/輪徑/任何常數，只在真的穿透 >1px 時才作用**，
> 正常貼地不介入 → 手感零改變。headless 4500 局實測（`simSinkScan.ts depen=on`）：
> **深陷率 15.3%→0%、最深 66.9px→9px、假死 119→36、完賽 681→764**，且沒有加大輪徑那種
> 車體變脆問題。GameCanvas/devSinkSim/simSinkScan 三處同一套邏輯。typecheck 過、正式 build
> 已驗證含修正邏輯且不含 DEV 面板。
>
> **副作用（要讓使用者知道）**：現行版本約 **15% 的「死亡」其實是這個 bug 害的**，修好後
> 那些會變成正常騎過去 → 遊戲會**變寬容一點**，這是預期行為，不是難度被調低。
>
> **✅ 出貨狀態（2026-07-11）**：
> - **網頁版（PWA）已上線**：`git push` 觸發 GitHub Actions 自動部署到 Cloudflare Pages，
>   已驗證 `taiexrider.pages.dev` 線上版含穿透修正（PWA 每 60 秒自動檢查新版，玩家待在
>   首頁一分鐘內自動更新，見 `src/pwa.ts`）。iOS PWA 玩家這條路已生效。
> - **Android**：**vc23（返回鍵/廣告預載/動畫開屏）使用者已打包簽署版上架封閉測試**；
>   穿透修正接續進 **vc24**——`versionCode 24`/`1.24` 已設、`npm run build`+`npx cap sync
>   android` 已跑（驗證過 android assets = 含修正的新 dist），使用者正在 Android Studio
>   打包簽署版 AAB 上封閉測試。DEV 面板有「穿透修正」滑桿(0/1)可在遊戲裡 A/B 對照。
>
> ## 🆕 2026-07-10（週五）家裡電腦晚場：三項體驗優化已完成 + 真機驗證全過（✅ 已打包 vc23 上架）
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
> **✅ 已出貨**：三項真機驗證全過後，使用者已打包 `versionCode 23`/`1.23` 簽署版 AAB
> 上傳封閉測試軌道。（後續穿透修正接續進 vc24，見本檔最上方「穿透修正」段。）
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
- **IAP 金流二次稽核**（報告全文在 [History.md](History.md)「📦 已封存文件：FABLE5_HANDOFF_20260709.md」段落底部）：
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
   `ca-app-pub-8981745966447649/2170377077`）。**技術上必須等公開上架後才能換**
   （不是使用者選擇要等）：AdMob 的「連結 Play 商店 listing」要查詢公開商店頁面，
   封測軌道不公開，AdMob 查不到、連不了；同時「放送資格審核」也要等 App 公開上線
   才能申請——**先維持測試單元，公開上線當下再一起處理**（AdMob App 也要回
   「應用程式設定」補 Play 商店 listing 連結）。
2. **正式上架時**：跑 [supabase/prelaunch_cleanup.sql](supabase/prelaunch_cleanup.sql)
   清玩家遊戲數據（**使用者會自己找時機手動跑**，不用 Claude 主動提醒/催促；動手前
   跟使用者逐表再確認一次；絕不動帳號/錢包/iap_purchases）。2026-07-13 已修復
   +3 鑽石重複發放漏洞（`wallet_daily_attempts` 一併 truncate），跑最新版即可。
3. ~~查封測期歷史交易~~：**使用者確認不需要**——封測期間所有交易都是用 Google Play
   授權測試名單的假信用卡刷的，不是真人真錢，正式上線前會把這些測試交易紀錄
   （`iap_purchases` 等）整批清掉，不需要逐筆去 Play Console 對帳查是否有真人受害。
4. ~~反作弊 Phase B/C~~：**✅ 全部已實作**（Phase A 2026-07-04、Phase B/C 2026-07-12，
   見 [ANTICHEAT_DESIGN.md](ANTICHEAT_DESIGN.md)）。這條連同下一條的「Ghost 回放」字樣
   是 7/12 之前寫的舊待辦，Ghost 鬼影賽跑早已上線（vc28）且 2026-07-15 才剛升級成
   真實車皮，2026-07-16 核對後修正，避免繼續誤導。
5. **RETENTION 第三批唯一還沒做的**：週聯賽 30 人分組升降級。長期，未排期，
   見 [RETENTION_PLAN.md](RETENTION_PLAN.md) 批次 6。
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
   三座橋都在簽署版真機驗證過**。舊 TWA 專案備份
   `C:\Users\tyl16\Documents\Private\TaiexRider-TWA-backup\`
   **已於 2026-07-15 刪除**——Capacitor 版從 vc19 穩定跑到 vc30，多次過審+真機驗證，
   已無回退需求；TWA 關鍵踩雷教訓仍留在本檔「踩雷筆記」§TWA/androidbrowserhelper
   與 [History.md](History.md) 舊交接紀錄裡，不會因為刪備份而遺失。完整合併細節見
   [CAPACITOR_EXPERIMENT.md](CAPACITOR_EXPERIMENT.md)「🔀 正式合併進主專案」。
   - 🔑 **架構認知（使用者已確認接受）**：Capacitor 版是把網頁內容**打包進 APK**
     （`capacitor.config.ts` 沒設 `server.url`），跟 TWA「即時開網站」不一樣——
     以後只改網頁邏輯、`git push` 部署到 Cloudflare Pages，Capacitor 版玩家**不會**
     馬上看到更新，要重新打包上傳 Play Console、玩家更新 App 才會生效。
     ~~2026-07-10 當時判斷「不用特別再設計殼版本更新提示」~~——**已於 2026-07-15
     推翻並實作**（見本檔「目前進度」2026-07-15 晚該段、DEVDOC §9.5b），因為玩家
     實際更新後遇到 Service Worker 殘留造成的閃爍問題，順帶把這個一起做掉了。
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
  車庫系統/車皮管線 OpenCV 重建/原生體驗）→ History.md「📦 已封存文件：FABLE5_HANDOFF.md」、
  DEVDOC 各節。vc9 啟動崩潰事故已結案（→ 踩雷筆記 TWA 段）。
- **已取消不做**：Web Push、週五馬拉松、好友邀請比較、排行榜 emoji 反應、BETA #4
  前翻/煞車鈕、歷史紀念日事件、經典週榜（併入週聯賽構想）。
- **鑽石車款 P 系列 5 台**：✅ 全數上線已核實（2026-07-09 用程式碼再確認過），無待辦，
  **不要再問**。IAP 真實售價 TWD 31/94/280/72。

### 📂 文件地圖

[DEVDOC.md](DEVDOC.md) 架構/規格/踩雷結論 ・ [History.md](History.md) 舊交接紀錄（含
2026-07-15 併入的 NEXT_BATCH_PLAN／FABLE5_HANDOFF／FABLE5_HANDOFF_20260709／
BETA_FEEDBACK 四份已完結文件，內容原封不動搬入，見該檔「📦 已封存文件」標記）・
[CAPACITOR_EXPERIMENT.md](CAPACITOR_EXPERIMENT.md) Capacitor 遷移全紀錄（✅ 2026-07-10 已正式切換、vc19 送審）・
[SECURITY_REVIEW.md](SECURITY_REVIEW.md) ・ [ANTICHEAT_DESIGN.md](ANTICHEAT_DESIGN.md) ・
[RETENTION_PLAN.md](RETENTION_PLAN.md) ・ [WALLET_PLAN.md](WALLET_PLAN.md) ・
[GARAGE_DESIGN.md](GARAGE_DESIGN.md) ・ [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md)

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
- 手感參數全集中在 `src/game/constants.ts`。**開發時用 DEV 調參面板即時拖滑桿**（見下節），
  不要「改一版打包一版」。

### 🕳️ Matter.js 0.20 單位鐵則（做物理子步時踩過，很隱蔽）
- **`Body.setVelocity()/setAngularVelocity()` 吃的是「每 `_baseDelta`(16.666ms) 的量」**，
  內部自己用 `body.deltaTime` 換算，**跟你傳給 `Engine.update()` 的 delta 無關**。
- **但直接讀 `body.velocity` / `body.angularVelocity` 拿到的是「每次 update 的位移」**
  （＝每個子步）。兩者單位不同！`subSteps=1` 時剛好相等，所以以前不會出錯。
- **通則：讀取一律用 `Body.getVelocity()` / `Body.getAngularVelocity()`（回傳 per-baseDelta），
  寫入用原始常數。** 混用會讓車速隨子步數變慢（實測 subSteps=2 時完賽步數 2726→3708）。
- 子步換算：速度/角速度上限**不用除以 n**（絕對目標值）；只有「每個子步都累加一次」的
  增量（`airSpinAccel` 等）要 ÷n；`groundLockEase` 這種 ease 取 n 次方根；**重力要 ×n**
  （Matter 的重力位移 ∝ delta²，n 個 Δ/n 子步只累積出原本的 1/n）。
- **`frictionAir` 不用動**：Matter 內部已是 `1 - fa*(deltaTime/_baseDelta)`，自動按 delta
  正規化。自己再開 n 次方根＝重複校正。

### 🎛️ DEV 調參面板（`npm run dev` 限定，正式 bundle 已驗證不含它）
- 進遊戲畫面右下角 ⚙ 打開。滑桿**即時生效**（直接改 `constants.ts` 匯出的物件——`as const`
  只是編譯期唯讀，執行期沒有 `Object.freeze`），車體幾何類（輪半徑等）需按「重開這局」。
- 面板同時顯示**即時 sink 讀數**（輪子陷進地形多深）與**單步位移 vs 輪半徑**，調參時直接
  看得到有沒有穿透；還有「自動驗證」按鈕，用當前參數在瀏覽器跑 N 局真實股價地形回報沉沒率。
- 調滿意後按「複製設定」，把片段貼回 `src/game/constants.ts` 才算真的落地（面板不會自動寫檔）。
- **手機實機調參**：`npm run dev -- --host`（`vite.config.ts` 已設 `server.host: true`），
  手機連同一個 wifi 開 `http://<電腦IP>:5173`。第一次可能要在 Windows 防火牆放行 Node.js。
- 相關檔案：`src/game/devTuning.ts`（參數表/持久化/匯出）、`DevTuner.tsx`+`.css`（UI）、
  `devSinkSim.ts`（瀏覽器內驗證，是 GameCanvas 物理迴圈的鏡像，改控制律時兩邊要同步）。

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
