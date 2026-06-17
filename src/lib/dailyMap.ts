// 每日地圖讀取：從 Supabase daily_map 撈今日地圖，未設定或失敗回 null（caller 用靜態 fallback）

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface DailyMapRow {
  stock_code: string;
  stock_name: string;
  prices: number[];
}

function headers() {
  return { apikey: KEY!, Authorization: `Bearer ${KEY!}` };
}

// 今日最難的地圖（每日排名賽用）
export async function fetchHardestDailyMap(date: string): Promise<DailyMapRow | null> {
  if (!URL || !KEY) return null;
  try {
    const r = await fetch(
      `${URL}/rest/v1/daily_map?map_date=eq.${date}&order=difficulty.desc&limit=1&select=stock_code,stock_name,prices`,
      { headers: headers() },
    );
    if (!r.ok) return null;
    const rows = (await r.json()) as DailyMapRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

// 指定股票代號的地圖（自選模式用）
export async function fetchStockDailyMap(date: string, code: string): Promise<DailyMapRow | null> {
  if (!URL || !KEY) return null;
  try {
    const r = await fetch(
      `${URL}/rest/v1/daily_map?map_date=eq.${date}&stock_code=eq.${code}&limit=1&select=stock_code,stock_name,prices`,
      { headers: headers() },
    );
    if (!r.ok) return null;
    const rows = (await r.json()) as DailyMapRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
