// 每日 00:05 台灣時間由 GitHub Actions 觸發
// 抓前一個交易日大盤（TAIEX MI_5MINS_INDEX）日盤資料，
// 以「今日台灣日期」為 map_date upsert 到 Supabase daily_map。
// 環境變數：SUPABASE_URL, SUPABASE_SERVICE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const UA = { "User-Agent": "Mozilla/5.0 TaiexRider/0.1" };
const DOWNSAMPLE = 110;

function downsample(arr: number[], target: number): number[] {
  if (arr.length <= target) return arr;
  const out: number[] = [];
  for (let i = 0; i < target; i++)
    out.push(arr[Math.round((i * (arr.length - 1)) / (target - 1))]);
  return out;
}

function toYMD8(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

async function fetchTaiexIntraday(yyyymmdd: string): Promise<number[]> {
  const url = `https://www.twse.com.tw/exchangeReport/MI_5MINS_INDEX?response=json&date=${yyyymmdd}`;
  try {
    const j = await (await fetch(url, { headers: UA })).json() as
      { stat: string; data?: string[][] };
    if (j.stat !== "OK" || !Array.isArray(j.data) || j.data.length === 0) return [];
    const raw = j.data
      .map((r) => parseFloat(r[1].replace(/,/g, "")))
      .filter((v) => Number.isFinite(v) && v > 0);
    console.log(`  MI_5MINS_INDEX ${yyyymmdd}: ${raw.length} 點 → 降採樣 ${DOWNSAMPLE}`);
    return downsample(raw, DOWNSAMPLE);
  } catch (e) {
    console.error(`  fetch 失敗 ${yyyymmdd}:`, e);
    return [];
  }
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_KEY");
    process.exit(1);
  }

  // 台灣時間 = UTC+8
  const nowTW = new Date(Date.now() + 8 * 3_600_000);
  const mapDate = nowTW.toISOString().slice(0, 10); // YYYY-MM-DD，今日台灣日期

  console.log(`目標 map_date: ${mapDate}`);

  // 往前最多 7 天，找最近一個有交易資料的日子
  let prices: number[] = [];
  for (let back = 1; back <= 7; back++) {
    const d = new Date(nowTW.getTime() - back * 86_400_000);
    prices = await fetchTaiexIntraday(toYMD8(d));
    if (prices.length >= 20) break;
    console.log(`  ${toYMD8(d)} 無資料，往前推...`);
  }

  if (prices.length < 20) {
    console.error("7 天內找不到有效交易資料，放棄。");
    process.exit(1);
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/daily_map`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ map_date: mapDate, prices, label: "台股大盤" }),
  });

  if (!res.ok) {
    console.error("Supabase upsert 失敗：", await res.text());
    process.exit(1);
  }
  console.log(`✅ daily_map ${mapDate} 寫入成功（${prices.length} 點）`);
}

main();
