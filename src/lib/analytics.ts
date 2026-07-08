// 輕量事件打點（zero-SDK）：fire-and-forget 打 Supabase RPC log_event。
// 原則：打點永遠不能影響遊戲——任何失敗都靜默吞掉、不 await、不 throw。
// 事件白名單與欄位上限由 RPC 端強制（supabase/migration_20260702.sql）。
// 讀取面不開放（無 select policy），分析查詢見 supabase/analytics_queries.sql。

import { getPlayerId } from "./playerId";
import { supabase } from "./supabase";

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
  // ⚠️ 2026-07-09 修復：Authorization 之前固定用 anon key（不代表任何登入者），
  // 導致伺服器端 auth.uid() 永遠是 NULL——events.player_id 從 7/2 上線以來對所有人
  // 都是空的（377 筆全 NULL，SQL 查證過）。改成先讀目前 session，有登入就帶真正的
  // access token，訪客才 fallback 用 anon key（訪客本來就該是 NULL，這樣才對）。
  supabase.auth.getSession().then(({ data: { session } }) => {
    try {
      fetch(`${URL}/rest/v1/rpc/log_event`, {
        method: "POST",
        headers: {
          apikey: KEY,
          Authorization: `Bearer ${session?.access_token ?? KEY}`,
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
  }).catch(() => {});
}
