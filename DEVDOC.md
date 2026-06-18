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
客戶端查詢策略：先查今天 → 空則查明天（`nextDay()` 使用純 UTC 運算避開時區問題）。

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
⚠️ **`challenge_date` 用台灣時區** `(now() at time zone 'Asia/Taipei')::date`，**不可用 `current_date`（UTC）**——台灣午夜後會把成績存到前一天、跟 app 讀的本地日期對不上（看似沒上榜，實際有寫）。詳見 CLAUDE.md「時區踩雷」。

### 2.3 `keep_alive` — Supabase 保活

```sql
create table if not exists public.keep_alive (id int primary key, pinged_at timestamptz);
insert into public.keep_alive values (1, now()) on conflict (id) do nothing;
```

cron-job.org 定期 ping，避免 Supabase 免費方案休眠。

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
5. Upsert 至 Supabase `daily_map`（`Prefer: resolution=merge-duplicates`，衝突鍵 `(map_date, stock_code)`），清除 7 天前舊資料。

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

### 5.3 摔車判定

車身 crashZone（5 個局部點：前擾流→風鏡→油箱→座椅前/後緣）轉為世界座標，任一點低於地形且翻過 90°（cos < 0）→ 判死（0.1s 緩衝）。雙輪離地 + 速度 < 0.5 超時 → stuckMidAir 保底。

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
│   ├── Home.tsx           # 首頁（三模式入口 + 設定 modal + 返回確認）
│   ├── DailyChallenge.tsx # 每日排名賽（地圖預覽 + 排行榜 + Google 登入）
│   └── RandomSlot.tsx     # 隨機拉霸（Supabase pool，30 格 × 8 = 240 DOM nodes）
├── TrackSelect.tsx        # 自選賽道（Supabase ~1000 支 + 無限捲動 30/次）
├── data/
│   ├── tracks.ts          # 本地內建 24 支賽道（月線 fallback）
│   ├── pick.ts            # dailyKey() / dailyTrack()
│   └── sample-*.json      # 預抓樣本（2330/0050/2454/TAIEX）
├── lib/
│   ├── dailyMap.ts        # Supabase daily_map 讀取 + promise 快取
│   ├── leaderboard.ts     # Supabase daily_scores 讀寫
│   ├── auth.ts            # Google One Tap 登入 / signOut
│   └── playerId.ts        # localStorage UUID + 暱稱
├── components/
│   └── Sparkline.tsx      # 折線圖元件
├── version.ts             # APP_VERSION + CHANGELOG（遊戲內更新日誌）
└── App.tsx                # 路由：home / daily / random / custom / game
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
| Phase 7 | 🟡 測試中 | TWA 打包上架（手動 Android Studio）+ Google Play 內部測試 + 全螢幕 immersive 調整中 |

---

## 9. Android TWA 專案配置

### 9.1 專案位置

| 項目 | 路徑 |
|---|---|
| Repo 內 Android | `android/`（git 已追蹤） |
| Android Studio 專案 | `C:\Users\tyl16\AndroidStudioProjects\TaiexRider\` |
| Keystore | `C:\Users\tyl16\Documents\taiexrider-release.jks` |

> ⚠️ `android/` 與 Android Studio 專案**不會自動同步**。改了 `android/` 內的檔案必須手動複製到 Android Studio 路徑，再重新 Generate Signed Bundle。

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

---

## 12. 測試提醒

preview / 隱藏分頁 `document.hidden=true` → `requestAnimationFrame` 暫停 → 主迴圈停住（看起來車不動）。

用 `window.__test`（僅 DEV 模式）手動步進驗證：
```js
window.__test.step(60)   // 步進 60 幀
window.__test.press()    // 模擬按下
window.__test.release()  // 模擬放開
window.__test.state()    // 取得目前物理狀態
window.__test.reset()    // 重置
```
