// 每日地圖讀取：從 Supabase daily_map 撈「最新一期」地圖，未設定或失敗回 null（caller 用靜態 fallback）
// promise 快取：同一個 date 只打一次 Supabase；App.tsx 啟動時預熱，
// 讓進入 DailyChallenge 時幾乎不需等待。
//
// ⚠️ 連假/多日休市：cron 把 map_date 存成 sessionDate+1（只覆蓋 session 後「一天」）。
// 若用「今天 / 明天」精準比對，連假第二天起日曆日就超過 map_date → 查無 → fallback 靜態 24 支。
// 正解：解析「目前這一期」= daily_map 中 map_date ≤ 今天(+1容忍) 的「最大」map_date（resolveSessionDate），
// 三個 fetcher 全部對齊它 → 連假整段都讀到最後一個交易日的盤（「一律顯示最後一次盤勢」）。
// 下個交易日開盤當晚跑完才出現更大的 map_date，自動換新圖。

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
const _sessionCache = new Map<string, Promise<string>>();

// 解析「目前這一期」的 map_date：daily_map 中 map_date ≤ nextDay(今天) 的「最大」值。
// 連假期間日曆日會超過最後交易日的 map_date，用 lte + desc 取最新一期，
// 才能「一律顯示最後一次盤勢」而非 fallback 靜態盤。查無（或未設定）時回傳 date 本身（穩定 key）。
// 此 key 同時供排行榜對齊（前端讀／RPC 寫都用 max(map_date)，整個連假累積在同一張榜）。
export function resolveSessionDate(date: string): Promise<string> {
  if (!_sessionCache.has(date)) _sessionCache.set(date, _resolveSession(date));
  return _sessionCache.get(date)!;
}

async function _resolveSession(date: string): Promise<string> {
  if (!URL || !KEY) return date;
  try {
    const r = await fetch(
      `${URL}/rest/v1/daily_map?map_date=lte.${nextDay(date)}&order=map_date.desc&limit=1&select=map_date`,
      { headers: headers() },
    );
    if (r.ok) {
      const rows = (await r.json()) as { map_date: string }[];
      if (rows[0]?.map_date) return rows[0].map_date;
    }
  } catch { /* fall through → 回傳 date 本身 */ }
  return date;
}

// 全市場清單（不含 prices，只用於列表展示 / 隨機抽籤）
export function fetchDailyMapList(date: string): Promise<DailyMapMeta[]> {
  if (!_listCache.has(date)) _listCache.set(date, _fetchList(date));
  return _listCache.get(date)!;
}

async function _fetchList(date: string): Promise<DailyMapMeta[]> {
  if (!URL || !KEY) return [];
  try {
    const d = await resolveSessionDate(date);
    const r = await fetch(
      `${URL}/rest/v1/daily_map?map_date=eq.${d}&select=stock_code,stock_name,difficulty&order=stock_code.asc&limit=2000`,
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
    const d = await resolveSessionDate(date);
    const r = await fetch(
      `${URL}/rest/v1/daily_map?map_date=eq.${d}&order=difficulty.desc&limit=1&select=stock_code,stock_name,prices`,
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
    const d = await resolveSessionDate(date);
    const r = await fetch(
      `${URL}/rest/v1/daily_map?map_date=eq.${d}&stock_code=eq.${code}&limit=1&select=stock_code,stock_name,prices`,
      { headers: headers() },
    );
    if (!r.ok) return null;
    const rows = (await r.json()) as DailyMapRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
