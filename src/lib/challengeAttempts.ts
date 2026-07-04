// 每日排名賽挑戰次數管理（localStorage，key 帶 session date → 隔天自動失效）
// 規則：2 次免費 + 3 次看廣告解鎖 = 每日上限 5 次；復活不消耗次數。
//
// 2026-07-05：純 localStorage 計數可被清瀏覽器資料繞過（SECURITY_REVIEW 反作弊 Phase B 項）。
// 已登入玩家改在 consume_attempt() RPC（migration_20260705.sql）做伺服器端真正把關，
// localStorage 只當顯示用計數快取；未登入玩家維持純本地（無法上排行榜，接受）。

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
  if (!session) return { ok: true, streak: null, lastSessionKey: null };
  const { data, error } = await supabase.rpc("consume_attempt");
  if (error || !data || !data[0]) return { ok: true, streak: null, lastSessionKey: null };
  const row = data[0] as { ok: boolean; streak_count: number; last_session_key: string | null };
  return { ok: row.ok, streak: row.streak_count, lastSessionKey: row.last_session_key };
}

function storageKey(sessionDate: string): string {
  return `tr_daily_att_${sessionDate}`;
}

export function getAttempts(sessionDate: string): number {
  try {
    const n = parseInt(localStorage.getItem(storageKey(sessionDate)) ?? "0", 10);
    return isNaN(n) ? 0 : Math.min(n, MAX_ATTEMPTS);
  } catch { return 0; }
}

export function incrementAttempts(sessionDate: string): void {
  try {
    const n = getAttempts(sessionDate);
    if (n < MAX_ATTEMPTS) localStorage.setItem(storageKey(sessionDate), String(n + 1));
  } catch {}
}
