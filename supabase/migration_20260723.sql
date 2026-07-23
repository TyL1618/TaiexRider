-- 2026-07-23：自選/隨機賽道完賽金幣 5→10、摔車 2→4（使用者拍板：隨機賽道抽到的
-- 股票走勢難易不可控，對玩家本來就帶點賭注成分，獎勵加碼平衡這個不確定性）。
-- 長征模式（long_finish/long_crash）、每日/週任務(quest)、看廣告(ad) 三個 case 分支
-- 數字不變，只動 finish/crash 這兩行。函式簽章/回傳型別跟 migration_20260710.sql
-- 那版完全一樣，create or replace 直接蓋掉即可，不用 drop。
create or replace function public.wallet_earn(p_kind text, p_amount int default null)
returns table(coins int, diamonds int, granted boolean)
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
    when 'finish'      then v_amount := 10; v_log_kind := 'play';  v_step := 10; v_cap := 100;
    when 'crash'       then v_amount := 4;  v_log_kind := 'play';  v_step := 4;  v_cap := 100;
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

  -- 超過每日上限：不加錢，granted=false 讓前端能明確告訴玩家「今日已達上限」，
  -- 不要再靜默把樂觀更新的數字捲回去（玩家會以為是 bug 或被吃錢）。
  if v_n > v_cap then
    return query select w.coins, w.diamonds, false from public.player_wallet w where w.player_id = v_uid;
    return;
  end if;

  update public.player_wallet
     set coins = player_wallet.coins + v_amount, updated_at = now()
   where player_wallet.player_id = v_uid;

  return query select w.coins, w.diamonds, true from public.player_wallet w where w.player_id = v_uid;
end;
$$;
revoke execute on function public.wallet_earn(text, int) from public, anon;
grant  execute on function public.wallet_earn(text, int) to authenticated;
