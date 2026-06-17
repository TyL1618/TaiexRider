// 每日地圖讀取：從 Supabase daily_map 撈今日地圖，未設定或失敗回 null（caller 用靜態 fallback）
// promise 快取：同一個 date 只打一次 Supabase；App.tsx 啟動時預熱，
// 讓進入 DailyChallenge 時幾乎不需等待。

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface DailyMapRow {
  stock_code: string;
  stock_name: string;
  prices: number[];
}

export interface DailyMapMeta {
  stock_code: string;
  stock_name: string;
  difficulty: number;
}

function headers() {
  return { apikey: KEY!, Authorization: `Bearer ${KEY!}` };
}

const _hardestCache = new Map<string, Promise<DailyMapRow | null>>();
const _stockCache   = new Map<string, Promise<DailyMapRow | null>>();
const _listCache    = new Map<string, Promise<DailyMapMeta[]>>();

// 全市場清單（不含 prices，只用於列表展示 / 隨機抽籤）
export function fetchDailyMapList(date: string): Promise<DailyMapMeta[]> {
  if (!_listCache.has(date)) _listCache.set(date, _fetchList(date));
  return _listCache.get(date)!;
}

async function _fetchList(date: string): Promise<DailyMapMeta[]> {
  if (!URL || !KEY) return [];
  try {
    const r = await fetch(
      `${URL}/rest/v1/daily_map?map_date=eq.${date}&select=stock_code,stock_name,difficulty&order=stock_code.asc&limit=2000`,
      { headers: headers() },
    );
    if (!r.ok) return [];
    return (await r.json()) as DailyMapMeta[];
  } catch {
    return [];
  }
}

// 今日最難的地圖（每日排名賽用）
export function fetchHardestDailyMap(date: string): Promise<DailyMapRow | null> {
  if (!_hardestCache.has(date)) _hardestCache.set(date, _fetchHardest(date));
  return _hardestCache.get(date)!;
}

async function _fetchHardest(date: string): Promise<DailyMapRow | null> {
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
export function fetchStockDailyMap(date: string, code: string): Promise<DailyMapRow | null> {
  const key = `${date}:${code}`;
  if (!_stockCache.has(key)) _stockCache.set(key, _fetchStock(date, code));
  return _stockCache.get(key)!;
}

async function _fetchStock(date: string, code: string): Promise<DailyMapRow | null> {
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
