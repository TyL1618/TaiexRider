// 經典模式紀錄保持者（每關只一位）。讀取走 PostgREST，提交走 RPC（需 Google 登入）。
const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isClassicRecordsConfigured = Boolean(URL && KEY);

export interface ClassicRecord {
  level_id: string;
  player_name: string;
  score: number;
  time_ms: number;
}

export interface ClassicStats {
  score: number;
  timeMs: number;
}

function anonHeaders(): Record<string, string> {
  return { apikey: KEY!, Authorization: `Bearer ${KEY!}` };
}

let _cache: Promise<Map<string, ClassicRecord>> | null = null;

// 一次撈全部保持者（整表 ~12 列），回傳 level_id → 紀錄 的 Map。promise 快取。
export function fetchClassicRecords(): Promise<Map<string, ClassicRecord>> {
  if (!_cache) _cache = _fetch();
  return _cache;
}

export function invalidateClassicRecords() {
  _cache = null;
}

async function _fetch(): Promise<Map<string, ClassicRecord>> {
  const out = new Map<string, ClassicRecord>();
  if (!isClassicRecordsConfigured) return out;
  try {
    const r = await fetch(
      `${URL}/rest/v1/classic_records?select=level_id,player_name,score,time_ms`,
      { headers: anonHeaders() },
    );
    if (!r.ok) return out;
    const rows = (await r.json()) as ClassicRecord[];
    for (const row of rows) out.set(row.level_id, row);
    return out;
  } catch {
    return out;
  }
}

// 提交經典紀錄（需登入）。成功後清快取，讓下次進選單看到最新保持者。
export async function submitClassicRecord(
  levelId: string,
  playerName: string,
  s: ClassicStats,
): Promise<boolean> {
  if (!isClassicRecordsConfigured) return false;
  const { supabase } = await import("./supabase");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;

  try {
    const r = await fetch(`${URL}/rest/v1/rpc/submit_classic_record`, {
      method: "POST",
      headers: {
        apikey: KEY!,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_level: levelId,
        p_name:  playerName,
        p_score: Math.round(s.score),
        p_time:  Math.round(s.timeMs),
      }),
    });
    if (r.ok) invalidateClassicRecords();
    return r.ok;
  } catch {
    return false;
  }
}
