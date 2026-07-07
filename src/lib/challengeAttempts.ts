// 每日排名賽挑戰次數管理（localStorage，key 帶 session date → 隔天自動失效）
// 規則：2 次免費 + 3 次看廣告解鎖 = 每日上限 5 次；復活不消耗次數。
//
// 2026-07-05：純 localStorage 計數可被清瀏覽器資料繞過（SECURITY_REVIEW 反作弊 Phase B 項）。
// 已登入玩家改在 consume_attempt() RPC（migration_20260705.sql）做伺服器端真正把關，
// localStorage 只當顯示用計數快取；未登入玩家維持純本地（無法上排行榜，接受）。
//
// 2026-07-07：使用者回報同裝置切換帳號時，本地計數快取（原本 key 只帶 sessionDate，
// 不分帳號）會沿用「前一個使用者」當天用掉的次數，顯示錯誤（真正的把關仍是上面
// consume_attempt() 的伺服器端邏輯，per-uid 正確，只有本地顯示快取跑掉）。改成
// key 也帶 uid（訪客固定用 "guest"，且訪客現在已在 DailyChallenge.tsx 被完全鎖住
// 不能進場，這裡保留 guest 分支純粹是防禦性寫法）。

import { supabase } from "./supabase";

export const MAX_ATTEMPTS = 5;
export const FREE_ATTEMPTS = 2;

export interface ConsumeAttemptResult {
  ok: boolean;
  // streak/lastSessionKey 為 null 代表未登入或 RPC 失敗：呼叫端應 fallback 本地
  // streak.ts recordStreak()，與現行未登入玩家純本地計數行為一致。
  streak: number | null;
  lastSessionKey: string | null;
}

// 已登入時呼叫伺服器 RPC 真正扣次數（第 6 次起 ok=false）+ 一併算好最新 streak
// （consume_attempt() 內部同時更新 player_streak，見 migration_20260706.sql）；
// 未登入或 RPC 尚未建立/網路失敗一律回傳 ok=true（放行，維持現行純前端把關的定位不變）。
export async function consumeAttemptServer(): Promise<ConsumeAttemptResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { console.warn("[wallet] consume_attempt 略過：目前沒有登入 session"); return { ok: true, streak: null, lastSessionKey: null }; }
  const { data, error } = await supabase.rpc("consume_attempt");
  if (error) console.error("[wallet] consume_attempt 失敗，streak 沒有更新到", error);
  if (error || !data || !data[0]) return { ok: true, streak: null, lastSessionKey: null };
  const row = data[0] as { ok: boolean; streak_count: number; last_session_key: string | null };
  return { ok: row.ok, streak: row.streak_count, lastSessionKey: row.last_session_key };
}

function storageKey(sessionDate: string, uid: string | null): string {
  return `tr_daily_att_${uid ?? "guest"}_${sessionDate}`;
}

export function getAttempts(sessionDate: string, uid: string | null): number {
  try {
    const n = parseInt(localStorage.getItem(storageKey(sessionDate, uid)) ?? "0", 10);
    return isNaN(n) ? 0 : Math.min(n, MAX_ATTEMPTS);
  } catch { return 0; }
}

export function incrementAttempts(sessionDate: string, uid: string | null): void {
  try {
    const n = getAttempts(sessionDate, uid);
    if (n < MAX_ATTEMPTS) localStorage.setItem(storageKey(sessionDate, uid), String(n + 1));
  } catch {}
}
