// 輕量事件打點（zero-SDK）：fire-and-forget 打 Supabase RPC log_event。
// 原則：打點永遠不能影響遊戲——任何失敗都靜默吞掉、不 await、不 throw。
// 事件白名單與欄位上限由 RPC 端強制（supabase/migration_20260702.sql）。
// 讀取面不開放（無 select policy），分析查詢見 supabase/analytics_queries.sql。

import { getPlayerId } from "./playerId";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type AnalyticsMode = "daily" | "slot" | "custom" | "long" | "classic";
export type AnalyticsEvent = "run_start" | "death" | "finish" | "revive" | "share";

export function logEvent(
  event: AnalyticsEvent,
  mode?: AnalyticsMode | string,
  props?: Record<string, unknown>,
): void {
  if (!URL || !KEY) return;
  try {
    fetch(`${URL}/rest/v1/rpc/log_event`, {
      method: "POST",
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_event: event,
        p_mode: mode ?? null,
        p_device: getPlayerId(),
        p_props: props ?? {},
      }),
      // 頁面關閉/切走時也盡量送出（死亡瞬間退出 app 的事件不遺失）
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 打點失敗絕不影響遊戲 */
  }
}
