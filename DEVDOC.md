# TaiexRider 開發規劃

> 概念：將台股每日走勢轉換成 2D 機車越野賽道（StonkRider 概念的台股本地化版本）。
> 玩家每天看到的賽道，是**前一個交易日**的真實資料 — 全離線可玩、無需即時行情、不需要 Realtime 連線。

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

## 1. 專案概觀

- **核心玩法**：HTML5 Canvas + 2D 物理，玩家騎機車跨越由台股價格序列轉換出來的地形，操作油門/重心/跳躍，目標是不摔車並做出特技。
- **平台**：PWA（網頁版優先），之後透過 TWA 包裝上架 Google Play。
- **資料時間點**：永遠使用 T-1（前一交易日）已收盤資料，避免即時性問題與週末/假日空窗。
- **定位聲明**：純娛樂，非投資建議 / 非博弈遊戲（避免 Google Play 內容分級踩到財經類雷區）。

---

## 2. 技術棚架

| 層級 | 選擇 | 備註 |
|---|---|---|
| 前端 | React + Vite + TypeScript | 沿用現有熟悉的 stack |
| 渲染 | HTML5 Canvas 2D | 不需要 PixiJS，效能足夠 |
| 物理引擎 | Matter.js | 機車車身/輪胎/地形碰撞 |
| PWA | `vite-plugin-pwa` (Workbox) | 離線快取策略 |
| 本機儲存 | IndexedDB（`idb` library） | 快取賽道資料、本地最佳分數 |
| 資料儲存 | Supabase（Postgres table） | 每日賽道資料快取，資料量極小 |
| 排程 | Supabase Edge Function + `pg_cron`，或外部 cron（GitHub Actions / cron-job.org） | 每日收盤後跑一次 |
| 上架封裝 | Bubblewrap（TWA） | PWA 直接包成 Android App Bundle |

---

## 3. 資料管線（Data Pipeline）

### 3.1 可用的 TWSE 開放資料端點

**全市場每日總覽（個股賽道用）**
```
GET https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL
```
回傳陣列，每個元素含 `Code`, `Name`, `OpeningPrice`, `HighestPrice`, `LowestPrice`, `ClosingPrice`, `Change`, `TradeVolume` 等欄位，涵蓋所有上市股票最近一個交易日。

**個股近一個月日線（個股賽道，較長賽道用）**
```
GET https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=YYYYMM01&stockNo=2330
```
回傳 `{ stat, title, fields, data, notes }`，`data` 為當月每日 `[日期, 成交股數, 成交金額, 開盤價, 最高價, 最低價, 收盤價, 漲跌價差, 成交筆數]`。0050、2330 等都用這支即可。

**大盤當日走勢（每日挑戰用，解析度最高）**
```
GET https://www.twse.com.tw/exchangeReport/MI_5MINS_INDEX?response=json&date=YYYYMMDD
```
即「每5秒指數統計」報表，提供當天加權指數的高頻時間序列 — 這是**每日挑戰模式**最理想的資料源，因為一天就有數十～上百個資料點，賽道細節豐富。

> ✅ **Phase 2 實測確認（2026-06-15）**：`title`＝「每5秒指數統計」，一天約 **3241 列**（09:00:00~13:30:00，每5秒一列）。每列 `data[i]`：`[時間, 發行量加權股價指數, 未含金融…, …各類指數]`，**欄位 index 1 = 加權指數（TAIEX）**，數值含千分位逗號。因點數過多，賽道生成前需**降採樣**到 ~110 點（見 `scripts/fetchTwse.ts`）。

### 3.2 排程設計

- 每個交易日收盤後（約下午 14:30~15:00 之後皆可，因為用的是 T-1 資料，緩衝很大）跑一次 fetch job。
- Job 內容：抓 `MI_5MINS_INDEX`（大盤當日走勢）+ 抓固定清單的個股/ETF 月線（0050、2330、...）。
- 轉換成賽道座標格式（見第 4 節），寫入 Supabase `daily_tracks` table。
- 週末/假日：job 不會抓到新資料，App 端就繼續使用「上週五」的資料 + 預先打包的經典賽道。

### 3.3 Supabase Schema

```sql
create table daily_tracks (
  id bigserial primary key,
  track_date date not null,
  track_type text not null,        -- 'taiex_daily' | 'stock_0050_monthly' | 'stock_2330_monthly' ...
  raw_prices jsonb not null,        -- 原始價格序列，正規化在前端做
  generated_at timestamptz default now(),
  unique (track_date, track_type)
);

-- 允許匿名只讀
alter table daily_tracks enable row level security;
create policy "anyone can read" on daily_tracks for select using (true);
```

資料量估算：每天每個 track_type 一筆，每筆 JSON 大概數 KB～數十 KB，一年下來頂多幾十 MB，完全不用擔心容量。

---

## 4. 賽道生成演算法

> ✅ **Phase 2 已實作**，實際程式在 `src/game/terrain.ts` 的 `pricesToTrack(prices)`。

輸入：一個數字陣列 `prices[]`（個股月線日收盤 ~51~63 點，或日盤 5分K ~54 點）。

### 4.1 高度正規化（依波動度自動縮放）

```
REF_PCT = 0.03   // 3% 為「普通波動」基準
maxStepPct = max(|prices[i]/prices[i-1] - 1|)  // 此賽道的最大單步漲跌幅

scaledHeight = clamp(
  heightRange * (maxStepPct / REF_PCT),   // 以基準縮放
  heightMin,                               // 下限：最平穩賽道也有最小高差
  heightMax                                // 上限：最狂野賽道不超過此高度
)

y[i] = baselineY - (price[i] - min) / (max - min) * scaledHeight
```

**現行參數**（`src/game/constants.ts` → `TRACK`）：

| 參數 | 值 | 說明 |
|---|---|---|
| `segmentWidth` | 120 px | 每個資料點的水平間距 |
| `heightRange` | 340 px | 對應 3% 波動的基準高度 |
| `heightMin` | 250 px | 最平穩賽道的最小高差 |
| `heightMax` | 1000 px | 最狂野賽道的高度上限 |
| `baselineY` | 560 px | 最低點對應的世界座標 y |
| `maxSlopeDeg` | 75° | 相鄰段最大斜率（tan(75°)×120≈448px/段） |
| `startFlat` | 4 段 | 起點平台長度 |
| `endFlat` | 3 段 | 終點平台長度 |

### 4.2 斜率限制

相鄰兩點高度差超過 `tan(maxSlopeDeg) × segmentWidth` 時，**等比例壓縮**整條賽道的 `scaledHeight`（不截斷、不補點），使最陡處恰好等於上限。這保留了價格波動的「形狀」，只是等比例縮小幅度。

### 4.3 霓虹著色

- **漲（前一點→後一點 price 上升）** → 紅色 `#ff2244`
- **跌** → 綠色 `#00ff88`（台股慣例：跌=綠）
- **平/起終點** → cyan `#2de2e6`

### 4.4 輸出格式

```typescript
interface TrackData {
  vertices: { x: number; y: number }[];  // 地形頂點
  colors: string[];                       // 每段顏色
  startX: number;                         // 起點 x
  finishX: number;                        // 終點 x
}
```

頂點陣列餵給 Matter.js 的靜態地形碰撞體。

**地形碰撞體實作（`buildTerrainBodies`，v0.4.1 定案 — 實心填滿梯形 + 底部外擴）：**
- 每段一個 `Bodies.fromVertices` **凸梯形**：上緣 = 折線（兩頂點，精確不動）、下緣拉到 `maxY + 800`、**下緣兩角各往外擴 `overlap = segmentWidth`**（上窄下寬）。
- **底部外擴的用意（v0.4.1 修 bug）**：相鄰梯形在接縫「正下方」重疊成實心聯集，消除外露的**垂直內部邊**——這正是「從高處落下偶爾卡在兩根 K 棒縫隙」的元兇（Matter.js internal-edge 卡頓）。已用 node 實測：峰/谷兩種頂點，union 頂面與折線誤差皆為 0（外擴不會讓任何梯形凸出鄰段上方），故手感／視覺完全不變。
- 傳入 `Vertices.centre(verts)` 當 position → fromVertices 不平移頂點，世界座標 = 原始 verts（已用 node 實測吻合，單一凸 part，無需 poly-decomp）。
- **為何根治隱形牆/卡轉折**：相鄰梯形共用一條垂直邊（在共同頂點 x 處往下），頂面 = 折線本身、零縫、零凸角。舊「旋轉矩形沿法線偏移」會讓轉折點兩段法線不同 → 上緣角翹到折線上方 = 隱形牆；填滿後完全消除。
- **填滿又繞過 fromVertices 穿透**：早期整條 `fromVertices` 失敗是因薄片（<1px 三角頂點）被高速隧穿；梯形又肥又深，無薄片。
- **視覺 A（K 棒柱）**：渲染與碰撞同形——每段填紅(漲)/綠(跌)/青(平)柱，頂部實往下淡出。物理與渲染解耦，若要回到「只留頂線」霓虹風（B）或漸層（C），改 `drawTrack` 即可，碰撞不受影響。
- **歷史**：v0.3.7 以前為「旋轉矩形厚 26px + 兩端 +3px 重疊」（曾加頂點填縫圓 `Bodies.circle(r=13)`，因凸角彈射移除）；v0.4.0 全面改填滿梯形。
- **備援**：若 chassis 圓體仍偶卡谷底，可加 collisionFilter mask 讓 chassis 不碰地、只輪子碰（Hill Climb 標準做法），本次未啟用。

---

## 5. 遊戲機制設計

### 5.1 操作（2026-06-14 定案：單鍵操控）

**參考對象＝ Ketchapp《Rider》(2016)，不採用 StonkRider 的多按鍵配置。**
整個遊戲只有**一個輸入：按住 / 放開**。

- **按住螢幕任一處（觸控）／滑鼠左鍵／空白鍵（桌機測試用）= 油門**：車輛後輪驅動往前加速。
- **放開 = 滑行 / 減速**：不主動踩油門，靠慣性與地形滑行。
- **空中按住 = 車身持續向後翻轉（後空翻）**；**空中放開 = 停止旋轉**。→ 這就是 5.2 後空翻計分的控制方式：押越久轉越多圈、分數遞增，但要在落地前放開把輪子喬朝下，否則摔車。
- **跳躍不需要按鍵**：跳台來自地形本身（下坡 / 跌停段衝出去自然飛起）。
- **沒有 nitro / wheelie / nose dive / jump 等獨立按鍵**（MVP 範圍），全部收斂進「按住/放開」這一個動作。
- **重來、靜音**：做成畫面上的小按鈕（icon），不佔用操控鍵。

> 設計精神：**簡單到「手指壓著就能玩」**，三歲到八十歲都會，難度全在「何時放開、賭幾圈」的時機判斷。

### 5.2 計分（2026-06-14 定案）

避免「獲利/虧損」等金錢語感的字眼（內容分級考量），改用中性的遊戲化指標：

- **行駛距離 / 完成度**：基礎分。
- **空中翻轉**（定案規則）：
  - 只做**後空翻**一種，不做複雜連段。
  - **每轉滿 360° 才算一圈**，沒轉滿不給分。
  - **分數遞增**以獎勵冒險：1 圈 100 / 2 圈 250 / 3 圈 450…（每多一圈，那圈更值錢）。
  - **控制方式**：空中**按住**＝持續後翻、**放開**＝停轉（單鍵，見 5.1）。
  - **風險機制**：落地前沒把車身轉正（輪子沒朝下）→ 直接摔車（見 5.4）。「再轉一圈來不來得及」就是核心刷分爽點。
  - 滯空來源：**下坡（跌停段）= 天然跳台**，跌越深、衝越快、飛越高、可轉圈數越多。
- **連續無摔車 Combo**：越久不摔倍率越高；摔車或復活時重置。
- **完賽時間**：每日大盤挑戰可做時間排行。

### 5.3 遊玩模式

| 模式 | 資料來源 | 特性 |
|---|---|---|
| **每日大盤挑戰** | 前一交易日 `MI_5MINS_INDEX`（5 分鐘 ~54 點）→ **內插補點到 ~100~120 點** | 全玩家同一賽道，每天更新，培養每日回訪習慣。走「長而爽」路線，但用補點延長、**不依賴每分鐘資料源** |
| **個股賽道** | 0050 / 2330 / 其他熱門代號日線（長度待定，~3 個月）；**首頁精選清單 + 自由搜尋代號**，全台股自動涵蓋 | 玩家可選擇代號。**MVP 先做這個模式**把玩法磨好 |
| **經典賽道** | 預先打包進 App 的歷史事件資料（如 2020.3 崩盤、2022 熊市段） | 不需連線即可玩，週末/假日 fallback，也是行銷亮點 |

> **賽道長度決策（2026-06-14）**：技術上不限制長度（Canvas 鏡頭剔除可吃上千點）；真正限制是「免費每分鐘資料拿不到」。故每日挑戰以官方免費的 5 分鐘資料為底，用**內插補點**延長到目標長度，純演算法、零資料風險。所有資料源統一降採樣/補點到**目標 ~100~120 點**，使每局時間穩定在 ~75~90 秒。

### 5.4 摔車與復活（2026-06-14 定案）

- **摔車判定**：車身翻覆、**輪子朝上且約 2 秒內無法回正** → 判定死亡。
- **死亡後**：結束該局並結算分數。
- **原地復活**：可選擇**看廣告**或**付費**復活，於原地繼續；復活會**重置 combo**（保留已得分數）。

### 5.5 難度（2026-06-14 定案）

- **MVP 只做「普通」一種物理參數**，難度分級（輕鬆/普通/困難改車速、重力、斜率上限、摔車寬鬆度）延後到 Phase 6。
- **地形難度星級**：用程式算每條賽道波動度，標示 ★ 星級給玩家心理預期，不改物理。

---

## 6. PWA / 離線快取策略

- `vite-plugin-pwa` + Workbox：
  - 靜態資源（JS/CSS/圖片/音效）→ Cache First
  - 每日賽道資料 API → Network First，失敗則 fallback 讀 IndexedDB 快取
- IndexedDB 結構（用 `idb`）：
  - `tracks` store：`{ date, type, vertices }` — 開啟 App 時 fetch 最新一筆，成功就覆蓋快取，失敗就用快取的繼續玩
  - `localScores` store：本地最佳分數（不需要伺服器端排行榜）
  - `classicTracks`：經典賽道直接打包進 build，不走網路

---

## 7. Google Play 上架路徑

1. **Bubblewrap（TWA）**：
   ```
   npx @bubblewrap/cli init --manifest=https://yourapp.com/manifest.webmanifest
   npx @bubblewrap/cli build
   ```
2. 在網域放 `/.well-known/assetlinks.json`，驗證網站與 App 的關聯（Digital Asset Links）。
3. **Google Play 開發者帳號**：一次性 25 美元。
4. **隱私權政策頁**：即使不蒐集個資，也建議放一頁簡短聲明（Play 上架強制要求連結）。
5. **內容分級問卷**：誠實填寫，明確標註「娛樂用途、非投資建議、非賭博」，避免被歸類到財經/博弈審查路線。
6. **商店素材**：App 圖示、Feature graphic、2~8 張截圖、簡短/完整說明文字。

---

## 8. 開發階段 Roadmap

| 階段 | 內容 | 目標 |
|---|---|---|
| Phase 0 | 專案初始化（Vite + React + TS + PWA plugin） | repo 可跑起來 |
| Phase 1 | ✅ 物理 prototype（2026-06-14）：假資料→霓虹賽道、Matter.js 機車、單指操控（著地驅動/空中後翻）、鏡頭跟隨、後空翻計分、摔車偵測、HUD。待真人試玩 tune 手感（`src/game/constants.ts`） | 先驗證「好玩」 |
| Phase 2 | 手動寫腳本抓 STOCK_DAY_ALL / STOCK_DAY / MI_5MINS_INDEX，轉換成賽道格式，肉眼檢查地形是否合理，調整正規化參數 | 確認資料 → 賽道的轉換品質 |
| Phase 3 | ✅ 三模式 UI（v0.5.0）：每日排名賽 / 隨機拉霸 / 自選賽道（見 §1 各 screen） | 遊玩內容完整 |
| Phase 4 | Supabase **排行榜**（每日排名賽成績上傳/讀取，§11）→ 之後 Edge Function + `pg_cron` 自動抓每日真實 TWSE 資料取代打包樣本 | 競技排名 + 每日資料自動更新 |
| Phase 5 | PWA 離線快取（Service Worker + IndexedDB） | 離線可玩 |
| Phase 6 | 視覺/音效打磨（可沿用暗色 cyan/amber 霓彩風格，或走 StonkRider 原本的綠/黑風格） | 視覺完成度 |
| Phase 7 | TWA 包裝 + Google Play 上架素材準備 | 送審上架 |

---

## 9. 專案結構建議

```
taiexrider/
├── src/
│   ├── game/
│   │   ├── physics.ts        # Matter.js 設定、機車 body 定義
│   │   ├── terrain.ts         # 價格陣列 -> 賽道頂點轉換（第4節演算法）
│   │   ├── GameCanvas.tsx     # 主畫面
│   │   └── controls.ts        # 鍵盤/觸控輸入
│   ├── data/
│   │   ├── trackTypes.ts
│   │   └── classicTracks.json # 預先打包的歷史經典賽道
│   ├── hooks/
│   │   └── useDailyTrack.ts   # fetch + IndexedDB 快取邏輯
│   └── App.tsx
├── scripts/
│   └── fetchDailyData.ts      # Phase 2 用的本地測試抓取腳本
├── supabase/
│   └── functions/fetch-daily-track/  # 每日排程 Edge Function
└── public/
    └── manifest.webmanifest
```

---

## 10. 待決事項

- [x] 專案正式名稱：**TaiexRider**
- [x] 賽道長度策略：5 分鐘資料 + 內插補點到 ~100~120 點，不追每分鐘資料（見 5.3）
- [x] 空中特技：單純後空翻、轉滿一圈計分、分數遞增、沒轉正即摔（見 5.2）
- [x] 摔車/復活規則：輪朝上 2 秒死、結束算分、看廣告/付費原地復活重置 combo（見 5.4）
- [x] 難度：MVP 只做普通，分級延後（見 5.5）
- [x] MVP 開發順序：先做個股賽道模式
- [x] 個股賽道：精選清單 + 自由搜尋，全台股自動涵蓋
- [x] 操控：單鍵（按住=油門+空中後翻 / 放開），參考 Ketchapp《Rider》，非 StonkRider 多鍵（見 5.1）
- [x] 視覺風格：**neon glow 賽博龐克**（霓虹線條 + 光暈、暗背景），參考 StonkRider／Rider；確切主色（cyan/amber vs 粉/綠）Phase 6 再微調
- [ ] `MI_5MINS_INDEX` 實際回傳欄位格式與解析度（5 分鐘 vs 5 秒）（Phase 2 實測確認）
- [ ] 個股賽道資料長度：固定近 3 個月，還是讓玩家選 1/3 個月（待定）
- [ ] 經典賽道收錄哪些歷史事件（2020.3 崩盤、2022 熊市、其他？）
