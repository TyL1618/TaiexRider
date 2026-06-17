// 排行榜 REST 服務（Phase 4 MVP）：直接 fetch PostgREST，不裝 SDK（零 bundle 成本）。
// 未設定 .env 時所有函式安全 no-op（回 []/false）→ 不影響現有行為。見 DEVDOC §11。

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
}

function headers(): Record<string, string> {
  return {
    apikey: KEY!,
    Authorization: `Bearer ${KEY!}`,
    "Content-Type": "application/json",
  };
}

// 讀某日排行榜（分數高→時間短，前 N 名）
export async function fetchDailyTop(challengeDate: string, limit = 100): Promise<ScoreRow[]> {
  if (!isLeaderboardConfigured) return [];
  const q =
    `${URL}/rest/v1/daily_scores?challenge_date=eq.${challengeDate}` +
    `&order=score.desc,time_ms.asc&limit=${limit}` +
    `&select=player_name,score,time_ms,flips,perfect`;
  try {
    const r = await fetch(q, { headers: headers() });
    if (!r.ok) return [];
    return (await r.json()) as ScoreRow[];
  } catch {
    return [];
  }
}

// 提交成績（走 RPC，後端 upsert-if-better）。日期由伺服器 current_date 決定，不由前端傳入。
export async function submitDailyScore(
  playerId: string,
  playerName: string,
  s: SubmitStats,
): Promise<boolean> {
  if (!isLeaderboardConfigured) return false;
  try {
    const r = await fetch(`${URL}/rest/v1/rpc/submit_daily_score`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_id: playerId,
        p_name: playerName,
        p_score: Math.round(s.score),
        p_time: Math.round(s.timeMs),
        p_flips: s.flips,
        p_perfect: s.perfect,
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
