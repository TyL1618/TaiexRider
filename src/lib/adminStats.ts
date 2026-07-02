// 隱藏統計頁資料層：admin_stats RPC（migration_20260702b.sql）。
// 權限門鎖在後端（JWT email 綁定開發者帳號），非 admin 拿到 null。
// 「連點版本號 5 下」只是入口糖衣，不是安全機制。

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface AdminDaily {
  d: string;
  dau: number;
  runs: number;
  finishes: number;
  deaths: number;
  shares: number;
  revives: number;
}

export interface AdminRetention {
  d0: string;
  new: number;
  retained: number;
}

export interface AdminStats {
  daily: AdminDaily[];
  modes: Record<string, number>;
  deathCauses: Record<string, number>;
  retention: AdminRetention[];
  totalEvents: number;
  generatedAt: string;
}

// 回傳 null = 未登入 / 非 admin / RPC 未建立
export async function fetchAdminStats(days = 14): Promise<AdminStats | null> {
  if (!URL || !KEY) return null;
  try {
    const { supabase } = await import("./supabase");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const r = await fetch(`${URL}/rest/v1/rpc/admin_stats`, {
      method: "POST",
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_days: days }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as AdminStats | null;
    return j ?? null;
  } catch {
    return null;
  }
}
