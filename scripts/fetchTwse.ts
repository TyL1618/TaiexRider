// Phase 2：抓真實台股資料，驗證「資料 → 賽道」品質
// Node 24 原生支援 TS 型別剝除，可直接 node 執行，無需編譯。後端/腳本抓無 CORS 問題。
//
// 用法：
//   node scripts/fetchTwse.ts intraday 2330        個股日盤（Yahoo Finance 5分K，~55點）
//   node scripts/fetchTwse.ts intraday TAIEX       大盤日盤（TWSE 每5秒降採樣，110點）
//   node scripts/fetchTwse.ts monthly 2330 3       個股月盤（TWSE 日收盤，近N個月，預設3）
//   node scripts/fetchTwse.ts monthly TAIEX 3      大盤月盤（Yahoo Finance ^TWII 日收盤）
//
// 輸出：src/data/sample-{LABEL}-intraday.json 或 sample-{LABEL}-monthly.json
//       格式：{ label, kind, mode, prices }

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA_TWSE = { "User-Agent": "Mozilla/5.0 TaiexRider/0.1" };
const UA_YF   = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };
const TAIEX_DOWNSAMPLE = 110; // 大盤日盤降採樣目標點數

interface TwseResp { stat: string; fields: string[]; data: string[][]; }

const num = (s: string) => parseFloat((s ?? "").replace(/,/g, ""));

// 均勻降採樣（保留頭尾）
function downsample(arr: number[], target: number): number[] {
  if (arr.length <= target) return arr;
  const out: number[] = [];
  for (let i = 0; i < target; i++) {
    out.push(arr[Math.round((i * (arr.length - 1)) / (target - 1))]);
  }
  return out;
}

// ── 日盤 ──────────────────────────────────────────────────────────────────

// TAIEX 日盤：TWSE MI_5MINS_INDEX（每5秒，降採樣到110點）
async function fetchTaiexIntraday(date: string): Promise<number[]> {
  const url = `https://www.twse.com.tw/exchangeReport/MI_5MINS_INDEX?response=json&date=${date}`;
  const j = (await (await fetch(url, { headers: UA_TWSE })).json()) as TwseResp;
  if (j.stat !== "OK" || !Array.isArray(j.data)) return [];
  const raw = j.data.map((r) => num(r[1])).filter((v) => Number.isFinite(v) && v > 0);
  console.log(`  TWSE MI_5MINS_INDEX: ${raw.length} 點 → 降採樣 ${TAIEX_DOWNSAMPLE} 點`);
  return downsample(raw, TAIEX_DOWNSAMPLE);
}

// 個股日盤：Yahoo Finance 5分K（包含大盤 TAIEX 備用）
async function fetchYahooIntraday(symbol: string): Promise<number[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=5m&range=1d&includePrePost=false`;
  const j = await (await fetch(url, { headers: UA_YF })).json() as Record<string, unknown>;
  const result = (j.chart as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
  const closes = (result?.[0]?.indicators as Record<string, unknown>)?.quote as Record<string, unknown>[] | undefined;
  const arr = (closes?.[0]?.close as (number | null)[]) ?? [];
  const valid = arr.filter((v): v is number => v != null && Number.isFinite(v));
  console.log(`  Yahoo ${symbol}: ${arr.length} 點，有效 ${valid.length} 點`);
  return valid;
}

// ── 月盤 ──────────────────────────────────────────────────────────────────

// 個股月盤：TWSE STOCK_DAY 日收盤（近N個月）
async function fetchTwseMonthly(code: string, months: number): Promise<number[]> {
  const now = new Date();
  const prices: number[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}01`;
    const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${code}`;
    const j = (await (await fetch(url, { headers: UA_TWSE })).json()) as TwseResp;
    if (j.stat === "OK" && Array.isArray(j.data)) {
      const ci = j.fields.indexOf("收盤價");
      const m = j.data.map((r) => num(r[ci])).filter((v) => Number.isFinite(v) && v > 0);
      console.log(`  ${date.slice(0, 6)}: ${m.length} 個交易日`);
      prices.push(...m);
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return prices;
}

// 大盤月盤：Yahoo Finance ^TWII 日收盤
async function fetchTaiexMonthly(months: number): Promise<number[]> {
  const rangeMap: Record<number, string> = { 1: "1mo", 2: "2mo", 3: "3mo", 6: "6mo", 12: "1y", 24: "2y", 36: "3y" };
  const range = rangeMap[months] ?? "3mo";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=${range}&includePrePost=false`;
  const j = await (await fetch(url, { headers: UA_YF })).json() as Record<string, unknown>;
  const result = (j.chart as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
  const closes = (result?.[0]?.indicators as Record<string, unknown>)?.quote as Record<string, unknown>[] | undefined;
  const arr = (closes?.[0]?.close as (number | null)[]) ?? [];
  const valid = arr.filter((v): v is number => v != null && Number.isFinite(v));
  console.log(`  Yahoo ^TWII ${range}: ${arr.length} 點，有效 ${valid.length} 點`);
  return valid;
}

// ── 工具 ──────────────────────────────────────────────────────────────────

function report(prices: number[]) {
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const ch = prices.slice(1).map((p, i) => ((p - prices[i]) / prices[i]) * 100);
  const avgAbs = ch.reduce((s, c) => s + Math.abs(c), 0) / ch.length;
  console.log(`${prices.length} 點｜區間 ${min.toFixed(0)} ~ ${max.toFixed(0)}（振幅 ${(((max - min) / min) * 100).toFixed(1)}%）`);
  console.log(`點間最大 +${Math.max(...ch).toFixed(2)}%  最大 ${Math.min(...ch).toFixed(2)}%  平均 ${avgAbs.toFixed(2)}%`);
}

// ── 主程式 ────────────────────────────────────────────────────────────────

async function main() {
  const mode  = process.argv[2] ?? "intraday";  // intraday | monthly
  const code  = (process.argv[3] ?? "2330").toUpperCase();
  const months = Number(process.argv[4] ?? "3");

  let prices: number[];
  let kind: string;
  let label: string;

  if (mode === "intraday") {
    label = code;
    kind  = code === "TAIEX" ? "taiex" : "stock";
    console.log(`抓日盤 ${code}…`);
    if (code === "TAIEX") {
      // 預設用今天日期抓最近一個交易日（若今天非交易日，TWSE 會回上一個）
      const today = new Date();
      const date = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,"0")}${String(today.getDate()).padStart(2,"0")}`;
      prices = await fetchTaiexIntraday(date);
      if (prices.length === 0) {
        // fallback：用 Yahoo Finance
        console.log("  TWSE 無資料，改用 Yahoo Finance…");
        prices = await fetchYahooIntraday("^TWII");
      }
    } else {
      prices = await fetchYahooIntraday(`${code}.TW`);
    }
  } else if (mode === "monthly") {
    label = code;
    kind  = code === "TAIEX" ? "taiex" : "stock";
    console.log(`抓月盤 ${code} 近 ${months} 個月…`);
    prices = code === "TAIEX"
      ? await fetchTaiexMonthly(months)
      : await fetchTwseMonthly(code, months);
  } else {
    console.error("未知模式，用法：node scripts/fetchTwse.ts intraday|monthly <代號> [月數]");
    process.exit(1);
  }

  if (prices.length === 0) {
    console.error("沒抓到資料（代號/日期錯誤或被限流？）");
    process.exit(1);
  }

  console.log(`\n=== ${label} ${mode} ===`);
  report(prices);

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = join(here, "..", "src", "data", `sample-${label}-${mode}.json`);
  writeFileSync(outPath, JSON.stringify({ label, kind, mode, prices }));
  console.log(`\n已寫入 ${outPath}`);
}

main();
