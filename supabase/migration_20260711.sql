-- ============================================================================
-- 2026-07-11：claim_weekly_quest() 補「伺服器端進度驗證」（反作弊邏輯洞修補）
--
-- ── 為什麼 ─────────────────────────────────────────────────────────────────
-- 舊版 claim_weekly_quest()（migration_20260708b / 20260709b）發金幣前只檢查兩件事：
--   ① quest_id 在白名單內、② 這週還沒領過。
-- **從來沒有驗證玩家的實際進度有沒有達標**——它信任「前端只會在任務完成時呼叫」。
-- 但這支 RPC 是 grant to authenticated，任何登入者拿自己的 JWT 直接打
--   POST /rest/v1/rpc/claim_weekly_quest  {p_week, p_quest_id}
-- 帶任意一個合法 quest_id，就能無條件領走該週金幣，完全不用玩。一週可刷光全部 10 個
-- 週任務（≈380 金幣）。金幣是純外觀貨幣（只買車皮、不碰真錢/排行榜），但這牴觸
-- 「任何影響遊戲的數值竄改都不接受」的既定原則，且比照 wallet_unlock_achievement
-- 早已改成 v2 伺服器自驗門檻，這支是漏網的同類洞。
--
-- ── 修法 ───────────────────────────────────────────────────────────────────
-- 發錢前先讀該玩家本週 player_weekly_quest 整列（%rowtype），依 quest_id 對應到
-- 該任務的進度欄位，驗證 progress >= target 才發；未達標回 ok=false（跟「已領過」
-- 同樣靜默拒絕，不發錢也不標 claimed）。target/欄位對照與前端 weeklyQuests.ts POOL
-- 完全一致。金額/上限/狂暴盤×2/防重複領 全部邏輯照舊，只多加一道進度閘門。
--
-- ⚠️ 42702 防呆：本函式 returns table(coins int, ok boolean)。所有進度欄位都透過
-- v_row（%rowtype 區域變數）讀取、UPDATE 一律加 player_wallet. 前綴，從結構上不可能
-- 跟輸出欄位撞名（見 CLAUDE.md「PL/pgSQL 踩雷」）。
--
-- 執行方式：Supabase Dashboard → SQL Editor 貼上整份執行一次（push 不會自動生效）。
-- 執行後建議用真實帳號測：① 未達標的週任務直接打 RPC 應回 ok=false、金幣不變；
-- ② 正常玩到達標再領應正常發放且只能領一次。
-- ============================================================================

create or replace function public.claim_weekly_quest(p_week text, p_quest_id text)
returns table(coins int, ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      text := auth.uid()::text;
  v_reward   int;
  v_target   int;
  v_progress numeric;
  v_change   numeric;
  v_row      public.player_weekly_quest%rowtype;
begin
  if v_uid is null then return; end if;

  -- 任務白名單：面額 + 達標門檻（與前端 weeklyQuests.ts POOL 同步；新增任務要一起改）
  case p_quest_id
    when 'w_flips30'        then v_reward := 40; v_target := 30;
    when 'w_perfect10'      then v_reward := 40; v_target := 10;
    when 'w_score2000'      then v_reward := 40; v_target := 1;  -- max_score>=2000 → 進度 1
    when 'w_play10'         then v_reward := 35; v_target := 10;
    when 'w_survive25'      then v_reward := 35; v_target := 1;  -- max_survive_sec>=25 → 進度 1
    when 'w_finish10'       then v_reward := 40; v_target := 10;
    when 'w_longFinish3'    then v_reward := 45; v_target := 3;
    when 'w_classicFinish3' then v_reward := 40; v_target := 3;
    when 'w_upDayFinish3'   then v_reward := 35; v_target := 3;
    when 'w_downDayFinish3' then v_reward := 35; v_target := 3;
    else
      return query select w.coins, false from public.player_wallet w where w.player_id = v_uid;
      return;
  end case;

  insert into public.player_weekly_quest (player_id, week_key) values (v_uid, p_week)
    on conflict (player_id, week_key) do nothing;

  select * into v_row from public.player_weekly_quest
    where player_id = v_uid and week_key = p_week;

  -- 已領過：靜默拒絕
  if v_row.claimed is not null and p_quest_id = any(v_row.claimed) then
    return query select w.coins, false from public.player_wallet w where w.player_id = v_uid;
    return;
  end if;

  -- 🔒 進度閘門：伺服器自己算這個 quest 的實際進度，未達標一律拒絕（不信任「有呼叫＝已完成」）
  v_progress := case p_quest_id
    when 'w_flips30'        then v_row.flips_sum
    when 'w_perfect10'      then v_row.perfect_sum
    when 'w_score2000'      then case when v_row.max_score       >= 2000 then 1 else 0 end
    when 'w_play10'         then v_row.play_count
    when 'w_survive25'      then case when v_row.max_survive_sec >= 25   then 1 else 0 end
    when 'w_finish10'       then v_row.finish_count
    when 'w_longFinish3'    then v_row.long_finish_count
    when 'w_classicFinish3' then v_row.classic_finish_count
    when 'w_upDayFinish3'   then v_row.up_day_finish_count
    when 'w_downDayFinish3' then v_row.down_day_finish_count
  end;
  if coalesce(v_progress, 0) < v_target then
    return query select w.coins, false from public.player_wallet w where w.player_id = v_uid;
    return;
  end if;

  -- 狂暴盤日（|漲跌|≥2.5%）獎勵 ×2（伺服器自算當期漲跌，不信任前端）
  v_change := public.taiex_change_pct();
  if v_change is not null and abs(v_change) >= 0.025 then
    v_reward := v_reward * 2;
  end if;

  update public.player_weekly_quest
     set claimed = claimed || array[p_quest_id], updated_at = now()
   where player_id = v_uid and week_key = p_week;

  insert into public.player_wallet (player_id) values (v_uid) on conflict (player_id) do nothing;
  update public.player_wallet
     set coins = player_wallet.coins + v_reward, updated_at = now()
   where player_wallet.player_id = v_uid;

  return query select w.coins, true from public.player_wallet w where w.player_id = v_uid;
end;
$$;
revoke execute on function public.claim_weekly_quest(text,text) from public, anon;
grant  execute on function public.claim_weekly_quest(text,text) to authenticated;

-- ── 驗收（跑完貼回結果確認）────────────────────────────────────────────────
-- 用玩家 JWT 呼叫（Dashboard postgres 角色 auth.uid() 為 null 會直接 return）：
--   select * from public.claim_weekly_quest('2026-W28', 'w_play10');  -- 沒玩滿應 ok=false
