-- ============================================================
-- TaiexRider migration 2026-07-22 — 玩家資料頁（排行榜點暱稱看玩家資料）
--
-- 新增三件事：
--  1. wallet_set_cosmetic() 白名單加 'skin'——車皮裝備從「純本地偏好」升級成
--     跟稱號/顏色同一套伺服器權威（存進 player_wallet.equipped 的 'skin' 鍵），
--     這樣別人才能在玩家資料頁看到「這個人當下騎哪台車」；順便修掉 2026-07-15
--     記錄的「換裝置車皮跑掉」已知限制（純本地 key 不跨裝置）。
--  2. get_daily_top() 多回傳 player_id——前端排行榜點暱稱時要用它去查 profile。
--     player_id 是 Supabase auth uuid（隨機值，非 email/PII），且 profile 只吐
--     遊戲統計（本來就顯示在榜上的暱稱/裝備）+ 名次次數，無隱私外洩；submit
--     一律用 auth.uid()，暴露 player_id 只能讀不能冒充提交。
--  3. get_player_profile(p_player_id)——彙整單一玩家的公開資料：暱稱/裝備/持有
--     車款清單/成就原始計數/每日榜名次次數/經典榜逐地圖逐名次次數。名次次數
--     直接數既有的結算表（daily_diamond_settlement / classic_diamond_settlement，
--     本來就逐日/逐週記 rank），不需要新表。security definer 讀這兩張
--     revoke-all 的表，跟 get_daily_top/settle_* 既有跨玩家讀寫是同一個信任模型。
--
-- 用法：Supabase Dashboard → SQL Editor → 全選貼上 → Run。
-- ⚠️ push 不會更新 DB，一定要手動跑這份。
-- ============================================================

-- ── 1. wallet_set_cosmetic：白名單加 'skin'（車皮也走伺服器權威裝備）。
--    signature 不變，只改函式體內合法 kind 清單，CREATE OR REPLACE 即可。
--    'skin' 的 id 就是 BIKE_SKINS 的車款 id（'default'/'p3-gold'/...），這些
--    本來就存在 owned 陣列裡，沿用「id 必須在 owned 才准裝備」的既有防線。────
create or replace function public.wallet_set_cosmetic(p_kind text, p_id text)
returns table(equipped jsonb, ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      text := auth.uid()::text;
  v_owned    jsonb;
  v_equipped jsonb;
begin
  if v_uid is null then return; end if;
  if p_kind not in ('title', 'nickcolor', 'badge', 'trail', 'ghostcolor', 'skin') then
    return query select null::jsonb, false;
    return;
  end if;

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  select w.owned, w.equipped into v_owned, v_equipped
    from public.player_wallet w where w.player_id = v_uid for update;

  if p_id is not null and not (v_owned ? p_id) then
    return query select v_equipped, false; -- 未擁有的項目不准裝備
    return;
  end if;

  if p_id is null then
    v_equipped := coalesce(v_equipped, '{}'::jsonb) - p_kind;
  else
    v_equipped := jsonb_set(coalesce(v_equipped, '{}'::jsonb), array[p_kind], to_jsonb(p_id));
  end if;

  update public.player_wallet
     set equipped = v_equipped, updated_at = now()
   where player_id = v_uid;

  return query select v_equipped, true;
end;
$$;
revoke execute on function public.wallet_set_cosmetic(text, text) from public, anon;
grant  execute on function public.wallet_set_cosmetic(text, text) to authenticated;

-- ── 2. get_daily_top：多回傳 player_id（改 OUT 欄位＝要 DROP 再建）。其餘邏輯
--    逐字沿用 migration_20260721k.sql，只在最前面多 select ds.player_id。──────
drop function if exists public.get_daily_top(date, int);
create or replace function public.get_daily_top(p_date date, p_limit int default 100)
returns table(player_id text, player_name text, score int, time_ms int, flips int, perfect int, cosmetics jsonb)
language sql
security definer
set search_path = public
stable
as $$
  select ds.player_id,
         coalesce(up.player_name, ds.player_name) as player_name,
         ds.score, ds.time_ms, ds.flips, ds.perfect,
         coalesce(w.equipped, '{}'::jsonb) - 'trail' as cosmetics
    from public.daily_scores ds
    left join public.user_profiles up on up.player_id = ds.player_id
    left join public.player_wallet w on w.player_id = ds.player_id
   where ds.challenge_date = p_date and not ds.suspect
   order by ds.score desc, ds.time_ms asc
   limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;
revoke execute on function public.get_daily_top(date, int) from public;
grant  execute on function public.get_daily_top(date, int) to anon, authenticated;

-- ── 3. get_player_profile(p_player_id)：單一玩家公開資料頁。回傳單一 jsonb 物件
--    （PostgREST RPC 回純量 jsonb ＝前端直接拿到物件，不用 data[0]）。─────────
--    achv 只吐原始計數，「哪些成就已解鎖」由前端用既有門檻常數判斷（避免門檻在
--    前後端各寫一份）。classic 陣列每筆 = {level_id, rank, count}，前端用
--    classics.ts 把 level_id 對成中文關卡名。
create or replace function public.get_player_profile(p_player_id text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'player_name', coalesce(
      (select up.player_name from public.user_profiles up where up.player_id = p_player_id),
      (select ds.player_name from public.daily_scores ds where ds.player_id = p_player_id order by ds.created_at desc limit 1),
      '車手'
    ),
    'equipped', coalesce((select w.equipped from public.player_wallet w where w.player_id = p_player_id), '{}'::jsonb),
    'owned',    coalesce((select w.owned    from public.player_wallet w where w.player_id = p_player_id), '["default"]'::jsonb),
    'achv', jsonb_build_object(
      'bull_finishes', coalesce((select a.bull_finishes from public.player_achievements a where a.player_id = p_player_id), 0),
      'bear_finishes', coalesce((select a.bear_finishes from public.player_achievements a where a.player_id = p_player_id), 0),
      'total_flips',   coalesce((select a.total_flips   from public.player_achievements a where a.player_id = p_player_id), 0),
      'total_perfect', coalesce((select a.total_perfect from public.player_achievements a where a.player_id = p_player_id), 0),
      'streak_count',  coalesce((select s.streak_count  from public.player_streak s      where s.player_id = p_player_id), 0)
    ),
    'daily', jsonb_build_object(
      'first',  (select count(*) from public.daily_diamond_settlement d where d.player_id = p_player_id and d.rank = 1),
      'second', (select count(*) from public.daily_diamond_settlement d where d.player_id = p_player_id and d.rank = 2),
      'third',  (select count(*) from public.daily_diamond_settlement d where d.player_id = p_player_id and d.rank = 3),
      'top10',  (select count(*) from public.daily_diamond_settlement d where d.player_id = p_player_id and d.rank between 1 and 10)
    ),
    'classic', coalesce((
      select jsonb_agg(jsonb_build_object('level_id', t.level_id, 'rank', t.rank, 'count', t.c)
                       order by t.rank asc, t.c desc)
        from (
          select c.level_id, c.rank, count(*) as c
            from public.classic_diamond_settlement c
           where c.player_id = p_player_id
           group by c.level_id, c.rank
        ) t
    ), '[]'::jsonb)
  );
$$;
revoke execute on function public.get_player_profile(text) from public;
grant  execute on function public.get_player_profile(text) to anon, authenticated;
