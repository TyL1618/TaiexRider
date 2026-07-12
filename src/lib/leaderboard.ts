// 排行榜 REST 服務（Phase 4 MVP）：直接 fetch PostgREST，不裝 SDK（零 bundle 成本）。
// 提交成績需 Google 登入（Supabase Auth），伺服器端用 auth.uid() 決定 player_id。

import { dailyKey } from "../data/pick";
import { resolveSessionDate } from "./dailyMap";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isLeaderboardConfigured = Boolean(URL && KEY);

export interface ScoreRow {
  player_name: string;
  score: number;
  time_ms: number;
  flips: number;
  perfect: number;
}

export interface SubmitStats {
  score: number;
  timeMs: number;
  flips: number;
  perfect: number;
  // 反作弊 Phase C + Ghost 用的輕量錄製（見 migration_20260712b.sql）。舊版客戶端
  // 沒有這欄位時 RPC 用 p_replay 預設值 null，完全向下相容。
  replay?: { events: [number, string, number][]; path: number[] };
}

function anonHeaders(): Record<string, string> {
  return { apikey: KEY!, Authorization: `Bearer ${KEY!}` };
}

const _topCache = new Map<string, Promise<ScoreRow[]>>();

// 清除某日排行榜快取（手動重整用）
export function invalidateDailyTop(date: string) {
  _topCache.delete(date);
}

// 讀某日排行榜（分數高→時間短，前 N 名）。promise 快取：同一天只打一次。
export function fetchDailyTop(challengeDate: string, limit = 100): Promise<ScoreRow[]> {
  if (!isLeaderboardConfigured) return Promise.resolve([]);
  if (!_topCache.has(challengeDate)) _topCache.set(challengeDate, _fetchTop(challengeDate, limit));
  return _topCache.get(challengeDate)!;
}

async function _fetchTop(challengeDate: string, limit: number): Promise<ScoreRow[]> {
  const q =
    `${URL}/rest/v1/daily_scores_ranked?challenge_date=eq.${challengeDate}` +
    `&order=score.desc,time_ms.asc&limit=${limit}` +
    `&select=player_name,score,time_ms,flips,perfect`;
  try {
    const r = await fetch(q, { headers: anonHeaders() });
    if (!r.ok) return [];
    return (await r.json()) as ScoreRow[];
  } catch {
    return [];
  }
}

// 提交成績（需 Google 登入）。伺服器端用 auth.uid() 決定 player_id，無法偽造。
// 成功後清除當日快取，讓下次進排行榜看到最新資料。
export async function submitDailyScore(
  playerName: string,
  s: SubmitStats,
): Promise<boolean> {
  if (!isLeaderboardConfigured) return false;
  // 動態 import 避免循環依賴，同時讓 supabase 只在需要時初始化
  const { supabase } = await import("./supabase");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;

  try {
    const r = await fetch(`${URL}/rest/v1/rpc/submit_daily_score`, {
      method: "POST",
      headers: {
        apikey: KEY!,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_name:    playerName,
        p_score:   Math.round(s.score),
        p_time:    Math.round(s.timeMs),
        p_flips:   s.flips,
        p_perfect: s.perfect,
        p_replay:  s.replay ?? null,
      }),
    });
    if (r.ok) {
      // 清除快取，讓下次進 DailyChallenge 顯示含本次成績的最新排行榜。
      // ⚠️ key 用「目前這一期」session（= max(map_date)），與讀取端 fetchDailyTop 同源，
      // RPC 寫入也是 max(map_date)，連假整段累積在同一張榜。不可用 toISOString()（UTC）。
      _topCache.delete(await resolveSessionDate(dailyKey()));
    }
    return r.ok;
  } catch {
    return false;
  }
}

// Ghost 鬼影賽跑：抓「當日目前第一名（非可疑）」的鬼影路徑（每 500ms 一個 x 座標）。
// 純公開讀取，anon key 即可（不需登入）。上線初期沒有人交出帶 replay 的第一名成績時
// 會回 null（正常現象，不是錯誤），呼叫端應靜默不顯示鬼影。
export async function fetchDailyGhostPath(challengeDate: string): Promise<number[] | null> {
  if (!isLeaderboardConfigured) return null;
  try {
    const r = await fetch(`${URL}/rest/v1/rpc/get_daily_ghost_path`, {
      method: "POST",
      headers: { ...anonHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ p_date: challengeDate }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as number[] | null;
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}
