-- ============================================================
-- TaiexRider migration 2026-07-21h — wallet_spend_item() 稱號白名單過期修復
--
-- 背景：使用者實測「個人化裝備」的稱號區塊，除了「台股股神」以外全部點了沒反應
-- （買不了）。根因：`wallet_spend_item()`（migration_20260721.sql）寫的時候，稱號
-- 目錄還是最初版（連勝狂魔/排行榜常客/空中飛人/地心引力挑戰者/完美落地大師/
-- 台股股神）；同一天稍晚「第二輪」把可購買稱號整批換成股市梗（新手騎士/台股股神/
-- 擦鞋童/擦鞋董/多空交戰/公園街友/財經皓角/韭菜/第四大法人，原本那 5 個改成成就
-- 解鎖不可購買），但這份 SQL 白名單忘記同步更新——只剩「台股股神」剛好新舊都有，
-- 其餘全被 `if v_price is null then return` 靜默拒絕。
--
-- 做法：整份白名單改成跟 Garage.tsx COSMETIC_CATALOG 現況一致（nickcolor/badge/
-- trail/ghostcolor 不變，title 換成 9 個股市梗，移除 5 個已改成就解鎖的舊 id——
-- 那 5 個現在走 wallet_unlock_achievement()，不該再出現在購買白名單裡）。
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
