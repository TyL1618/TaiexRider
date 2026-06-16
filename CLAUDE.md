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

## 目前進度

### 🔖 交接（2026-06-16，移除 boost + 低重力 0.3 + 地形穿落修正）

**開工第一件事：`git pull`。**

> **⚠️ 圖片注意**：`public/bike.png`（610×409 去背霓虹重機）已在 repo，貼圖生效。
> 對位微調參數：`BIKE.spriteW / spriteOffsetX / spriteOffsetY`（在 `src/game/constants.ts`）。

> **⚙️ 驅動模型（重要）**：使用者確認 **Rider 是「街機定速」**—— 地面速 = 空中速 = 固定 N，不需要 boost。
> 故移除整個 launchBoost / groundedStreak 系統；低重力 0.3 取代 boost 給予充足空中翻轉時間。

**目前驅動 / 手感（定速引擎 + 兩輪取坡）：**
- **驅動（坡面切線鎖速）⭐ 核心模型**：著地按住 → 取「後輪→前輪連線方向（坡面切線，tx 永遠 > 0 = 恆朝前）」的速度分量，ease 到 `cruiseSpeed=5.76`（`groundLockEase=0.7`）。任何坡角同速；過坡頂保留垂直速度 → 自然飛出去。無 boost，地面速 = 空中速。
- **法線速度歸零（吸地消彈跳）**：著地時每步把「垂直坡面朝外」的速度分量歸零（法線=(ty,-tx)，只移除 vn>0 的離坡分量）。消除 Matter.js 碰撞微彈。
- **低重力**：`engine.gravity.y = 0.3`（自然飛行時間長，約 0.7s 陡坡可翻 1~2 圈）。
- **離地歸零殘留角速度**：消除爬坡貼坡帶上來的「莫名往後翻」。
- **空中操控**：按住＝後空翻（`airSpinMax=0.192`、`airSpinAccel=0.024`）；放開＝線性制動 (`airSpinBrakeAccel=0.06`, ~4步停) 再微微前壓（`airNoseForwardAccel=0.0006`、`airNoseForwardMax=0.008`）。
- **前壓配重**：前輪 `frontWheelDensity=0.0030` > 後輪 `0.0012`。
- **落地/對齊**：著地角速度朝坡面切線修正（`groundAlignGain=0.3`，夾 `groundedAvMax=0.15`）；`restitution=0.05`。
- **chassis 碰撞修正**：`friction=0, frictionStatic=0, chamfer=8`（大圓角 + 無摩擦 → 在接縫順滑，不卡）。已取消 `mask:0`（原修法造成 chassis 穿地 → constraint 把輪子也帶進縫隙穿落）。
- **地形**：`segmentWidth=80`、`heightRange=420`、`refPct=0.022`；折線維持原汁原味。
- **V 谷平底**：h1×h2 > segW² 的谷底插入 80px 平段。
- **地形碰撞接縫**：矩形沿「法線往下」偏移半厚度，各斜率頂面精準貼線。
- **完美落地**：`flips>0` + 真實跳躍 + 正立 + 坡面夾角 < `perfectLevelRad=0.7` (≈40°)。
- **結算迷你圖**：以 `prices[0]`（開盤價）為基準：高於開盤=紅、低於開盤=綠、等於=青；含虛線基準線。
- **結算畫面**：`.overlay-result`（透明讓出中段折線圖區域）；進結算 HUD 全隱藏；完賽車體凍住。
- **死亡判定**：兩輪都沒碰地 && 速度<0.5 && 持續 2.0s → 判死。
- `public/bike.png` 已就位（610×409 去背），貼圖生效。

**待使用者試玩確認（taiexrider.pages.dev）：**
1. 不再從折線接縫穿落掉出螢幕？（chassis 碰撞修正）
2. 飛行高度/距離：重力 0.3 是否自然？空中有充足時間翻轉？
3. 沒有 boost 的起步感覺順暢，速度穩定？
4. 結算圖顏色（相對開盤 漲=紅/跌=綠）正確？

**否決狀態更新**：允許「放開＝緩緩前壓」這一種空中自動微旋；其餘不要。

---

#### 🟡 仍待辦（先試玩確認手感，再推進以下）

0. **先試玩** `taiexrider.pages.dev`，確認上面 4 點
1. **手感 tune**（依試玩回饋調整 `src/game/constants.ts` 的 DRIVE/BIKE/TRACK）
2. （選配）Grok 建議的折線尖角 Catmull-Rom 平滑（本次未做，避免尖角卡輪）
3. **Phase 3（三模式 UI）** — 每日挑戰 / 隨機 / 自選賽道入口
4. 更多股票預抓（現有 14 支，可補更多）

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
