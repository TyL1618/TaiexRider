# TaiexRider — 專案守則與進度

> 把台股前一交易日走勢轉成 2D 霓虹機車賽道的單指小遊戲（PWA → TWA 上架 Google Play）。
> 完整設計規劃見 [DEVDOC.md](DEVDOC.md)。

---

## 🔴 開發守則（每次開工都要遵守）

1. **改 code 必同步更新文件並推上 GitHub**
   只要動到程式碼，就要：
   ① 一併更新 [DEVDOC.md](DEVDOC.md)（設計/規格有變動時）與本檔「目前進度」；
   ② `git add -A && git commit` ③ `git push`。
   不要累積一堆改動才一次推——小步提交、隨手 push。

2. **跨機器開發（家裡 / 公司輪流）——以 repo 為單一事實來源**
   - 重要決策、進度、規格 **一律寫進 repo 內的 .md**（CLAUDE.md / DEVDOC.md），因為 Claude 的本機 memory（`~/.claude`）**不會跨電腦同步**。
   - **每次開工第一件事：`git pull`**；收工前確認已 `git push`。
   - 換機器接手時，讀 CLAUDE.md「目前進度」即可無縫接續。

3. **不要污染上層 repo**：本資料夾是獨立 git repo，遠端 = `TyL1618/TaiexRider`。
   上層 `Coding/Project` 是 VictoryMatrix 的 repo，與本專案無關。

---

## 技術棧速查

React 18 + Vite 5 + TypeScript ・ Canvas 2D 渲染 ・ Matter.js 物理 ・
vite-plugin-pwa (Workbox) ・ idb (IndexedDB 快取) ・ Supabase（Phase 4 起）。
資料源＝TWSE 開放端點（後端抓、瀏覽器只讀，避 CORS）。

指令：`npm run dev`（開發）/ `npm run build`（打包）/ `npm run typecheck`。

---

## 目前進度

- **Phase 0 ✅ 完成**（2026-06-14）：Vite+React+TS+PWA 骨架可跑，neon 標題畫面，`tsc -b` 零錯誤，首次 push 完成。
- **Phase 1 🟡 prototype 完成、待真人試玩調手感**（2026-06-14）：
  - 假資料 → 霓虹賽道地形（`terrain.ts`，正規化+斜率夾平）。
  - Matter.js 機車（`bike.ts`，車身+雙輪+軸約束）。
  - 單指操控：著地按住=前進力驅動、空中按住=後翻、放開=滑行/停轉（`GameCanvas.tsx`）。
  - 鏡頭跟隨、後空翻計分、摔車偵測、HUD、結束 overlay、R 重來。
  - 已驗證：可前進、空中可後翻、著地保持正立、無 console error。**手感數值（`constants.ts` 的 DRIVE/BIKE）待真人玩過再 tune**。
- **下一步**：真人試玩回報手感 → 微調 → 進 Phase 2（接真實台股資料）。
- 後續 Phase 2~7 見 [DEVDOC.md](DEVDOC.md) 第 8 節 Roadmap。

### ⚙️ 物理踩雷筆記（避免重蹈）
- Matter.js 對 torque/force 會乘上 `delta²`(~278×)，自訂扭矩極易爆量。**旋轉控制改用 `Body.setAngularVelocity` 直接給 rad/step**（直覺好調），不要用 torque。
- 輪子 `frictionStatic` 別設太高(>3)會黏住不滾。
- 手感參數全集中在 `src/game/constants.ts`。

### 🧪 測試踩雷：preview 分頁是隱藏分頁，rAF 被瀏覽器暫停
- 用 preview 工具驗證時，分頁 `document.hidden=true` → `requestAnimationFrame` 不會 fire → 遊戲主迴圈整個停住（看起來像「車不會動」，其實是迴圈沒跑）。screenshot 也會 timeout。
- 解法：`GameCanvas.tsx` 有 `import.meta.env.DEV` 下的 `window.__test` 鉤子（step/press/release/reset/state），可**手動步進**物理來驗證，繞過 rAF。真人用可見分頁玩則一切正常。

### Phase 1 v2 調整（2026-06-14，依真人回饋）
- 速度 ×1.2；機車→**敞篷跑車**(露頭/小輪/寬輪距低重心)；假資料加**漲停/跌停級跳台**(真實滯空~1.6s)；**雙輪同時著地=完美落地+200**；分數移到**螢幕正中上方**；後空翻/完美落地有 toast。
- 已用 __test 手動步進驗證：前進/真實滯空/後空翻計分(2圈350)/重置 皆正常。車體外觀與手感需真人可見分頁試玩。

### 待 Phase 2 實測確認
- `MI_5MINS_INDEX` 實際回傳欄位格式與解析度（5 分 vs 5 秒）。
- 個股賽道資料長度（固定近 3 個月，或讓玩家選 1/3 個月）。
