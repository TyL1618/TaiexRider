# TaiexRider 全面資安檢查報告（2026-07-02 首輪 ＋ 2026-07-04 第二輪）

> 範圍：前端（React/PWA）、Supabase（RLS/RPC/VIEW）、GitHub Actions/CI 密鑰、TWA/assetlinks、相依套件、金鑰管理。
> 由 Fable 5 執行（FABLE5_HANDOFF 資安任務）。結論先講：**沒有發現可直接遠端入侵或竊資的漏洞**；
> 主要風險集中在「已登入使用者濫用寫入路徑」（作弊/塞爆類），以及一項金鑰管理待確認。

---

## 🔁 2026-07-04 第二輪複查（Fable 5）

> 比照首輪規格重掃一遍，**新增涵蓋**：車庫/金幣（garage.ts、Garage.tsx）、每日任務（quests.ts）、
> streak/medals/achievements/adRewards、看廣告拿金幣 stub（ads.ts）、開發者測試帳號（App.tsx）、
> 分享圖卡（shareCard.ts）、死亡熱點（deathHeatmap.ts + RPC）、隱藏統計頁（admin_stats RPC）、
> 打點（analytics.ts + log_event RPC）。首輪各項狀態變化一併更新。結論：**無新的遠端入侵/竊資面**。

| 等級 | 項目 | 狀態 |
|------|------|------|
| 🟢 已改善 | RPC 物理一致性 + 提交冷卻（首輪 🟠「RPC 濫用面」主體） | **反作弊 Phase A 已實作並上線**（`migration_20260704.sql`，使用者 2026-07-04 已跑；含經典 level_id 白名單，順帶修掉任意字串塞列的污染面） |
| 🟢 已修補 | `log_event` RPC anon 可無限呼叫 → events 表灌爆（DB 膨脹） | **三層節流已實作**（`migration_20260704b.sql`：單 IP 60/分 + 全服 10k/時 + 50k/日，props 上限 2048→512，膨脹絕對上限 ≈ 25MB/天）⚠️ 待使用者跑 |
| 🟢 已修補 | `cleanup_old_scores_if_needed` anon 可呼叫 | **已收權**（同 migration b），改由每日 CI 帶 service key 呼叫（fetchDailyMap.ts）；cron-job.org 的 cleanup 排程可刪、keepalive 保留 |
| 🟢 已上線 | 無 CSP / 安全 headers | **`public/_headers` 已加**：nosniff/XFO DENY/Referrer-Policy/Permissions-Policy 直接執法；CSP 先 **Report-Only** 觀察（怕誤擋 GSI 登入），真機確認 console 無違規後改名轉正（檔內有說明） |
| 🟢 已上線 | GitHub Actions 未 pin SHA（首輪供應鏈潔癖項） | checkout / setup-node 已 pin 到 commit SHA |
| 🟠 已拍板 | 車庫金幣/擁有清單/任務/streak/成就全為 localStorage，可被使用者端竄改 | **使用者 2026-07-04 晚拍板：伺服器端錢包，7/5 動工**（方案細節見 [WALLET_PLAN.md](WALLET_PLAN.md)） |
| 🟡 已拍板 | 每日 5 次挑戰上限純前端（清 localStorage 可繞過） | `consume_attempt` RPC **與錢包同一批（7/5）做**（WALLET_PLAN.md 第 5 項） |
| 🟡 已答覆 | upload keystore 雲端備份 | 使用者 2026-07-04 回覆：密碼公司/家裡皆有記錄；keystore **檔案本體**備份狀態不確定但暫緩（Play App Signing 保底，upload key 遺失可向 Google 申請重置） |
| 🟢 乾淨 | XSS 重掃（含新增畫面）／密鑰／npm audit prod 0 漏洞 | 無需動作 |
| 🟡 dev-only | esbuild/vite dev server 漏洞 2 個 | **不進產品 bundle、只影響本機 dev server**——非上架風險；修復需 vite@8 breaking change，排正式上架後升級（跑 dev 時別逛可疑網站的緩解照舊） |

### 車庫/金幣/任務/成就：localStorage 可竄改（🟠 待決策——使用者不接受擱置）

> **2026-07-04 晚使用者裁示**：「任何影響遊戲的數值竄改都不接受，不管有沒有影響其他玩家」——
> 本節原本的「接受」定位作廢。真解＝伺服器端錢包（金幣餘額/擁有清單存 DB、發幣走 RPC 帶
> 伺服器端驗證與每日上限），需要登入、需要動 garage/quests 客戶端，方案與時機待使用者拍板
> （見文末待辦第 5 項）。以下保留原始風險分析供決策參考。

- `tr_garage_coins`（金幣）、`tr_garage_owned`（擁有車皮）、`tr_quest_progress`（每日任務）、
  `tr_daily_streak`、`tr_achv_market`（Q 系列成就）、`tr_ad_coin_claims_*`（廣告金幣每日 2 次上限）、
  `tr_pb_*`（獎牌 PB）全部存 localStorage，任何人開 DevTools 都能直接改。
- **公平性影響：零**——這些數值不進排行榜、不影響計分、不與其他玩家比較，純個人收藏/習慣迴圈。
  改了只是騙自己，與首輪對「每日 5 次上限」的定位一致。
- **⚠️ 唯一要當真的邊界：P 系列付費車款（真錢 IAP）**。`isOwned()` 目前讀 localStorage 擁有清單，
  若 P 系列上線時沿用同一套（把 P 車 id 塞進 `tr_garage_owned` 就能免費解鎖），等於**收入直接漏光**。
  Google Play Billing 串接時，P 車擁有權必須改為伺服器端驗證（Play Developer API 驗票 or
  Supabase 表記錄 purchase token 驗證後發放），localStorage 只能當顯示快取。已在此立此存照。
- 看廣告拿金幣 stub（`ads.ts requestRewardedCoins()` 現在直接 resolve(true)）＋每日 2 次上限也在前端——
  真廣告 SDK 串接後，「看完才發幣」的 callback 本來就在 SDK/伺服器側，屆時自然收斂，現況接受。

### 開發者測試帳號（App.tsx 明碼 email 比對）

- `tyl161803@gmail.com` 登入時前端自動補滿金幣 99999 + 解鎖 Q 系列成就。email 字串會出現在
  公開 JS bundle 裡——該 email 本來就是隱私權政策公開聯絡信箱，無新增洩漏；效果僅限 localStorage
  （金幣/成就），無排行榜/後端影響。**別人就算改自己的 localStorage 冒充也只是改到自己的收藏**，可接受。
- 後端側的 admin 權限（`admin_stats` RPC）鎖在 Supabase JWT 的 email claim（Google 驗證過），
  前端比對只是 UX 糖衣，權限模型正確。

### 新增 RPC 複查（migration_20260702b + 20260704）

- `daily_death_heatmap()`：純聚合（20 bucket 死亡計數）、不含個別玩家資訊，anon 可呼叫無隱私疑慮。
  每次呼叫全掃當日 death events（時區表達式用不到索引），量大時是小型 CPU 濫用面——目前資料量
  （封測 12 人）可忽略，正式上架後若 events 量大可加 materialized 快取，記錄不動。
- `admin_stats(p_days)`：security definer + email 硬編碼閘門，非 admin 回 null 不留線索；p_days 有 1~90 夾擠。乾淨。
- `log_event()`：白名單 + 欄位上限都在，但 **anon 可無限次呼叫**（每列 props 上限 2KB）→
  惡意腳本可灌爆 events 表（免費方案 500MB）。90 天清理擋不住短時間灌入。
  **→ 2026-07-04 晚已修**（使用者不接受封測期擱置）：`migration_20260704b.sql` 加三層節流
  （單 IP 60/分、全服 10,000/時、50,000/日；IP 取 cf-connecting-ip 優先、XFF 最後一節備援，
  取不到時落 'unknown' 共用桶＝限流變嚴而非失效）+ props 上限 2048→512（實際 payload < 200B）。
  殘餘風險：分散式（多 IP 輪替）灌 `rate_limits` 計數表本身，被每日清理 + 全服上限雙重封頂，
  絕對膨脹上限 ≈ 25MB/天，構不成威脅。
- `submit_daily_score` / `submit_classic_record`（Phase A 版）：欄位間物理一致性驗證 + 10s 冷卻 +
  經典關卡白名單，全部靜默拒絕。上線前已拿線上真實資料回測（27+12 筆，0 誤殺），
  公式與設計文件的偏差及理由見 `migration_20260704.sql` 檔頭。

### 相依套件（npm audit，與 2026-07-02 基準比對）

- **生產依賴：0 漏洞**（`npm audit --omit=dev`，與首輪相同）。
- dev 依賴 2 個：esbuild ≤0.24.2（moderate，dev server 任意讀取——首輪已知接受）＋
  vite ≤6.4.2（因依賴上述 esbuild 被連坐標記）。首輪的 undici/wrangler 項已不在清單（依賴鏈更新後消失）。
  修復仍需 vite@8 breaking change，封測期維持接受，與首輪結論一致。

### 其他複查結果（乾淨）

- **XSS**：全 src 重掃 `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function` 零匹配；
  新增畫面（Garage/StatsScreen/展示框）全走 React 轉義；車皮圖檔路徑來自寫死的 `BIKE_SKINS` 清單非使用者輸入。
- **密鑰**：`.env.local` 確認在 gitignore；repo 內無 service key；`GOOGLE_CLIENT_ID`/anon key 屬設計上公開。
- **深連結 `?goto=`**：白名單四值比對，無 open redirect / 注入面。
- **分享圖卡**：離屏 canvas 自繪 + navigator.share，無外部資源注入面。
- **AdSense 載入**（未啟用）：pub ID 寫死空字串，`loadAdSense` 目前死碼；啟用時 src 由常數組成，無注入面。

### 第二輪待辦彙整（2026-07-04 晚更新：使用者指示「不留到上架」，能修的當晚全修）

1. ✅ `migration_20260704.sql`（反作弊 Phase A）——使用者已跑，真機驗證成績正常上榜。
2. **使用者**：Supabase SQL Editor 跑 **`migration_20260704b.sql`**（log_event 節流 + cleanup 收權）。
3. **使用者**：cron-job.org 上呼叫 `cleanup_old_scores_if_needed` 的排程**可以刪了**（收權後會開始回權限錯誤；keepalive ping 排程保留不動）。
4. **使用者**：部署後真機/桌機玩一輪＋登入，開 DevTools console 看有無 `Content-Security-Policy-Report-Only` 違規訊息；乾淨的話回報，把 `_headers` 的 CSP 改名轉正式執法。
5. ✅ 已拍板（2026-07-04 晚）：伺服器端錢包＋每日 5 次上限搬 DB，**7/5 同一批動工**，計畫見 [WALLET_PLAN.md](WALLET_PLAN.md)。
6. **P 系列 IAP 動工時**：擁有權驗證必須伺服器端（前瞻性結論，與第 5 項同一套伺服器錢包可一起解）。
7. keystore：密碼已確認兩地留存；檔案本體備份使用者暫緩（Play App Signing 保底），不再追蹤為 🔴。

---

## 總覽

| 等級 | 項目 | 狀態 |
|------|------|------|
| 🔴 需使用者確認 | upload keystore 備份狀態 | 待確認 |
| 🟠 建議修（低風險改動） | `user_profiles.player_name` 無伺服器端長度限制 | 前端防呆已修；DB constraint 併入 migration 待跑 |
| 🟠 已知，設計中 | 兩支 RPC 無速率限制、分數欄位間無物理一致性驗證 | 見 ANTICHEAT_DESIGN.md |
| 🟡 建議補強 | `daily_scores` SELECT policy 只授 anon | 併入 migration 待跑 |
| 🟡 建議補強 | 無 CSP header | 記錄，封測期不動（怕誤擋 GSI 登入） |
| 🟢 已處理 | devDependencies 漏洞 `npm audit fix`（6→2，餘 2 個 dev-only 接受） | 完成 |
| 🟢 乾淨 | 密鑰處理／XSS／RLS 寫入路徑／assetlinks | 無需動作 |

---

## 🔴 金鑰管理：upload keystore 備份（唯一高影響項）

- `taiexrider-release.jks`（upload key，SHA-256 `83:FD:B6...`）依 History.md 記錄**只存在公司電腦**，曾提醒「回家前複製到雲端硬碟」但**未記錄是否已完成**。
- 幸好專案有啟用 **Play App Signing**（app 簽署金鑰 `DB:F0:8B...` 由 Google 保管，assetlinks 用的就是它）——upload key 遺失時可向 Google 申請重置（數天工作天），**不會**永久失去更新能力，但會卡住當下要出的版本。
- **待辦（使用者）**：確認 keystore 已備份到至少一個雲端位置（Google Drive / 私人加密儲存），連同 keystore 密碼。

## 🟠 `user_profiles.player_name` 無長度限制（已部分修）

- **情境**：`updateProfileName()` 直接 upsert 到 `user_profiles`，RLS 只驗 `player_id = auth.uid()`，**沒有驗 name 長度**。任何已登入者可用 anon key + 自己的 JWT 直接打 PostgREST，塞入任意長字串（MB 級）。排行榜 VIEW `daily_scores_ranked` COALESCE 讀這張表 → 排行榜 payload 被灌爆（流量/快取/前端渲染負擔）。前端的 `clampNameWidth` 擋不住直接打 API 的人。
- **已修（前端防呆）**：`auth.ts` upsert 前 `slice(0, 32)`。
- **待跑（DB 硬限制）**：`supabase/migration_20260702.sql` 加 `CHECK (char_length(player_name) <= 32)` + 對既有資料截斷。**要在 Supabase SQL Editor 手動跑**（push 不會生效）。

## 🟠 RPC 濫用面（已知，交由反作弊設計處理）

- `submit_daily_score` / `submit_classic_record`：只有各欄位獨立範圍驗證，無欄位間物理一致性（時間 10 秒卻 5 萬分照收）、無速率限制（同帳號可每秒狂打）。
- `cleanup_old_scores_if_needed()` granted to `anon`——任何人可無限呼叫。它只在 DB>400MB 時刪 90 天前資料，濫用後果輕（頻繁呼叫只是查 DB 大小），但屬「不必要的公開攻擊面」。migration 中改為僅 `service_role` 可執行（cron-job.org 呼叫端要改用 service key header——**改完 cron-job.org 那邊也要改**，若嫌麻煩可先不動，風險低）。
- 每日 5 次挑戰上限存 localStorage（`tr_daily_att_*`）——清 storage 即繞過。屬作弊面非資安面，反作弊設計一併處理。

## 🟡 `daily_scores` SELECT policy 只授 anon

- `create policy "anon read scores" ... to anon`——`authenticated` 角色沒有 SELECT policy。目前排行榜讀 `daily_scores_ranked` VIEW（owner 權限繞過 RLS）所以沒壞，但這是**靠 VIEW 特性撐著的脆弱設計**：未來若有人直接查表（已登入狀態）會靜默拿到 0 列，看起來像 bug。migration 中補 `to anon, authenticated`。`classic_records`、`daily_map`、`keep_alive` 同樣情況一併補。

## 🟡 無 CSP（Content-Security-Policy）

- Cloudflare Pages 可用 `public/_headers` 加 CSP，限制 script 來源為 self + `accounts.google.com`（GSI）+ Supabase 網域，降低未來 supply-chain / 注入類風險。
- **封測期間不動**：CSP 配錯會直接弄壞 Google 登入（GSI 會動態開 iframe/popup，網域清單要試錯），等正式上架後有餘裕再上。記錄於此不忘。

## 🟢 確認乾淨的部分（複查過，非照抄交接檔）

- **密鑰**：`.env` 已 gitignore 且只含 anon key（設計上公開）；`SUPABASE_SERVICE_ROLE_KEY` 只存在 GitHub Secrets，只被 CI 端 `fetchDailyMap.ts` 使用，從未進前端 bundle（全 repo grep 確認）。CI log 無印出密鑰（Actions 自動遮罩 + 腳本無 echo key）。
- **workflow 觸發面**：deploy.yml 只在 push main、fetch-daily-map.yml 只有 schedule/manual——**沒有 pull_request 類觸發**，fork PR 拿不到 secrets。actions 用 v4 tag 未 pin SHA（供應鏈潔癖項，重要性低，記錄即可）。
- **RLS 寫入路徑**：所有表 enable RLS；`daily_scores`/`classic_records` 寫入只能走 security definer RPC，`player_id` 由 `auth.uid()` 決定無法偽造；`user_profiles` UPDATE policy 省略 WITH CHECK 時 Postgres 自動沿用 USING → 無法把 row 改派給別人（查證過語意）。`daily_map` 只有 service key 可寫。
- **XSS**：全 src 無 `dangerouslySetInnerHTML`/`innerHTML`/`eval`；暱稱、股名等全走 React 轉義。PostgREST 查詢參數（date/stock_code）皆來自伺服器資料或本地日期函式，非自由使用者輸入。
- **TWA/assetlinks**：fingerprint = Play 簽署金鑰，網域拿不到你的簽名 → 他人 app 無法冒用 `taiexrider.pages.dev` 開全螢幕 TWA（會露網址列）。反向的「別人 clone 網頁包自己的 TWA」無法阻止（本來就公開網頁，見 #7 決策接受現實）。
- **相依套件**：`npm audit` 生產依賴 **0 漏洞**。dev 依賴修剩 2 個（esbuild dev-server 任意讀取——只影響本機 `npm run dev` 時被惡意網站打 localhost，平時注意別在跑 dev server 時逛可疑網站即可；undici 於 wrangler 內部——僅部署工具鏈用）。兩者皆不進產品 bundle，升級需 vite@8 breaking change，封測期不值得，記錄接受。

---

## 待辦彙整

1. **使用者**：確認 keystore + 密碼已雲端備份（🔴）。
2. **使用者**：在 Supabase SQL Editor 跑 `supabase/migration_20260702.sql`（含 name 長度限制、SELECT policy 補 authenticated、cleanup 收權、監控 events 表——一次跑完）。
3. **正式上架後**：評估 CSP `_headers`；反作弊 RPC 強化（見 ANTICHEAT_DESIGN.md）。
