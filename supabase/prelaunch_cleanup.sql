-- ============================================================================
-- 正式上架前／上架當天：清空封測期間累積的「玩家遊玩紀錄」，給正式版一個
-- 全新乾淨的環境。2026-07-04 使用者交代規劃、2026-07-09 使用者要求「先準備好，
-- 上架前隨時都可以清除」，此刻先寫好但不執行，由使用者自行決定時機在 Supabase
-- SQL Editor 手動跑。
--
-- ⚠️ 這支腳本會清掉不可逆的資料，執行前務必再次確認時機（建議正式版審核通過、
-- 即將對外公開的當下再跑，不要提早跑掉還在封測用的排行榜/經典榜）。
--
-- 範圍原則（2026-07-09 使用者明確界定）：
--   ✅ 清除：玩家「玩過的紀錄」——排行榜歷史成績、經典模式紀錄、後台監測事件
--   ❌ 不動：遊戲本身需要的資料（daily_map 每日地圖／stock_registry 股票圖鑑登記表）
--   ❌ 不動：已登入帳號本身（user_profiles）與金幣/鑽石餘額（player_wallet，
--            使用者明確表示金幣鑽石不用清）
--   ❌ 不動：IAP 購買紀錄（iap_purchases）——這是金流防重放憑證，不是遊玩紀錄，
--            清掉可能讓已購買商品的驗證邏輯出錯，絕對不能動
--
-- 下面這些表「沒有」放進清除清單，是刻意的，不是漏掉：
--   wallet_earn_log / wallet_daily_attempts / player_weekly_quest /
--   daily_diamond_settlement / classic_diamond_settlement
--   → 這幾張表本來就有 cleanup_old_wallet_logs() 排程在滾動清理（14 天/60 天/
--     8 週不等，見 migration_20260708c.sql/20260708d.sql），不是永久累積的
--     測試污染，開服後這些「今天/本週」尺度的資料自然會被新資料覆蓋，
--     不需要特地手動清空。
--   player_achievements / player_streak / player_collection（Q 系列成就進度、
--     連續天數、股票圖鑑收集）→ 使用者這次沒有點名要清，這些偏向「玩家帳號的
--     持續進度」而非「單場遊玩紀錄/排行榜」，先保留不動。如果之後想連這些也
--     一起歸零（例如連封測期間解鎖的成就都要清掉重來），告訴 Claude 再加開一段。
-- ============================================================================

begin;

-- 排行榜（每日挑戰）歷史成績。daily_scores_ranked 是建立在 daily_scores 上的
-- view（非本 repo migration 建立，早期在 Supabase Dashboard 直接建的），清掉
-- 基底表後 view 會自動反映空結果，不需要另外處理。
truncate table public.daily_scores;

-- 排行榜每日鑽石結算紀錄（衍生自 daily_scores 的結算副表，一併清掉避免玩家
-- 端看到「上一期結算」彈窗卻對應到已經消失的舊測試期資料）。
truncate table public.daily_diamond_settlement;

-- 經典模式紀錄（含目前這一週的前三名，全部視為封測測試資料清掉）。
truncate table public.classic_records;

-- 經典模式週結算鑽石紀錄（同上，避免結算彈窗對應到已清除的舊資料）。
truncate table public.classic_diamond_settlement;

-- 後台監測事件（run_start/death/finish/revive/share 等打點），封測期間的
-- 測試流量資料，開服後才是真正有意義的正式數據。
truncate table public.events;

commit;

-- ── 執行後可用這幾行快速確認清空成功（皆應回傳 0）───────────────────────────
-- select count(*) from public.daily_scores;
-- select count(*) from public.classic_records;
-- select count(*) from public.events;
-- select count(*) from public.daily_diamond_settlement;
-- select count(*) from public.classic_diamond_settlement;
