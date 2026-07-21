-- ============================================================
-- TaiexRider migration 2026-07-21l — 新增 8 個股市梗稱號 + 財經皓角改名
--
-- 使用者新增可購買稱號：本多終勝/巴膩膩/軋空逃生/四貸同堂/奈米戶/梭哈是種智慧/
-- 逢低買進/公園長椅居民（皆 200 鑽，跟既有股市梗稱號同價），並把「財經皓角」
-- 改名「皓哥黃段子聽眾」（沿用同一個 id `title:finance-haojiao`——只改顯示文字，
-- 不改 id，已購買過的玩家不受影響，`owned` 清單裡存的是 id 不是 label）。
--
-- 逐字沿用 migration_20260721h.sql 現行版本的 wallet_spend_item() 白名單，
-- 只在 title 區塊新增 8 筆（財經皓角改名純前端 label 顯示，SQL 白名單不用改，
-- 白名單只認 id/price）。
--
-- 用法：Supabase Dashboard → SQL Editor → 全選貼上 → Run。
-- ⚠️ push 不會更新 DB，一定要手動跑這份。
-- ============================================================

create or replace function public.wallet_spend_item(p_item_id text)
returns table(diamonds int, owned jsonb, ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      text := auth.uid()::text;
  v_price    int;
  v_owned    jsonb;
  v_diamonds int;
begin
  if v_uid is null then return; end if;

  select t.price into v_price from (values
    ('nickcolor:neon-cyan'::text,   50),
    ('nickcolor:amber-gold',        50),
    ('nickcolor:danger-red',        80),
    ('nickcolor:deep-purple',       80),
    ('nickcolor:ghost-gray',       100),
    ('nickcolor:black-gold',       250),
    ('title:newbie-knight',        200),
    ('title:taiex-god',            200),
    ('title:shoeshine-boy',        200),
    ('title:shoeshine-chairman',   200),
    ('title:bull-bear-clash',      200),
    ('title:park-homeless',        200),
    ('title:finance-haojiao',      200),
    ('title:chives',                200),
    ('title:fourth-institution',   200),
    -- 2026-07-21l 新增 8 個股市梗稱號 ─────────────────────────
    ('title:bulls-win-eventually', 200),
    ('title:ba-nini',              200),
    ('title:short-squeeze-escape', 200),
    ('title:four-generations-debt',200),
    ('title:nano-shareholder',     200),
    ('title:allin-wisdom',         200),
    ('title:buy-the-dip',          200),
    ('title:park-bench-resident',  200),
    ('badge:fire',                  80),
    ('badge:star',                  80),
    ('badge:crown',                150),
    ('badge:diamond',              150),
    ('badge:motorcycle',           100),
    ('trail:amber',                 80),
    ('trail:magenta',               80),
    ('trail:green',                 80),
    ('trail:white',                100),
    ('ghostcolor:amber',            80),
    ('ghostcolor:magenta',          80),
    ('ghostcolor:green',            80),
    ('ghostcolor:white',           100)
  ) as t(id, price) where t.id = p_item_id;
  if v_price is null then return; end if; -- 未知/不可購買項目（含黑天鵝專屬道具、成就解鎖稱號）一律靜默拒絕

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  select w.owned, w.diamonds into v_owned, v_diamonds
    from public.player_wallet w where w.player_id = v_uid for update;

  if v_owned ? p_item_id then
    return query select v_diamonds, v_owned, true; -- 已擁有：冪等回傳現況，不重複扣款
    return;
  end if;

  if v_diamonds < v_price then
    return query select v_diamonds, v_owned, false;
    return;
  end if;

  v_diamonds := v_diamonds - v_price;
  v_owned := v_owned || jsonb_build_array(p_item_id);

  update public.player_wallet
     set diamonds = v_diamonds, owned = v_owned, updated_at = now()
   where player_id = v_uid;

  return query select v_diamonds, v_owned, true;
end;
$$;
revoke execute on function public.wallet_spend_item(text) from public, anon;
grant  execute on function public.wallet_spend_item(text) to authenticated;
