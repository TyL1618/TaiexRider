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

### 🔖 交接（2026-06-15，Route B 真物理重寫完，待真人試玩確認）

**開工第一件事：`git pull`。** 本次依使用者明確「動工」指令做。

> **⚠️ 圖片待補**：車體改吃貼圖 `public/bike.png`（去背霓虹重機，整張含輪、輪子不轉）。
> 使用者要手動把圖存到 `public/bike.png`。**檔案還沒進 repo 前，drawBike 自動退回向量備援**（不會壞 build）。
> 確認圖出來後再依 `BIKE.spriteW / spriteOffsetX / spriteOffsetY` 微調對位。

**本次改動（Route B = 拋棄鎖速、改真物理）：**
- **驅動**：廢除 `cruiseSpeed` 鎖速/AWD。著地按住 → 後輪 `setAngularVelocity` 逼近 `driveWheelSpin=1.9`，**只在低於目標時加速** → 下坡靠重力自然超速＝保留動量（這才是平地靠前段下坡累積速度起跳的關鍵）。放開＝滑行。`maxSpeed=22` 防暴衝。
- **前壓配重**（治本翹頭）：前輪 `frontWheelDensity=0.0030` > 後輪 `0.0012` → 重心前移、車頭自然下壓。**純配重，非自動旋轉**（守住使用者否決）。
- **落地貼地**（治本彈跳/翻車）：著地時車身角速度朝 `slopeAt()` 坡面切線比例修正（`groundAlignGain=0.3`，夾 `groundedAvMax=0.28`）；車輪/車身 `restitution=0.05`。
- **空中後翻加快**：`airSpinAccel 0.010→0.030`、`airSpinMax 0.22→0.24`（短滯空也轉得動，配合地形變陡可轉兩圈）。
- **地形變陡**：`segmentWidth 120→80`、`heightRange 340→420`、`refPct 0.03→0.022`（多數股票不再被夾到 heightMin）。
- **前輪突出**：`wheelBaseHalf 18→22`（前輪超出車頭，利於頂折線上坡）。
- 死亡判定不變：`|vx|<0.5 && (throttle||chassisContacts>0)` 持續 2.0s。

**待使用者試玩確認（taiexrider.pages.dev）：**
1. 平地還會不會翹頭後翻？（前壓配重）
2. 下坡能不能累積速度飛起來？地圖夠斜了嗎？（segmentWidth/refPct）
3. 空中能轉兩圈了嗎？（airSpinAccel/Max + 滯空變長）
4. 落地穩穩貼地、不彈跳不翻車？（restitution + slope align）
5. 車速會不會還是太快難控？（driveWheelSpin 可再降）
6. **存好 `public/bike.png` 後**，貼圖對位準不準？

**使用者明確否決**：空中任何自動旋轉都不要（前壓只用配重達成，不可用 torque/角速度自動翻）。

---

#### 🟡 仍待辦（先試玩確認手感，再推進以下）

0. **先試玩** `taiexrider.pages.dev`，確認上面 6 點
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
