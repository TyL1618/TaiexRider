# 7/6（禮拜一）起分批處理清單（2026-07-04 晚盤點）

> 使用者 2026-07-04 19:37 要求：把所有還沒做的事（資安 + 遊戲內容）記住並分批次分組，
> 7/6 起一批一批處理（不分優先順序，依「該一起做/該一起測」邏輯分批）。
> 7/6 可能換公司電腦開工——**這份清單是唯一事實來源**，開工先讀這份，讀完再讀 CLAUDE.md「目前進度」。

---

## 批次 1 — 錢包收尾（最急，2026-07-04 晚剛做完 migration 但還沒生效/驗證）

- [ ] Supabase SQL Editor 跑 **`supabase/migration_20260705.sql`**（`player_wallet` 等三表 + 六個 RPC）。
      跑之前已登入玩家的購買/發幣/次數限制 RPC 呼叫會靜默失敗（不影響遊戲，但也還沒有伺服器保護）。
- [ ] 跑完後用真實 Google 帳號（`tyl161803@gmail.com`）登入真機/桌機驗證一輪：
      買車扣款是否正確、完賽/摔車/任務/看廣告是否有進帳、清 localStorage 後擁有清單還在、
      每日排名賽第 6 次挑戰是否被伺服器擋下。
- [x] **修登出沒清快取的 bug + 帳號污染三合一修復** 已完成（2026-07-06，migration_20260706.sql）。
      背景：2026-07-05 晚發現不只是「登出沒清快取」，而是暱稱（`taiex_player_name`）、
      Q 系列成就（`tr_achv_market`）、streak（`tr_daily_streak`）三個裝置共用 key
      都不分帳號也不清，且 Garage.tsx 的自動解鎖邏輯會把「裝置上另一個帳號留下的假進度」
      誤寫進「目前登入帳號」的伺服器擁有清單（已發生於 tommyisboy08@gmail.com 測試帳號，
      使用者已手動 SQL 清除）。修法三塊一次做：
      ① 暱稱改 DB 權威：新增 `get_player_name()` RPC，登入時 `auth.ts initNicknameFromGoogle()`
         優先拉伺服器 `user_profiles.player_name` 蓋掉本地，伺服器沒有才 fallback 舊邏輯。
      ② 錢包/成就/streak 登出全部歸零：`auth.ts signOut()` 呼叫 `resetPlayerName()` +
         `garage.ts resetWalletCache()`（內含金幣/鑽石/擁有清單/裝備車皮 + achievements/streak）。
      ③ 成就/streak 徹底搬 DB（不只是清快取，是把權威來源換掉）：新增
         `player_achievements`/`player_streak` 表，完賽時 `record_market_finish()` RPC 伺服器
         自己重算當期 TAIEX 漲跌（不信任前端傳的 mood）累加 bull/bear finish；進每日排名賽時
         `consume_attempt()` RPC 順便更新 streak；**`wallet_unlock_achievement()` 改成伺服器自行
         驗證門檻**（v1 只信任客戶端宣稱「達標了」就給，這正是 tommyisboy08 誤解鎖的根本路徑，
         v2 這支 RPC 現在會自己查 player_achievements/player_streak 是否真的達標，不管客戶端
         傳什麼都無法騙到）；`wallet_dev_grant()` 一併灌好開發者測試帳號的成就/streak，取代
         舊版前端 `devSetProgress()`/`devForceStreak()` 純本地寫死。
      typecheck 過，preview 驗證訪客路徑（首頁/車庫/每日挑戰頁）無回歸、零 console error。
      **⚠️ 已登入路徑（暱稱同步/成就解鎖/streak/開發者帳號灌值）preview 無法測（需真實
      Google OAuth），需使用者真機/桌機用兩個帳號交叉驗證：A 帳號改暱稱→登出→B 帳號登入
      暱稱應顯示 B 自己的、不會看到 A 的殘留；A/B 互換都不會看到對方的 Q 車款解鎖進度。**
      **⚠️ 待使用者在 Supabase SQL Editor 手動跑 `supabase/migration_20260706.sql`**（新
      RPC/表不存在前，暱稱/成就/streak 維持舊的純本地行為，不影響遊戲能不能玩，但污染
      問題不會被修好）。
      **⚠️ 另有一次性資料清零 SQL**（使用者要求：不確定封測期間有沒有測試者已經在玩，
      要把除了 tyl161803@gmail.com 以外所有玩家的金幣/鑽石/車庫/成就歸零)，見對話紀錄
      /當次 commit 訊息附的 SQL，跑一次即可、不進 migration 檔案（一次性操作不需要留存重跑）。

## 批次 2 — 其他資安收尾（優先度中）

- [ ] 確認 `taiexrider-release.jks` 檔案本體已備份雲端（密碼已確認兩地備份，檔案本體之前暫緩）。
- [ ] Play Console 上架前目視確認：手機截圖用新版地形（v0.12.x）重截、資料安全性表單補
      「App 互動資料（匿名遊玩統計）」聲明（見 [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md)）。
- [ ] `daily_scores`/`classic_records`/`daily_map`/`keep_alive` 的 RLS SELECT policy 補
      `to anon, authenticated`（目前只授 `anon`，靠 VIEW 繞過沒壞，但屬脆弱設計）。
- [ ] dev 依賴 esbuild/vite 2 個已知漏洞升級（需 vite@8 breaking change，只影響本機
      `npm run dev`，非上架風險，排正式上架後）。
- [ ] `daily_death_heatmap` RPC 效能：正式上架玩家多了之後評估要不要加 materialized view 快取。

## 批次 3 — 反作弊 Phase B/C（工程量大，建議正式上架後）

- [ ] Phase B：DB 端同帳號提交頻率離群偵測。
- [ ] Phase C：完整操作事件序列驗證 + Ghost 回放（跟留存規劃的 Ghost 回放一起設計，見
      [ANTICHEAT_DESIGN.md](ANTICHEAT_DESIGN.md) 第四層）。

## 批次 4 — 車庫/商業化

- [ ] 鑽石購買頁（花台幣分別買鑽石/金幣，兩個獨立按鈕）。
- [ ] Google Play Billing（IAP）真串接，含購買憑證伺服器端驗證（現在的鑽石扣款機制本身
      不是真錢驗證，只防「改本地數字」，見 SECURITY_REVIEW.md 對應段落）。
- [ ] P3~P5 三台鑽石車款生圖 + 登記進 `wallet_spend_skin` 白名單（同時更新 `garage.ts` 的
      `BIKE_SKINS`）。
- [ ] 廣告真實串接（AdMob Rewarded / AdSense Interstitial），取代現在直接發幣的 stub
      （`ads.ts` 的 `requestRewardedCoins()`）。

## 批次 5 — 留存規劃第二批（部分需使用者點頭 schema，見 [RETENTION_PLAN.md](RETENTION_PLAN.md)）

- [ ] 經典模式 Top N + 百分位排名（需 schema/RPC 變更）。
- [ ] 經典模式週榜（需 schema/RPC 變更）。
- [ ] 週任務（**2026-07-06 更新：改小量 schema，待點頭**——進度若只存 localStorage，換帳號/裝置會歸零，跟暱稱/成就/streak 同一類問題，詳見 RETENTION_PLAN.md）。
- [ ] 股票圖鑑（**2026-07-06 更新：改小量 schema，待點頭**——本質是長期收集功能，只存本地換帳號等於整本圖鑑歸零，詳見 RETENTION_PLAN.md）。
- [ ] 狂暴盤日事件（大盤大振幅時獎勵倍率公告，已定案用金幣加成不用分數加成避免碰計分公平性，**維持零 schema**——每天重新判斷、無跨裝置狀態，不受換帳號影響）。
- [ ] 歷史紀念日彩蛋（經典關卡對應日期免費開放/雙倍獎勵，零 schema）。

## 批次 6 — 留存規劃第三批（長期，工程量大）

- [ ] 週聯賽分組（30 人小組升降級，等 DAU 有規模才有意義）。
- [ ] Ghost 鬼影賽跑（跟反作弊 Phase C 一起做）。
- [ ] 排行榜 emoji 反應。
- [ ] 好友邀請比較。
- [ ] 週五馬拉松（串連一週 5 天賽道）／月更節奏公告。

## 批次 7 — 明確延後但要記住的項目

- [ ] Web Push 通知（中期，需先申請 Firebase/FCM 專案）。
- [ ] 殼版本更新提示（使用者明確要求正式上架後才做，設計見 DEVDOC §9.5b）。
- [ ] 網頁版偷玩對策（`taiexrider.pages.dev` 公開網址技術上封不掉，MVP 不值得做，已接受現實）。
- [ ] ETF 代號（00981A 等）納入每日地圖（一行 regex 改動：`/^\d{4}$/` → `/^\d{4}[A-Z]?$/`）。

## 批次 8 — 正式上架當天才動手

- [ ] 清空伺服器所有玩家「玩過的遊戲數據」（`daily_scores`/`daily_scores_ranked`/
      `classic_records`/`events`），**但絕對不能清已註冊 Google 帳號/`user_profiles`**——
      只清紀錄不清帳號。動手前務必逐表跟使用者確認要清哪些 schema，不要自行判斷範圍
      （2026-07-04 使用者交代，見 CLAUDE.md 待辦第 9 項）。

---

## 已明確決定不做的（避免誤判成漏做）

- BETA #4 前翻/煞車鈕操控——2026-07-04 使用者已決定取消，見 [BETA_FEEDBACK.md](BETA_FEEDBACK.md) #4。
