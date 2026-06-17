// 每日地圖讀取：從 Supabase daily_map 抓今日 prices，未設定或失敗回 null（caller 用靜態 fallback）

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export async function fetchDailyMap(date: string): Promise<number[] | null> {
  if (!URL || !KEY) return null;
  try {
    const r = await fetch(
      `${URL}/rest/v1/daily_map?map_date=eq.${date}&select=prices&limit=1`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
    );
    if (!r.ok) return null;
    const rows = (await r.json()) as { prices: number[] }[];
    return rows[0]?.prices ?? null;
  } catch {
    return null;
  }
}
