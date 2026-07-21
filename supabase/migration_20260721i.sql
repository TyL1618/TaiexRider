-- ============================================================
-- TaiexRider migration 2026-07-21i — 個人化裝備「目前裝備中」改伺服器權威
--
-- 背景：使用者真機實測發現，裝備稱號/暱稱顏色/前綴圖示/尾焰特效顏色/鬼影顏色
-- 任何一項後，重開 App 都會回到「未裝備」的乾淨狀態——但「擁有清單」本身是
-- 正常的（車庫顯示「已擁有」，只是沒有裝備中的框線）。這證實了 owned 這條
-- 伺服器同步路徑完全正常，問題出在「目前裝備哪一個」這個狀態：2026-07-21
-- 原始設計把它當成「純本地偏好，比照 activeSkinKey() 不存伺服器」
-- （garage.ts cosmeticActiveKey()），但車皮那套用了大半個月都沒出過事，這批
-- 全新功能反而重開就失效——不管確切是哪個 Android WebView/Capacitor 環節在
-- 重開之間弄丟這個純本地 key，「owned 伺服器同步這條路徑已證實在使用者裝置上
-- 100% 可靠」這件事本身就是最強訊號：改成跟 owned 同一套伺服器權威機制，
-- 徹底終結這一整類「本地 key 不知道為什麼不見了」的問題，不用再去猜根因。
--
-- 做法：player_wallet 新增 equipped jsonb 欄位（{"title": "title:xxx", ...}
-- 這種 kind→id 對照表，跟 owned 陣列同放一張表），新增 wallet_set_cosmetic()
-- RPC 寫入（驗證 kind 合法、id 必須在 owned 清單內才給裝備），wallet_get()
-- 一併吐回 equipped 供登入/進車庫時同步。
--
-- 用法：Supabase Dashboard → SQL Editor → 全選貼上 → Run。
-- ⚠️ push 不會更新 DB，一定要手動跑這份。
-- ============================================================

alter table public.player_wallet
  add column if not exists equipped jsonb not null default '{}'::jsonb;

-- ── wallet_set_cosmetic(p_kind, p_id)：裝備/取消裝備個人化道具（p_id=null 表
--    取消裝備該類別）。p_id 非 null 時必須已經在 owned 清單裡才准裝備，防止
--    繞過購買流程直接呼叫 API 裝備未擁有的項目。──────────────────────────
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
  if p_kind not in ('title', 'nickcolor', 'badge', 'trail', 'ghostcolor') then
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

-- ── wallet_get()：再擴充 equipped（⚠️ 這是第四次改這支函式的輸出欄位——
--    完整複製 migration_20260721e.sql 目前正確的 12 欄位版本，只在尾端新增
--    這一個，絕對不能只挑「這次要加的」重寫）。──────────────────────────
drop function if exists public.wallet_get();
create or replace function public.wallet_get()
returns table(
  coins int, diamonds int, owned jsonb,
  bull_finishes int, bear_finishes int,
  streak_count int, last_session_key date,
  collection text[], ads_removed boolean,
  tickets int, total_flips int, total_perfect int,
  equipped jsonb
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
           c.codes, w.ads_removed, w.tickets,
           a.total_flips, a.total_perfect,
           w.equipped
      from public.player_wallet w
      join public.player_achievements a on a.player_id = w.player_id
      join public.player_streak s on s.player_id = w.player_id
      join public.player_collection c on c.player_id = w.player_id
     where w.player_id = v_uid;
end;
$$;
revoke execute on function public.wallet_get() from public, anon;
grant  execute on function public.wallet_get() to authenticated;
