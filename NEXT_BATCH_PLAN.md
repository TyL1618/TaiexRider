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
- [ ] **修登出沒清快取的 bug**（2026-07-04 晚發現，尚未修）：`src/lib/auth.ts` 的 `signOut()`
      只呼叫了 GSI cancel + `supabase.auth.signOut()`，**完全沒清除 `garage.ts` 的 localStorage
      錢包快取**（`tr_garage_coins`/`tr_garage_diamonds`/`tr_garage_owned`/`tr_garage_active`）。
      症狀：用開發者帳號（99999 金幣+鑽石、裝備某車皮）登出後，首頁仍顯示舊數字/舊車皮，
      要跳到其他頁面再回來才會（似乎）恢復預設——但追蹤程式碼後**找不到任何地方會真的清空
      這幾把 localStorage 鑰匙**，`Home.tsx` 的 `getCoins()`/`getActiveBikeSkin()` 是 render
      時直接讀 localStorage，`user` 變 `null` 只會觸發重新渲染、讀到的還是同一份沒被清過的
      舊快取。修法：登出確定當下，把這幾把鑰匙重置回訪客預設值（金幣 0／鑽石 0／擁有清單只剩
      `["default"]`／裝備車皮回 `default`），單靠這個重置 + 既有的 `user` 觸發重渲染就夠，
      不一定需要額外 `window.location.reload()`（reload 不會清 localStorage，單獨加沒用）。
- [ ] **討論決定要不要處理「切換 Google 帳號不刷新」**：這個無法只靠 reload 解決——
      Supabase 的 `onAuthStateChange` 綁的是 session 生命週期，不是瀏覽器目前登入哪個 Google
      帳號；不主動重新走一次 `signInWithGoogle()` 流程，app 完全偵測不到帳號已經換了。
      工程量比登出清快取大（需要主動重新驗證登入狀態），7/6 討論值不值得做。

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
- [ ] 週任務（零 schema，純前端 + localStorage）。
- [ ] 股票圖鑑（零 schema，記錄騎過哪些股票代號）。
- [ ] 狂暴盤日事件（大盤大振幅時獎勵倍率公告，已定案用金幣加成不用分數加成避免碰計分公平性，零 schema）。
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
