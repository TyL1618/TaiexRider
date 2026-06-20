// 每日收盤後由 GitHub Actions 觸發
// 抓全台上市股票 + TAIEX 當日日盤，計算難度，寫入 Supabase daily_map。
// 清除 7 天前舊資料。
// 環境變數：SUPABASE_URL, SUPABASE_SERVICE_KEY
//
// ⚠️ map_date 錨定在「實際抓到的交易日 sessionDate」，map_date = sessionDate + 1，
// 讓 app 在 calendar day = map_date 當天顯示「前日盤勢」(= sessionDate 的走勢)。
// 不可用「執行當下時間 +1」推算：GitHub 排程常延遲，一旦跨過午夜 now 會多跳一天，
// 而抓到的盤仍是前一個收盤日 → 造成日期錯位 + 跳號（曾發生 6/17 盤被存成 6/19）。

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const UA_TWSE = { "User-Agent": "Mozilla/5.0 TaiexRider/0.1" };
const UA_YF   = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };
const DOWNSAMPLE  = 110;
const DELAY_MS    = 3000;  // 3 秒間隔，避免 Yahoo Finance 限流
const BATCH_SIZE  = 200;   // Supabase 批次寫入大小

interface StockRow {
  map_date:   string;
  stock_code: string;
  stock_name: string;
  prices:     number[];
  difficulty: number;
}

function downsample(arr: number[], target: number): number[] {
  if (arr.length <= target) return arr;
  const out: number[] = [];
  for (let i = 0; i < target; i++)
    out.push(arr[Math.round((i * (arr.length - 1)) / (target - 1))]);
  return out;
}

function calcDifficulty(prices: number[]): number {
  let max = 0;
  for (let i = 1; i < prices.length; i++) {
    const pct = Math.abs(prices[i] / prices[i - 1] - 1);
    if (pct > max) max = pct;
  }
  return max;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// 取得全部上市股票代號 + 名稱（TWSE STOCK_DAY_ALL，一次拿全部）
async function fetchAllListedStocks(): Promise<{ code: string; name: string }[]> {
  const url = "https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json";
  const j = await (await fetch(url, { headers: UA_TWSE })).json() as
    { stat: string; fields?: string[]; data?: string[][] };
  if (j.stat !== "OK" || !j.fields || !j.data) return [];
  const ci = j.fields.indexOf("證券代號");
  const ni = j.fields.indexOf("證券名稱");
  return j.data
    .map(r => ({ code: r[ci].trim(), name: r[ni].trim() }))
    .filter(s => /^\d{4}$/.test(s.code)); // 4 碼純數字 = 一般上市股票
}

// 個股日盤：Yahoo Finance 5 分 K
async function fetchYahooIntraday(symbol: string): Promise<number[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=5m&range=1d&includePrePost=false`;
  try {
    const r = await fetch(url, { headers: UA_YF, signal: AbortSignal.timeout(10_000) });
    const j = await r.json() as Record<string, unknown>;
    const result = (j.chart as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
    const quotes = (result?.[0]?.indicators as Record<string, unknown>)?.quote as Record<string, unknown>[] | undefined;
    const arr = (quotes?.[0]?.close as (number | null)[]) ?? [];
    return arr.filter((v): v is number => v != null && Number.isFinite(v));
  } catch {
    return [];
  }
}

// TAIEX 日盤 + 真正交易日：用 Yahoo ^TWII（與個股同一資料源，比 TWSE 端點可靠）。
// 交易日直接從回傳的 K 棒 timestamp + 交易所時區偏移算出，不靠執行當下時間推算。
// 回傳 date 為交易所當地（台灣）日期字串 YYYY-MM-DD。
async function fetchTaiexSession(): Promise<{ date: string; prices: number[] } | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=5m&range=1d&includePrePost=false`;
  try {
    const r = await fetch(url, { headers: UA_YF, signal: AbortSignal.timeout(15_000) });
    const j = await r.json() as Record<string, unknown>;
    const result = ((j.chart as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined)?.[0];
    if (!result) return null;
    const ts = (result.timestamp as number[] | undefined) ?? [];
    const meta = result.meta as Record<string, unknown> | undefined;
    const gmtoffset = (meta?.gmtoffset as number | undefined) ?? 28800; // 台灣 +8h
    const quotes = (result.indicators as Record<string, unknown>)?.quote as Record<string, unknown>[] | undefined;
    const closes = (quotes?.[0]?.close as (number | null)[]) ?? [];
    if (ts.length === 0) return null;
    // 交易所當地日期：把 epoch 秒 + 時區偏移後當成 UTC 讀日期部分
    const localDate = (epochSec: number) =>
      new Date((epochSec + gmtoffset) * 1000).toISOString().slice(0, 10);
    const sessionDate = localDate(ts[ts.length - 1]); // 最後一根 = 最近 session
    const prices: number[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (localDate(ts[i]) === sessionDate && c != null && Number.isFinite(c)) prices.push(c);
    }
    if (prices.length < 20) return null;
    console.log(`  TAIEX ${sessionDate}: ${prices.length} 點 → 降採樣 ${DOWNSAMPLE}`);
    return { date: sessionDate, prices: downsample(prices, DOWNSAMPLE) };
  } catch {
    return null;
  }
}

// 批次 upsert
async function upsertBatch(rows: StockRow[]): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/daily_map`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(await r.text());
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_KEY");
    process.exit(1);
  }

  // 錨定實際交易日（不可用 now+1，見檔頭說明）
  const session = await fetchTaiexSession();
  if (!session) { console.error("找不到最近交易日的 TAIEX 資料，放棄。"); process.exit(1); }
  // map_date = sessionDate + 1 天（UTC 純整數運算，免時區誤差）
  const [sy, sm, sd] = session.date.split("-").map(Number);
  const mapDate = new Date(Date.UTC(sy, sm - 1, sd + 1)).toISOString().slice(0, 10);
  console.log(`交易日 session: ${session.date} → map_date: ${mapDate}`);

  const rows: StockRow[] = [];
  rows.push({ map_date: mapDate, stock_code: "TAIEX", stock_name: "台股大盤",
    prices: session.prices, difficulty: calcDifficulty(session.prices) });

  // 全部上市股票
  console.log("取得上市股票清單...");
  const stocks = await fetchAllListedStocks();
  console.log(`共 ${stocks.length} 支，預估 ${Math.round(stocks.length * DELAY_MS / 60000)} 分鐘`);

  let ok = 0, fail = 0;
  for (let i = 0; i < stocks.length; i++) {
    const { code, name } = stocks[i];
    const raw = await fetchYahooIntraday(`${code}.TW`);
    if (raw.length >= 10) {
      const prices = downsample(raw, DOWNSAMPLE);
      rows.push({ map_date: mapDate, stock_code: code, stock_name: name,
        prices, difficulty: calcDifficulty(prices) });
      ok++;
    } else {
      fail++;
    }
    if ((i + 1) % 100 === 0)
      console.log(`  進度 ${i + 1}/${stocks.length}，成功 ${ok}，失敗 ${fail}`);
    await sleep(DELAY_MS);
  }
  console.log(`\n抓取完成：成功 ${ok}，失敗 ${fail}，共 ${rows.length} 筆`);

  if (rows.length === 0) { console.error("無資料，放棄。"); process.exit(1); }

  // 批次寫入
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await upsertBatch(rows.slice(i, i + BATCH_SIZE));
    process.stdout.write(`\r  寫入 ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
  console.log("\n寫入完成");

  // 清理舊資料：cutoff 錨定「剛寫入的 map_date」往前 7 天，不是錨「執行當下 now」。
  // ⚠️ 長連假（過年/長颱風假 > 7 天）若用 now-7：map_date 凍在最後交易日不動、now 一直往前走，
  //    超過 7 天後 cutoff 會追過當前唯一在用的 map_date 把它刪掉（甚至同一次跑剛 upsert 又刪掉）
  //    → app 掉回靜態盤。錨 mapDate 則當前盤永遠保留，任意長度連假都安全。
  const [cy, cm, cd] = mapDate.split("-").map(Number);
  const cutoff = new Date(Date.UTC(cy, cm - 1, cd - 7)).toISOString().slice(0, 10);
  const del = await fetch(`${SUPABASE_URL}/rest/v1/daily_map?map_date=lt.${cutoff}`, {
    method: "DELETE",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (del.ok) console.log(`舊資料（${cutoff} 前）已清理`);

  console.log("✅ 完成");
}

main();
