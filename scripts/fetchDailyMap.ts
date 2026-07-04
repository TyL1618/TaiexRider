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

// 地形複雜度 = 振幅 × (1 + 折返次數)
// 振幅：全日 (high - low) / open，衡量賽道總高度差。
// 折返次數：相鄰顯著方向改變（相對 open 累積移動 > 0.3% 才算一次轉折），
//   過濾微小噪音；折返越多代表賽道越崎嶇。
// 這樣漲停/跌停板股（振幅高但折返少）不再壟斷排名賽地圖。
function calcDifficulty(prices: number[]): number {
  if (prices.length < 2) return 0;
  const open = prices[0];
  if (open === 0) return 0;

  const hi = Math.max(...prices);
  const lo = Math.min(...prices);
  const amplitude = (hi - lo) / open;

  const threshold = open * 0.003; // 0.3% 閾值
  let reversals = 0;
  let lastDir = 0; // 1 = 上漲方向, -1 = 下跌方向
  let lastSignificantPrice = prices[0];

  for (let i = 1; i < prices.length; i++) {
    const move = prices[i] - lastSignificantPrice;
    if (Math.abs(move) >= threshold) {
      const dir = move > 0 ? 1 : -1;
      if (lastDir !== 0 && dir !== lastDir) reversals++;
      lastDir = dir;
      lastSignificantPrice = prices[i];
    }
  }

  return amplitude * (1 + reversals);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// 取得全部上市股票代號 + 名稱（TWSE STOCK_DAY_ALL，一次拿全部）
// TWSE 偶爾忽略 response=json 回傳 CSV；先拿 text，嘗試 JSON，失敗則 CSV fallback。
async function fetchAllListedStocks(): Promise<{ code: string; name: string }[]> {
  const url = "https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json";
  try {
    const text = await (await fetch(url, { headers: UA_TWSE })).text();
    // --- 嘗試 JSON ---
    try {
      const j = JSON.parse(text) as { stat: string; fields?: string[]; data?: string[][] };
      if (j.stat !== "OK" || !j.fields || !j.data) return [];
      const ci = j.fields.indexOf("證券代號");
      const ni = j.fields.indexOf("證券名稱");
      return j.data
        .map(r => ({ code: r[ci].trim(), name: r[ni].trim() }))
        .filter(s => /^\d{4}$/.test(s.code));
    } catch {
      // --- CSV fallback（TWSE 偶發回傳原始 CSV）---
      console.warn("  STOCK_DAY_ALL 回傳非 JSON，改用 CSV 解析");
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return [];
      const headers = lines[0].split(",").map(h => h.trim().replace(/^"/, "").replace(/"$/, ""));
      const ci = headers.indexOf("證券代號");
      const ni = headers.indexOf("證券名稱");
      if (ci < 0 || ni < 0) { console.error("  找不到欄位：", headers.join(",")); return []; }
      return lines.slice(1)
        .map(line => {
          const cols = line.split(",");
          return { code: (cols[ci] ?? "").trim().replace(/"/g, ""), name: (cols[ni] ?? "").trim().replace(/"/g, "") };
        })
        .filter(s => /^\d{4}$/.test(s.code));
    }
  } catch (e) {
    console.error("  fetchAllListedStocks 失敗：", e);
    return [];
  }
}

// 個股日盤：Yahoo Finance 5 分 K
// targetDate: 要抓的交易日（YYYY-MM-DD）；range: 由 main() 依當下時間決定（1d/5d）
async function fetchYahooIntraday(symbol: string, targetDate: string, range: string): Promise<number[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=5m&range=${range}&includePrePost=false`;
  try {
    const r = await fetch(url, { headers: UA_YF, signal: AbortSignal.timeout(10_000) });
    const j = await r.json() as Record<string, unknown>;
    const result = (j.chart as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
    const meta = result?.[0]?.meta as Record<string, unknown> | undefined;
    const gmtoffset = (meta?.gmtoffset as number | undefined) ?? 28800;
    const ts = (result?.[0]?.timestamp as number[] | undefined) ?? [];
    const arr = ((result?.[0]?.indicators as Record<string, unknown>)?.quote as Record<string, unknown>[] | undefined)?.[0]?.close as (number | null)[] ?? [];
    return arr.filter((v, i): v is number => {
      if (v == null || !Number.isFinite(v) || !ts[i]) return false;
      return new Date((ts[i] + gmtoffset) * 1000).toISOString().slice(0, 10) === targetDate;
    });
  } catch {
    return [];
  }
}

// TAIEX 日盤 + 真正交易日：用 Yahoo ^TWII（與個股同一資料源，比 TWSE 端點可靠）。
// 交易日直接從回傳的 K 棒 timestamp + 交易所時區偏移算出，不靠執行當下時間推算。
// range=1d 若不夠（盤中手動觸發、當日資料不完整），自動 fallback 到 range=5d 取最近完整 session。
// 回傳 date 為交易所當地（台灣）日期字串 YYYY-MM-DD。
async function fetchTaiexSession(): Promise<{ date: string; prices: number[] } | null> {
  const localDate = (epochSec: number, gmtoffset: number) =>
    new Date((epochSec + gmtoffset) * 1000).toISOString().slice(0, 10);

  for (const range of ["1d", "5d"] as const) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=5m&range=${range}&includePrePost=false`;
    try {
      const r = await fetch(url, { headers: UA_YF, signal: AbortSignal.timeout(15_000) });
      const j = await r.json() as Record<string, unknown>;
      const result = ((j.chart as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined)?.[0];
      if (!result) continue;
      const ts = (result.timestamp as number[] | undefined) ?? [];
      if (ts.length === 0) continue;
      const meta = result.meta as Record<string, unknown> | undefined;
      const gmtoffset = (meta?.gmtoffset as number | undefined) ?? 28800; // 台灣 +8h
      const closes = ((result.indicators as Record<string, unknown>)?.quote as Record<string, unknown>[] | undefined)?.[0]?.close as (number | null)[] ?? [];

      // 把所有資料按日期分組
      const byDate = new Map<string, number[]>();
      for (let i = 0; i < ts.length; i++) {
        const c = closes[i];
        if (c == null || !Number.isFinite(c)) continue;
        const d = localDate(ts[i], gmtoffset);
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d)!.push(c);
      }
      // 從最新往舊找第一個 >= 20 點的完整 session
      const sortedDates = Array.from(byDate.keys()).sort().reverse();
      for (const sessionDate of sortedDates) {
        const prices = byDate.get(sessionDate)!;
        if (prices.length >= 20) {
          console.log(`  TAIEX ${sessionDate}: ${prices.length} 點 → 降採樣 ${DOWNSAMPLE}${range === "5d" ? " (5d fallback)" : ""}`);
          return { date: sessionDate, prices: downsample(prices, DOWNSAMPLE) };
        }
      }
      // 當前 range 全都不夠，繼續嘗試下一個 range
    } catch {
      continue;
    }
  }
  return null;
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

  // 決定要用哪個 range 抓個股：
  // 正常排程（收盤後 16:00）→ session.date = 台灣今日 → range=1d 即可。
  // 盤中手動觸發 → session.date = 昨天（今日資料不完整）→ 用 range=5d 並過濾 session.date。
  const taiwanToday = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const stockRange = session.date === taiwanToday ? "1d" : "5d";
  if (stockRange === "5d") console.log(`  盤中觸發，個股改用 range=5d 過濾 ${session.date}`);

  // 全部上市股票
  console.log("取得上市股票清單...");
  const stocks = await fetchAllListedStocks();
  console.log(`共 ${stocks.length} 支，預估 ${Math.round(stocks.length * DELAY_MS / 60000)} 分鐘`);

  let ok = 0, fail = 0;
  for (let i = 0; i < stocks.length; i++) {
    const { code, name } = stocks[i];
    const raw = await fetchYahooIntraday(`${code}.TW`, session.date, stockRange);
    if (raw.length >= 10) {
      const prices = downsample(raw, DOWNSAMPLE);
      // 資料點過少（一字漲跌停鎖死、極冷門股）：地形極短且單調，難度打 1 折
      // → 仍可在自選模式選到，但實質失去「今日最難＝每日排名賽地圖」資格（BETA #3）
      const lenPenalty = raw.length < 50 ? 0.1 : 1;
      rows.push({ map_date: mapDate, stock_code: code, stock_name: name,
        prices, difficulty: calcDifficulty(prices) * lenPenalty });
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

  // 監控 events 保留策略：刪 90 天前原始事件（RPC 僅 service_role 可呼叫）。
  // migration_20260702.sql 未跑之前此呼叫會 404，無妨。
  const evDel = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cleanup_old_events`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: "{}",
  });
  console.log(evDel.ok ? "events 90 天前舊事件已清理" : "events 清理跳過（RPC 尚未建立）");

  // daily_scores 容量護欄（DB > 400MB 才刪 90 天前成績）。
  // 2026-07-04 起 RPC 收權（migration_20260704b.sql），anon 不能再呼叫，改由這裡帶 service key 每日呼叫。
  const scDel = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cleanup_old_scores_if_needed`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: "{}",
  });
  console.log(scDel.ok ? "daily_scores 容量檢查完成" : "daily_scores 清理呼叫失敗（無妨，下次再試）");

  console.log("✅ 完成");
}

main();
