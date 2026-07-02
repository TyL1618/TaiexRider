// 全服死亡熱點（每日排名賽）：匿名彙總 RPC daily_death_heatmap（20 等分 bucket）。
// 黑魂血跡式的社群感：讓玩家看到「今天大家都死在哪」。失敗/未建 RPC 一律回空陣列。

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface HeatBucket {
  bucket: number; // 1..20（賽道 20 等分）
  deaths: number;
}

let _cache: Promise<HeatBucket[]> | null = null;

export function fetchDeathHeatmap(): Promise<HeatBucket[]> {
  if (!_cache) _cache = _fetch();
  return _cache;
}

export function invalidateDeathHeatmap(): void {
  _cache = null;
}

async function _fetch(): Promise<HeatBucket[]> {
  if (!URL || !KEY) return [];
  try {
    const r = await fetch(`${URL}/rest/v1/rpc/daily_death_heatmap`, {
      method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) return [];
    const rows = (await r.json()) as HeatBucket[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}
