// 排行榜 REST 服務（Phase 4 MVP）：直接 fetch PostgREST，不裝 SDK（零 bundle 成本）。
// 提交成績需 Google 登入（Supabase Auth），伺服器端用 auth.uid() 決定 player_id。

import { dailyKey } from "../data/pick";
import { resolveSessionDate } from "./dailyMap";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isLeaderboardConfigured = Boolean(URL && KEY);

// 提交當下裝備的個人化道具快照（2026-07-21j 起，見 migration_20260721j.sql）——
// 讓「別人」也看得到你裝備了什麼，不再是只有自己手機看得到自己那列的裝飾。
export interface ScoreCosmetics {
  title?: string | null;
  nickcolor?: string | null;
  badge?: string | null;
  ghostcolor?: string | null;
}

export interface ScoreRow {
  // 2026-07-22 起 get_daily_top() 一併回傳 player_id（Supabase auth uuid），供排行榜
  // 點暱稱開玩家資料頁用（見 playerProfile.ts）。舊快取/舊 RPC 沒有時為 undefined，
  // 點擊功能自然停用（不影響排行榜本身顯示）。
  player_id?: string;
  player_name: string;
  score: number;
  time_ms: number;
  flips: number;
  perfect: number;
  cosmetics?: ScoreCosmetics | null;
}

// 鬼影路徑資料。兩種格式並存（伺服器/渲染端都相容，等 vc28 客戶端絕跡後可收斂）：
// v1（vc28）＝純數字陣列（x 每 500ms）；v2（vc29 起）＝[x, y, 累計旋轉角] 每 250ms。
export type GhostPathData = (number | [number, number, number])[];

// 鬼影完整資料＝路徑 + 紀錄保持者當下使用的車皮 id（2026-07-15 起，見
// migration_20260715.sql）+ 鬼影顏色（2026-07-21j 起，見 migration_20260721j.sql
// ——鬼影身上的色調要顯示「紀錄保持者自己裝備的顏色」，不是正在看的這個人自己
// 的偏好，才有「別人看得到你裝備了什麼」的意義）。skinId 找不到對應車款時渲染端
// 會 fallback 預設車，ghostColorId 沒有時不上色（跟從沒裝備過一樣）。
export interface GhostRecord {
  path: GhostPathData;
  skinId: string;
  ghostColorId: string | null;
}

export interface SubmitStats {
  score: number;
  timeMs: number;
  flips: number;
  perfect: number;
  // 提交當下玩家使用的車皮 id，供其他玩家的鬼影還原真實車款（見 migration_20260715.sql）。
  skinId?: string;
  // 反作弊 Phase C + Ghost 用的輕量錄製（見 migration_20260712b/20260713b.sql）。
  // 舊版客戶端沒有這欄位時 RPC 用 p_replay 預設值 null，完全向下相容。
  replay?: { events: [number, string, number][]; path: [number, number, number][] };
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

// 2026-07-21k 起改呼叫 get_daily_top() RPC（即時 join player_wallet.equipped），
// 不再直接 REST 查 daily_scores_ranked VIEW——VIEW 沒有權限 join player_wallet
// （該表 revoke all from anon/authenticated，只有 security definer 函式能讀），
// 只能停在提交當下的快照，玩家「打完當日次數後才回車庫換裝備」時排行榜會整天
// 看不到最新裝備，體驗比純本地讀還差，見 migration_20260721k.sql。
async function _fetchTop(challengeDate: string, limit: number): Promise<ScoreRow[]> {
  try {
    const r = await fetch(`${URL}/rest/v1/rpc/get_daily_top`, {
      method: "POST",
      headers: { ...anonHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ p_date: challengeDate, p_limit: limit }),
    });
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
        p_skin_id: s.skinId ?? "default",
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

// Ghost 鬼影賽跑：抓「當日目前第一名（非可疑）」的鬼影路徑＋當時使用的車皮 id
// ＋當時裝備的鬼影顏色（格式見 GhostRecord，2026-07-21j 起見 migration_20260721j.sql
// ——鬼影顏色是紀錄保持者自己的裝備，不是正在看的這個人自己的偏好）。純公開讀取，
// anon key 即可（不需登入）。第一名還沒有帶 replay 的成績時會回 null（正常現象，
// 不是錯誤），呼叫端應靜默不顯示鬼影。RPC 改成 returns table(...) 後 PostgREST
// 回傳陣列，跟舊版單一 jsonb 純量回傳格式不同，故取 data[0]。
export async function fetchDailyGhostPath(challengeDate: string): Promise<GhostRecord | null> {
  if (!isLeaderboardConfigured) return null;
  try {
    const r = await fetch(`${URL}/rest/v1/rpc/get_daily_ghost_path`, {
      method: "POST",
      headers: { ...anonHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ p_date: challengeDate }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { path: GhostPathData | null; skin_id: string; cosmetics: ScoreCosmetics | null }[] | null;
    const row = data?.[0];
    if (!row || !Array.isArray(row.path) || row.path.length === 0) return null;
    return { path: row.path, skinId: row.skin_id || "default", ghostColorId: row.cosmetics?.ghostcolor ?? null };
  } catch {
    return null;
  }
}
