# TaiexRider 全面資安檢查報告（2026-07-02）

> 範圍：前端（React/PWA）、Supabase（RLS/RPC/VIEW）、GitHub Actions/CI 密鑰、TWA/assetlinks、相依套件、金鑰管理。
> 由 Fable 5 執行（FABLE5_HANDOFF 資安任務）。結論先講：**沒有發現可直接遠端入侵或竊資的漏洞**；
> 主要風險集中在「已登入使用者濫用寫入路徑」（作弊/塞爆類），以及一項金鑰管理待確認。

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
