// 排行榜前一期鑽石結算（參與+名次）彈窗用——結算本身由 GitHub Actions 排程在台灣
// 00:00 呼叫 settle_daily_diamonds()（見 migration_20260708c.sql），這裡只負責
// 「玩家端有沒有還沒看過的結算結果」查詢+已讀標記。未登入者沒有鑽石可結算，一律回 null。

import { supabase } from "./supabase";

export interface PendingSettlement {
  challengeDate: string;
  diamonds: number;
  rank: number | null;
}

export async function checkPendingSettlement(): Promise<PendingSettlement | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.rpc("get_pending_daily_settlement");
  if (error || !data || !data[0]) return null;
  const row = data[0] as { challenge_date: string; diamonds: number; rank: number | null };
  if (!row.diamonds) return null;
  return { challengeDate: row.challenge_date, diamonds: row.diamonds, rank: row.rank };
}

export async function ackSettlement(challengeDate: string): Promise<void> {
  await supabase.rpc("ack_daily_settlement", { p_date: challengeDate });
}
