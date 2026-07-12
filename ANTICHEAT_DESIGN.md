# TaiexRider 反作弊機制設計（2026-07-02 定案）

> 目標：在「純前端 + Supabase」架構限制內，把「偽造分數上榜」的成本拉高到不值得做。
> 原則：**伺服器端能驗的都在 RPC 驗**；接受「無法 100% 防」的現實（客戶端永遠可被逆向），
> 重點是擋掉 99% 的低成本作弊（改 JS 變數、直接打 API、重放請求）。
> 狀態：**Phase A 已實作**（2026-07-04，`supabase/migration_20260704.sql`，已跑生效）；
> **Phase B 已實作**（2026-07-12，`supabase/migration_20260712.sql`，待使用者手動跑）；
> **Phase C 已實作**（2026-07-12，`supabase/migration_20260712b.sql`，待使用者手動跑，
> 跟 Ghost 鬼影賽跑一起做）——範圍見本文件第二/三/四層段落最新註記。
> ⚠️ Phase A 實作與本文第一層原公式有三處刻意偏差（照抄會誤殺 16/27 筆真實成績），
> 依據 2026-07-04 線上資料回測定案，細節見 migration 檔頭註解：
> ① 分數上限加 slack +500（容忍 v0.12.14 前舊計分制的未更新客戶端，普及後可收緊）；
> ② 時間下限改用「分數隱含最低行進比例」（摔車也會提交，不能假設完賽）；
> ③ 冷卻 30s → 10s（實測完賽中位數僅 17s，30s 會誤殺連續進步的正常玩家）。
> 另補：經典關卡 level_id 白名單（原本任意字串可塞新列）。
> **2026-07-11 追加**：`submit_daily_score` 補了一道 Phase A 範圍內的洞——原本完全
> 沒檢查「今天有沒有真的消耗過挑戰次數」，可繞過 UI 直接打 API、每 10 秒洗一次物理
> 上限內的分數。因為每日排行榜名次直接發鑽石（付費貨幣），這條洞等同免費印鑽石，
> 優先度拉高到不等 Phase B。已修：要求 `wallet_daily_attempts.attempts ≥ 1`（同一
> session）才收分，見 `supabase/migration_20260711c.sql`。**未做到**「提交次數 ≤
> 消耗次數」逐筆對帳（同一次挑戰仍可在物理上限內反覆改進提交），那個仍屬 Phase B
> 範圍。

---

## 威脅模型

| 攻擊 | 成本 | 現況防禦 |
|------|------|----------|
| A. 開 DevTools 改分數變數再完賽 | 極低 | 無 |
| B. 拿 anon key + 自己 JWT 直接打 `submit_daily_score` RPC | 低 | 只有欄位獨立範圍驗證（0~50000 等） |
| C. 重放/高頻狂打 RPC 洗榜 | 低 | 無速率限制 |
| D. 清 localStorage 繞過每日 5 次上限 | 極低 | 無（上限純前端） |
| E. 修改物理參數（改重力/速度）跑出真實但超人的成績 | 中 | 無 |
| F. 多帳號協同 | 中高 | 無（暫不處理，量大再說） |

身分偽造（player_id）已由 `auth.uid()` 根治，不在此列。

---

## 第一層：RPC 物理一致性驗證（Phase A，最高 CP 值）

單欄位範圍驗證升級為**欄位間關係驗證**，全部在 `submit_daily_score` / `submit_classic_record` 內做，純 SQL 改動、不動客戶端：

1. **分數上限公式**（對照 `constants.ts` 計分規則推導，v0.12.14 改線性＋倍率後更新）：
   - 行進分 ≤ 1000（固定制度）
   - 翻轉分＝線性：`flip_score(f) = 100f`（每圈固定 100，不遞增）
   - 完美落地＝該趟翻轉分 ×2：保守上界（假設每次翻轉都判完美）＝ `2 × 100 × p_flips`
   - **檢核**：`p_score ≤ 1000 + 200 × p_flips`，超過即拒（比舊公式簡單，線性化後上界公式也跟著變乾淨）。
2. **時間下限**：車速恆定 `cruiseSpeed=6.912px/step`（60step/s ≈ 415px/s）。當日地圖長度伺服器可算：`(len(prices)+7) × 80 px`（daily_map 的 prices 就在 DB 裡，RPC 直接查）。
   - **檢核**：`p_time ≥ 地圖長度 / 415 × 1000 × 0.9`（0.9 容忍係數，防資料點浮動）。時間太短 = 不可能跑完 = 拒。
   - 經典模式同理，12 關長度可寫成 SQL CASE 或小表。
3. **翻轉/時間比**：後空翻最大角速度 0.192 rad/step → 一圈最快 ≈ 0.55s，且翻轉需先騰空。
   - **檢核**：`p_flips ≤ ceil(p_time / 1000) × 1.5`（每秒 1.5 圈上界，寬鬆但擋得住 flips=50/time=15s 這種）。
4. **perfect ≤ flips 相關**：完美落地需 ≥0.85 圈旋轉 → `p_perfect ≤ p_flips + 3`（+3 容忍單圈完美落地被 floor 成 0 圈的邊角）。

> 這層擋掉攻擊 B 的大部分（亂填數字），A 也部分被擋（改分數變數但 flips/time 對不上）。
> 攻擊 E（改物理參數跑真成績）擋不住——它產生的數字自洽。靠第三層。

## 第二層：速率限制 + 伺服器端次數上限（Phase B）

1. **提交冷卻**：`daily_scores` 已有 `created_at`。RPC 開頭加：同 uid 距上次提交 < 30 秒 → 靜默拒絕（正常一局至少 30s+，重放/腳本狂打直接失效）。零新表。
   ✅ **實作狀態**：Phase A 就做了（`migration_20260704.sql` 的 [A1]），只是冷卻秒數調成
   **10 秒**不是 30 秒——2026-07-04 用真實成績回測，完賽中位數僅 17s，30s 會誤殺連續
   進步的正常玩家，見該份 migration 頭尾註解，2026-07-12 review 後維持現狀不改。
2. **每日次數上限搬進 DB**（根治攻擊 D）：新表 `daily_attempts (challenge_date, player_id, attempts int)`，遊戲開局呼叫新 RPC `consume_attempt()`：`attempts ≥ 5 → 回傳 false`，前端以回傳值放行。localStorage 保留當 UI 快取（未登入者仍用舊制，反正未登入不能上榜）。
   - ⚠️ 代價：開局多一次 round-trip；離線/失敗 fallback 允許遊玩但不能提交。實作時注意。
   ✅ **實作狀態**：2026-07-06 就做了（`wallet_daily_attempts` 表 + `consume_attempt()`），
   2026-07-10 修過一次 42702 撞名 bug（見踩雷筆記），2026-07-11c 補了
   `submit_daily_score` 與這張表的綁定。跟本文件原訂的 Phase B rollout 順序不同，是
   提前做掉的。
3. **提交次數側限**：同一 uid 同一天提交 > 12 次（5 局 + 復活 + 容忍）→ 靜默拒絕並標記（見第三層）。
   ✅ **2026-07-12 實作**（`migration_20260712.sql`）：改成「不擋提交、只標記」（跟第三層
   合併實作，見下方）——`daily_scores` 新增 `submit_count`，`submit_daily_score` 每次
   真的改善分數的 upsert +1，> 12 次 → `suspect = true`。

## 第三層：離群偵測 + 隔離（Phase B~C，對付「自洽的假成績」）

✅ **2026-07-12 實作**（`migration_20260712.sql`，vc27 批次）：

1. `daily_scores` 加欄位 `suspect boolean default false`（已做，同上）。
2. **夜間掃描**：沒有另開新 GitHub Actions，**複用既有的 `settle_daily_diamonds()`**
   （`scripts/settleDailyRewards.ts` 每晚台灣 00:00 呼叫）——結算前一期鑽石之前，先對
   那一期跑 z-score 離群掃描（分數 > 平均 4 個標準差，樣本數 < 8 不判斷，避免玩家太少
   時統計不穩定誤殺）→ `suspect = true`。**尚未實作**「時間逼近理論下限」那條件（覺得
   z-score + 提交次數兩條已能擋住主要攻擊面，時間下限那條留待之後真的觀察到漏網案例
   再加，避免過度設計）。
3. **不刪除、不擠榜首**：`daily_scores_ranked` VIEW 已加 `where not suspect`；
   `settle_daily_diamonds()` 的名次獎排序子查詢也排除 suspect（拿不到名次鑽石，
   參與獎不受影響）。誤判可人工在 Dashboard 把 `suspect` 改回 `false` 復權，玩家無感。
4. **經典模式（`classic_records`）刻意不動**：攻擊模型不同（沒有「單日」概念，是永久
   前三名），這輪範圍只涵蓋每日排行榜；之後有需要再另外設計。

## 第四層：操作事件序列（Phase C，與 Ghost 回放共用一份工）

✅ **2026-07-12 實作**（`migration_20260712b.sql`，vc28 批次）：

錄一份輕量「關鍵事件時間軸」隨成績提交，一魚兩吃。**實作範圍比設計稍微收斂**：
只錄「翻轉/完美落地事件（含時間戳+圈數）」+「車輛 x 座標每 0.5s 取樣」，**沒有做
press/release 完整合法性狀態機**（成本/風險不成比例，事件數對得上 flips/perfect、
取樣點數對得上時間，已足夠拉高偽造成本；press/release 粒度之後真的觀察到繞過案例
再加，避免過度設計）：

- **格式**：`{ "events": [[t,"f"|"p",n], ...], "path": [x0,x1,...] }`，t=相對開始 ms、
  n=該次落地貢獻的翻轉圈數（`GameCanvas.tsx settleFlip()` 記錄）、path 每 500ms 一個
  車身 x 座標（主迴圈 `raceTimeMs` 累加處記錄）。
- **反作弊用**：`submit_daily_score` 新增 `p_replay` 參數（預設 null，向下相容尚未
  更新的客戶端），有帶時驗證：events 的 n 加總 vs p_flips、"p" 事件筆數 vs
  p_perfect、path 長度 vs p_time/500，各自容忍一定誤差，離譜偏差靜默拒絕。
- **Ghost 用**：新 RPC `get_daily_ghost_path(p_date)` 回傳當日目前第一名（非
  suspect）的 `replay->path`，`GameCanvas.tsx drawGhost()` 依 `raceTimeMs` 線性插值
  出鬼影 x 座標，套用既有地形函式（`terrainYAt`/`slopeAt`）算貼地高度/傾角，純視覺
  疊圖、不跑物理，半透明+去色跟玩家自己的車一眼區分。
- **產品範圍**（使用者 2026-07-12 拍板）：只做「跟當日目前第一名賽跑」，`DailyChallenge.tsx`
  進場前一個開關（開啟/關閉第一名鬼影，`tr_ghost_toggle`，純顯示偏好不用帳號隔離），
  不做成獨立模式。鬼影來源是即時查詢（誰是第一名鬼影就換誰），不是固定存檔。
- **上線空窗期**：只有這份 migration 生效後、且當天有人用新版客戶端交出帶 replay
  的第一名成績，開關才會真的看到鬼影；舊成績沒有 replay 欄位，是預期中的正常現象。
- 存放：`daily_scores` 加 `replay jsonb`（沒有另建獨立表——目前規模單日筆數不多，
  加欄位已經夠用，之後量大再評估是否要限制只留前 100 名的 replay）。

## 刻意不做

- **完整伺服器端物理重放**：要在 Postgres/Edge Function 跑 Matter.js 重演，工程與成本不成比例。第四層的粗一致性已足夠拉高成本。
- **前端混淆/加密**：假安全，逆向者眼裡是透明的，還增加維護成本。
- **裝置指紋**：隱私成本高，封測規模用不上。

## Rollout 順序

| 階段 | 內容 | 改動面 | 時機 |
|------|------|--------|------|
| A | 物理一致性驗證 + 冷卻 | 純 SQL（一份 migration，手動跑） | ✅ 已上（2026-07-04，10s 冷卻） |
| B | DB 端每日次數 + 高頻標記 + suspect 欄位/VIEW + 夜間掃描 | SQL + 前端開局 RPC + CI | ✅ 已實作（2026-07-12，`migration_20260712.sql`，待手動跑），vc27 |
| C | 操作事件序列 + Ghost 資料 | 前端錄製 + schema + RPC | ✅ 已實作（2026-07-12，`migration_20260712b.sql`，待手動跑），vc28 |

> ⚠️ 所有 RPC 修改都要在 Supabase SQL Editor 手動跑，push 不生效（老規矩）。
> ⚠️ Phase A 上線前先拿近期真實成績跑一遍驗證公式（避免把正常玩家的極限成績誤殺）——
> events/daily_scores 現有資料就夠回測。
