# 伺服器端錢包 + DB 端每日次數上限——實作計畫（2026-07-04 晚拍板）

> ✅ **2026-07-04 當晚已提前實作完成**（使用者：「不用等 7/5，現在就處理」）。
> `supabase/migration_20260705.sql` 已寫好（**⚠️ 待使用者在 Supabase SQL Editor 手動跑才生效**，
> push 不會更新 DB），客戶端（garage.ts/App.tsx/Garage.tsx/GameCanvas.tsx/DailyChallenge.tsx/
> challengeAttempts.ts）已全部改接。跑完 migration 前，已登入玩家的購買/發幣/攻略次數 RPC 呼叫
> 會靜默失敗（garage.ts 對應函式回傳 false/略過，不影響遊戲，但也還沒有伺服器保護）——
> **真正生效必須先跑那份 migration，之後拿真實 Google 帳號真機/桌機登入驗證一輪**
> （購買車皮扣款、完賽發幣、每日第 6 次挑戰被擋）。以下維持原始規劃內容備查，
> 實作與此文件唯一的落差：鑽石車款（P1/P2，本文件寫下時還沒生圖上線）也一併納入
> wallet_spend_skin 的白名單，不是只有「無金幣售價車皮」的骨架。
>
> 背景：SECURITY_REVIEW 2026-07-04 第二輪 🟠 項。使用者裁示「任何影響遊戲的數值竄改都不接受」，
> localStorage 金幣/擁有清單/任務進度必須搬伺服器端；「每日挑戰 5 次上限」（反作弊 Phase B 的
> consume_attempt）同一批做，一次動完開局/結算流程一次測。
> 誠實邊界（已向使用者說明）：伺服器驗證不了「你真的完賽了」（要到 Phase C 事件流），
> 所以用「伺服器端每日發幣上限」封頂——竄改者最多騙到「正常玩一整天」的量，不能再多。

## Schema / RPC（migration_20260705.sql，一份搞定）

1. **`player_wallet`**：`player_id text pk`（= auth.uid()）、`coins int check (coins >= 0)`、
   `owned jsonb default '[]'`（車皮 id 陣列）、`updated_at`。RLS：SELECT 限本人
   （`player_id = auth.uid()::text`），**無任何直接寫入路徑**（全走 security definer RPC）。
2. **`wallet_earn(p_kind text) returns int`**（回傳新餘額，靜默拒絕回 -1）：
   - kind 白名單 + 固定面額（伺服器決定，客戶端不能傳金額）：`finish`=10、`crash`=3、
     `quest`=25（統一取任務獎勵上限，避免傳 quest id 還要驗）、`ad`=20。
   - **每日上限（伺服器端，rate_limits 表同款 bucket 計數）**：finish ≤ 30 次、crash ≤ 30 次、
     quest ≤ 3 次、ad ≤ 2 次／天（台灣時區日）。合法玩家一天到不了頂，竄改者被封頂。
   - 開發者帳號（JWT email = tyl161803@gmail.com）：`dev_grant` kind 直接補滿 99999，
     取代 App.tsx 現在的前端 hack（前端那段可刪）。
3. **`wallet_spend(p_skin text) returns int`**：目前**沒有任何金幣售價車皮**（B 免費/Q 成就/P IAP），
   先建好驗證骨架（車皮 id + 價格白名單寫在 RPC 內，同 classic level 白名單模式），暫無呼叫端。
4. **`wallet_unlock(p_skin text)`**（Q 系列）：v1 先信任客戶端宣稱＋每日 1 次上限；
   v2（Phase C 或 events 佐證）再用 events 的 finish 事件數回驗大漲/大跌日完賽次數。
   ⚠️ events 是 fire-and-forget 可能漏事件，回驗只能當「上限」不能當「必要條件」，否則誤鎖。
5. **`consume_attempt() returns boolean`**（Phase B 根治每日 5 次）：`daily_attempts
   (challenge_date, player_id, attempts)`，開局呼叫，attempts ≥ 5 回 false。
   challenge_date 用與 submit_daily_score 同源的 `max(map_date ≤ 台灣今天)`。

## 客戶端改動點

- `garage.ts`：`getCoins/addCoins/getOwnedSkins/purchaseSkin/unlockAchievementSkin` 加
  「已登入 → 走 wallet RPC、localStorage 只當顯示快取；未登入 → 維持現行 localStorage
  （上不了榜、竄改只影響自己的離線收藏，接受）」。登入時做一次性遷移：本地餘額/擁有清單
  upsert 到 wallet（僅第一次，防重複灌）→ 之後以 DB 為準。
- `App.tsx handleGameOver`：addCoins → 已登入改呼叫 `wallet_earn('finish'|'crash')`；
  quest 完成獎勵 → `wallet_earn('quest')`；dev 帳號前端補幣 hack 移除（改 RPC dev_grant）。
- `adRewards.ts` / Garage・結算「看廣告拿金幣」→ `wallet_earn('ad')`（每日 2 次上限搬伺服器端）。
- `DailyChallenge` 開局 → `consume_attempt()`，false 就不給進；**離線/RPC 失敗 fallback：
  放行遊玩但不能提交成績**（ANTICHEAT_DESIGN Phase B 既定取捨）。localStorage 計數保留當 UI 快取。
- streak/任務「進度」暫留 localStorage（純顯示、不發幣的部分無經濟價值；發幣的瞬間才過伺服器驗證）。
  streak 之後可改由 daily_scores 提交紀錄推導（DB 本來就有，天然防竄改），列 v2。

## 驗證

- preview：登入不可（GSI 需真人），用未登入路徑 + RPC 單元呼叫（curl 帶測試 JWT 不可行 →
  SQL Editor 手動測 RPC 各 kind/上限/冪等）。
- 真機：登入後完賽發幣、廣告金幣 2 次上限、跨裝置餘額同步、第 6 局被擋。
- 改完照舊：CLAUDE.md 進度 + SECURITY_REVIEW 狀態更新 + migration 提醒手動跑。
