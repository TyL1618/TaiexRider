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

### 🔖 跨機器交接（2026-06-15 收工 → 明天公司電腦續做）

**整體狀態**：Phase 0 ✅ ／ Phase 1 ✅（單鍵手感已調到好玩）／ **Phase 2 進行中**（已接真實台股資料＋選賽道畫面，4 條真實賽道可玩）。可玩版已全部 push，`git clone`／`git pull` 即可續做。**開工第一件事：`git pull`**。

#### 🆕 2026-06-15 午後大改（Opus，已全部完成並部署）
- **核心操控＝「按住才恆速前進」（Rider 風格，非自動跑）**：
  - **著地 + 按住** → 沿「車身朝向(≈坡面)」方向用 `Body.setVelocity` 平滑鎖定到 `cruiseSpeed`(9)。**鎖的是沿坡速度不是水平速度** → 上坡/下坡/平路速度一致（解決「平路快、坡面慢」）。
  - **著地 + 放開** → 不給動力，依坡度自然滑行/減速/停。
  - **空中 + 按住** → 後空翻（唯一空中作用）。
  - 不再用 force/torque 驅動（那是頓挫與 wheelie 的根源）。著地角速度阻尼 0.5x+硬夾 ±0.12 防甩晃立車。
  - 重力 `engine.gravity.y` 1→1.5（車變重、落地乾脆）；連帶 `airSpinMax` 0.12→0.18、`airSpinAccel` 0.006→0.009（補滯空變短）。
- **坡度上限 `maxSlopeDeg` 60→40**：>45° 在定速下車會立起甩晃，夾到 40° 才能貼坡滑。
- **完美落地改判定**：必須「雙輪同時觸地 + 正立 + 真實滯空」（原本只看車身角度→坡上狂誤判，已修）。
- **賽道還原原始折線**（Catmull-Rom 平滑版已砍除，因效果不佳）。
- **手機反藍修正**：index.css 加 `-webkit-tap-highlight-color: transparent`。
- **UI 重構**：右上「返回主選單」、左上設定 icon（音量待實作/顯示版本）、移除 R 鍵、overlay 改「再玩一次」、底部提示「按住=前進・空中按住=後空翻」。
- **首頁**：排序鈕（熱門/困難度/股號）、搜尋框（限預抓股票）、困難度星級、「昨日盤線」→「前次日盤」。
- ⚠️ **仍待真人試玩確認**：`cruiseSpeed`(9) 速度感、重力(1.5)份量、後翻轉速、沿坡恆速在折線過陡段是否順。

#### 仍待辦（依重要性）
- 重生點 / 看廣告復活（死前幾公尺重生）— 廣告需 Phase 7。
- 紫色霓虹配色（效仿 Rider 風格，目前是 cyan 底）。
- 自由搜尋任意股號 → 需 Phase 4 後端解 CORS。
- 賽道長度（一局 1~2 分鐘）、更多股票樣本。

#### 真人試玩回饋（2026-06-15 晚）→ 部分已處理

1. **賽道太短 → 希望一局 1~2 分鐘**（分數核心＝把握每個旋轉機會）
   - 現況：真實樣本 50~110 點、約 50~90 秒。
   - 方向：個股抓更多月份／大盤少降採樣（調高 `scripts/fetchTwse.ts` 的 `TARGET_POINTS`）；或加大 `TRACK.segmentWidth`。跳台越多越好（和第 4 點一起調）。

2. **納入證交所所有上市股票，未來甚至加美股**
   - 現況：4 檔寫死樣本（TAIEX/2330/0050/2454）。
   - 方向：`STOCK_DAY_ALL` 可列全部上市代號（做清單／搜尋）；個股歷史逐檔用 `STOCK_DAY`。⚠️ **瀏覽器直接抓 www.twse.com.tw 會被 CORS 擋 → 即時/自由搜尋要等 Phase 4 後端代抓**；現階段可先預抓一批熱門股打包。美股＝另一資料源（更後面）。

3. **遊戲結束後鏡頭拉遠，顯示前一天完整股市圖**（增加參與感）
   - 新功能：摔車/完賽 overlay 時，camera 平滑拉遠到框住整條賽道、顯示完整走勢線（「這是昨天的台積電」）。
   - 動 `GameCanvas` 的 camera：結束狀態時 lerp 到 fit 全 `track` bounds（minY/maxY/finishX 已有）。

4. **2454 實際騎起來「超平坦」不狂野 → 振幅/採樣要按比例**
   - 根因：`pricesToTrack` 把每條賽道都正規化到**固定** `heightRange`(340px) 又夾平 60° 斜率 → 不管波動大小看起來都一樣高，所以狂野股不狂野。先前報的「點間 %」是數據面、沒反映到畫面。
   - ⚠️ 這其實是**修正先前「原汁原味」的決定** → 改成「讓波動度真實反映在地形高低」。
   - 方向：(a) `heightRange` 隨該檔實際波動度**按比例放大**；或 (b) 降低降採樣/縮小 `segmentWidth` 讓單一變化更尖；或 (c) 放寬斜率夾平。
   - ⚠️ 與第 5 點互相拉扯：要更陡更刺激 vs 要爬得上去 → 需平衡（例：上坡可爬、下坡跌停做成陡跳台）。

5. ~~**陡坡爬不上去卡住**~~ ✅ **已修（2026-06-15）**
   - `accel` 0.0022→0.003、`uphillBoost` 2→5、速度門檻 2.5→8 px/step（`constants.ts`）

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
