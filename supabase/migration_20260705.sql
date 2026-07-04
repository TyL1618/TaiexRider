-- ============================================================
-- TaiexRider migration 2026-07-05 — 伺服器端錢包（金幣/鑽石/擁有清單）
--                                  + 每日排名賽次數上限搬 DB
-- 背景：SECURITY_REVIEW 2026-07-04 第二輪 🟠 項 + WALLET_PLAN.md。
--       localStorage 金幣/鑽石/擁有清單/每日 5 次上限全部可被使用者端竄改
--       （DevTools 直接改 tr_garage_coins/tr_garage_diamonds/tr_garage_owned）。
--       使用者裁示「任何影響遊戲的數值竄改都不接受」，本檔把已登入玩家的
--       這些數值搬到伺服器端 RPC 驗證，localStorage 只當顯示快取。
-- 誠實邊界（已向使用者說明，WALLET_PLAN.md 開頭）：伺服器驗證不了「你真的
--       完賽了」（要到反作弊 Phase C 事件流才行），所以用「伺服器端每日發幣
--       上限」封頂——竄改者最多騙到「正常玩一整天」的量，不能再多。
--       Q 系列成就解鎖同理：v1 先信任客戶端宣稱（無競技/金錢意義的純收藏
--       cosmetic），v2 才用 events 表回驗，見 wallet_unlock_achievement 註解。
-- 未登入玩家：維持現行純 localStorage（上不了排行榜，竄改只影響自己的離線
--       收藏，接受，與現行「每日 5 次」的定位一致）。
-- 用法：Supabase Dashboard → SQL Editor → 全選貼上 → Run（跑一次即可，可重複跑）。
-- ⚠️ push 不會更新 DB，一定要手動跑這份，否則錢包 RPC 不存在、客戶端會 fallback
--    純本地模式（garage.ts 呼叫失敗即靜默略過，不影響遊戲，但沒有伺服器保護）。
-- ============================================================

-- ── player_wallet：金幣/鑽石/擁有清單，只能透過下方 security definer RPC 存取 ──
create table if not exists public.player_wallet (
  player_id  text primary key,                       -- = auth.uid()::text
  coins      int   not null default 0    check (coins >= 0),
  diamonds   int   not null default 0    check (diamonds >= 0),
  owned      jsonb not null default '["default"]'::jsonb,  -- 車皮 id 陣列，default 開局即有
  updated_at timestamptz not null default now()
);
alter table public.player_wallet enable row level security;
revoke all on table public.player_wallet from public, anon, authenticated;

-- ── wallet_earn_log：每日每種發幣管道次數上限（防狂點/腳本狂打）──────
create table if not exists public.wallet_earn_log (
  player_id text not null,
  earn_date date not null,
  kind      text not null,   -- 'finish' / 'crash' / 'quest' / 'ad'
  n         int  not null default 0,
  primary key (player_id, earn_date, kind)
);
alter table public.wallet_earn_log enable row level security;
revoke all on table public.wallet_earn_log from public, anon, authenticated;

-- ── wallet_daily_attempts：每日排名賽挑戰次數（根治 Phase B「清 localStorage 繞過」）──
create table if not exists public.wallet_daily_attempts (
  player_id      text not null,
  challenge_date date not null,
  attempts       int  not null default 0,
  primary key (player_id, challenge_date)
);
alter table public.wallet_daily_attempts enable row level security;
revoke all on table public.wallet_daily_attempts from public, anon, authenticated;

-- ── wallet_get()：讀取（沒有列就先建立預設列）─────────────────────
create or replace function public.wallet_get()
returns table(coins int, diamonds int, owned jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then return; end if; -- 未登入：回傳空 rowset，客戶端 fallback 純本地

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  return query select w.coins, w.diamonds, w.owned from public.player_wallet w where w.player_id = v_uid;
end;
$$;
revoke execute on function public.wallet_get() from public, anon;
grant  execute on function public.wallet_get() to authenticated;

-- ── wallet_earn(kind)：伺服器決定面額 + 每日上限，客戶端不能傳金額 ──────
-- 面額/上限對照 WALLET_PLAN.md：finish=10(≤30/天) crash=3(≤30/天)
-- quest=25(≤3/天，統一取任務獎勵上限避免傳 quest id 還要驗) ad=20(≤2/天，同 adRewards.ts 既有上限)。
create or replace function public.wallet_earn(p_kind text)
returns table(coins int, diamonds int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
  v_amount int;
  v_cap    int;
  v_today  date := (now() at time zone 'Asia/Taipei')::date;
  v_n      int;
begin
  if v_uid is null then return; end if;

  case p_kind
    when 'finish' then v_amount := 10; v_cap := 30;
    when 'crash'  then v_amount := 3;  v_cap := 30;
    when 'quest'  then v_amount := 25; v_cap := 3;
    when 'ad'     then v_amount := 20; v_cap := 2;
    else return; -- 未知 kind 靜默拒絕
  end case;

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  insert into public.wallet_earn_log as l (player_id, earn_date, kind, n)
  values (v_uid, v_today, p_kind, 1)
  on conflict (player_id, earn_date, kind) do update set n = l.n + 1
  returning n into v_n;
  if v_n > v_cap then
    -- 今日該管道已達上限：不發幣，仍回傳目前餘額讓客戶端校正本地快取（不是報錯）
    return query select w.coins, w.diamonds from public.player_wallet w where w.player_id = v_uid;
    return;
  end if;

  update public.player_wallet
     set coins = coins + v_amount, updated_at = now()
   where player_id = v_uid;

  return query select w.coins, w.diamonds from public.player_wallet w where w.player_id = v_uid;
end;
$$;
revoke execute on function public.wallet_earn(text) from public, anon;
grant  execute on function public.wallet_earn(text) to authenticated;

-- ── wallet_spend_skin(skin_id)：金幣/鑽石購買車皮（依 currency 扣對應餘額）──
-- 價格白名單同步 src/lib/garage.ts 的 BIKE_SKINS 付費項，改動要兩邊同步，
-- 跟 submit_classic_record 的經典關卡白名單同一套模式（不信任客戶端傳的價格）。
create or replace function public.wallet_spend_skin(p_skin_id text)
returns table(coins int, diamonds int, owned jsonb, ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      text := auth.uid()::text;
  v_price    int;
  v_currency text;
  v_owned    jsonb;
  v_coins    int;
  v_diamonds int;
begin
  if v_uid is null then return; end if;

  select t.price, t.currency into v_price, v_currency from (values
    ('b2-cafe-racer'::text, 200, 'coin'::text),
    ('b1-street-white',     150, 'coin'),
    ('p1-crimson',          300, 'diamond'),
    ('p2-galaxy',           380, 'diamond')
  ) as t(id, price, currency) where t.id = p_skin_id;
  if v_price is null then return; end if; -- 未知/免費車款不走這個 RPC，靜默拒絕

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  select w.owned, w.coins, w.diamonds into v_owned, v_coins, v_diamonds
    from public.player_wallet w where w.player_id = v_uid for update;

  if v_owned ? p_skin_id then
    return query select v_coins, v_diamonds, v_owned, true; -- 已擁有：冪等回傳現況，不重複扣款
    return;
  end if;

  if v_currency = 'diamond' then
    if v_diamonds < v_price then
      return query select v_coins, v_diamonds, v_owned, false;
      return;
    end if;
    v_diamonds := v_diamonds - v_price;
  else
    if v_coins < v_price then
      return query select v_coins, v_diamonds, v_owned, false;
      return;
    end if;
    v_coins := v_coins - v_price;
  end if;

  v_owned := v_owned || jsonb_build_array(p_skin_id);

  update public.player_wallet
     set coins = v_coins, diamonds = v_diamonds, owned = v_owned, updated_at = now()
   where player_id = v_uid;

  return query select v_coins, v_diamonds, v_owned, true;
end;
$$;
revoke execute on function public.wallet_spend_skin(text) from public, anon;
grant  execute on function public.wallet_spend_skin(text) to authenticated;

-- ── wallet_unlock_achievement(skin_id)：Q 系列成就解鎖（不扣款）───────
-- ⚠️ v1 先信任客戶端宣稱（achievements.ts/streak.ts 本地算的大漲/大跌完賽次數、
-- 連續參賽天數目前沒有伺服器端佐證）——可接受，因為 Q 系列是純 cosmetic，
-- 不進排行榜/不影響計分公平性，跟「每日 5 次」在 SECURITY_REVIEW 的定位一致。
-- v2（Phase C 或 events 表回驗）才用真實完賽事件數重新驗證，見 WALLET_PLAN.md 第 4 項。
create or replace function public.wallet_unlock_achievement(p_skin_id text)
returns table(owned jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
  v_owned jsonb;
begin
  if v_uid is null then return; end if;
  if p_skin_id not in ('q1-bull', 'q2-bear', 'q3-phoenix') then return; end if;

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  select w.owned into v_owned from public.player_wallet w where w.player_id = v_uid for update;
  if not (v_owned ? p_skin_id) then
    v_owned := v_owned || jsonb_build_array(p_skin_id);
    update public.player_wallet set owned = v_owned, updated_at = now() where player_id = v_uid;
  end if;

  return query select v_owned;
end;
$$;
revoke execute on function public.wallet_unlock_achievement(text) from public, anon;
grant  execute on function public.wallet_unlock_achievement(text) to authenticated;

-- ── wallet_dev_grant()：開發者測試帳號補滿金幣+鑽石（取代 App.tsx 前端 hack）──
-- JWT email 綁定，非開發者帳號靜默拒絕，模式同 admin_stats()。
create or replace function public.wallet_dev_grant()
returns table(coins int, diamonds int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   text := auth.uid()::text;
  v_email text := coalesce(auth.jwt() ->> 'email', '');
begin
  if v_uid is null then return; end if;
  if v_email <> 'tyl161803@gmail.com' then return; end if;

  insert into public.player_wallet (player_id) values (v_uid)
  on conflict (player_id) do nothing;

  update public.player_wallet
     set coins = 99999, diamonds = 99999, updated_at = now()
   where player_id = v_uid;

  return query select w.coins, w.diamonds from public.player_wallet w where w.player_id = v_uid;
end;
$$;
revoke execute on function public.wallet_dev_grant() from public, anon;
grant  execute on function public.wallet_dev_grant() to authenticated;

-- ── consume_attempt()：每日排名賽挑戰次數（反作弊 Phase B 首項）───────
-- challenge_date 與 submit_daily_score 同源（max(map_date ≤ 台灣今天)，DB 無資料 fallback 台灣日曆日）。
-- 未登入回傳 true（放行）：反正 submit_daily_score 本來就拒絕未登入提交，這裡卡未登入玩家
-- 的練習次數沒有防弊意義，維持現行「純前端 5 次」定位（見 SECURITY_REVIEW 對「作弊面非資安面」的結論）。
create or replace function public.consume_attempt()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
  v_today date := coalesce(
    (select max(map_date) from public.daily_map
       where map_date <= (now() at time zone 'Asia/Taipei')::date),
    (now() at time zone 'Asia/Taipei')::date
  );
  v_n int;
begin
  if v_uid is null then return true; end if;

  insert into public.wallet_daily_attempts as a (player_id, challenge_date, attempts)
  values (v_uid, v_today, 1)
  on conflict (player_id, challenge_date) do update set attempts = a.attempts + 1
  returning attempts into v_n;

  return v_n <= 5;
end;
$$;
revoke execute on function public.consume_attempt() from public, anon;
grant  execute on function public.consume_attempt() to authenticated;

-- ── 清理：wallet_earn_log / wallet_daily_attempts 只留最近 14 天（掛在既有清理節奏上）──
create or replace function public.cleanup_old_wallet_logs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.wallet_earn_log where earn_date < current_date - interval '14 days';
  delete from public.wallet_daily_attempts where challenge_date < current_date - interval '14 days';
end;
$$;
revoke execute on function public.cleanup_old_wallet_logs() from public, anon, authenticated;
