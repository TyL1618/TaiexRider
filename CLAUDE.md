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

> **⚙️ 驅動模型轉折（重要）**：Route B 真物理（後輪扭矩驅動）試出來**又慢又爬不上坡**——
> 因為輕的驅動輪拖不動重車身。使用者點明 **Rider 是「街機定速」不是真物理**（平/上/下同速、快但合理、
> 飛出去空中空檔大）。故**驅動改回沿坡面定速**，但**保留 B 的穩定性修正**（前壓配重/落地對齊/低彈性/陡地形）。

**目前驅動 / 手感（定速引擎 + 兩輪取坡 + 速度解耦）：**
- **驅動（維持速度大小、方向交給物理）⭐ 核心模型**：著地按住 → **只把速度大小 ease 到 `cruiseSpeed=7.2`，不動方向**。方向讓物理決定 → 輪子貼地滾＝等速跟地形；凸坡頂地面掉開＝帶動量**自然飛出去**（往右上就飛）；凹谷地面頂住＝不亂飛順順爬。`sp<1`(起步/撞牆/卡谷) → 才沿前輪坡向 `slopeAt(前輪x)` 推一把避免卡死。**＊先前「每步硬設速度方向沿坡面」是 BUG 根源**：到坡頂被硬掰回下坡方向→永遠黏地飛不出去，已廢除。
- **速度解耦（boost 已鎖死）**：地面 `cruiseSpeed=7.2`；離地拉到目標速 `cruiseSpeed×launchBoost≈12`、設上限永不超過。**boost 觸發條件：有按油門 + 速度朝前(vx>0) + 地面連續待夠 `minGroundedStepsForBoost=5`**。沒按/往後/轉折點微彈一律不加速（修「自己亂飛/往後甩」）。
- **離地歸零殘留角速度**：消除爬坡貼坡帶上來的「莫名往後翻」。
- **空中操控**：按住＝後空翻（負向）；放開＝車頭極緩往前壓（`airNoseForwardAccel=0.0006`、`airNoseForwardMax=0.008`，已÷10）。⚠️ 推翻先前「空中不要任何自動旋轉」否決——使用者本次明確要求放開時自動低頭備降。
- **前壓配重**：前輪 `frontWheelDensity=0.0030` > 後輪 `0.0012`（地面防翹頭仍保留）。
- **落地/對齊貼地**：著地角速度朝前輪坡段比例修正（`groundAlignGain=0.3`，夾 `groundedAvMax=0.15`）。新驅動不再硬設方向→對齊目標可達、不會狂追翻過頭（之前 0.28 會狂轉甩飛）；`restitution=0.05`。
- **地形**：`segmentWidth=80`、`heightRange=420`、`refPct=0.022`；折線**維持原汁原味不平滑**（Catmull-Rom 暫不做）。
- **完美落地規則**：先在空中完成翻滾(`flips>0`) + 真實跳躍 + 正立 + **車身與坡面平行**(`|車身角−弦坡角|<perfectLevelRad`)。用「平行」取代「同 step 雙輪觸地」→ 不受兩輪觸地毫秒級時間差影響（先前幾乎觸發不了）。
- **死亡判定（新規則）**：`兩輪都沒碰地板 && 速度<0.5 && 持續 2.0s` → 判死（不管有無按油門）。收掉「卡 V 尖點兩輪懸空不動」「翻車貼地不動」；飛行中有移動→不誤判。（`chassisContacts` 仍在收集但已不用於判死）
- `public/bike.png` 已就位（610×409 去背），貼圖生效；對位調 `BIKE.spriteW/spriteOffsetX/spriteOffsetY`。

**待使用者試玩確認（taiexrider.pages.dev）：**
1. 轉折點還會不會突然爆衝飛出去？（launchBoost 改拉到上限+gate）
2. 銳角 V 谷(<90°)/陡牆，前輪爬得上去了嗎？（前輪領坡）
3. 卡死的死局有正常 2 秒判死嗎？飛行中不會誤判吧？
4. 車速 7.2 好控？飛行距離有保持？過坡頂飛得出去？
5. 空中放開→前壓、按住→後空翻正常？翻滾後平行落地完美落地觸發？
6. 貼圖對位準不準？

**否決狀態更新**：原「空中不要任何自動旋轉」已被使用者本次推翻——現允許「放開＝緩緩前壓」這一種空中自動微旋。其餘仍不要。

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
