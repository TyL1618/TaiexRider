// 每日地圖讀取：從 Supabase daily_map 撈今日地圖，未設定或失敗回 null（caller 用靜態 fallback）
// promise 快取：同一個 date 只打一次 Supabase；App.tsx 啟動時預熱，
// 讓進入 DailyChallenge 時幾乎不需等待。
//
// 注意：GitHub Actions 在 21:05 台灣時間執行，把 map_date 存成「明天」讓 00:00 即生效。
// 因此 fetch 時若今天查無資料，自動試明天日期。

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

function nextDay(date: string): string {
  // 用純 UTC 運算，避免本地時區偏移導致日期算錯（UTC+8 會讓 setDate+1 仍回傳同一天）
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
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
    for (const d of [date, nextDay(date)]) {
      const r = await fetch(
        `${URL}/rest/v1/daily_map?map_date=eq.${d}&select=stock_code,stock_name,difficulty&order=stock_code.asc&limit=2000`,
        { headers: headers() },
      );
      if (!r.ok) continue;
      const rows = (await r.json()) as DailyMapMeta[];
      if (rows.length > 0) return rows;
    }
    return [];
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
    for (const d of [date, nextDay(date)]) {
      const r = await fetch(
        `${URL}/rest/v1/daily_map?map_date=eq.${d}&order=difficulty.desc&limit=1&select=stock_code,stock_name,prices`,
        { headers: headers() },
      );
      if (!r.ok) continue;
      const rows = (await r.json()) as DailyMapRow[];
      if (rows[0]) return rows[0];
    }
    return null;
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
    for (const d of [date, nextDay(date)]) {
      const r = await fetch(
        `${URL}/rest/v1/daily_map?map_date=eq.${d}&stock_code=eq.${code}&limit=1&select=stock_code,stock_name,prices`,
        { headers: headers() },
      );
      if (!r.ok) continue;
      const rows = (await r.json()) as DailyMapRow[];
      if (rows[0]) return rows[0];
    }
    return null;
  } catch {
    return null;
  }
}
