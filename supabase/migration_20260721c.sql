-- ============================================================
-- TaiexRider migration 2026-07-21c — 緊急修復：migration_20260721.sql 把
--   wallet_get() 改壞了，砍掉了成就/連續天數/圖鑑/去廣告狀態欄位
-- ⚠️⚠️ 這份請立刻跑，優先度最高 ⚠️⚠️
--
-- 事故經過：migration_20260721.sql 為了讓 wallet_get() 多回傳 tickets，直接
-- drop+recreate 成 returns table(coins, diamonds, owned, tickets) 四個欄位，
-- 但沒注意到 wallet_get() 從 2026-07-06 起已經被擴充成回傳九個欄位（見
-- migration_20260706d.sql：bull_finishes/bear_finishes/streak_count/
-- last_session_key/collection/ads_removed）。已經跑過 20260721.sql 的資料庫，
-- 現在 wallet_get() 回傳只剩 4 欄，前端 syncWalletFromServer() 讀不到成就/
-- 連續天數/圖鑑/去廣告狀態這幾個欄位（會是 undefined），這幾項資料在客戶端會
-- 讀到 undefined 而不同步——玩家開 App 可能看到連續天數/成就/去廣告狀態跑掉。
-- 這份補回完整九欄位＋新增的 tickets，用法同前：SQL Editor 全選貼上 Run 一次。
-- ============================================================

drop function if exists public.wallet_get();
create or replace function public.wallet_get()
returns table(
  coins int, diamonds int, owned jsonb,
  bull_finishes int, bear_finishes int,
  streak_count int, last_session_key date,
  collection text[], ads_removed boolean,
  tickets int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then return; end if;

  insert into public.player_wallet (player_id) values (v_uid) on conflict (player_id) do nothing;
  insert into public.player_achievements (player_id) values (v_uid) on conflict (player_id) do nothing;
  insert into public.player_streak (player_id) values (v_uid) on conflict (player_id) do nothing;
  insert into public.player_collection (player_id) values (v_uid) on conflict (player_id) do nothing;

  return query
    select w.coins, w.diamonds, w.owned,
           a.bull_finishes, a.bear_finishes,
           s.streak_count, s.last_session_key,
           c.codes, w.ads_removed, w.tickets
      from public.player_wallet w
      join public.player_achievements a on a.player_id = w.player_id
      join public.player_streak s on s.player_id = w.player_id
      join public.player_collection c on c.player_id = w.player_id
     where w.player_id = v_uid;
end;
$$;
revoke execute on function public.wallet_get() from public, anon;
grant  execute on function public.wallet_get() to authenticated;
