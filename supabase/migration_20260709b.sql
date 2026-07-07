-- ============================================================================
-- 2026-07-09（緊急修復）：wallet_earn() / claim_weekly_quest() / grant_iap_diamonds()
-- 三支函式的 UPDATE 敘述都有「欄位參照不明確」(ambiguous column reference, SQLSTATE
-- 42702) 的 bug——這三支函式都用 `returns table(coins int, ...)` 或
-- `returns table(diamonds int, ...)`，PL/pgSQL 會把 coins/diamonds 這兩個輸出欄位
-- 名稱當成函式內的隱含變數；當 UPDATE 敘述寫 `set coins = coins + v_amount` 時，
-- 右邊那個 `coins` 到底是指 player_wallet.coins 這個資料表欄位、還是函式的輸出變數，
-- Postgres 無法判斷，整個函式呼叫會直接拋例外中止（連同前面已經 insert 的
-- wallet_earn_log 那筆也會被一起 rollback，玩家端完全看不到任何錯誤，只會安靜地
-- 拿不到錢）。
--
-- 這個 bug 從 migration_20260705.sql 的第一版 wallet_earn() 就存在，一路被複製到
-- 後續每一版（20260706b/20260707c/20260708/20260709），代表**伺服器端從 7/5 上線
-- 以來，玩家從來沒有真的透過 wallet_earn()/claim_weekly_quest() 拿到過金幣，
-- 也沒有玩家透過 grant_iap_diamonds()（真錢購買鑽石）真的拿到過鑽石**——玩家畫面上
-- 看到的加幣，全部只是前端 addCoins() 的樂觀顯示，從來沒有真正寫進資料庫，一旦任何
-- 畫面重新從伺服器同步（例如進車庫），就會被打回原本（沒有增加過）的真實餘額。
--
-- 這次是使用者實測「看廣告拿金幣」失敗、直接在瀏覽器 devtools 抓到 Network 回傳的
-- 400 錯誤內容才找到的（SQLSTATE 42702, message: column reference "coins" is
-- ambiguous）。settle_daily_diamonds()/settle_classic_weekly() 兩支函式因為
-- `returns void`（沒有輸出欄位跟 diamonds 撞名），不受影響，一直都是正常的——排行榜
-- 名次獎鑽石、經典模式週結算鑽石這兩條路徑玩家應該有正常收到。
--
-- 修法：把 UPDATE 敘述裡容易誤判的欄位加上資料表名稱前綴（player_wallet.coins /
-- player_wallet.diamonds），跟函式的輸出變數 disambiguate，不改動任何金額/上限/
-- 業務邏輯，三支函式其餘部分逐字照舊。
--
-- 在 Supabase SQL Editor 執行一次即可，執行後建議立刻用真實帳號測一次「看廣告拿
-- 金幣」或「完賽」，並直接查 wallet_earn_log 確認有新的一筆寫入、player_wallet.coins
-- 真的有增加。
-- ============================================================================

-- ── ① wallet_earn()：完賽/摔車/長征/任務/看廣告 金幣 ─────────────────────────
create or replace function public.wallet_earn(p_kind text, p_amount int default null)
returns table(coins int, diamonds int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      text := auth.uid()::text;
  v_amount   int;
  v_cap      int;
  v_log_kind text;
  v_step     int;
  v_today    date := (now() at time zone 'Asia/Taipei')::date;
  v_n        int;
  v_change   numeric;
begin
  if v_uid is null then return; end if;

  case p_kind
    when 'finish'      then v_amount := 5;  v_log_kind := 'play';  v_step := 5;  v_cap := 100;
    when 'crash'       then v_amount := 2;  v_log_kind := 'play';  v_step := 2;  v_cap := 100;
    when 'long_finish' then v_amount := 30; v_log_kind := 'play';  v_step := 30; v_cap := 100;
    when 'long_crash'  then
      v_amount   := greatest(0, least(30, coalesce(p_amount, 0))); -- 不信任前端，clamp 在 0~30
      v_log_kind := 'play';
      v_step     := v_amount;
      v_cap      := 100;
    when 'quest'  then v_amount := 25; v_log_kind := 'quest'; v_step := 1;  v_cap := 3;
    when 'ad'     then v_amount := 40; v_log_kind := 'ad';    v_step := 1;  v_cap := 2;
    else return; -- 未知 kind 靜默拒絕
  end case;

  if p_kind = 'quest' then
    v_change := public.taiex_change_pct();
    if v_change is not null and abs(v_change) >= 0.025 then
      v_amount := v_amount * 2;
    end if;
  end if;

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  insert into public.wallet_earn_log as l (player_id, earn_date, kind, n)
  values (v_uid, v_today, v_log_kind, v_step)
  on conflict (player_id, earn_date, kind) do update set n = l.n + v_step
  returning n into v_n;
  if v_n > v_cap then
    return query select w.coins, w.diamonds from public.player_wallet w where w.player_id = v_uid;
    return;
  end if;

  update public.player_wallet
     set coins = player_wallet.coins + v_amount, updated_at = now()
   where player_id = v_uid;

  return query select w.coins, w.diamonds from public.player_wallet w where w.player_id = v_uid;
end;
$$;
revoke execute on function public.wallet_earn(text, int) from public, anon;
grant  execute on function public.wallet_earn(text, int) to authenticated;

-- ── ② claim_weekly_quest()：週任務領獎金幣 ───────────────────────────────
create or replace function public.claim_weekly_quest(p_week text, p_quest_id text)
returns table(coins int, ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     text := auth.uid()::text;
  v_reward  int;
  v_change  numeric;
  v_claimed text[];
begin
  if v_uid is null then return; end if;

  case p_quest_id
    when 'w_flips30'    then v_reward := 40;
    when 'w_perfect10'  then v_reward := 40;
    when 'w_score2000'  then v_reward := 40;
    when 'w_play10'     then v_reward := 35;
    when 'w_survive25'  then v_reward := 35;
    when 'w_finish10'       then v_reward := 40;
    when 'w_longFinish3'    then v_reward := 45;
    when 'w_classicFinish3' then v_reward := 40;
    when 'w_upDayFinish3'   then v_reward := 35;
    when 'w_downDayFinish3' then v_reward := 35;
    else
      return query select w.coins, false from public.player_wallet w where w.player_id = v_uid;
      return;
  end case;

  insert into public.player_weekly_quest (player_id, week_key) values (v_uid, p_week)
    on conflict (player_id, week_key) do nothing;

  select claimed into v_claimed from public.player_weekly_quest
    where player_id = v_uid and week_key = p_week;

  if v_claimed is not null and p_quest_id = any(v_claimed) then
    return query select w.coins, false from public.player_wallet w where w.player_id = v_uid;
    return;
  end if;

  v_change := public.taiex_change_pct();
  if v_change is not null and abs(v_change) >= 0.025 then
    v_reward := v_reward * 2;
  end if;

  update public.player_weekly_quest
     set claimed = claimed || array[p_quest_id], updated_at = now()
   where player_id = v_uid and week_key = p_week;

  insert into public.player_wallet (player_id) values (v_uid) on conflict (player_id) do nothing;
  update public.player_wallet set coins = player_wallet.coins + v_reward, updated_at = now() where player_id = v_uid;

  return query select w.coins, true from public.player_wallet w where w.player_id = v_uid;
end;
$$;
revoke execute on function public.claim_weekly_quest(text,text) from public, anon;
grant  execute on function public.claim_weekly_quest(text,text) to authenticated;

-- ── ③ grant_iap_diamonds()：真錢購買鑽石（只給 service_role 呼叫）───────────
create or replace function public.grant_iap_diamonds(
  p_player_id      text,
  p_sku_id         text,
  p_purchase_token text
) returns table(diamonds int, ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount int;
begin
  if p_player_id is null or p_purchase_token is null then
    return query select 0, false; return;
  end if;

  -- SKU 白名單（暫定佔位鑽石數，對照 Play Console 商品設定，之後要同步改）
  case p_sku_id
    when 'diamonds_100'  then v_amount := 100;
    when 'diamonds_350'  then v_amount := 350;
    when 'diamonds_1200' then v_amount := 1200;
    else
      return query select 0, false; return;
  end case;

  -- 防重放：同一個 purchase_token 只能兌換一次
  if exists (select 1 from public.iap_purchases where purchase_token = p_purchase_token) then
    return query select w.diamonds, false from public.player_wallet w where w.player_id = p_player_id;
    return;
  end if;

  insert into public.iap_purchases (purchase_token, player_id, sku_id, diamonds)
  values (p_purchase_token, p_player_id, p_sku_id, v_amount);

  insert into public.player_wallet (player_id) values (p_player_id) on conflict (player_id) do nothing;
  update public.player_wallet
     set diamonds = player_wallet.diamonds + v_amount, updated_at = now()
   where player_id = p_player_id;

  return query select w.diamonds, true from public.player_wallet w where w.player_id = p_player_id;
end;
$$;
revoke execute on function public.grant_iap_diamonds(text, text, text) from public, anon, authenticated;
