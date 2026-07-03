# TaiexRider 開發規劃

> 概念：將台股每日走勢轉換成 2D 機車越野賽道（StonkRider 概念的台股本地化版本）。
> 玩家每天看到的賽道，是**前一個交易日**的真實資料 — 全離線可玩、無需即時行情。

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
  unique (challenge_date, player_id)
);
alter table public.daily_scores enable row level security;
create policy "public read"   on public.daily_scores for select using (true);
create policy "auth insert"   on public.daily_scores for insert with check (auth.uid() is not null);
create policy "auth update"   on public.daily_scores for update using (auth.uid() is not null);
```

提交走 `leaderboard.ts` 的 `submitDailyScore()` → RPC `submit_daily_score`（security definer），需 Google 登入（`auth.uid()` 伺服器端決定 player_id）。
⚠️ **`challenge_date` = `coalesce(max(map_date ≤ 台灣今天), 台灣今天)`**（與前端 `resolveSessionDate()` 同源），讓週末/連假整段成績累積在同一張榜、午夜才換新榜。**不可用 `current_date`（UTC）**（台灣午夜後存到前一天），**也不可只用台灣日曆日**（連假時 ≠ 最後交易日的 map_date，會跟讀取端的 max(map_date) 對不上 → 看似沒上榜）。⚠️ **改 schema 後 push 不會更新 RPC，要手動在 Supabase SQL Editor 跑 `create or replace function submit_daily_score`。** 詳見 CLAUDE.md「排行榜對齊」「時區踩雷」。

### 2.3 `keep_alive` — Supabase 保活

```sql
create table if not exists public.keep_alive (id int primary key, pinged_at timestamptz);
insert into public.keep_alive values (1, now()) on conflict (id) do nothing;
```

cron-job.org 定期 ping，避免 Supabase 免費方案休眠。

### 2.4 `classic_records` — 經典模式紀錄保持者

```sql
create table if not exists public.classic_records (
  level_id     text primary key,          -- 每關只一列 = 保持者
  player_id    text not null,
  player_name  text not null,
  score        int  not null,
  time_ms      int  not null,
  updated_at   timestamptz not null default now()
);
```

經典關卡是固定地形，適合永久排行榜。提交走 RPC `submit_classic_record(p_level,p_name,p_score,p_time)`（security definer，需登入；分數高優先、同分時間短才覆蓋）。前端 `src/lib/classicRecords.ts` 讀取（整表 ~12 列、Map 快取）+ 提交。⚠️ 改 schema 後 push 不會更新，要手動在 Supabase SQL Editor 跑建表 + `create or replace function`。

---

## 3. 資料管線（Data Pipeline）

### 3.1 每日更新腳本

**腳本**：`scripts/fetchDailyMap.ts`（Node 22+ 直跑 `.ts`，type-stripping）
**觸發**：GitHub Actions `.github/workflows/fetch-daily-map.yml`，cron `0 8 * * *`（= 台灣時間 16:00，收盤後 2.5h）。提早跑 + 錨定交易日 = 即使排程延遲也不跨午夜錯位。

**流程**：
1. 先抓 TAIEX：Yahoo `^TWII`（5 分 K、`range=1d`），從回傳 timestamp 讀出**實際交易日 sessionDate**，`map_date = sessionDate + 1`。
2. 抓 TWSE `STOCK_DAY_ALL` 取**上市股票清單**（代號+名稱），過濾 `/^\d{4}$/`（純 4 位數字，排除 ETF 字母尾）。
3. 對每支股票抓當日盤中走勢：Yahoo `{code}.TW`（5 分 K、`range=1d`），降採樣至 ~110 點。
4. 計算 `difficulty`（盤中最大單步漲跌幅）。
5. Upsert 至 Supabase `daily_map`（`Prefer: resolution=merge-duplicates`，衝突鍵 `(map_date, stock_code)`），清除舊資料。⚠️ **cutoff 錨定剛寫入的 `mapDate − 7 天`，不可錨「執行當下 now − 7 天」**：長連假（過年/長颱風假 > 7 天）map_date 凍住但 now 一直走，用 now-7 會追過當前唯一在用的 map_date 把它刪掉（甚至同一次跑剛寫又刪）→ 掉回靜態盤。錨 mapDate 則任意長度連假當前盤永遠保留。

> 每日約 ~1090 支股票，失敗容錯繼續（不中斷整批）。連假/休市時 Yahoo `range=1d` 自動回最後交易日 → sessionDate 不變 → 持續顯示最後交易日的盤（正確）。

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

**圈數與完美落地計分（v0.12.14 改線性＋倍率定案）**：
- 圈數 = `floor((|airRotation| + 0.3π) / 2π)`——差 0.3π（85%+）內**進位**，貼近體感；翻轉分／完美分／totalFlips 統一用這套圈數。
- **翻轉分改線性**：`flipScore(N) = N × flipBaseScore(100)`，不再遞增（舊制 1/2/3 圈＝100/250/450，新制＝100/200/300）。
- **完美落地＝剛才那趟翻轉分 ×2**：`flipScore(N) × 2`（1圈 +200／2圈 +400／3圈 +600），不論落地面平或斜，只看落地角是否貼合坡面。
- 完美觸發條件不變：滯空 > 0.3s ＋ |rot| > 1.7π ＋ 落地角與坡面夾角 < 31°。
- 兩處呼叫共用 `settleFlip()`：一般落地（連續 4 步著地結算）／**飛越終點線時仍在空中**（見下）。

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

### 5.5 挑戰次數上限（每日排名賽）

- 每日限 `MAX_ATTEMPTS=5` 次，前 `FREE_ATTEMPTS=2` 次免費，後 3 次按鈕顯示「看廣告開始」（廣告尚未串接，目前直接進遊戲）。
- 次數以 localStorage key `tr_daily_att_{sessionDate}` 儲存，`sessionDate = resolveSessionDate()` 結果（連假整段用同一個 key）。
- 進入遊戲時才 `incrementAttempts()`（非按鈕按下時），確保只有真的開始才計次。
- 邏輯在 `src/lib/challengeAttempts.ts`，UI 在 `DailyChallenge.tsx`。

### 5.6 死亡後復活（Revival）

- 僅每日排名賽啟用（`GameCanvas` prop `revivalEnabled={isDailyRun}`）。
- 死亡後出現「看廣告復活」琥珀色按鈕（`.overlay-btn.ad-btn`），每局限一次（`revivalUsed` state）。
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
│   ├── audio.ts           # Web Audio API 程式生成音效（引擎 + 翻車 + 琶音）
│   └── camera.ts          # 鏡頭跟隨
├── screens/
│   ├── Home.tsx           # 首頁（四模式入口 + 設定 modal + 返回確認）
│   ├── DailyChallenge.tsx # 每日排名賽（地圖預覽 + 排行榜 + Google 登入）
│   ├── ClassicSelect.tsx  # 經典模式（歷史著名盤勢 12 條靜態關卡 + 事件說明）
│   └── RandomSlot.tsx     # 隨機拉霸（Supabase pool，30 格 × 8 = 240 DOM nodes）
├── TrackSelect.tsx        # 自選賽道（Supabase ~1000 支 + 無限捲動 30/次）
├── data/
│   ├── tracks.ts          # 本地內建 24 支賽道（月線 fallback）
│   ├── pick.ts            # dailyKey() / dailyTrack()
│   ├── classics.ts        # 經典模式型別 + classicToTrack()
│   ├── classics.json      # 經典關卡靜態資料（scripts/fetchClassics.ts 一次性產出）
│   └── sample-*.json      # 預抓樣本（2330/0050/2454/TAIEX）
├── lib/
│   ├── dailyMap.ts           # Supabase daily_map 讀取 + promise 快取
│   ├── leaderboard.ts        # Supabase daily_scores 讀寫
│   ├── classicRecords.ts     # Supabase classic_records 讀寫（經典紀錄保持者）
│   ├── longTrack.ts          # 每日長征串接 + fetchLongPreview（5 股預覽）
│   ├── auth.ts               # Google One Tap 登入 / signOut
│   ├── playerId.ts           # localStorage UUID + 暱稱（clampNameWidth 限長）
│   ├── challengeAttempts.ts  # 每日排名賽挑戰次數（localStorage，MAX 5 / FREE 2）
│   └── ads.ts                # TWA 環境偵測 + AdSense/AdMob 雙軌 scaffold（Phase 1 無廣告）
├── components/
│   └── Sparkline.tsx      # 折線圖元件
├── version.ts             # APP_VERSION + CHANGELOG（遊戲內更新日誌）
└── App.tsx                # 路由：home / daily / random / custom / classic / game
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
| Phase 7 | 🟡 封測中 | TWA 打包上架（手動 Android Studio）；全螢幕 immersive ✅ 已完成；Google Play **封閉測試**（門檻：12 名測試者 + 連續 14 天） |
| Phase 8 | 🟡 持續優化 | v0.9.4 連假讀取/排行榜跨連假同榜修正（`max(map_date ≤ 今天)`）；**v0.10 經典模式**（12 條歷史盤勢靜態關卡）；**v0.11 經典紀錄保持者**（`classic_records`，每關單一保持者）、返回離開改「再按一次返回鍵」、暱稱顯示寬度限長（12 寬）、每日長征 5 股預覽圖、開機深色霓虹 splash；**v0.12 懸空公平計時 + 每日排名賽每日 5 次上限（前 2 免費/後 3 看廣告）+ 死後原地復活（分數保留）+ 廣告雙軌 scaffold（`ads.ts` TWA 偵測，Phase 1 無廣告）** |

> **🟠 待辦（Phase 7 收尾）**：TWA 啟動仍會閃一下 Chrome 網址列（封測版實測），需 Android splash（androidbrowserhelper `SPLASH_SCREEN_BACKGROUND_COLOR=#05080f` + 圖）遮住啟動空窗（#5 的 A，需重打包 AAB）。詳見 CLAUDE.md 交接 #5。

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

AndroidManifest 的 activity name 改為 `.MainActivity`。

### 9.5 打包流程（每次更新）

1. 把 `android/` 內改動的檔案複製到 Android Studio 專案對應路徑
2. `app/build.gradle.kts` 的 `versionCode` + 1（每次上傳都要不同）
3. Build → Generate Signed Bundle/APK → Android App Bundle → 選 keystore → 產 AAB
4. Play Console → 測試及發布 → 內部測試 → 建立新版本 → 上傳 AAB → 發布

### 9.5b 殼版本更新提示（2026-07-03 設計，暫緩實作——理由見下）

**問題**：`android/` 原生殼改動（splash/捷徑/返回手勢等）重包 AAB 上傳後，玩家不會自動被提示更新（PWA 內容端有 Service Worker 自動偵測，但殼本身沒有）。使用者曾因此手動跑去 Play Console 確認有沒有更新按鈕。

**方案 A（採用，但暫緩到公開上架後才做）**：`android/app/src/main/AndroidManifest.xml` 的 `DEFAULT_URL` 加查詢參數標示殼版本，如 `?shell=11`。前端讀這個參數，跟 Supabase 一張 `app_config(key, value)` 表裡的 `latest_shell` 比對，版本落後就彈窗提示更新，按鈕深連結 `market://details?id=com.tylapp.taiexrider` 直接開 Play 商店頁；`app_config.latest_shell` 手動更新一個數字即可控制全服提示，不用重新部署前端。可設「建議更新」（可關閉）或「強制更新」（擋住遊戲）兩種等級。

**方案 B（正式做法，長期）**：接 Google Play In-App Updates API（Play Core），原生對話框，甚至可原地下載不用離開 app。要動 `android/` 原生 code，工程量較大，適合日後有大改殼版本時再做。

**為何現在不做**：封測期間 app 的 `DEFAULT_URL` 只有封測名單看得到（未公開宣傳），殼版本更新頻率低、影響範圍小，優先度排在其他項目後面。**正式上架後**若殼版本更新頻率提高，優先做方案 A（成本低、Supabase 一個表就搞定）。

### 9.6 Google Play 帳號

- 開發者帳號：Harold_Yun（tyl161803@gmail.com）
- 目前狀態：內部測試軌道，待正式發布

---

## 10. 未來待辦

- **ETF 含字母代號**：腳本 filter 從 `/^\d{4}$/` 改 `/^\d{4}[A-Z]?$/` 即可納入 00981A 等
- **AdMob 廣告（Phase 7 後段）**：
  - 方案 B（Native SDK）：在 Android 專案加 Gradle dependency + JS Bridge
  - 死亡後「看廣告復活？」→ `window.AdBridge.showRewardedAd()` → 回調復活
  - IAP：Google Play Billing API（同樣走 JS Bridge）
- **商業模式**：看廣告復活一次（AdMob Rewarded）/ IAP 永久去廣告

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

**保留策略**：原始事件留 90 天，每日 16:00 CI（`fetchDailyMap.ts`）以 service key 呼叫 `cleanup_old_events()` 清理。

**查看數據**：兩條路——
① Supabase Dashboard → SQL Editor 跑 `supabase/analytics_queries.sql`（9 段：DAU/模式分佈/死亡原因/完賽率/死亡熱點/次日留存/成績概況/復活率/表大小），常用段存 Saved queries。
② **遊戲內隱藏統計頁（v0.12.12）**：設定視窗 → 3 秒內連點版本號 5 下 → `StatsScreen`（每日總覽/模式分佈/死因/次日留存）。資料走 `admin_stats` RPC（`migration_20260702b.sql`），**權限綁 JWT email = 開發者帳號**，其他人開頁面只會看到無權限訊息——連點只是入口糖衣不是門鎖。需以 Google 登入開發者帳號才有數據。

**全服死亡熱點（v0.12.11）**：`daily_death_heatmap` RPC（同 migration b，anon 可查的匿名 20 等分彙總）→ `src/lib/deathHeatmap.ts` → DailyChallenge 熱度條 + GameCanvas top3 ☠️ 標記。監控 death.xr 打點一份工投三用（監控/遊戲內容/社群哏）。

**⚠️ 佈署依賴**：`supabase/migration_20260702.sql` 要在 SQL Editor 手動跑過一次，events 表與 RPC 才存在；沒跑之前前端打點靜默失敗（不影響遊戲）。

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
