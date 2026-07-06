# 7/6（禮拜一）起分批處理清單（2026-07-04 晚盤點）

> 使用者 2026-07-04 19:37 要求：把所有還沒做的事（資安 + 遊戲內容）記住並分批次分組，
> 7/6 起一批一批處理（不分優先順序，依「該一起做/該一起測」邏輯分批）。
> 7/6 可能換公司電腦開工——**這份清單是唯一事實來源**，開工先讀這份，讀完再讀 CLAUDE.md「目前進度」。

---

## 批次 1 — 錢包收尾（2026-07-06 上午確認：兩份 migration 皆已在 Supabase 跑過）

- [x] Supabase SQL Editor 已跑 **`supabase/migration_20260705.sql`**（`player_wallet` 等三表 + 六個 RPC）
      **與 `supabase/migration_20260706.sql`**（`player_achievements`/`player_streak` + 改造版 RPC）。
      **2026-07-06 用公司電腦的 anon key 直接打 Supabase REST API 驗證**：所有表/RPC 皆回應
      `42501 permission denied`（= 存在但只開放 `authenticated` 角色呼叫，設計如此）而非
      `PGRST202 找不到函式`，證實兩份 migration 都已生效，不是只有 commit 沒有真的執行。
- [x] **真機驗證已完成**（2026-07-06，使用者確認正常）：買車扣款、完賽/摔車/任務/廣告進帳、
      清 localStorage 後擁有清單保留、每日排名賽第 6 次挑戰被伺服器擋下，皆 OK。批次 1 全部完成。
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
      **✅ migration_20260706.sql 已確認跑過**（見上方批次 1 開頭 2026-07-06 驗證結果）。
      **這裡指的一次性清零 SQL（僅金幣/鑽石/車庫/成就，因 tommyisboy08 污染事件而起）是否已跑
      仍未確認**——待確認是否已執行過，或直接等批次 8 正式上架當天的全面清零一次做掉即可
      （批次 8 範圍更大，含排行榜+經典成績，2026-07-06 使用者已補充確認）。

## 批次 2 — 其他資安收尾（2026-07-06 盤點：可 code 處理的項目已確認完成）

- [x] `taiexrider-release.jks` 雲端備份——**使用者已連續確認一週完成，本清單先前重複列成待辦是
      文件沒同步更新，2026-07-06 更正**。之後不再列入待辦。
- [x] `daily_scores`/`classic_records`/`daily_map`/`keep_alive` 的 RLS SELECT policy 補
      `to anon, authenticated`——**查證後發現這件事其實早在 `migration_20260702.sql`
      就已經做過**（policy 改名 `read scores`/`read classic`/`read daily_map`/`read keepalive`，
      四張表 policy 皆含 `to anon, authenticated`），而該份 migration 已於 2026-07-02 確認執行過
      （2026-07-06 用 REST API 打 `events`/`user_profiles` 驗證存在）。本清單這一項是舊的
      SECURITY_REVIEW.md 建議與後續 migration 重複記錄，2026-07-06 確認後結案，不需要新 migration。
- [ ] Play Console 上架前目視確認：手機截圖用新版地形（v0.12.x）重截、資料安全性表單補
      「App 互動資料（匿名遊玩統計）」聲明（見 [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md)）。
      **需要使用者手動在 Play Console 操作，非 code 任務，Claude 無法代做**。
- [ ] dev 依賴 esbuild/vite 2 個已知漏洞升級（需 vite@8 breaking change，只影響本機
      `npm run dev`，非上架風險，**已決定排正式上架後**，本批次不動）。
- [ ] `daily_death_heatmap` RPC 效能：**已決定等正式上架玩家量上來再評估**，本批次不動
      （目前沒有效能問題可測，貿然加 materialized view 是過度工程）。

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

## 批次 5 — 留存規劃第二批（2026-07-06 動工，四項全數完成，見 [RETENTION_PLAN.md](RETENTION_PLAN.md)）

- [x] **狂暴盤日事件** 已完成（v0.12.29 已推，`supabase/migration_20260706b.sql`）。門檻取
      2.5%（用 TAIEX 近 2 年 482 交易日實測資料校準：2% 出現機率 14.9%／約每週一次太常見，
      2.5% 出現機率 10.0%／約兩週一次，使用者拍板）。首頁公告「⚡ 狂暴盤：今日任務獎勵 ×2」，
      伺服器端 `wallet_earn('quest')`/`claim_weekly_quest()` 各自呼叫共用的
      `taiex_change_pct()` 重算當期漲跌決定是否加倍，不信任前端。**⚠️ 待使用者跑 migration**。
- [x] **股票圖鑑** 已完成（v0.12.29 已推）。`player_collection` 表（每人一列存已收集代號
      陣列，天生封頂在股票池總數 ~1090，不隨玩家數爆炸，永久不清除）+ `collect_stock()` RPC，
      `wallet_get()` 一併帶回收集清單（沿用既有同步呼叫點）。App.tsx 完賽/摔車時依
      `track.kind==='stock'` 收集（長征模式一次收 5 支），車庫頁顯示「📖 圖鑑 N / 總數 支已收集」。
      規則確認：跟哪天盤勢無關，同一支重複玩不重複計。**⚠️ 待使用者跑 migration**。
- [x] **週任務** 已完成（v0.12.29 已推）。`player_weekly_quest` 表（每人每週一列，仿
      `wallet_earn_log` 保留最近 8 週即清除）+ `record_weekly_run()`/`claim_weekly_quest()`/
      `get_weekly_quest()` RPC，任務池仿每日任務放大成週尺度（翻轉 30 圈／完美 10 次／
      單局 2000 分／10 場遊戲／撐 25 秒，3 選其一 seeded），每日排名賽頁面新增「🗓️ 本週任務」
      卡片（跟每日任務並列不衝突）。**⚠️ 待使用者跑 migration**。
- [x] **經典模式前三名** 已完成（v0.12.29 已推），取代原本的「Top N + 百分位排名」規劃——
      使用者 2026-07-06 拍板簡化：不算百分位、不需要存全部玩家成績，只留每關前 3 名，
      同玩家用更新覆蓋不佔位。`classic_records` 主鍵改 `(level_id, player_id)`，
      `submit_classic_record()` 提交後裁剪到前 3 名，表大小恆定＝關卡數 × 3（目前 12 關＝
      36 列上限），不隨玩家數增長。`ClassicSelect.tsx` 卡片顯示 🥇🥈🥉。**⚠️ 待使用者跑
      migration**（跑之前沿用舊資料/舊行為，不影響遊戲能不能玩）。
      **經典模式週榜仍未做**（獨立功能，今天沒有討論到，維持待規劃）。
- [x] ~~歷史紀念日彩蛋~~：**使用者 2026-07-06 決定不做**——效益不大，且慶祝日期（如金融
      海嘯週年）沒辦法涵蓋全年，不再列入待辦。

**⚠️ 使用者待辦**：Supabase SQL Editor 跑 **`supabase/migration_20260706b.sql`**（一次跑完
上述四項全部的表/RPC）。preview 已驗證訪客路徑（首頁無狂暴盤/車庫圖鑑計數器 0/總數/每日排名賽
兩組任務並列/經典模式沿用舊資料顯示 1 筆）零 console error；已登入路徑（狂暴盤加倍、圖鑑
實際收集、週任務伺服器同步、經典前三名多筆顯示）跟以往一樣 preview 無法測已登入流程，
需使用者真機/桌機用真實帳號跑一輪確認。

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
      **2026-07-06 使用者補充確認**：
      - 時程＝**最可能 7/8 申請正式上架**，但實際跑清零 SQL 是**上架當天**才做，
        可能還會再拖好幾天，不要以為 7/8 一到就該自動執行——**使用者會自己手動跑**，
        不是 Claude 主動觸發。
      - **每日排名賽歷史紀錄（`daily_scores`/`daily_scores_ranked`）從封測開始至今
        從未清過**，裡面全是測試期間累積的舊資料，正式上架清零時必須包含在內。
      - **經典模式所有人的成績（`classic_records`）也要清空**，不只是死亡熱點/events。
      - 目標＝整個遊戲（排行榜+經典成績+統計事件）回歸到路人拿到手是全新乾淨的狀態，
        帳號本身不動。

---

## 已明確決定不做的（避免誤判成漏做）

- BETA #4 前翻/煞車鈕操控——2026-07-04 使用者已決定取消，見 [BETA_FEEDBACK.md](BETA_FEEDBACK.md) #4。
