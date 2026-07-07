// 經典模式紀錄榜（每關前 3 名，2026-07-06 從「每關 1 位保持者」改版；
// 2026-07-08 改成每週重置＋前三名發鑽石，見 migration_20260708d.sql）。
// 讀取走 PostgREST，提交走 RPC（需 Google 登入）。
import { weekKey } from "./weeklyQuests";

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

let _cache: Promise<Map<string, ClassicRecord[]>> | null = null;

// 一次撈「本週」全部前三名（只篩本週 week_key，避免清理排程還沒跑掉的上週殘留資料
// 混進來變成每關 6 筆），回傳 level_id → 前三名陣列（已依分數高→時間短排序）的 Map。
// promise 快取。
export function fetchClassicRecords(): Promise<Map<string, ClassicRecord[]>> {
  if (!_cache) _cache = _fetch();
  return _cache;
}

export function invalidateClassicRecords() {
  _cache = null;
}

async function _fetch(): Promise<Map<string, ClassicRecord[]>> {
  const out = new Map<string, ClassicRecord[]>();
  if (!isClassicRecordsConfigured) return out;
  try {
    const r = await fetch(
      `${URL}/rest/v1/classic_records?select=level_id,player_name,score,time_ms` +
      `&week_key=eq.${weekKey()}&order=level_id.asc,score.desc,time_ms.asc`,
      { headers: anonHeaders() },
    );
    if (!r.ok) return out;
    const rows = (await r.json()) as ClassicRecord[];
    for (const row of rows) {
      const list = out.get(row.level_id) ?? [];
      list.push(row);
      out.set(row.level_id, list);
    }
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
