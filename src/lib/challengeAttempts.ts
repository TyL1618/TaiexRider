// 每日排名賽挑戰次數管理（localStorage，key 帶 session date → 隔天自動失效）
// 規則：2 次免費 + 3 次看廣告解鎖 = 每日上限 5 次；復活不消耗次數。
//
// 2026-07-05：純 localStorage 計數可被清瀏覽器資料繞過（SECURITY_REVIEW 反作弊 Phase B 項）。
// 已登入玩家改在 consume_attempt() RPC（migration_20260705.sql）做伺服器端真正把關，
// localStorage 只當顯示用計數快取；未登入玩家維持純本地（無法上排行榜，接受）。

import { supabase } from "./supabase";

export const MAX_ATTEMPTS = 5;
export const FREE_ATTEMPTS = 2;

// 已登入時呼叫伺服器 RPC 真正扣次數，回傳是否還能玩（第 6 次起 false）；
// 未登入或 RPC 尚未建立/網路失敗一律回傳 true（放行，維持現行純前端把關的定位不變）。
export async function consumeAttemptServer(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return true;
  const { data, error } = await supabase.rpc("consume_attempt");
  if (error || typeof data !== "boolean") return true;
  return data;
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
