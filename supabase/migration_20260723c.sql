-- ============================================================
-- TaiexRider migration 2026-07-23c — submit_daily_score() 加診斷原因碼
--
-- 背景：使用者回報「跑了一場 2100 分結果沒送出去，舊的 1784 沒被覆蓋」。查
-- submit_daily_score() 發現函式回傳型別是 void，內部 6~7 道防作弊檢查任何一道
-- 沒過都直接靜默 return，不留任何記錄；前端 leaderboard.ts submitDailyScore()
-- 只看 HTTP 是否 200，這支 RPC 靜默 return 一樣回 200——玩家跟開發者都無法分辨
-- 「真的寫入成功」還是「被防作弊擋下」，出事後完全查不出是哪一關卡住。
--
-- 做法：函式簽章改成 returns table(ok boolean, reason text)，每個提早 return
-- 的分支都標上明確原因碼；成功路徑區分「真的改善分數寫入」(ok, reason='ok')
-- 跟「分數沒有比現有紀錄好，正確地不覆蓋」(ok, reason='not_improved'，這不是
-- bug，是既有『分數只增不減』設計的正常結果)。所有既有檢查的條件/順序/數值
-- 完全不變，只是加上標籤，不改變任何判斷邏輯本身。
--
-- 用法：Supabase Dashboard → SQL Editor → 全選貼上 → Run。
-- ⚠️ push 不會更新 DB，一定要手動跑這份。
-- ============================================================

drop function if exists public.submit_daily_score(text, int, int, int, int, jsonb, text);
create or replace function public.submit_daily_score(
  p_name    text,
  p_score   int,
  p_time    int,
  p_flips   int default 0,
  p_perfect int default 0,
  p_replay  jsonb default null,
  p_skin_id text default 'default'
) returns table(ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_today date := coalesce(
    (select max(map_date) from public.daily_map
       where map_date <= (now() at time zone 'Asia/Taipei')::date),
    (now() at time zone 'Asia/Taipei')::date
  );
  v_slack   constant int     := 500;
  v_speed   constant numeric := 414.72;
  v_last    timestamptz;
  v_len     int;
  v_full_ms numeric;
  v_ratio   numeric;
  v_attempts int;
  v_new_count int;
  v_ev_flip  int;
  v_ev_perf  int;
  v_ev_last  numeric;
  v_path_len int;
  v_path_step int;
  v_path_last numeric;
begin
  v_uid := auth.uid()::text;
  if v_uid is null then
    return query select false, 'no_auth'::text; return;
  end if;

  -- 單欄位範圍驗證（既有）
  if p_score  < 0      or p_score  > 50000   then
    return query select false, 'score_range'::text; return;
  end if;
  if p_time   < 1000   or p_time   > 7200000 then
    return query select false, 'time_range'::text; return;
  end if;
  if p_flips  < 0      or p_flips  > 50      then
    return query select false, 'flips_range'::text; return;
  end if;
  if p_perfect < 0     or p_perfect > 50     then
    return query select false, 'perfect_range'::text; return;
  end if;

  -- [A9] 這一期必須消耗過至少一次排名賽次數才可能有分數要交
  select attempts into v_attempts from public.wallet_daily_attempts
   where player_id = v_uid and challenge_date = v_today;
  if coalesce(v_attempts, 0) < 1 then
    return query select false, 'no_attempts'::text; return;
  end if;

  -- [A1] 提交冷卻：同 uid 距上次「成功寫入」< 10s 靜默拒絕
  select created_at into v_last from public.daily_scores
   where challenge_date = v_today and player_id = v_uid;
  if v_last is not null and now() - v_last < interval '10 seconds' then
    return query select false, 'cooldown'::text; return;
  end if;

  -- [A2] 分數上限：行進 1000 + 完美翻轉 200/圈 + 舊制 slack
  if p_score > 1000 + 200 * p_flips + v_slack then
    return query select false, 'score_ceiling'::text; return;
  end if;

  -- [A3] 完美落地不可能多於翻轉（每次完美至少記 1 圈）
  if p_perfect > p_flips + 3 then
    return query select false, 'perfect_exceeds_flips'::text; return;
  end if;

  -- [A4] 翻轉/時間比：物理極限 ≈ 1.9 圈/s → 2 圈/s + 3 緩衝
  if p_flips > ceil(p_time / 1000.0) * 2 + 3 then
    return query select false, 'flip_rate'::text; return;
  end if;

  -- [A5] 時間下限：分數隱含「至少跑了多遠」→ 至少要花多少時間
  select jsonb_array_length(prices) into v_len
    from public.daily_map where map_date = v_today
   order by difficulty desc limit 1;
  if v_len is not null then
    v_full_ms := (v_len + 4) * 80 / v_speed * 1000;
    v_ratio := least(1.0, greatest(0.0, (p_score - 200 * p_flips - v_slack) / 1000.0));
    if p_time < v_ratio * v_full_ms * 0.9 then
      return query select false, 'time_too_short'::text; return;
    end if;
  end if;

  -- [C1]+[C2] 有帶 replay 才驗（向下相容舊客戶端）。整塊包 exception：格式惡意/
  -- 損壞（非物件、欄位型別錯造成 cast 失敗等）一律靜默拒絕，不回 SQL 錯誤。
  if p_replay is not null then
    begin
      -- [C2] 大小/型別/長度硬上限（防 DB 膨脹＋防鬼影資料污染）
      if pg_column_size(p_replay) > 65536 then
        return query select false, 'replay_too_large'::text; return;
      end if;
      if jsonb_typeof(p_replay) <> 'object' then
        return query select false, 'replay_bad_format'::text; return;
      end if;
      if jsonb_typeof(coalesce(p_replay->'events', '[]'::jsonb)) <> 'array' then
        return query select false, 'replay_bad_format'::text; return;
      end if;
      if jsonb_typeof(coalesce(p_replay->'path',   '[]'::jsonb)) <> 'array' then
        return query select false, 'replay_bad_format'::text; return;
      end if;
      if jsonb_array_length(coalesce(p_replay->'events', '[]'::jsonb)) > 150 then
        return query select false, 'replay_too_many_events'::text; return;
      end if;

      -- [C3] path 雙格式驗證：v1（vc28）＝純數字陣列，x 每 500ms；
      -- v2（vc29 起）＝[x,y,角度] 三元組每 250ms，客戶端錄滿 2400 筆封頂。
      v_path_len := jsonb_array_length(coalesce(p_replay->'path', '[]'::jsonb));
      if v_path_len = 0 then
        -- 空 path：只有極短局才合理（正常客戶端 t=0 就會記第一筆）
        if ceil(p_time / 500.0) > 5 then
          return query select false, 'replay_empty_path'::text; return;
        end if;
      elsif jsonb_typeof(p_replay->'path'->0) = 'array' then
        -- v2
        v_path_step := 250;
        if v_path_len > 2400 then
          return query select false, 'replay_path_too_long'::text; return;
        end if;
        if exists (
          select 1 from jsonb_array_elements(p_replay->'path') e
           where jsonb_typeof(e.value) <> 'array'
              or jsonb_array_length(e.value) <> 3
              or jsonb_typeof(e.value->0) <> 'number'
              or jsonb_typeof(e.value->1) <> 'number'
              or jsonb_typeof(e.value->2) <> 'number'
        ) then
          return query select false, 'replay_path_bad_element'::text; return;
        end if;
        if abs(v_path_len - least(ceil(p_time / 250.0), 2400)) > 8 then
          return query select false, 'replay_path_len_mismatch'::text; return;
        end if;
        v_path_last := v_path_len * v_path_step;
        if v_path_last > p_time + 2000 + v_path_step then
          return query select false, 'replay_path_time_mismatch'::text; return;
        end if;
      else
        -- v1
        v_path_step := 500;
        if exists (
          select 1 from jsonb_array_elements(p_replay->'path') e
           where jsonb_typeof(e.value) <> 'number'
        ) then
          return query select false, 'replay_path_bad_element'::text; return;
        end if;
        if abs(v_path_len - ceil(p_time / 500.0)) > 5 then
          return query select false, 'replay_path_len_mismatch'::text; return;
        end if;
        v_path_last := v_path_len * v_path_step;
        if v_path_last > p_time + 2000 + v_path_step then
          return query select false, 'replay_path_time_mismatch'::text; return;
        end if;
      end if;

      -- [C1] 事件粗一致性：events 圈數加總 / perfect 筆數 vs 回報值
      select coalesce(sum((ev->>2)::int), 0),
             count(*) filter (where ev->>1 = 'p'),
             coalesce(max((ev->>0)::numeric), 0)
        into v_ev_flip, v_ev_perf, v_ev_last
        from jsonb_array_elements(coalesce(p_replay->'events', '[]'::jsonb)) ev;

      if abs(v_ev_flip - p_flips) > 2 then
        return query select false, 'replay_flip_mismatch'::text; return;
      end if;
      if abs(v_ev_perf - p_perfect) > 2 then
        return query select false, 'replay_perfect_mismatch'::text; return;
      end if;
      if v_ev_last > p_time + 2000 then
        return query select false, 'replay_event_time_mismatch'::text; return;
      end if;
    exception when others then
      return query select false, 'replay_exception'::text; return;
    end;
  end if;

  insert into public.daily_scores
    (challenge_date, player_id, player_name, score, time_ms, flips, perfect, submit_count, replay, skin_id)
  values (v_today, v_uid, left(p_name, 16), p_score, p_time, p_flips, p_perfect, 1, p_replay, left(coalesce(p_skin_id, 'default'), 32))
  on conflict (challenge_date, player_id) do update
    set score        = excluded.score,
        time_ms      = excluded.time_ms,
        flips        = excluded.flips,
        perfect      = excluded.perfect,
        player_name  = excluded.player_name,
        created_at   = now(),
        submit_count = public.daily_scores.submit_count + 1,
        replay       = excluded.replay,
        skin_id      = excluded.skin_id
    where excluded.score > public.daily_scores.score
       or (excluded.score = public.daily_scores.score
           and excluded.time_ms < public.daily_scores.time_ms)
  returning submit_count into v_new_count;

  -- v_new_count 是 null：conflict 存在但 where 條件沒過（新分數沒有比現有紀錄好）
  -- ——這是既有「分數只增不減」設計的正常結果，不是 bug。
  if v_new_count is null then
    return query select true, 'not_improved'::text; return;
  end if;

  -- [B1] 單日「真的改善分數」的提交次數 > 12 次 → 標記可疑（不擋提交）
  if v_new_count > 12 then
    update public.daily_scores set suspect = true
     where challenge_date = v_today and player_id = v_uid;
  end if;

  return query select true, 'ok'::text;
end;
$$;
revoke execute on function public.submit_daily_score(text, int, int, int, int, jsonb, text) from public, anon;
grant  execute on function public.submit_daily_score(text, int, int, int, int, jsonb, text) to authenticated;
