# TaiexRider 開發規劃

> 概念：將台股每日走勢轉換成 2D 機車越野賽道（StonkRider 概念的台股本地化版本）。
> 玩家每天看到的賽道，是**前一個交易日**的真實資料 — 全離線可玩、無需即時行情。

> 🔀 **2026-07-10 起：Android 原生殼已從 TWA 正式切換到 Capacitor**，見
> [CLAUDE.md](CLAUDE.md) 待辦 6b 與 [CAPACITOR_EXPERIMENT.md](CAPACITOR_EXPERIMENT.md)
> 掌握最新狀態。下面 §9.4c（AdMob 8 層坑）、§2.7（IAP 除錯鏈）、§9.2（TWA 簽署金鑰/
> assetlinks）等段落記的是 **TWA 時代的技術決策與踩雷歷史**，保留作為歷史紀錄（部分
> 踩雷結論如「Play App Signing 重新簽署」在 Capacitor 時代仍然適用，只是換了個機制
> 表現出來，見 CAPACITOR_EXPERIMENT.md 的 Google 登入 checklist），但**架構現況請
> 以上面兩份文件為準**，不要照著 TWA 段落提到的程式碼路徑（`AdActivity.kt` 等）去找
> 現在的檔案，那些已經不存在了。

---

## 0. 部署架構

| 項目 | 說明 |
|---|---|
| 線上網址 | `taiexrider.pages.dev`（Cloudflare Pages） |
| CI/CD | GitHub Actions（`.github/workflows/deploy.yml`） |
| 觸發條件 | push to `main` → 自動 build + deploy |
| Deploy 指令 | `wrangler pages deploy ./dist --project-name taiexrider` |
| Token 存放 | GitHub repo → Settings → Secrets → `CLOUDFLARE_API_TOKEN` |
| Token 權限 | `Account: Cloudflare Pages: Edit` |
| Cloudflare 帳號 ID | `aa30f8795c349575164c118e5876ec60` |

> ⚠️ **不使用 Cloudflare 本身的 CI**（曾因 Build token 權限問題放棄，改為 GitHub Actions）。
> Cloudflare Pages 上的 `taiexrider` 專案是用 **Direct Upload** 方式建立，Git integration 未啟用。

---

## 1. 技術棧

| 層級 | 選擇 | 備註 |
|---|---|---|
| 前端 | React 18 + Vite 5 + TypeScript | |
| 渲染 | HTML5 Canvas 2D | 不需要 PixiJS |
| 物理引擎 | Matter.js | 機車車身/輪胎/地形碰撞 |
| PWA | `vite-plugin-pwa` (Workbox) | `skipWaiting: true` / `clientsClaim: true`（v0.7.2 起新版即時接管）|
| 後端/資料庫 | Supabase（Postgres + PostgREST + Auth） | 排行榜、每日地圖資料、Google 登入 |
| 排程 | GitHub Actions cron（每日 16:00 台灣時間） | 抓全台上市股盤中資料存 Supabase（Yahoo Finance 源）|
| 上架封裝 | `androidbrowserhelper:2.7.1`（手動 TWA） | Android Studio 手動建立，package `com.tylapp.taiexrider` |

---

## 2. Supabase Schema（`supabase/schema.sql`）

### 2.1 `daily_map` — 每日賽道資料

```sql
create table public.daily_map (
  map_date    date    not null,
  stock_code  text    not null,
  stock_name  text    not null,
  prices      jsonb   not null,   -- 盤中走勢數值陣列（~110 點）
  difficulty  float8  not null default 0,
  primary key (map_date, stock_code)
);
alter table public.daily_map enable row level security;
create policy "public read" on public.daily_map for select using (true);
```

每日由 GitHub Actions 更新。`map_date = 實際交易日 sessionDate + 1`，讓 00:00 即生效。
⚠️ **不可用「執行當下時間 +1」推算**——GitHub 排程延遲跨午夜會錯位+跳號。`sessionDate` 從 Yahoo 回傳的 K 棒 timestamp 直接讀出（實際交易日），詳見 §3.1 與 CLAUDE.md「時區踩雷」。
客戶端查詢策略（連假安全 + 午夜換圖）：`resolveSessionDate()` 取 daily_map 中 `map_date ≤ **今天**（日曆日）` 的 **max**（最近一期），地圖與排行榜 challenge key 全部對齊它。上界用「今天」即可午夜換圖（`map_date=sessionDate+1` 內建 00:00 才生效）；連假時日曆日超過最後交易日的 map_date → lte+desc 往回沿用最近一期，下個交易日盤抓到隔天 00:00 才換。⚠️ 不可只查「今天/明天」精準比對——連假第二天起日曆日就錯過 → 掉回靜態盤。RPC `submit_daily_score` 的 `challenge_date` 也用 `max(map_date ≤ 台灣今天)`（同源），連假整段累積在同一張榜。詳見 CLAUDE.md「app 讀取（連假安全 + 午夜換圖）」。

### 2.2 `daily_scores` — 每日排行榜成績

```sql
create table public.daily_scores (
  id            bigserial primary key,
  challenge_date date    not null,
  player_id      text    not null,
  player_name    text    not null,
  score          int     not null,
  time_ms        int     not null,
  flips          int     not null default 0,
  perfect        int     not null default 0,
  created_at     timestamptz default now(),
  skin_id        text    not null default 'default',  -- 2026-07-15 起：提交當下使用的車皮 id
  unique (challenge_date, player_id)
);
alter table public.daily_scores enable row level security;
create policy "public read"   on public.daily_scores for select using (true);
create policy "auth insert"   on public.daily_scores for insert with check (auth.uid() is not null);
create policy "auth update"   on public.daily_scores for update using (auth.uid() is not null);
```

提交走 `leaderboard.ts` 的 `submitDailyScore()` → RPC `submit_daily_score`（security definer），需 Google 登入（`auth.uid()` 伺服器端決定 player_id）。

⚠️ **2026-07-15：鬼影改用紀錄保持者當下使用的車皮，不是玩家自己的車**（`migration_20260715.sql`）。`submit_daily_score` 新增 `p_skin_id`（存進 `skin_id` 欄位）；`get_daily_ghost_path(p_date)` 回傳型別從純 `jsonb`（path）改成 `table(path jsonb, skin_id text)`（回傳型別變更需 `drop function` 重建，不能 `create or replace`），PostgREST 因此改回陣列，前端 `fetchDailyGhostPath()` 讀 `data[0]`。渲染端（`GameCanvas.tsx` `drawGhost()`）用 `ghostSkinId` 查 `BIKE_SKINS` 载入對應貼圖，找不到 fallback 預設車；同時拿掉舊版的去色濾鏡（半透明 0.32 已足夠跟玩家自己的車區分，且能看清對手真實車款/顏色）。
⚠️ **`challenge_date` = `coalesce(max(map_date ≤ 台灣今天), 台灣今天)`**（與前端 `resolveSessionDate()` 同源），讓週末/連假整段成績累積在同一張榜、午夜才換新榜。**不可用 `current_date`（UTC）**（台灣午夜後存到前一天），**也不可只用台灣日曆日**（連假時 ≠ 最後交易日的 map_date，會跟讀取端的 max(map_date) 對不上 → 看似沒上榜）。⚠️ **改 schema 後 push 不會更新 RPC，要手動在 Supabase SQL Editor 跑 `create or replace function submit_daily_score`。** 詳見 CLAUDE.md「排行榜對齊」「時區踩雷」。

### 2.3 `keep_alive` — Supabase 保活

```sql
create table if not exists public.keep_alive (id int primary key, pinged_at timestamptz);
insert into public.keep_alive values (1, now()) on conflict (id) do nothing;
```

cron-job.org 定期 ping，避免 Supabase 免費方案休眠。

### 2.4 `classic_records` — 經典模式前三名（2026-07-06 從「單一保持者」改版）

```sql
create table if not exists public.classic_records (
  level_id     text not null,
  player_id    text not null,
  player_name  text not null,
  score        int  not null,
  time_ms      int  not null,
  updated_at   timestamptz not null default now(),
  primary key (level_id, player_id)   -- 複合鍵，每關可多列（前 3 名）
);
```

經典關卡是固定地形，適合永久排行榜。原本每關只留 1 位保持者，2026-07-06 使用者拍板簡化成「每關前 3 名，不算百分位」（比原規劃的「Top N + 百分位排名」省成本，不需要存全部玩家成績）。提交走 RPC `submit_classic_record(p_level,p_name,p_score,p_time)`（security definer，需登入）：先 upsert 玩家自己那筆（分數更高，或同分時間更短才覆蓋自己的舊紀錄），再 `delete` 裁剪到該關前 3 名（依分數降冪、時間升冪取前 3，其餘刪除）。**表大小天生封頂在「關卡數 × 3」**（目前 12 關＝36 列上限），不隨玩家數增長。前端 `src/lib/classicRecords.ts` 讀取（`select` 依 `level_id,score,time_ms` 排序、client 端 group 成 `Map<level_id, ClassicRecord[]>`）+ 提交，`ClassicSelect.tsx` 顯示 🥇🥈🥉。schema 見 `supabase/migration_20260706b.sql`。⚠️ 改 schema 後 push 不會更新，要手動在 Supabase SQL Editor 跑。

### 2.5 帳號相關資料（錢包/成就/streak/暱稱）— 伺服器端權威

2026-07-05~06 起，已登入玩家的金幣/鑽石/擁有清單/Q 系列成就進度/streak/暱稱全部改為
**伺服器端權威、localStorage 只當顯示快取**（未登入玩家維持純本地，接受）。完整 schema/RPC
定義見 `supabase/migration_20260705.sql`（`player_wallet`/`wallet_earn_log`/
`wallet_daily_attempts` + `wallet_get`/`wallet_earn`/`wallet_spend_skin`/
`wallet_unlock_achievement`/`wallet_dev_grant`/`consume_attempt`）與
`supabase/migration_20260706.sql`（`player_achievements`/`player_streak` +
`get_player_name`/`record_market_finish`，並擴充前述數支 RPC 一併回傳成就/streak）。
規劃背景與踩雷見 [WALLET_PLAN.md](WALLET_PLAN.md)。

⚠️ **關鍵設計**：`wallet_unlock_achievement()` 是伺服器**自行查 `player_achievements`/
`player_streak` 是否達標**才放行，不是「客戶端說達標就給」——早期版本信任客戶端宣稱，
曾導致同裝置切換 Google 帳號時，一個帳號的假成就進度被拿去誤解鎖另一個帳號的車款
（2026-07-05 事故，見 CLAUDE.md 待辦 1b）。之後任何「解鎖/發獎勵」類 RPC 新增時，
都應該讓伺服器自己查權威資料判斷資格，不要只信任客戶端傳的「我達標了」。

⚠️ **PL/pgSQL 重大踩雷（2026-07-09 修，`migration_20260709b.sql`，SQLSTATE 42702）**：
`returns table(coins int, ...)` 會把輸出欄位名變成函式內的**隱含變數**，函式裡再寫
`update player_wallet set coins = coins + x` 時，右邊的 `coins` 到底是資料表欄位還是
輸出變數，Postgres 判斷不了，**整個函式呼叫直接拋例外 rollback**（連同前面已 insert 的
log 一起回滾，前端又慣例把 RPC 失敗靜默吞掉 → 玩家只是「安靜拿不到錢」）。這個 bug 從
`migration_20260705.sql` 第一版 `wallet_earn()` 就存在、被複製到每次改版，**代表 7/5~7/9
期間所有玩家的金幣獎勵/週任務金幣/真錢購買鑽石從來沒有真的寫進資料庫**（畫面上的加幣
全是前端樂觀顯示，進車庫重新同步就打回原形——這正是當時「金幣歸零」回報潮的真因）。
`settle_daily_diamonds()`/`settle_classic_weekly()` 因 `returns void` 沒有撞名輸出變數，
一直正常。**規則：RPC 的輸出欄位名跟資料表欄位同名時，UPDATE/WHERE 裡的欄位一律加
資料表名前綴**（`player_wallet.coins`），或改用 `v_` 前綴的區域變數中轉。

### 2.6 留存規劃第二批（2026-07-06/07，`migration_20260706b.sql` + `migration_20260707.sql`）

**狂暴盤日事件**：`public.taiex_change_pct()` 共用函式（抽出自 `record_market_finish()`）算出當期 TAIEX 漲跌幅；`|漲跌| ≥ 2.5%` 時 `wallet_earn('quest')`／`claim_weekly_quest()` 自動把任務獎勵面額 ×2。門檻用 TAIEX 近 2 年 482 交易日實測資料校準（2% 出現機率 14.9%／約每週一次太常見，2.5% 出現機率 10.0%／約兩週一次）。前端 `src/lib/marketMood.ts` 的 `MarketMood.isRage` 只負責首頁公告顯示，實際加倍判定在伺服器端，不信任前端。

**股票圖鑑**：`player_collection(player_id pk, codes text[])`——每人一列存已收集股票代號（陣列去重），天生封頂在股票池總數（~1090），不隨玩家數爆炸，永久不清除。`collect_stock(p_code)` RPC 寫入；`wallet_get()` 一併帶回 `collection` 欄位（沿用既有登入同步呼叫點）。App.tsx `handleGameOver` 依 `track.kind==='stock'` 收集（長征模式一次收 5 支，代號來自 `subtitle` 換行分隔）。

**圖鑑分母（絕版制）**：`stock_registry(stock_code pk, stock_name, first_seen, last_seen, delisted)`——任何人可讀（不需登入）。`scripts/fetchDailyMap.ts` 的 `upsertStockRegistry()` 每天把已經在抓的 TWSE 官方上市清單順手 upsert 進來（`Prefer: resolution=merge-duplicates`，只送 `stock_code/stock_name/last_seen`，`first_seen` 靠 DEFAULT 只在新列生效、不會覆蓋舊值），再呼叫 `mark_delisted_stocks(p_active_codes text[])` RPC 用同一份清單比對出下市名單。**安全防呆**：`p_active_codes` 長度 < 500（代表 TWSE 抓取失敗/不完整）就直接不執行標記，避免把全部股票誤判下市。設計理由：分母只增不減（下市股票標記絕版但不消失），避免「圖鑑總數自己變少」的詭異體感，見 RETENTION_PLAN.md。

**週任務**：`player_weekly_quest(player_id, week_key, perfect_sum, flips_sum, max_score, max_survive_sec, play_count, claimed[])`，複合鍵 `(player_id, week_key)`。`week_key` 用 ISO 8601 週別（`YYYY-Www`，`src/lib/weeklyQuests.ts` 的 `weekKey()` 本地時區實作，非 UTC）。`record_weekly_run()` 累加進度、`claim_weekly_quest()` 驗證＋發獎（含狂暴盤 ×2），`get_weekly_quest()` 純讀取。任務池仿每日任務放大成週尺度，3 選其一 seeded。清理：`cleanup_old_wallet_logs()`（已被 CI 每日呼叫）順便清 8 週前的列，`week_key` 用 `to_char(..., 'IYYY-"W"IW')` 字串比較。

### 2.7 鑽石購買（IAP，2026-07-06，`migration_20260706c.sql`）——本專案第一次用 Edge Function

**設計**：前端走 **Digital Goods API**（僅 Android TWA 支援，網頁版不開放購買——`src/lib/billing.ts` 的 `isBillingAvailable()` 偵測不到就整塊隱藏）觸發 `PaymentRequest`（`https://play.google.com/billing` 付款方式）拿到 `purchase_token` → 呼叫 **`supabase/functions/verify-iap-purchase/index.ts`**（Deno Edge Function，本專案至今全部用 Postgres RPC，這是第一次需要對外呼叫 Google API 才引入 Edge Function）→ 用服務帳號 JWT bearer flow 換 access token，向 Google Play Developer API 驗證這筆付款是真的 → 驗證通過才用 **service role** 呼叫 `grant_iap_diamonds(p_player_id,p_sku_id,p_purchase_token)` RPC 發鑽石。

**防重放**：`iap_purchases(purchase_token pk, player_id, sku_id, diamonds, created_at)` 記錄每筆已兌換的 purchase_token，同一筆不能重複發鑽石。`grant_iap_diamonds()` 內有 SKU 白名單（`diamonds_100`/`diamonds_350`/`diamonds_1200`，暫定鑽石數，實際定價在 Play Console 設定），**只給 service_role 呼叫**（`revoke ... from public, anon, authenticated`）——前端絕對不能直接呼叫這支，否則偽造 purchase_token 就能騙鑽石。

**✅ 部署前置作業皆已完成**（2026-07-06）：① migration 已跑；② Play Console 單次產品已建立（介面路徑：透過 Google Play 營利 → 產品 → 單次產品，實測發現這一步本身要求 APK 先有 BILLING 權限才給建，順序比預期更早卡關）；③ Google Cloud 服務帳號 + Play Console 授權已完成；④ `verify-iap-purchase` Edge Function 已部署（secrets：`GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`）；⑤ Android 原生專案已加 androidbrowserhelper 的 Play Billing 橋接（vc11 已上傳審核通過上線）。詳細清單見 History.md「📦 已封存文件：NEXT_BATCH_PLAN.md」批次 4。

**永久去除廣告（非消耗型，`migration_20260706d.sql`）**：跟鑽石（消耗型，可重複買）不同，去廣告是「買一次終身有效」，Google 端驗證完要呼叫 `:acknowledge` 而不是 `:consume`（`consume` 會讓非消耗型商品變成可重複購買，語意錯誤）。`verify-iap-purchase` 依 SKU 是否在 `DIAMOND_SKUS` 集合裡分流兩種呼叫方式。購買後 `player_wallet.ads_removed` 設為 true，四個「看廣告」點依此欄位調整（**2026-07-09 定案：一律改「免看廣告直接領取」，不是隱藏按鈕**——曾把拿金幣/雙倍按鈕整段藏起來，等於花錢買去廣告反而失去獎勵，已修正）：`GameCanvas.tsx` 復活按鈕直接復活、結算「觀看廣告 獎勵 ×2」→「🎁 領取 獎勵 ×2」、`Garage.tsx`「看廣告 +40 金幣」→「🎁 領取 +40 金幣」（每日上限不變）；`DailyChallenge.tsx` 第 3~5 次挑戰標籤一律顯示「開始挑戰」。SKU id：`remove_ads_forever`。

**金流安全網（2026-07-09 稽核補強）**：
- **consume/acknowledge 不可靜默吞錯**：Google 規定付款 3 天內沒 consume/acknowledge 會自動退款——若失敗卻回報 `ok:true`，會變成「鑽石已發＋又被退款」的真錢損失。Edge Function 兩支呼叫回傳 bool，`alreadyConsumed`/`alreadyAcknowledged`（400）視為冪等成功，真失敗回 502 不回報成功、留給對帳重試。
- **對帳 `reconcilePurchases()`（`src/lib/billing.ts`）**：付款成功但發放中途失敗（session 掉/網路斷/function 逾時）的孤兒交易，下次進車庫 `listPurchases()` 撈出重送 Edge Function 補發（grant RPC 冪等：已發過走防重放分支、但 consume/acknowledge 每次重試）。已成功對帳的 token 記本地 `tr_iap_reconciled` 避免重打。
- **未登入雙層防護**：`runPurchaseFlow()` 在叫出 PaymentRequest **之前**先查 session（關鍵層——訪客沒帳號可入帳，扣了款只能等退款）；Garage UI 訪客不顯示購買區塊（第二層）。
- **診斷可觀測性（刻意保留，別清掉）**：billing 查價/購買失敗原因顯示在車庫紅色橫幅（`getLastPurchaseError`/`getPriceDiag`）＋「🔄 重試」按鈕；Edge Function 三處 `console.error`。TWA release 版無法 chrome://inspect，畫面顯示是唯一的真機除錯管道。

**IAP 打通除錯鏈（2026-07-09，每層都是獨立的坑，之後任一環又壞可對照排查）**：
① 按鈕灰＝TWA 缺 Play Billing 橋接元件 → 自訂 `DelegationService` 子類別註冊 `DigitalGoodsRequestHandler` + manifest intent-filter + `PaymentActivity`/`PaymentService`（vc12）；
② 仍失敗＝`<application>` 缺 `asset_statements` meta-data → 補 strings.xml 鏡像（vc13）；
③ getDetails 被擋＝`DelegationService` 誤帶 `BIND_JOB_SERVICE` 系統權限，Chrome bind 被拒 → 移除（vc14）；
④ 點了沒反應＝CSP `connect-src` 沒放 `https://play.google.com`，PaymentRequest 建構直接拋 RangeError → `public/_headers` 補白名單；
⑤ 又變「暫無法購買」＝查價與對帳並發各自建 billing 連線互相干擾＋冷啟動連線未就緒 → `getService()` 快取 Promise 共用連線＋查價自動重試 4 次；
⑥ 付款成功不發鑽石（Edge Function 全 500）＝服務帳號**多行 PEM 私鑰用 `supabase secrets set --env-file` 被折行吃掉只剩第一行** → 用 `JSON.stringify(private_key)` 保持單行+`\n` 轉義寫入（詳見 CLAUDE.md 踩雷筆記）；
⑦ 鑽石入帳被 42702 擋（見 §2.5 的 PL/pgSQL 踩雷）。
**二次稽核（2026-07-09，見 [History.md](History.md)「📦 已封存文件：FABLE5_HANDOFF_20260709.md」報告）發現的缺口**：
- 🔴✅ **2026-07-10 已修＋已部署上線**：Edge Function 原本未比對 Google 回應
  `productId` 與聲稱 `sku_id`（便宜包冒充貴包的真錢漏洞）。`verifyPurchase()` 現在讀
  `GooglePurchase.productId`，主流程在 `purchaseState` 通過後多一關：
  `purchase.productId && purchase.productId !== sku_id` 就拒絕（`productId` 回傳
  "may not be present"，只在有值時比對，避免誤擋合法購買）。已用
  `npx supabase functions deploy verify-iap-purchase --project-ref cjnwwtrpveejhbwalncy`
  部署成功，這個缺口結案。
- 🟠 退款後無收回機制（封測期接受，正式上架後視退款率決定是否接 Voided Purchases API）。

**2026-07-22：Android 原生購買外掛換成 `@capgo/native-purchases`（Billing 8.3.0+）**——
Google Play 政策要求 2026-08-31 起一律要用 Billing Library 8.0.0+，原本的
`capacitor-native-purchases`（jokio 維護，最後更新 2026-02，內部寫死 7.1.1）沒有跟進，
不換套件的話 8/31 後就無法發布更新。改用 Cap-go 維護中、大版號跟安裝的 Capacitor 8
對齊的替代品。API 從「responseCode 數字模式」（`getProductDetails`/`purchaseProduct`/
`getLatestTransaction` 都回傳 `{responseCode, data}`）整個換成「Promise resolve/reject +
`Transaction`/`Product` 物件直接回傳」（`getProduct`/`purchaseProduct`/`getPurchases`），
`purchaseProduct()` 直接在回傳的 `Transaction` 裡帶 `purchaseToken`，不用像舊版另外呼叫
`getLatestTransaction()` 補查。舊版「所有 INAPP 商品自動 consume」（曾讓
`remove_ads_forever` 被誤判成可重複購買）的問題不會再發生：新外掛用
`purchaseProduct({isConsumable:false, autoAcknowledgePurchases:false})` 明確關掉客戶端
consume/acknowledge，一律交給 `verify-iap-purchase` Edge Function 用 Google Play
Developer API 在伺服器端處理（跟原本架構一致，外掛官方文件也建議這樣做）。
⚠️ **已知限制**：這版外掛（8.6.4）原生端把「使用者自己取消付款」跟「其他購買失敗」
共用同一句泛用錯誤訊息（沒有像 jokio 舊版的 `BillingResponseCode` 可以分辨），
`purchaseProduct()` 失敗時無法可靠分辨兩者，統一當使用者取消靜默處理，真正的購買失敗
只能靠 `console.warn`／`adb logcat` 除錯（完整細節見 `src/lib/billing.ts` 檔頭註解）。
`verify-iap-purchase` Edge Function／`AndroidManifest.xml` 的 `BILLING` 權限完全不用改
（後端驗證邏輯、purchase_token 格式都不受外掛換版影響）。typecheck/build/`cap sync`
已跑（9 個外掛數不變，1:1 換掉）。**⚠️ 這是原生外掛換版，PWA 網頁版不受影響（網頁版
本來就不開放購買，走的是 TWA 時代留的 Digital Goods API 分支，這條完全沒動）；Android
要重新打包簽署版才會生效，且 Play Billing **必須真機測付款流程**（購買鑽石/去廣告各
測一次，含「使用者按取消」是否真的靜默不跳錯誤），才能確認新外掛真的能用。**

### 2.8 金幣/鑽石經濟總覽（2026-07-08 大改版定案，v0.12.33 起）

伺服器權威版在 `wallet_earn()`/`claim_weekly_quest()` 等 RPC（前端 `playRewards.ts`/
`adRewards.ts` 只是樂觀顯示，**兩邊改任何數字都要同步**，否則已登入玩家會被伺服器覆寫回舊值）。

**金幣來源與每日上限**：
| 來源 | 金額 | 上限（桶） |
|---|---|---|
| 一般/自選完賽 / 摔車 | 5 / 2 | 「遊玩」桶單日 100 金幣（含長征、含雙倍） |
| 長征完賽 / 摔車 | 30 / 依跑到比例 0~30 | 同上桶 |
| 每日任務 | 25/個（狂暴盤日 ×2） | 3 個/日 |
| 週任務 | 35~45/個（狂暴盤日 ×2） | 每週各任務一次 |
| 看廣告（車庫領取） | 40 | 2 次/日（結算「雙倍本局金幣」不占這桶、算遊玩桶） |

**鑽石來源**（金幣買不到鑽石）：排行榜每日結算（參與 +3；名次 1st +80／2nd +50／
3~4th +20／5~10th +10，`settle_daily_diamonds()`＋每日台灣 00:00 GitHub Actions）、
經典模式週結算（每關前三 30/20/10，`settle_classic_weekly()` 同一支排程）、
真錢 IAP（**2026-07-11 定價定案，同日晚間依實際遊戲內顯示價二次微調**：
`diamonds_100/350/1200` 三個 SKU id 不變，內容物 100/350/**1300**（大包 1200→1300，
`migration_20260711b.sql`）。⚠️ **Play Console 輸入的「售價」跟玩家實際看到的
「顯示價」不同**（含稅，商品頁會比 Console 輸入值高一截，2026-07-11 首次發現此落差
——100 鑽輸入 30 元、玩家實際看到 31 元）。使用者已回推微調 Console 輸入值，讓
**顯示價**精準落在整數：`diamonds_100` Console 輸入 29 元→顯示 30 元／`diamonds_350`
輸入 86 元→顯示 90 元／`diamonds_1200` 輸入 279 元→顯示 290 元／`remove_ads_forever`
輸入 76 元→顯示 **80 元**（原訂 72 元不動的決定已被取代，去廣告漲為顯示價 80 元）。
**之後提到售價一律指「玩家實際看到的顯示價」（30/90/290/80），不是 Console 輸入值。**）。

**支出**：金幣車款咖啡騎士/通勤小白各 500；鑽石車款（P 系列）赤紅暴走 300／電馭武士
380／黃金期貨 450／匿蹤幽靈 520／銀河鍍鉻 600。白名單與定價在 `wallet_spend_skin()`。

**排行榜/經典模式不給金幣**（只給鑽石），避免刷短賽道無限賺。狂暴盤日＝TAIEX
`|漲跌| ≥ 2.5%`（`taiex_change_pct()`，伺服器端判定，見 §2.6）。

---

## 3. 資料管線（Data Pipeline）

### 3.1 每日更新腳本

**腳本**：`scripts/fetchDailyMap.ts`（Node 22+ 直跑 `.ts`，type-stripping）
**觸發**：GitHub Actions `.github/workflows/fetch-daily-map.yml`，cron `0 8 * * *`（= 台灣時間 16:00，收盤後 2.5h）。提早跑 + 錨定交易日 = 即使排程延遲也不跨午夜錯位。

**流程**：
1. 先抓 TAIEX：Yahoo `^TWII`（5 分 K、`range=1d`），從回傳 timestamp 讀出**實際交易日 sessionDate**，`map_date = sessionDate + 1`。
2. 抓 TWSE `STOCK_DAY_ALL` 取**上市股票清單**（代號+名稱），過濾 `/^\d{4,6}[A-Z]?$/`（2026-07-06
   拉真實資料驗證：1368 支裡有 278 支非純 4 位數——ETF 4/5/6 位數、槓桿反向 K/L/R/T/U 字母尾、
   多幣別計價 A~I 字母尾，舊版 `/^\d{4}$/` 全部濾掉；新 regex 僅 1 支特別股例外「2887Z1」不處理）。
3. 對每支股票抓當日盤中走勢：Yahoo `{code}.TW`（5 分 K、`range=1d`），降採樣至 ~110 點。
4. 計算 `difficulty`（盤中最大單步漲跌幅）。
5. Upsert 至 Supabase `daily_map`（`Prefer: resolution=merge-duplicates`，衝突鍵 `(map_date, stock_code)`），清除舊資料。⚠️ **cutoff 錨定剛寫入的 `mapDate − 7 天`，不可錨「執行當下 now − 7 天」**：長連假（過年/長颱風假 > 7 天）map_date 凍住但 now 一直走，用 now-7 會追過當前唯一在用的 map_date 把它刪掉（甚至同一次跑剛寫又刪）→ 掉回靜態盤。錨 mapDate 則任意長度連假當前盤永遠保留。
6. **股票圖鑑登記表**（2026-07-07 新增）：拿第 2 步已經抓到的官方上市清單，`upsertStockRegistry()` 順手 upsert 進 `stock_registry`（不重複打一次 TWSE API），再呼叫 `mark_delisted_stocks()` RPC 比對維護「絕版」狀態，詳見 §2.6。

> 每日約 ~1090 支股票，失敗容錯繼續（不中斷整批）。連假/休市時 Yahoo `range=1d` 自動回最後交易日 → sessionDate 不變 → 持續顯示最後交易日的盤（正確）。

### 3.1b app 讀取端（連假安全 + 午夜換圖，`src/lib/dailyMap.ts`）

`resolveSessionDate()` 取「daily_map 中 `map_date ≤ **今天**（日曆日）的**最大值**」當
「目前這一期」，三個 fetcher（hardest/list/stock）全對齊它。

- **上界用「今天」而非 nextDay**：`map_date = sessionDate+1` 已內建「00:00 才生效」。
  週五 16:00 cron 把週五盤存成 `map_date=週六`，週五當天 `max(≤週五)` 仍是週四盤
  （不提早跳）；**週六 00:00** 起才切到週五盤＝午夜精準換圖。⚠️ 上界若用 `nextDay`
  會讓週五下午就提早換圖（曾誤用）。
- **連假 fallback**：日曆日超過最後交易日的 map_date 時，`lte + desc` 往回取「最近
  一期」→ 整段沿用最後交易日的盤。（2026-06-20 曾因舊邏輯精準比對 `[今天,明天]` 錯過
  `map_date=6/19` 而掉回靜態 24 支。）
- **靜態樣本已全數移除（2026-07-18）**：Phase 2 時代打包進 build 的 24 支
  `sample-*.json`（2026-06-15 快照）曾同時是 fallback 兼「選股時本地優先」的短路來源
  ——TrackSelect/RandomSlot 只要選/抽到那 24 支熱門股就直接用舊快照、完全不查
  daily_map，造成「愈熱門的股票盤勢愈舊」（7/17 史上大跌隔天被玩家發現 0050/2330
  地圖對不上真實盤勢）。現在三個入口（自選/隨機/每日排名賽）一律只走 daily_map，
  完全抓不到（離線）就顯示需連線提示／鎖住開始鈕，**絕不退回過期地圖**——排名賽
  尤其如此，榜是照真實地圖比的，退回舊圖等於讓玩家在不同地形上交分數。
- **排行榜對齊（同一張榜跨連假）**：challenge key 也用 `resolveSessionDate()`，讀取
  （`DailyChallenge`）、提交清快取（`leaderboard.ts`）、RPC 寫入（`submit_daily_score`
  的 `v_today := coalesce(max(map_date)≤台灣今天, 台灣日曆日)`）三者同源 → 週末/連假
  整段成績累積在同一張榜，午夜才換新榜。**schema 改完要手動在 Supabase SQL Editor 跑
  `create or replace function submit_daily_score`，push 不會更新 RPC。**

### 3.2 資料源端點

| 用途 | 端點 | 備註 |
|---|---|---|
| 個股盤中 5 分 K | `GET https://query1.finance.yahoo.com/v8/finance/chart/{code}.TW?interval=5m&range=1d` | 主力資料源 |
| 大盤盤中 5 分 K | `GET https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=5m&range=1d` | `^TWII`；含 timestamp 可讀交易日 |
| 上市股票清單 | `GET https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json` | 僅取代號+名稱 |

⚠️ **TWSE `MI_5MINS_INDEX` 已棄用**：對 GitHub runner 不穩定，曾整批失敗 → TAIEX 改走 Yahoo `^TWII`。

---

## 4. 賽道生成演算法（`src/game/terrain.ts`）

輸入：`prices[]`（數值陣列，個股盤中 ~110 點 或 月線 ~50 點）

### 4.1 高度正規化

```
REF_PCT = 0.022
maxStepPct = max(|prices[i]/prices[i-1] - 1|)
scaledHeight = clamp(heightRange × maxStepPct / REF_PCT, heightMin, heightMax)
y[i] = baselineY - (price[i] - min) / (max - min) × scaledHeight
```

### 4.2 現行參數（`src/game/constants.ts → TRACK`）

| 參數 | 值 |
|---|---|
| `segmentWidth` | 80 px |
| `heightRange` | 420 px |
| `refPct` | 0.022 |
| `baselineY` | 560 px |
| `maxSlopeDeg` | 75° |
| `startFlat` | 4 段 |
| `endFlat` | 3 段 |

### 4.3 地形碰撞體（v0.4.1 定案）

每段一個 `Bodies.fromVertices` 凸梯形：上緣 = 折線、下緣拉到 `maxY+800`、下緣兩角各往外擴 `segmentWidth`（v0.4.1），梯形頂面兩端各 +3px（`topExtra=3`，v0.7.0）。相鄰段重疊，零縫零凸角。

**V 谷平底（v0.12.1 擴充）**：深谷（爬出高度 h2 > `segmentWidth`）插 `flatBottomW=80px` 平底（舊規則）；**淺尖谷**（4 < h2 ≤ 80 且兩壁夾角 < `sharpIncludedMaxDeg=120°`）插 `sharpFlatW=40px` 小平底。淺尖谷是輪子卡縫主因——headless 批次模擬（`scripts/simStuck.ts`，6000 局）顯示卡住事件 97% 集中在這類谷，加小平底後 safe-bot 卡住率 7.4% → 0.6%。

### 4.3.1 高度縮放（v0.12.3，BETA #1）

`scaledHeight = clamp(heightRange × max(maxStepPct/refPct, amplitudePct/ampRefPct), heightMin, heightMax)`。
單步分量（`refPct=1.5%`）照顧日線/月線；**振幅分量**（`ampRefPct=3.5%`，全日 (高-低)/起點）照顧盤中 5 分 K——舊版只看單步，盤中資料單步極小 → 幾乎全部被壓在 `heightMin=350` → 封測回饋「太平緩」。振幅 3.5% = 420px 基準、10% 漲跌停級 ≈ 1200px；TAIEX 等平緩盤（振幅 <1%）仍落在 heightMin 不變。改完有跑 simStuck 回歸（safe bot 0.7%，維持低水位）。

### 4.4 霓虹著色

- 漲（坡向上）→ 紅 `#ff2244`
- 跌（坡向下）→ 綠 `#00ff88`（台股慣例）
- 平 / 起終點 → cyan `#2de2e6`

---

## 5. 遊戲機制

### 5.1 操作（單鍵）

按住 = 油門（地面）/ 後空翻（空中）；放開 = 滑行 / 停轉。無其他按鍵。

### 5.2 計分

- **行進分**：隨距離累加（只增不減）
- **後空翻**：每轉滿 360° 計分，分數遞增；沒轉正落地即摔
- **完美落地**：滯空 + 落地角度 < ~31° → 依圈數 × 100 加分 + cyan 光環特效
- **時間**：每日排名賽同分比時間（越短越前）

**落地延遲結算（v0.12.1）**：翻轉/完美落地不再於「觸地第一步」邊緣觸發結算。首次觸地只快照（累積旋轉、滯空時間、車身角、位置），連續 `landingSettleSteps=4` 步著地（≈67ms）才用快照結算給分；「擦地」（<4 步又離地，如微彈跳、翻轉中輪子掠過山頂）**不清空 airRotation、不歸零角速度**。舊邏輯任何 grounded step 都清零旋轉，導致微彈跳後真正落地量到 ≈0 而漏判（`scripts/simPerfect.ts` 模擬：漏判 85% → 5%）。完美落地角度判定用「觸地瞬間」快照（玩家看到的那一刻），非結算時角度。

**圈數與完美落地計分（v0.12.14 改線性＋倍率定案；2026-07-23 圈數公式＋落地漸進給分再修）**：
- 圈數 = `round(|airRotation| / 2π)`（四捨五入到最近整圈）——**取代舊版 `floor((|rot|+0.3π)/2π)`**：舊公式每多一圈要轉滿到下一圈的 85% 才進位，但這個門檻跟下面「是否觸發完美」的判定門檻（固定 1.7π）不同步，玩家轉了明顯超過 1 圈、逼近 2 圈的角度（如 600°）會觸發「完美落地」卻只用 1 圈的分數結算，體感矛盾（2026-07-23 使用者實測回報）。改用四捨五入後，「感覺轉了兩圈」的角度更容易被正確算成 2 圈。翻轉分／完美分／totalFlips 統一用這套圈數。
- **翻轉分改線性**：`flipScore(N) = N × flipBaseScore(100)`，不再遞增（舊制 1/2/3 圈＝100/250/450，新制＝100/200/300）。
- **完美落地＝剛才那趟翻轉分 ×2**：`flipScore(N) × 2`（1圈 +200／2圈 +400／3圈 +600），不論落地面平或斜，只看落地角是否貼合坡面。
- 完美觸發條件不變：滯空 > 0.3s ＋ |rot| > 1.7π ＋ 落地角與坡面夾角 < 31°。
- **落地角度判定維持二選一（非0即100），門檻放寬到 ≈70°**：`uprightCosThreshold` 從 0.55（≈57°）放寬到 0.34（≈70°），減少「轉夠圈數但落地角度差一點就整包歸零」的誤判機率。**曾在同一天短暫改成「漸進給分」**（滿分門檻外、另一個較寬鬆門檻內打 5 折）——使用者實測後回報不想要中間值（如 +50），要就 0 要就 100，已改回二選一，`roughUprightCosThreshold`/`partialFlipRatio` 兩個常數已移除，只保留放寬過的單一門檻。
- 兩處呼叫共用 `settleFlip()`：一般落地（連續 4 步著地結算）／**飛越終點線時仍在空中**（見下）。
- **分享成績文案 2026-07-23 修過一個真實 bug**：`shareScore()` 原本讀 `hud.points`（每 5 幀節流同步，終點/摔車瞬間可能落後真實分數，結算畫面本身早就改讀 `finalScoreRef` 避開這個坑，但分享文案這支函式漏改），改成跟結算畫面同一份 `finalScoreRef.current`。**注意**：進終點的瞬間 `maxDistScore` 一定會被夾到剛好 1000（見 `traveled/(finishX-startX)` 算式在完賽判定之前就先算好），所以真的「完賽」的分數理論上一定整百結尾；非整百結尾的分數必然是「摔車」（行進分停在中途、非整數比例）——這條數學結論已跟使用者對過。

### 5.2b 飛越終點線時仍在空中（v0.12.14 修）

舊版完賽判定（`c.position.x >= finishX`）不管當下是否著地，一旦越線立刻 `Body.setStatic` 凍結車身——若最後一段把玩家彈飛、飛越終點線時人還沒落地（常發生在終點平坦台），該趟翻轉/完美落地永遠沒機會進入落地結算，分數整趟消失。修法：越線瞬間若 `!landingSettled`（翻轉尚未結算），用**當下**狀態（`airRotation`/`airTime`/`c.angle`/`c.position.x`）強制呼叫 `settleFlip()` 結算後才凍結車身，並在同一 step 內重算 `points`（原本 `points` 早於完賽判定計算，不重算會漏掉這筆分數）。

### 5.2c 分享按鈕誤觸（v0.12.14 修）

駕駛控制綁在 `window` 全域 `pointerdown`（非畫布局部），摔車/完賽瞬間結算面板立刻彈出；若玩家手指當下正按著油門（畫面下半部常見持握位置），面板换出後抬指位置可能剛好疊在新出現的「分享成績」等按鈕上，被瀏覽器判成一次點擊。修法：`overlay-result` 加 `resultReady` 狀態，面板出現後 350ms 內 `pointer-events: none`，之後才接受點擊；面板消失（`crashed`/`finished` 皆 false）重置。

### 5.3 摔車判定

車身 crashZone（5 個局部點：前擾流→風鏡→油箱→座椅前/後緣）轉為世界座標，任一點低於地形且翻過 90°（cos < 0）→ 判死（0.1s 緩衝）。雙輪離地 + 速度 < 0.5 超時 → stuckMidAir 保底。⚠️ 死亡條件均加 `!waitingToStart` guard：懸空等待期間不觸發。

### 5.4 懸空公平計時（Suspended Start）

每次出發時（含復活後），車輛靜止懸空在地面上方 `HOVER_HEIGHT=67px`：三個物理體全設 static，`waitingToStart=true`，HUD 計時凍結。第一次 pointerdown 事件才解除 static、`waitingToStart=false`、計時開始。確保計時器不受生成→落地動畫時間影響，對排行榜公平。

### 5.4b 卡縫自動脫困 watchdog（v0.12.13）

- **症狀（封測回報）**：高速落地／行進時輪子偶發楔進地形轉折縫卡住不動，手動「放開再按住」可脫困。
- **根因（headless 模擬定性，`scripts/simStuck.ts`＋新增 `scripts/simDrop.ts`）**：
  - **不是**「平地-平地接縫」的碰撞縫隙——`simDrop.ts` 定點落下矩陣（高度×接縫偏移×傾角×前速×輪轉速×微起伏地形，5000+ 組合）全數 0 卡住，純平接縫在 60fps 固定步長下卡不住。
  - 真正成因＝**幾何轉角的機械性卡死**：①平地→陡上坡凹角（輪子被油門 ground-lock 持續壓進牆角縫，力平衡卡死；谷底平台視覺上正是「兩段平坦梯形」，與回報吻合）②陡上坡上的微凸角裸縫 ③峰頂裸角。全部「放開油門即回彈脫困」。
- **修法（遊戲側，不改地形）**：`GameCanvas.tsx` step() 內 watchdog——著地＋油門下，40 步（0.67s）滑動窗淨位移 < 3px → 判定卡死 → 自動暫停驅動 60 步（≈1s，等效「放開油門」，吸地/貼坡對齊照常）→ 恢復。必要時自動重複循環。
- **模擬驗證**：`simStuck.cjs 2000 all 1 assist`——完賽/摔車率與現況相同（safe bot 1727/273 vs 1711/289，不影響難度與排行榜），卡死全部自動脫困、0 永久卡死。
- **⚠️ 參數紅線**：窗長 40 步是下限——15 步窗會誤傷正常騎乘短暫減速（模擬實測完賽率 +6%，難度跑掉）。逐步判定（每步位移 <閾值）會被牆角 ±1px 振盪重置，**必須用窗內淨位移**。
- **未採用的地形側方案（記錄備查）**：①共線 lip 12px 埋入鄰段蓋縫＋取消現行凸角水平延伸——修不了機械性卡死主類，但可讓摔車率 14.5%→4.5%（現行 `topExtra=3` 水平延伸在斜坡上會旋轉梯形頂邊、凸角處形成 ≤3px 微階梯彈飛車輛）——**難度大變動，封測期間不動，正式版後可考慮**；②水平 lip 加大到 12px——頂邊旋轉誤差放大到 ~10px，stall 26%，否決；③凸角插小平台——製造新裸角更糟，否決。

#### 5.4b-2 陡坡衝下＋落在平地接縫「深陷」（2026-07-07 使用者真機回報，新發現，未修復）

- **症狀**：跟 5.4b 的溫和卡縫不同——從高處/陡坡衝下、車頭朝向任意，落地瞬間**整台車沉下去很深**（非正常落地的 ~10px settle），手放開才彈出來。之前的 `simDrop.ts`（定點落下、VXS 只到 cruiseSpeed、人工固定 tilt ±15°）結構性測不到這個情境。
- **根因（新腳本 `scripts/simSteepLanding.ts`＋`scripts/simPeakWall.ts`，皆用真正上線的 `terrain.ts`/`bike.ts`/`applyControls` 邏輯，未修改 shipped code）**：
  - 讓車子真的沿陡坡（30~75°、坡長 1~6 段）加速衝下、自然銜接平地，65 組角度×坡長組合中 **15 組（23%）出現嚴重深陷**（sink 最深 202px，車身伴隨多圈翻滾卡死），無單調邊界（同角度不同坡長交錯出現，屬對初始相位敏感的混沌現象）。
  - **13/15 案例集中在「陡坡轉平地」那個轉角**（`segIdx=0`，角度真的改變的地方，不是純平地-平地接縫），另 2 案例發生在後續真正的平地-平地接縫。跟 5.4b 描述的「油門持續壓進靜態牆角」溫和機制不同，這裡是**短陡坡讓車子騰空、以接近垂直（~93°）姿態高速砸落**造成的劇烈版本。
  - **候選解法①：把 `topExtra`（現行 3px）調大** →`topExtra=7~10` 可讓轉角深陷完全消失（0/65）。**但有害副作用**：`topExtra≥6`（視峰頂陡度而定，70°/75° 短峰頂在 6 就壞、60° 撐到 9）會讓陡峰頂的正常「飛出去」彈跳完全消失（滯空從 84~156 步驟降到 0）。追蹤逐步碰撞 log 發現真正機制：**topExtra 加大會讓相鄰梯形的頂面重疊區跨越角度變化處，前輪同時碰撞兩個表面法向量不同的梯形體（`frontContacts=2`），Matter.js 算出矛盾的碰撞法向量把輪子釘死在上坡半路**（不是峰頂本身被延伸，峰頂延伸量始終正確為 0；是旁邊非峰頂段的延伸量過大，跟峰頂無關的另一個雷）。轉角需要的安全深陷消除值域（≥7）跟峰頂安全值域（因峰頂陡度而異，≤5~8）**不重疊，無解**。
  - **候選解法②：共線相鄰段合併成單一梯形**（`merge`，同 5.4b 舊表格提過的方案）→ 15/65 降到 12/65，只治好了真正共線的平地-平地接縫（3 組），對主要的「坡轉平地角度變化」轉角是 no-op（角度不同永遠不會被判定共線）。**對峰頂 100% 安全**（峰頂兩側坡角必不同，數學上永遠不會被合併，行為跟現行完全一致），但沒解決主要問題。
  - **結論：這是「用重疊梯形代表地形」這個架構的結構性限制，不是能靠調參數解決的**——重疊機制本身在「重疊區跨越角度變化」時就有雙重碰撞卡死風險，調大重疊治轉角就會在別處（陡峰頂）捅出新雷。真的要根治需要更根本的架構改動（例如只精準識別「陡坡轉平地」這一種轉角類型做隔離加強、或换一種完全不同的地形碰撞機制），不是本次分析範圍。
- **現況**：5.4b 的 watchdog（v0.12.13）在這個情境下**有效但不完全**——同一批案例開 watchdog 重跑，深陷從 137/140px 降到 62/9px（未完全消除，但比沒有好），跟使用者「放開手指才脫困」的真機體感吻合。**使用者決定暫不處理**（2026-07-07），此發現純粹記錄備查，供之後真的要處理時參考起點（避免重蹈"調大 topExtra"這條已驗證的死路）。

### 5.5 挑戰次數上限（每日排名賽）

- 每日限 `MAX_ATTEMPTS=5` 次，前 `FREE_ATTEMPTS=2` 次免費，後 3 次按鈕顯示「看廣告開始」（廣告尚未串接，目前直接進遊戲）。
- 次數以 localStorage key `tr_daily_att_{sessionDate}` 儲存，`sessionDate = resolveSessionDate()` 結果（連假整段用同一個 key）。
- 進入遊戲時才 `incrementAttempts()`（非按鈕按下時），確保只有真的開始才計次。
- 邏輯在 `src/lib/challengeAttempts.ts`，UI 在 `DailyChallenge.tsx`。

### 5.6 死亡後復活（Revival）

- 僅每日排名賽啟用（`GameCanvas` prop `revivalEnabled={isDailyRun}`）。
- 死亡後出現「看廣告復活」琥珀色按鈕（`.overlay-btn.ad-btn`），每局限一次（`revivalUsed` state）。**✅ 2026-07-09 起真的會呼叫 `requestRewardedAd("revive")` 看完廣告才復活**（此前按鈕點下去是直接免費復活的殘留 bug，已修復，見 9.4c）。
- 復活邏輯（`doRevive()`）：讀死亡時的 `chassis.position.x`，`terrainYAt()` 算地形高度，在正上方 `HOVER_HEIGHT` 重新 setPosition + setVelocity(0) + setStatic(true) → 進入懸空等待狀態。分數、計時、翻轉紀錄保留（不呼叫 `doReset()`）。
- 實作：`reviveSignal` ref（與 `resetSignal` 平行），frame loop 偵測 signal 變化觸發 `doRevive()`。
- 每次 `handleStartTrack` 讓 `gameKeyRef.current++`，作為 `<GameCanvas key>` 確保新局重建（`revivalUsed` 重置）。

### 5.4 物理踩雷

- Matter.js torque 乘 `delta²`（≈278×）→ **用 `Body.setAngularVelocity` 直接給 rad/step**
- 車身（chassis）改圓形 `Bodies.circle(r=10)`，`friction=0 restitution=0`，只由雙輪碰地（`collisionFilter mask:0` 在 v0.4.2 啟用）
- 坡面鎖速：著地時取「後輪→前輪連線方向」速度分量，ease 到 `cruiseSpeed`

---

## 6. 前端模組結構

```
src/
├── game/
│   ├── GameCanvas.tsx     # 主遊戲畫面（Canvas 渲染 + Matter.js 主迴圈）
│   ├── bike.ts            # 機車物理體（chassis + 雙輪 + 約束）
│   ├── terrain.ts         # 賽道生成 + 碰撞體
│   ├── constants.ts       # 所有手感參數（DRIVE/BIKE/TRACK/RULES/COLOR）
│   ├── audio.ts           # Web Audio API 程式生成音效（引擎 + 翻車 + 琶音 + 拉霸機音效）
│   └── camera.ts          # 鏡頭跟隨
├── screens/
│   ├── Home.tsx           # 首頁（四模式入口 + 設定 modal + 返回確認 + 盤勢主題說明）
│   ├── DailyChallenge.tsx # 每日排名賽（地圖預覽 + 排行榜 + streak + 每日任務 + 死亡熱點）
│   ├── ClassicSelect.tsx  # 經典模式（12 條靜態關卡 + 事件說明 + 獎牌制）
│   ├── RandomSlot.tsx     # 隨機拉霸（Supabase pool，30 格 × 8 = 240 DOM nodes）
│   ├── Garage.tsx         # 車庫（B/Q/鑽石車款列表 + 金幣/鑽石 + 看廣告拿金幣 + 成就進度）
│   └── StatsScreen.tsx    # 隱藏統計頁（連點版本號 5 下開啟，admin_stats RPC）
├── TrackSelect.tsx        # 自選賽道（Supabase ~1000 支 + 無限捲動 30/次）
├── data/
│   ├── tracks.ts          # TrackData 型別（靜態 24 支樣本 2026-07-18 已移除，見 §3.1b）
│   ├── pick.ts            # dailyKey()
│   ├── classics.ts        # 經典模式型別 + classicToTrack()
│   └── classics.json      # 經典關卡靜態資料（scripts/fetchClassics.ts 一次性產出）
├── lib/
│   ├── dailyMap.ts           # Supabase daily_map 讀取 + promise 快取
│   ├── leaderboard.ts        # Supabase daily_scores 讀寫
│   ├── classicRecords.ts     # Supabase classic_records 讀寫（經典紀錄保持者）
│   ├── longTrack.ts          # 每日長征串接 + fetchLongPreview（5 股預覽）
│   ├── auth.ts               # Google One Tap 登入 / signOut
│   ├── playerId.ts           # localStorage UUID + 暱稱（clampNameWidth 限長）
│   ├── challengeAttempts.ts  # 每日排名賽挑戰次數（MAX 5 / FREE 2；已登入→consume_attempt RPC 真正把關，未登入→localStorage）
│   ├── ads.ts                # TWA 環境偵測 + AdMob 本機橋接（requestRewardedAd，見 9.4c）+ AdSense scaffold（網頁版，暫緩）
│   ├── adRewards.ts          # 看廣告拿金幣每日次數上限（車庫頁+結算畫面共用計數）
│   ├── garage.ts             # 車皮清單（BIKE_SKINS）+ 金幣/鑽石雙通貨 + 擁有/裝備邏輯（已登入→伺服器錢包 RPC 為權威，未登入→純本地）
│   ├── achievements.ts       # Q 系列成就進度（大漲/大跌完賽次數，streak 沿用 streak.ts）
│   ├── quests.ts             # 每日任務池（seeded by 裝置本地日曆日）
│   ├── streak.ts             # 每日排名賽連續參賽天數
│   ├── medals.ts             # 經典模式獎牌門檻（銅/銀/金，由 PB 推導）
│   ├── marketMood.ts         # 全站盤勢主題氛圍（大漲/大跌/平盤 CSS 變數 + 狂暴盤 isRage 判定）
│   ├── deathHeatmap.ts       # 全服死亡熱點（daily_death_heatmap RPC）
│   ├── shareCard.ts          # 分享成績圖卡（離屏 canvas 生圖）
│   ├── haptics.ts            # 全域按鈕震動回饋
│   ├── wakeLock.ts           # 遊戲畫面螢幕常亮
│   ├── analytics.ts          # events 打點（run_start/death/finish/revive）
│   ├── adminStats.ts         # 隱藏統計頁資料（admin_stats RPC，email 綁權限）
│   ├── collection.ts         # 股票圖鑑：已收集代號（player_collection，已登入→伺服器權威）+ 圖鑑登記表讀取（stock_registry，公開）
│   ├── weeklyQuests.ts       # 週任務池（ISO 週別 seeded，player_weekly_quest 已登入權威）
│   └── billing.ts            # 鑽石購買 + 永久去廣告（Digital Goods API，僅 TWA，呼叫 verify-iap-purchase Edge Function）
├── components/
│   ├── Sparkline.tsx      # 折線圖元件
│   ├── CoinIcon.tsx       # 金幣圖示 SVG
│   └── Encyclopedia.tsx   # 股票圖鑑彈窗（兩欄卡片+排序+篩選+已收集打星星）
├── version.ts             # APP_VERSION + CHANGELOG（遊戲內更新日誌）
└── App.tsx                # 路由：home / daily / random / custom / classic / garage / game
```

---

## 7. 認證流程（`src/lib/auth.ts`）

**Google One Tap（優先）**：
1. `signInWithGoogle()` 呼叫時生成 nonce：`rawNonce`（base64 → Supabase）、`hashedNonce`（SHA-256 hex → GSI）
2. `window.google.accounts.id.initialize({ nonce: hashedNonce, callback })` + `prompt()`
3. 取得 credential → `supabase.auth.signInWithIdToken({ provider:"google", token, nonce: rawNonce })`
4. GSI 封鎖 / 不顯示 → `isNotDisplayed()` / `isSkippedMoment()` → fallback `signInWithOAuth` redirect

**注意**：hashedNonce 必須是 hex 字串（非 base64），否則 Google / Supabase 驗證不過。

---

## 8. 開發階段 Roadmap

| 階段 | 狀態 | 內容 |
|---|---|---|
| Phase 0 | ✅ | 專案初始化（Vite + React + TS + PWA） |
| Phase 1 | ✅ | 物理 prototype：霓虹賽道 + Matter.js 機車 + 單指操控 + 計分 |
| Phase 2 | ✅ | 真實股票資料：TWSE 抓取腳本 + 24 支預載 + 賽道選擇 UI |
| Phase 3 | ✅ v0.5.0 | 三模式 UI：每日排名賽 / 隨機拉霸 / 自選賽道 |
| Phase 4 | ✅ v0.6–0.7 | Supabase 後端：排行榜 + Google One Tap 登入 + 每日全台股自動更新（GitHub Actions） |
| Phase 5 | ✅ v0.9.0 | PWA 離線快取：Workbox runtimeCaching（每日地圖 SWR 24h / 排行榜 NetworkFirst 5s） |
| Phase 6 | ✅ v0.8–0.9 | 音效（Web Audio API）、夜景城市背景、難度星等 HUD、爆炸粒子強化 |
| Phase 7 | 🟡 封測中 | TWA 打包上架（手動 Android Studio）；全螢幕 immersive ✅ 已完成；Google Play **封閉測試**（門檻：12 名測試者 + 連續 14 天，2026-06-25 起算，7/8 滿 14 天） |
| Phase 8 | ✅ | v0.9.4 連假讀取/排行榜跨連假同榜修正（`max(map_date ≤ 今天)`）；**v0.10 經典模式**（12 條歷史盤勢靜態關卡）；**v0.11 經典紀錄保持者**（`classic_records`，每關單一保持者）、返回離開改「再按一次返回鍵」、暱稱顯示寬度限長（12 寬）、每日長征 5 股預覽圖、開機深色霓虹 splash；**v0.12.0~6 懸空公平計時 + 每日排名賽每日 5 次上限 + 死後原地復活 + App 捷徑/splash 品牌圖/預測性返回（vc10，已真機驗證）** |
| Phase 9 | ✅ | **v0.12.7~28 留存批次**：完美落地計分定案、PB 突破/streak、經典獎牌制、分享圖卡、全服死亡熱點（漸層線視覺）、隱藏統計頁、卡縫脫困 watchdog、**車庫系統**（金幣/鑽石雙通貨+B/Q/鑽石車款共 12 台正式車皮上線，P1~P5 五台鑽石車款已於 2026-07-07 全數生圖完成）、**伺服器端錢包**（`migration_20260705.sql`）、每日任務、全站盤勢主題氛圍、看廣告拿金幣（stub）、Q 系列成就進度自動解鎖裝備 |
| Phase 10 | ✅ | **v0.12.29~32（2026-07-06）**：留存規劃第二批（狂暴盤日事件、股票圖鑑+絕版制彈窗、週任務、經典模式前三名取代單一保持者）；反作弊 Phase A（`migration_20260704.sql`）；帳號污染修復（暱稱/成就/streak 搬 DB）；ETF/字母尾代號涵蓋範圍修正（`/^\d{4,6}[A-Z]?$/`，修正前濾掉 20% 股票）；**鑽石購買 + 永久去除廣告 IAP 全面上線**（Digital Goods API + 本專案第一支 Edge Function `verify-iap-purchase` + Google Play Billing 原生橋接，四個 SKU 已在 Play Console 建立啟用：`diamonds_100/350/1200` 消耗型、`remove_ads_forever` 非消耗型）；Android versionCode 10→11 |
| Phase 11 | ✅ | **2026-07-09：AdMob 獎勵廣告原生橋接完成並真機驗證**（`AdBridge.kt`/`AdBridgeService.kt`/`AdActivity.kt`，見 9.4c）——復活／結算畫面雙倍金幣／車庫看廣告拿金幣三條路徑皆確認正常發放。目前用 Google 測試廣告單元 ID，真實單元 ID 待上架前替換。Android versionCode 14→15 |

> **🟠 待辦（正式上架後）**：反作弊 Phase B/C 尚未實作（Phase A 已完成，見 [ANTICHEAT_DESIGN.md](ANTICHEAT_DESIGN.md)）；AdMob 橋接已完成但**廣告單元 ID 仍是測試用**，上架前要換成真實 ID（見 9.4c）；AdSense（網頁版）2026-07-07 決定暫緩——目前不打算公開網址宣傳，網頁版只給少數認識的 iOS 朋友玩，等網頁玩家變多再加；殼版本更新提示（v0.9.5b 設計，2026-07-07 決定不單獨重包，等下次任何原因需要重包 AAB 時順便一起做）；**清空伺服器所有玩家遊戲數據**（daily_scores/daily_scores_ranked/classic_records/events，但保留已註冊 Google 帳號，2026-07-04 使用者交代，上架當天才執行）。

---

## 9. Android TWA 專案配置

### 9.1 專案位置

| 項目 | 路徑 |
|---|---|
| Repo 內 Android | `android/`（git 已追蹤） |
| Android Studio 專案 | `C:\Users\tyl16\AndroidStudioProjects\TaiexRider\` |
| Keystore | `C:\Users\tyl16\Documents\taiexrider-release.jks` |

> ⚠️ `android/` 與 Android Studio 專案**不會自動同步**。改了 `android/` 內的檔案必須手動複製到 Android Studio 路徑，再重新 Generate Signed Bundle。

### 9.1.1 原生體驗三項（v0.12.6，⚠️ 待重包 AAB 才生效）

repo `android/` 已改好以下三項，**需複製到 Android Studio 專案 → versionCode +1 → Generate Signed Bundle → 上傳 Play Console** 才會在真機出現：

1. **App 捷徑（長按圖示）**：`res/xml/shortcuts.xml`（每日排名賽/隨機拉霸）+ manifest `android.app.shortcuts` meta + `strings.xml` 標籤。androidbrowserhelper 手動專案**不會**自動讀 PWA manifest 的 shortcuts，必須原生宣告；捷徑用 `https://taiexrider.pages.dev/?goto=daily|random` 深連結，前端 `App.tsx` 讀 `?goto=` 導頁（此部分 push 即生效，PWA manifest shortcuts 也同步加了）。
2. **Splash 品牌圖**：manifest 加 `SPLASH_IMAGE_DRAWABLE=@drawable/splash_icon`（= icon-512 複製）+ `FILE_PROVIDER_AUTHORITY` + `androidx.core.content.FileProvider` provider 宣告 + `res/xml/filepaths.xml`（androidbrowserhelper 靠 FileProvider 把圖交給 Chrome）。這是 History.md「splash A 方案」的主體，可蓋住啟動網址列空窗。
   ⚠️ **vc9 事故（2026-07-02）**：`SPLASH_SCREEN_BACKGROUND_COLOR` 這個 meta-data **必須用 `android:resource="@color/..."`，不能用 `android:value="#05080f"` 塞色碼字面值**——androidbrowserhelper 的 `LauncherActivity` 會把讀到的 int 當「資源 ID」查表，字面值 → `Resources$NotFoundException` → 點開秒崩。此錯誤 6/22 就寫進 manifest，但函式庫只在「有設 SPLASH_IMAGE_DRAWABLE」時才讀背景色，所以 vc7/8 沉睡、vc9 加品牌圖後引爆。vc10 已修。`FADE_OUT_DURATION` 要的是毫秒 int，用 `android:value` 是對的。
3. **Android 13+ 預測性返回**：`<application android:enableOnBackInvokedCallback="true">`（targetSdk 36 ≥ 33 OK）。⚠️ **重包後真機必測返回鍵流程**（子頁返回/遊戲中返回/首頁雙按離開），與既有 popstate 攔截可能互動，出問題就先拿掉這個屬性再重包。

### 9.2 關鍵設定

| 項目 | 值 |
|---|---|
| Package ID | `com.tylapp.taiexrider` |
| Keystore alias | `taiexrider` |
| 上傳金鑰 SHA-256（開發者） | `83:FD:B6:0E:...:1B:4C` |
| **Google Play 簽署金鑰 SHA-256** | `DB:F0:8B:8F:BA:71:10:51:92:DD:8F:83:B8:4D:92:91:85:34:B0:3E:5B:9B:2A:CA:92:E6:9E:9E:22:9F:57:DA` |
| assetlinks.json | `public/.well-known/assetlinks.json` → 已設為 Google Play 簽署金鑰 |
| TWA library | `androidbrowserhelper:2.7.1` |
| minSdk / targetSdk | 24 / 36 |

> Google Play App Signing 重新簽署 AAB，assetlinks.json 必須用 **Google Play 的 SHA-256**（上傳金鑰不同）。
>
> ⚠️ **同一個坑會在換 Capacitor 時再出現一次**：Google 登入的 Android OAuth Client 綁
> 「package name + 簽章 **SHA-1**」，一樣要用 **Google Play 簽署金鑰**（不是上傳金鑰），
> 否則自己側載測都過、玩家從商店下載卻全部登不進去。注意這裡要 **SHA-1**，上表記的是
> SHA-256，兩者不能換算，要重抓。完整 checklist 見
> [CAPACITOR_EXPERIMENT.md](CAPACITOR_EXPERIMENT.md)「正式遷移到 Capacitor 出貨時的
> Google 登入 checklist」。

### 9.3 AndroidManifest.xml 關鍵 meta-data

```xml
<!-- .MainActivity 內（繼承 LauncherActivity 的自訂 Activity） -->
<meta-data
    android:name="android.support.customtabs.trusted.DEFAULT_URL"
    android:value="@string/twa_url" />
<meta-data
    android:name="android.support.customtabs.trusted.DISPLAY_MODE"
    android:value="sticky-immersive" />
<!-- ⚠️ 正確值是 sticky-immersive，不是 immersive-sticky！
     字串顛倒時 androidbrowserhelper 原始碼直接 fallback 到 DefaultMode，靜默失效。 -->

<!-- 必須宣告否則 2.7.1 啟動閃退 -->
<activity
    android:name="com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity"
    android:exported="false" />
```

### 9.4 Android Theme 配置（`res/values/themes.xml`）

```xml
<style name="Theme.TaiexRider" parent="Theme.MaterialComponents.DayNight.NoActionBar">
    <item name="android:windowFullscreen">true</item>
    <item name="android:windowNoTitle">true</item>
    <item name="android:statusBarColor">@android:color/transparent</item>
    <item name="android:navigationBarColor">@android:color/transparent</item>
    <item name="android:windowLayoutInDisplayCutoutMode" tools:targetApi="28">shortEdges</item>
</style>
```

> parent 必須是 `NoActionBar` 系列，`DarkActionBar` 會與 immersive mode 衝突。

### 9.4b 自訂 MainActivity（`java/com/tylapp/taiexrider/MainActivity.kt`）

繼承 `LauncherActivity`，`onCreate`/`onWindowFocusChanged` 強制設 immersive flags：
- API 30+：`WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`
- API 24–29：`View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | HIDE_NAVIGATION | FULLSCREEN`

AndroidManifest 的 activity name 改為 `.MainActivity`。另負責 Android 13+ 的
`POST_NOTIFICATIONS` 執行時權限請求（覆寫 `shouldLaunchImmediately()` 回 `false` 延後
TWA 自動啟動，等權限對話框有結果才 `launchTwa()`，否則瀏覽器畫面會立刻蓋掉對話框）。
vc17 起**不再**在這裡啟動 `AdBridgeService`——服務只在看廣告時由 `AdActivity` 短暫啟動
（見 9.4c），這裡只負責在自然的開機時機把通知權限問完。

### 9.4c AdMob 獎勵廣告橋接（`AdBridge.kt`/`AdBridgeService.kt`/`AdActivity.kt`，2026-07-09 完成）

TWA 沒有官方 postMessage 套件可用（androidbrowserhelper 的 `LauncherActivity` 不暴露
`CustomTabsSession`），改用**本機 loopback HTTP server** 橋接原生 AdMob：

- **`AdBridgeService.kt`**：前景服務（`specialUse` 類型），內建 NanoHTTPD 監聽
  `127.0.0.1:47591`，只有兩個被動查詢端點：`/ad/reset`（清空狀態）、
  `/ad/result`（回報 `{done, granted}`）。**不負責啟動任何畫面**（Service 直接
  `startActivity` 會被 Android Background Activity Launch 限制擋下，`result code=102
  BAL_BLOCK`）。回應必須帶 `Access-Control-Allow-Origin: *`——網頁來源
  `https://taiexrider.pages.dev` 與 server `http://127.0.0.1:47591` 是跨來源，
  沒有這個標頭瀏覽器會讓請求照送、伺服器照回應，但擋住網頁 JS 讀取內容（曾是這條
  橋接卡最久的 bug，症狀是「log 顯示 done=true 但網頁端永遠拿不到」）。
  **vc17 起改「只在看廣告時短暫存活」**：唯一啟動點是 `AdActivity`；`onStartCommand`
  ／`/ad/reset` 都會排一個 120s 保底逾時（流程卡死也不會讓通知永遠留著）；
  `/ad/result` 偵測到 `done` 第一次變 `true` 時改排 8s 短延遲後
  `stopForeground()+stopSelf()`（留時間給網頁端輪詢抓走結果）。`START_NOT_STICKY`
  （被系統殺掉不自動復活，下一輪看廣告會重新啟動）。前景服務通知（系統強制，無法
  隱藏）因此只在「點看廣告 → 廣告播完後幾秒」短暫出現，平常通知欄乾淨。
- **`AdActivity.kt`**：真正載入/顯示 `RewardedAd` 的透明畫面，繼承普通 `Activity`
  （**不是** `AppCompatActivity`——配上 manifest 的 `Theme.Translucent.NoTitleBar`
  會直接崩潰）。由 manifest 的自訂 URL scheme intent-filter
  （`taiexrider-ad://show?type=coin|revive`）啟動，**發起者必須是 Chrome**（使用者
  在網頁點按鈕觸發），才不受 BAL 限制。`onCreate()` 啟動 `AdBridgeService`（vc17 起
  是唯一啟動點）——這個位置天生涵蓋「載入廣告吃記憶體，系統把整個 App 行程砍掉重開、
  新行程直接冷啟動這支 Activity、從未經過 `MainActivity`」的坑：廣告在哪個行程播，
  哪個行程就有 server 在聽。
- **`AdBridge.kt`**：`AdBridgeService`/`AdActivity` 共用的簡單靜態狀態（`done`/
  `granted`），同一 process 內傳遞結果，不需要真的跨 process IPC。
- **網頁端**（`src/lib/ads.ts` 的 `requestRewardedAd(kind)`）：按鈕點擊同步用
  `window.open('taiexrider-ad://show?type=...', '_blank')` 觸發（**不能用
  `<a>.click()` 同文件內導轉**——TWA 會判定成「離開受信任來源」跳出確認框，
  按離開直接把整個 TWA 關掉），之後輪詢 `/ad/result` 直到有結果或 60 秒逾時；
  輪詢同時監聽 `visibilitychange`（廣告全螢幕顯示時原本分頁變背景分頁，
  `setTimeout` 會被 Chrome 節流，分頁一恢復可見要立刻醒來檢查，不能只靠固定間隔）。
  **優雅降級**：若從頭到尾 15 秒完全連不上 loopback server（服務起不來，或未來
  Chrome Private Network Access 政策把公開網頁對 127.0.0.1 的請求整個擋掉），提早
  放棄回傳 `false`——呼叫端（復活/雙倍/拿金幣/排行榜第 3~5 次）對 `false` 一律
  「不發獎勵、不扣次數、按鈕恢復可按」，遊戲照常進行，不會卡死。
- **✅ 已真機驗證**：復活／結算畫面雙倍金幣／車庫看廣告拿金幣三條路徑皆確認
  正常發放獎勵、Supabase 正確寫入。**上架前待辦**：`AdActivity.kt` 的
  `TEST_REWARDED_AD_UNIT_ID` 仍是 Google 官方測試單元，要換成真實單元 ID
  （revive_reward: `ca-app-pub-8981745966447649/1679422480`；coin_reward:
  `ca-app-pub-8981745966447649/2170377077`，依 `intent.data` 的 `type` 參數分流）。
- **8 層問題鏈完整回顧（2026-07-09 打通，每層都是獨立的坑，供之後排查類似跨
  TWA/原生橋接問題對照）**：
  ① 官方 PostMessage for TWA 在 `LauncherActivity` 架構下無解（session 是 private
  欄位無 getter＋啟動後必 `finish()`，github android-browser-helper#472 仍 open）→
  改本機 loopback server；
  ② 普通 Service 被系統背景省電殺掉（三星 One UI「app idle」幾分鐘就殺）→ 前景服務；
  ③ Service 直接 `startActivity` 被 BAL 擋（前景服務不在豁免清單）→ 改 Chrome
  使用者手勢導轉自訂 scheme；
  ④ `<a>.click()` 同文件導轉觸發 TWA「離開網站」確認框 → 改 `window.open`；
  ⑤ `AppCompatActivity` 配非 AppCompat 主題啟動即崩 → 改繼承 `Activity`；
  ⑥ 載入廣告吃記憶體，系統砍掉整個行程重開、新行程沒有 Service → `AdActivity`
  自己也 `startForegroundService`（vc17 起乾脆成為唯一啟動點）；
  ⑦ 背景分頁計時器節流讓輪詢睡死 → `visibilitychange` 喚醒；
  ⑧（真因）loopback 回應缺 `Access-Control-Allow-Origin`，網頁 JS 永遠讀不到伺服器
  早已正確回應的結果 → 加 CORS 標頭。
- **⚠️ Android 13+ 通知權限**：`MainActivity.kt` 會在 API 33+ 請求
  `POST_NOTIFICATIONS` 執行時權限（沒有這個權限，前景服務本身仍正常運作、廣告
  功能不受影響，但系統會靜默不顯示常駐通知——vc15 上傳 Play Console 時因為要填
  `FOREGROUND_SERVICE_SPECIAL_USE` 用途聲明表單才發現這個疏漏，vc16 補上）。
- **Play Console 上傳注意**：`FOREGROUND_SERVICE_SPECIAL_USE` 權限上傳時 Google
  會要求填「用途聲明表單」，選「其他」+ 文字說明 + **附一段示範影片連結**
  （YouTube 不公開連結即可）證明實際用途，才能通過審查。
- **已知殘留瑕疵**：debug 簽名跟 `assetlinks.json`（僅登記正式簽名指紋）對不上時，
  Chrome 會比較常顯示網址列；即使正式簽名，使用者第一次點看廣告仍會跳一次「本機
  網路存取」系統權限請求、網址列跟著短暫閃一下（Chrome 對任何權限請求的固定行為，
  跟簽名/信任狀態無關），之後同一次安裝不會再跳。**若要完全消除**，需之後評估
  改用真正的 PostMessage for TWA（放棄 `LauncherActivity`、自己管理
  `CustomTabsSession`）或整專案改用 Capacitor（詳見 CLAUDE.md「廣告雙軌架構」段落）。

### 9.5 打包流程（每次更新）

1. 把 `android/` 內改動的檔案複製到 Android Studio 專案對應路徑
2. `app/build.gradle.kts` 的 `versionCode` + 1（每次上傳都要不同）
3. Build → Generate Signed Bundle/APK → Android App Bundle → 選 keystore → 產 AAB
4. Play Console → 測試及發布 → 內部測試 → 建立新版本 → 上傳 AAB → 發布

### 9.5b 殼版本更新提示（✅ 2026-07-15 已實作，Capacitor 版）

**問題**：原生殼改動重包上傳後，玩家不會自動被提示更新（PWA 內容端有 Service Worker
自動偵測，但殼本身沒有）。使用者曾因此手動跑去 Play Console 確認有沒有更新按鈕。

**⚠️ 2026-07-03 舊設計已作廢**：當初方案 A 是靠 `AndroidManifest.xml` 的 `DEFAULT_URL`
加查詢參數（`?shell=11`）傳殼版本給網頁——這是 TWA（androidbrowserhelper）「殼只是
開一個網址」架構才成立的機制。2026-07-10 換成 Capacitor（網頁內容打包進 APK，不是
即時開網站）後這個機制直接失效，下面是重新設計、已實作的 Capacitor 版本。

**已實作（方案 A′，非強制）**：
- `src/lib/shellUpdate.ts` `checkShellUpdate()`：原生殼限定（`Capacitor.isNativePlatform()`），
  用 `@capacitor/app` 的 `App.getInfo().build` 直接讀本機 `versionCode`（不用查詢參數），
  跟 Supabase `app_config` 表（`supabase/migration_20260715b.sql`）的
  `latest_android_versioncode` 比對。
- 落後就在首頁（`Home.tsx`）顯示可關閉的提示條（`.shell-update-banner`），**不擋遊戲**，
  按鈕 `window.open('https://play.google.com/store/apps/details?id=com.tylapp.taiexrider', '_system')`
  開 Play 商店頁（Capacitor 內建支援 `_system` target，不需要額外裝 `@capacitor/browser`）。
- 關閉提示會記住這個版號（`tr_update_dismissed_v`），下次有更新的版號才會再跳。
- **維運方式**：打包新版上傳 Play Console **審核通過、正式對玩家生效那天**才去
  Supabase SQL Editor 把 `app_config.latest_android_versioncode` 改成新版號，一個
  數字控制全服提示，不用重新部署前端（跟舊設計的優點一致，只是不再靠查詢參數傳遞）。

**方案 B（正式做法，長期，仍未做）**：接 Google Play In-App Updates API（Play Core），
需要額外的 Capacitor 社群外掛（例如 `@capawesome/capacitor-app-update`），原生對話框
（Flexible/Immediate 兩種），甚至可原地下載不用離開 app；「最新版本」由 Google 自己
判斷（不用手動維護 Supabase 數字），但要多裝原生依賴、多一輪測試成本，適合玩家量大、
更新頻率高之後再評估升級。

**強制更新（選配，未做）**：可以再加一個 `min_supported_versioncode` 欄位，低於門檻
直接擋住遊戲畫面只顯示更新按鈕，留給日後有破壞性更新（例如反作弊資料格式不相容）時用。

### 9.6 Google Play 帳號

- 開發者帳號：Harold_Yun（tyl161803@gmail.com）
- 目前狀態：內部測試軌道，待正式發布

---

## 10. 未來待辦

- **AdMob 廣告**：✅ 已完成（見 9.4c），本機 loopback server 橋接（非原本規劃的
  JS Bridge/`window.AdBridge` 全域物件，實際做法是 `src/lib/ads.ts` 的
  `requestRewardedAd(kind)` + 自訂 URL scheme 觸發）。剩真實廣告單元 ID 待上架前換上。
- **IAP**：✅ 已完成（Google Play Billing API + Digital Goods API，見 §「鑽石車款」）。
- **商業模式**：看廣告復活一次／雙倍金幣／車庫拿金幣（AdMob Rewarded，✅ 已上線）
  / IAP 永久去廣告（✅ 已上線，待真廣告可移除才有實際意義）
- **最終保底：整專案換 Capacitor（2026-07-09 深度討論定案，只在 TWA 架構連續走不通
  時才考慮）**：現有 React/Vite/Canvas2D/Matter.js/Supabase 幾乎 100% 留用，只換
  「打包成 App 的殼」；Capacitor 有成熟外掛（AdMob/IAP）走正規 JS↔原生橋接，不會重演
  「網頁無法觸發自訂原生指令」的 TWA 死路。**✅ 關鍵確認：換 Capacitor 不會讓封測歸零**
  ——Google Play 只認 `applicationId`（維持 `com.tylapp.taiexrider`）+ 簽署金鑰（沿用
  `taiexrider-release.jks`），測試軌道/名單/14 天倒數全部不受影響；唯一會歸零的是改
  applicationId，不要改。附加好處：原生 `FLAG_KEEP_SCREEN_ON`（如
  `@capacitor-community/keep-awake`）可取代 Web Wake Lock API，消除 TWA 下「Chrome 在
  背景執行」的規格強制通知。升級順序：TWA 現行方案 → 特定畫面 WebView 包裝 → 才是
  Capacitor（勝過 React Native＝要重寫渲染層／全原生＝重做整款遊戲）。
- **PNA 風險（Chrome Private Network Access 政策）**：未來若擋掉公開網頁對 127.0.0.1
  的 loopback fetch，廣告橋接整條失效（**不影響 IAP**——那條走 DelegationService，無
  loopback）。網頁端已有優雅降級（15 秒連不上提早放棄、不發獎勵不扣次數、遊戲照常，
  見 §9.4c），屆時的根治選項＝上面的 Capacitor 或 PostMessage for TWA。

---

## 11. 音效系統（`src/game/audio.ts`，v0.8.0 + v0.9.3）

純 Web Audio API 合成，**不需任何外部音檔**。所有函式都 lazy 建立 `AudioContext`（需使用者互動後才能啟動）。

| 函式 | 觸發時機 | 合成方式 |
|---|---|---|
| `playFlip()` | 後空翻計分時 | Sine 160→520Hz，0.28s 上揚 |
| `playPerfectLanding()` | 完美落地時 | Triangle C5→E5→G5 琶音，3 音間隔 90ms |
| `playCrash()` | 翻車 / 卡死判定 | 白噪音 bandpass 350Hz，0.55s 衰減 |
| `playFinish()` | 完賽（抵終點）| Triangle C4→E4→G4→C5 凱旋琶音 |
| `startEngine()` | 遊戲開始 / 重置 | Sawtooth→lowpass→gain，靜音啟動 |
| `updateEngine(speed, grounded)` | 每幀（非暫停 / 非結算）| 動態調整振盪頻率與音量 |
| `stopEngine()` | 翻車 / 完賽 / 元件卸載 | 0.15s 淡出後停止振盪器 |

引擎音在著地時頻率隨速度 50→190Hz，離地降至 38Hz（怠速），透過 `setTargetAtTime` 平滑轉換。

v0.9.3 加入 master gain node（`masterGain()`），所有音效都接到同一個 GainNode → `destination`，音量設定存 localStorage key `taiexVolume`（預設 0.8）。`setVolume(v)` / `getVolume()` 供 UI 控制。

**拉霸機音效（v0.12.4）**：`playSlotTick()`（短促 1.5~2kHz 方波 click ≈ 機械棘輪「咖」）+ `playSlotStop()`（240→110Hz thunk + 高通噪音「哐」收尾）。`RandomSlot.tsx` 的 rAF 迴圈在捲動位移每跨過一個 `ITEM_H` 觸發 tick——節奏自然跟著 T1 等速快、T2 減速慢的位移曲線；等速段 ~69 格/秒太密，tick 率上限 ~35/s。皆接 masterGain 受音量控制。

**震動回饋（v0.12.4，`src/lib/haptics.ts`）**：`navigator.vibrate` + feature detection（iOS Safari 不支援自動 no-op）。`haptics.crash()`（120ms）接兩個死亡分支、`haptics.perfect()`（[28,45,55] 雙震）接完美落地；按鈕點擊用 `initButtonHaptics()` 全域 pointerdown 事件委派（`closest("button")` 命中就 8ms 短震），`main.tsx` 初始化，之後新增按鈕自動生效。

**GameCanvas 延遲載入（v0.12.4）**：`App.tsx` 用 `React.lazy(() => import("./game/GameCanvas"))` 把 GameCanvas + Matter.js + terrain/bike 拆成獨立 chunk（110KB / gzip 36KB），主 bundle 452KB（原 ~560KB）。App 掛載 2.5s 後背景 `import()` 預熱；Suspense fallback `.lazy-game-loading`（深色全螢幕）。SW precache 涵蓋該 chunk，安裝後進遊戲零延遲。

---

## 12. 監控 / 事件打點（v0.12.2）

**架構**：zero-SDK。前端 `src/lib/analytics.ts` 的 `logEvent(event, mode, props)` fire-and-forget 打 Supabase RPC `log_event`（`keepalive: true`，任何失敗靜默吞掉、絕不影響遊戲）。事件存 `public.events` 表。

| 事件 | 觸發點 | props |
|------|--------|-------|
| `run_start` | `App.tsx handleStartTrack`（模式由開局畫面推導：daily/slot/custom/long/classic） | `label` |
| `death` | `GameCanvas` 死亡兩分支 | `cause`（topHit/stuckMidAir）、`xr`（死亡位置/全長 0~1）、`label` |
| `finish` | `GameCanvas` 完賽 | `score`、`timeMs`、`flips`、`perfect`、`label` |
| `revive` | `doRevive()` | `label` |
| `share` | （保留，分享功能用） | — |

**安全**：寫入只能走 RPC（事件白名單 + props ≤2KB + device ≤48 字）；`player_id` 由 `auth.uid()` 綁定；events 表**無任何 select policy**（只有 Dashboard/service_role 可讀）。`device_id` = localStorage 匿名 UUID（`taiex_player_id`），未登入也能算留存。

⚠️ **player_id 歷史缺陷（2026-07-09 修）**：`logEvent()` 原本 `Authorization` header 固定用
anon key（不代表任何登入者），伺服器端 `auth.uid()` 永遠 NULL → **7/2 上線到 7/9 的 377 筆
事件 player_id 全部 NULL、無法回溯修補**（device_id↔帳號的關聯沒有任何表記過）。修法：
先 `supabase.auth.getSession()`，登入帶真 access_token、訪客才 fallback anon key。查特定
帳號遊玩史只有 7/9 之後的資料有效；更早的只能拿 `daily_scores.created_at`/
`player_wallet.updated_at` 間接推測。

**保留策略**：原始事件留 90 天，每日 16:00 CI（`fetchDailyMap.ts`）以 service key 呼叫 `cleanup_old_events()` 清理。

**查看數據**：兩條路——
① Supabase Dashboard → SQL Editor 跑 `supabase/analytics_queries.sql`（9 段：DAU/模式分佈/死亡原因/完賽率/死亡熱點/次日留存/成績概況/復活率/表大小），常用段存 Saved queries。
② **遊戲內隱藏統計頁（v0.12.12）**：設定視窗 → 3 秒內連點版本號 5 下 → `StatsScreen`（每日總覽/模式分佈/死因/次日留存）。資料走 `admin_stats` RPC（`migration_20260702b.sql`），**權限綁 JWT email = 開發者帳號**，其他人開頁面只會看到無權限訊息——連點只是入口糖衣不是門鎖。需以 Google 登入開發者帳號才有數據。

**全服死亡熱點（v0.12.11）**：`daily_death_heatmap` RPC（同 migration b，anon 可查的匿名 20 等分彙總）→ `src/lib/deathHeatmap.ts` → DailyChallenge 熱度條 + GameCanvas top3 ☠️ 標記。監控 death.xr 打點一份工投三用（監控/遊戲內容/社群哏）。

**✅ 已跑**：`supabase/migration_20260702.sql`（events 表與 RPC）。

---

## 13. 測試提醒

preview / 隱藏分頁 `document.hidden=true` → `requestAnimationFrame` 暫停 → 主迴圈停住（看起來車不動）。

用 `window.__test`（僅 DEV 模式）手動步進驗證：
```js
window.__test.step(60)   // 步進 60 幀
window.__test.press()    // 模擬按下
window.__test.release()  // 模擬放開
window.__test.state()    // 取得目前物理狀態
window.__test.reset()    // 重置
```
