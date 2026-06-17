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

### 🔖 交接（2026-06-17 v0.6.0 — Phase 4 排行榜 MVP 完成）

**開工第一件事：`git pull`。**

> **Phase 4 完成（排行榜 MVP）**：每日排名賽成績上傳 + 排行榜讀取全通。
> - **Supabase**：新帳號 + 新 org（TaiexRider FREE），project ref `cjnwwtrpveejhbwalncy`，region Tokyo。`supabase/schema.sql` 已跑（`daily_scores` 表 + `submit_daily_score` RPC + RLS + `keep_alive`）。
> - **環境變數**：`.env`（本機，不進 git）+ GitHub Actions Secrets（`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`）→ `deploy.yml` 已加 `env:` 讓 Vite build 時嵌入。
> - **成績提交**：`GameCanvas` 新增 `onGameOver?(stats: GameOverStats)` callback（完賽/摔車各觸一次）；`App.tsx` 判斷 `isDailyRun` → 呼叫 `submitDailyScore`；`timeMs` 送出前 `Math.round`（避免浮點數打 Postgres `int` 400）。
> - **暱稱輸入**：`DailyChallenge` 加暱稱欄位（預設隨機名、最長 16 字、即時存 localStorage）。
> - **cron-job.org 保活**：每日 ping `daily_scores?limit=1`，200 OK 驗證通過。
> - **真機驗證**：成績寫入 `daily_scores`，排行榜畫面正確顯示（分數→時間排序，前 100 名）。

> **🟠 下一步選項**：
> - Phase 5：PWA 離線快取（Service Worker + IndexedDB）
> - Phase 6：視覺/音效打磨
> - Phase 7：TWA 包裝 + Google Play 上架
> - 或繼續補 Phase 4 強化：Google 登入綁定、後端合理性檢查防作弊、後端權威下發每日地圖

---

### 🔖 交接（2026-06-16 v0.4.2 — 填滿地形 + discussion 14 點處理）

**開工第一件事：`git pull`。**

> **真機試玩回饋（已修，v0.4.1 + v0.4.2）**：使用者真機確認「整體非常像 Rider、流暢、K 棒風格 OK、返回邏輯正確」。修掉的 bug：
> - **卡 K 棒縫隙（高處落下偶發）**＝Matter.js internal-edge 卡頓。**兩段式修法**：
>   - **v0.4.1**：梯形**底部兩角各外擴 `overlap=segmentWidth`**（上窄下寬），相鄰梯形接縫正下方重疊成實心聯集 → 消除外露垂直內部邊。node 實測峰/谷 union 頂面與折線誤差=0，手感視覺不變。（大幅降低但仍極低機率殘留）
>   - **v0.4.2（root fix）**：`bike.ts` chassis 改 `collisionFilter:{ group, mask:0 }` → **車身完全不碰地、只由雙輪碰地**（Hill Climb 標準）。少了會在接縫頂點被夾的 chassis 碰撞體即根治。填滿地形無縫，故車身不碰地不會穿落。**注意**：`chassisContacts` 現恆 0（不影響著地判定，用前後輪）。
> - **首頁標題與排行榜/設定鈕重疊** → `.select-screen` padding-top 3.8rem；**遊戲內暫停鈕與返回鈕重疊** → `.pause-btn` top 3.4rem。
> - #7 決策：只做 robots.txt 不索引＋不宣傳網址；認 Play 包 Token 留到最後期。#8 資安僅記錄，以後處理。

> **本次大改（v0.4.0）**：依使用者整理的 `discussion.md`（14 點）一次處理。核心＝**地形碰撞體從「旋轉矩形沿法線偏移」改為「實心填滿梯形」**（使用者提案，視覺 A = K 棒柱）。

**v0.4.0 已完成（對應 discussion 編號）：**
- **#2/#4/#12 地形填滿（根治隱形牆／卡轉折）**：`buildTerrainBodies` 改成每段一個 `Bodies.fromVertices` 凸梯形——上緣=折線、兩側垂直、下緣拉到 `maxY+800`。相鄰梯形共用垂直邊 → 零縫、零凸角、頂面=折線本身。已用 node 實測 `fromVertices(Vertices.centre,...)` 世界頂點與輸入完全吻合（單一凸 part）。舊「矩形法線偏移」造成的頂點翹角＝隱形牆，已消除。**注意**：`buildTerrainBodies(track)` 不再吃 thickness 參數。
- **視覺 A**：`drawTrack` 每段填成 K 棒柱（漲紅/跌綠/平青，頂部實往下淡出）＝所見即所撞。若覺得醜可改 B（只留頂線）/C（漸層），fill 顏色在 `constants.ts` COLOR.fillUp/Down/Flat*。
- **#3 線段顏色**：`terrain.ts` 改用**最終頂點 y 方向**上色（dy<0=紅/dy>0=綠/平=青），不再用原始 price（夾平後會與視覺坡向不符）。
- **#1 死亡門檻**：新增 `RULES.crashTipCos=0`，crashZone 只在車身**翻過 90°**（cos<0）才啟動，與 `uprightCosThreshold`(0.55，後空翻計分用)分離。爬陡坡前傾不再被戳死。
- **#5 分數不倒退**：新增 `maxDistScore`，行進分只增不減（向後滑不扣回）。
- **#9 完賽顯示**：新增 `totalFlips`/`perfectLandings`，結算畫面顯示「翻轉 N 圈・完美落地 N 次」。
- **#11 首頁設定鈕**：右上版本號 → ⚙ 設定 modal（音量待實作＋版本＋更新日誌入口）。
- **#13 暫停＋返回確認**：遊戲右上「返回主選單」下方加暫停/繼續鈕（彈窗/暫停時凍結物理＋計時）；遊玩中按返回→確認彈窗；**裝置返回鍵**（popstate）：遊戲中→確認離開賽道、首頁→確認離開 App（leavingRef + `history.go(-2)`）。
- **#14 排行榜佔位**：首頁左上 🏆 排行榜鈕 → 「敬請期待」modal。

> **⚠️ 待真機驗證**：#13 裝置返回鍵（popstate 攔截）桌機 build/typecheck 過，但 **Android/TWA 實體返回鍵需真機測**。preview 隱藏分頁 rAF 暫停，無法驗證遊玩；用 `window.__test` 手動步進或真人可見分頁玩。
> **🟠 仍待討論（見對話末）**：#7 網頁版偷玩、#8 資安、#10 每日挑戰+廣告+IAP → 已記錄於「未來規劃」。另 chassis `mask=0`（只讓輪子碰地）為填滿方案的**備援保險**，本次未做（先看填滿是否已足夠）。

---

### 🔖 交接（2026-06-16 凌晨 v0.3.7）

**開工第一件事：`git pull`。**

> **⚠️ 圖片注意**：`public/bike.png`（610×409 去背霓虹重機）已在 repo，貼圖生效。
> 對位微調參數：`BIKE.spriteW / spriteOffsetX / spriteOffsetY`（在 `src/game/constants.ts`）。

> **⚙️ 驅動模型（重要）**：使用者確認 **Rider 是「街機定速」**—— 地面速 = 空中速 = 固定 N，不需要 boost。
> 故移除整個 launchBoost / groundedStreak 系統；低重力 0.3 取代 boost 給予充足空中翻轉時間。

**目前驅動 / 手感（定速引擎 + 兩輪取坡）：**
- **驅動（坡面切線鎖速）⭐ 核心模型**：著地按住 → 取「後輪→前輪連線方向（坡面切線，tx 永遠 > 0 = 恆朝前）」的速度分量，ease 到 `cruiseSpeed=5.76`（`groundLockEase=0.7`）。任何坡角同速；過坡頂保留垂直速度 → 自然飛出去。無 boost，地面速 = 空中速。
- **法線速度歸零（吸地消彈跳）**：著地時每步把「垂直坡面朝外」的速度分量歸零（法線=(ty,-tx)，只移除 vn>0 的離坡分量）。消除 Matter.js 碰撞微彈。
- **低重力**：`engine.gravity.y = 0.5`（飛行時間長，翻轉窗口寬）。
- **離地歸零殘留角速度**：消除爬坡貼坡帶上來的「莫名往後翻」。
- **空中操控**：按住＝後空翻（`airSpinMax=0.192`、`airSpinAccel=0.024`）；放開＝線性制動 (`airSpinBrakeAccel=0.06`, ~4步停) 再微微前壓（`airNoseForwardAccel=0.0006`、`airNoseForwardMax=0.008`）。
- **前壓配重**：前輪 `frontWheelDensity=0.0030` > 後輪 `0.0012`。
- **落地/對齊**：著地角速度朝坡面切線修正（`groundAlignGain=0.3`，夾 `groundedAvMax=0.15`）；`restitution=0.05`。
- **chassis 改圓形（`Bodies.circle(r=10)`）**：圓形碰撞體接觸力永遠過圓心 → 不產生旋轉力矩 → 不被坡頂稜角頂抖、不自動翻正；`friction=0, restitution=0`；已取消 `mask:0`（原修法造成 chassis 穿地 → constraint 把輪子也帶進縫隙穿落）。
- **地形**：`segmentWidth=80`、`heightRange=420`、`refPct=0.022`；折線維持原汁原味。
- **V 谷平底**：h1×h2 > segW² 的谷底插入 80px 平段。
- **地形碰撞體（零縫隙⭐新）**：矩形（法線偏移貼線）＋每個頂點加圓形（`Bodies.circle(r=13)`）填縫。圓心在頂點正下方 13px、圓頂與地形面齊平，數學上完全填滿任何角度的接縫，無台階。三角形方案（Bodies.fromVertices）已廢棄，因三角頂點附近極細（<1px），速度 6.9px/step 直接隧穿。
- **完美落地**：`airRotation > 1.7π` + 真實跳躍 + 坡面夾角 < `perfectLevelRad=0.55`(≈31°)。坡面角改用 `slopeAt(track, chassis.x)` 取代兩輪插值（更穩定）。計分 = `Math.max(1, flips) × 100`（依圈數，最少 100）。
- **結算迷你圖**：以 `prices[0]`（開盤價）為基準：高於開盤=紅、低於開盤=綠、等於=青；含虛線基準線。
- **結算畫面**：`.overlay-result`（透明讓出中段折線圖區域）；進結算 HUD 全隱藏；完賽車體凍住。
- **死亡判定（⭐車頂碰地即死）**：`BIKE.crashZone`（5 個局部座標點，前擾流→風鏡→油箱→座椅前/後緣）每 step 轉為世界座標，任一點 `worldY > terrainYAt(track, worldX)` → 判死（`crashUpsideDownSec=0.1s` 緩衝消除單幀誤判）。刻意不延伸到尾殼，避免陡坡朝上時屁股誤觸前一段地形。另保留 `stuckMidAir`（雙輪離地 + 速度<0.5）處理卡谷等邊緣情況。
- **`slopeAt` / `terrainYAt` 修正**：改二分搜尋，修正 V 谷插入後 x 不均勻時 `floor(x/segW)` 索引錯誤的既有 bug。
- `public/bike.png` 已就位（610×409 去背），貼圖生效。

**死亡特效（v0.3.4~0.3.5）：**
- 翻車觸發後 0.1s：車身位置爆出 28 顆粒子（琥珀/青/白），速度 1.5-5.5px/step，重力 0.1，1.5s 動畫
- 同時：白色全屏閃光（×0.72/幀）+ 鏡頭震動 8px（×0.82/幀，暫時偏移不汙染 camX/camY）
- `dying=true` 期間：HUD 全隱，鏡頭凍在爆炸現場；1.5s 後進結算
- crashZone 加 `!upright` 前提：正立不觸發，消除山峰刺穿誤判

**結算畫面切換（v0.3.6）：**
- 預設顯示賽道全覽（不疊走勢圖）
- 點擊中段大區域 → 瞬間切換走勢圖（黑底純折線）；再點切回
- 小膠囊 badge 顯示「走勢圖 →」/「← 賽道」提示

**地形碰撞修正（v0.3.7）：**
- 移除頂點填縫圓（`Bodies.circle` at vertices）→ 消除轉折點隱形牆彈射
- 矩形兩端各 +3px（`segLen+6`）重疊取代圓填縫，無凸角、無彈射

**否決狀態更新**：允許「放開＝緩緩前壓」這一種空中自動微旋；其餘不要。

---

#### 🟡 仍待辦

1. **手感 tune**（依試玩回饋調整 `src/game/constants.ts` 的 DRIVE/BIKE/TRACK）
2. （選配）Grok 建議的折線尖角 Catmull-Rom 平滑（本次未做，避免尖角卡輪）
3. ~~**Phase 3（三模式 UI）**~~ ✅ v0.5.0 完成（每日排名賽／隨機拉霸／自選）
4. 更多股票預抓（v0.4.3 已補到 24 支：原 14 + 長榮/陽明/萬海/台達電/日月光/中信金/富邦金/台塑/瑞昱/00878；可再補。指令 `node scripts/fetchTwse.ts monthly <code> 3` + `intraday <code>`，再接進 `tracks.ts`）
5. **v0.4.0 待真人試玩確認**：填滿地形是否徹底消除卡頓／隱形牆；若 chassis 仍偶卡谷底，啟用備援 chassis `mask=0`（只輪子碰地）。
6. **discussion #13 真機測**：Android/TWA 實體返回鍵的 popstate 確認流程。

#### 🟠 未來規劃（discussion 記錄，待決策／Phase 4 後端）

- **#7 網頁版偷玩**：`taiexrider.pages.dev` 永遠公開，TWA 只是包這個 URL，技術上封不掉。對策上限：robots.txt 不索引、不公開宣傳 URL、Phase 4 後端對每日資料加 Token（只認 Play 包請求）。MVP 不值得做，接受現實。
- **#8 資安**：目前純靜態 PWA 幾乎無風險（無後端、無 SQL、資料全公開股價）。風險點在 Phase 4 後端：Supabase RLS 要設對、API key 絕不放前端 bundle（走後端 proxy）。
- **#10 每日挑戰 + 廣告 + IAP（商業模式）**：基本分＝跑完即固定底分；加分＝完美落地次數×N；**同分用時間排名**（越短越前）；死亡→看 15s 廣告復活一次；IAP＝買斷永久去廣告。需 Phase 4 後端 + 排行榜 API；廣告 AdMob、IAP Google Play Billing。**結算已先備好 totalFlips/perfectLandings/timer 三項數據，排名所需欄位齊全。**

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
