// 玩家資料頁資料抓取：排行榜點暱稱 → get_player_profile(p_player_id) RPC（見
// migration_20260722.sql）。純公開讀取，anon key 即可（訪客也能看別人的資料頁）。
// RPC 回傳單一 jsonb 物件（PostgREST 對「回純量 jsonb 的函式」直接回該物件，不像
// returns table 會包成陣列），故直接當物件解析、不用取 data[0]。

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface ClassicRankStat {
  levelId: string; // 對 classics.ts 的 id，前端轉中文關卡名
  rank: number;    // 1/2/3（經典榜只結算前三名）
  count: number;   // 累計拿過幾次這個名次
}

export interface PlayerProfileData {
  playerName: string;
  // {title, nickcolor, badge, skin, ...}：目前裝備的個人化道具 + 車皮 id
  equipped: Record<string, string>;
  owned: string[]; // 車款 + 個人化道具 id 混在一起，前端自己用 BIKE_SKINS 篩車款
  achv: {
    bullFinishes: number; bearFinishes: number;
    totalFlips: number; totalPerfect: number; streakCount: number;
  };
  daily: { first: number; second: number; third: number; top10: number };
  classic: ClassicRankStat[];
}

interface RawProfile {
  player_name?: string;
  equipped?: Record<string, string> | null;
  owned?: string[] | null;
  achv?: {
    bull_finishes?: number; bear_finishes?: number;
    total_flips?: number; total_perfect?: number; streak_count?: number;
  } | null;
  daily?: { first?: number; second?: number; third?: number; top10?: number } | null;
  classic?: { level_id: string; rank: number; count: number }[] | null;
}

export async function fetchPlayerProfile(playerId: string): Promise<PlayerProfileData | null> {
  if (!URL || !KEY || !playerId) return null;
  try {
    const r = await fetch(`${URL}/rest/v1/rpc/get_player_profile`, {
      method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_player_id: playerId }),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as RawProfile | null;
    if (!d) return null;
    return {
      playerName: d.player_name ?? "車手",
      equipped: d.equipped ?? {},
      owned: Array.isArray(d.owned) ? d.owned : [],
      achv: {
        bullFinishes: d.achv?.bull_finishes ?? 0,
        bearFinishes: d.achv?.bear_finishes ?? 0,
        totalFlips: d.achv?.total_flips ?? 0,
        totalPerfect: d.achv?.total_perfect ?? 0,
        streakCount: d.achv?.streak_count ?? 0,
      },
      daily: {
        first: d.daily?.first ?? 0,
        second: d.daily?.second ?? 0,
        third: d.daily?.third ?? 0,
        top10: d.daily?.top10 ?? 0,
      },
      classic: Array.isArray(d.classic)
        ? d.classic.map((c) => ({ levelId: c.level_id, rank: c.rank, count: c.count }))
        : [],
    };
  } catch {
    return null;
  }
}
