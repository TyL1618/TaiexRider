-- Phase 4 #1: 改名同步排行榜
-- 執行步驟：Supabase Dashboard → SQL Editor → New query → 貼上整段 → Run
--
-- 效果：改暱稱後排行榜立刻顯示新名稱（舊提交紀錄也一起更新），
-- 因為 daily_scores_ranked VIEW 優先讀 user_profiles.player_name。
--
-- 注意：player_id 用 TEXT（與 daily_scores.player_id 型別一致），
-- 不用 UUID 避免 JOIN 型別不符（auth.uid()::text 轉型比對）。

-- 若上次執行到一半留下殘局，先清掉
DROP TABLE IF EXISTS public.user_profiles CASCADE;

-- 1. 玩家暱稱表（player_id = TEXT，對應 daily_scores.player_id）
CREATE TABLE public.user_profiles (
  player_id   TEXT PRIMARY KEY,
  player_name TEXT NOT NULL DEFAULT ''
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- 任何人都可以讀（排行榜需要顯示名稱）
CREATE POLICY "public_read_profiles"
  ON public.user_profiles FOR SELECT
  USING (true);

-- 只能 upsert 自己的 row（auth.uid() 轉 text 比對）
CREATE POLICY "own_insert_profile"
  ON public.user_profiles FOR INSERT
  WITH CHECK (auth.uid()::text = player_id);

CREATE POLICY "own_update_profile"
  ON public.user_profiles FOR UPDATE
  USING (auth.uid()::text = player_id);

-- 2. 排行榜讀取 VIEW
CREATE OR REPLACE VIEW public.daily_scores_ranked AS
SELECT
  ds.challenge_date,
  ds.player_id,
  ds.score,
  ds.time_ms,
  ds.flips,
  ds.perfect,
  COALESCE(up.player_name, ds.player_name) AS player_name
FROM public.daily_scores ds
LEFT JOIN public.user_profiles up ON up.player_id = ds.player_id;

-- anon/authenticated 可以 SELECT（PostgREST 排行榜 fetch 用 anon key）
GRANT SELECT ON public.daily_scores_ranked TO anon, authenticated;
