// Phase 2：抓真實台股資料，驗證「資料 → 賽道」品質
// Node 24 原生支援 TS 型別剝除，可直接 node 執行，無需編譯。後端/腳本抓無 CORS 問題。
//
// 用法：
//   node scripts/fetchTwse.ts stock 2330 3      個股近 3 個月日線
//   node scripts/fetchTwse.ts taiex 20260612    大盤盤中(每5秒)，自動降採樣成賽道
//
// 輸出統一格式：src/data/sample-<label>.json = { label, kind, prices }

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA = { "User-Agent": "Mozilla/5.0 TaiexRider/0.1" };
const TARGET_POINTS = 110; // 賽道目標資料點數（降採樣到此數）

interface TwseResp {
  stat: string;
  fields: string[];
  data: string[][];
}

const num = (s: string) => parseFloat((s ?? "").replace(/,/g, ""));

// 均勻降採樣到 target 點（保留頭尾），資料夠多時用
function downsample(arr: number[], target: number): number[] {
  if (arr.length <= target) return arr;
  const out: number[] = [];
  for (let i = 0; i < target; i++) {
    out.push(arr[Math.round((i * (arr.length - 1)) / (target - 1))]);
  }
  return out;
}

// 個股：STOCK_DAY 一次回傳一個月，抓最近 N 個月收盤
async function fetchStock(code: string, months: number): Promise<number[]> {
  const now = new Date();
  const prices: number[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}01`;
    const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${code}`;
    const j = (await (await fetch(url, { headers: UA })).json()) as TwseResp;
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

// 大盤：MI_5MINS_INDEX 每5秒，欄位1=發行量加權股價指數，降採樣成賽道
async function fetchTaiex(date: string): Promise<number[]> {
  const url = `https://www.twse.com.tw/exchangeReport/MI_5MINS_INDEX?response=json&date=${date}`;
  const j = (await (await fetch(url, { headers: UA })).json()) as TwseResp;
  if (j.stat !== "OK" || !Array.isArray(j.data)) return [];
  const raw = j.data.map((r) => num(r[1])).filter((v) => Number.isFinite(v) && v > 0);
  console.log(`  盤中原始 ${raw.length} 點(每5秒) → 降採樣 ${TARGET_POINTS} 點`);
  return downsample(raw, TARGET_POINTS);
}

function report(prices: number[]) {
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const ch = prices.slice(1).map((p, i) => ((p - prices[i]) / prices[i]) * 100);
  const avgAbs = ch.reduce((s, c) => s + Math.abs(c), 0) / ch.length;
  console.log(`${prices.length} 點｜區間 ${min} ~ ${max}（振幅 ${(((max - min) / min) * 100).toFixed(1)}%）`);
  console.log(`點間最大上升 +${Math.max(...ch).toFixed(2)}%、最大下降 ${Math.min(...ch).toFixed(2)}%、平均 ${avgAbs.toFixed(2)}%`);
}

async function main() {
  const mode = process.argv[2] ?? "stock";
  let label: string;
  let kind: string;
  let prices: number[];

  if (mode === "taiex") {
    const date = process.argv[3] ?? "20260612";
    console.log(`抓大盤盤中 ${date}…`);
    kind = "taiex";
    label = "TAIEX";
    prices = await fetchTaiex(date);
  } else {
    const code = process.argv[3] ?? "2330";
    const months = Number(process.argv[4] ?? "3");
    console.log(`抓個股 ${code} 近 ${months} 個月…`);
    kind = "stock";
    label = code;
    prices = await fetchStock(code, months);
  }

  if (prices.length === 0) {
    console.error("沒抓到資料（代號/日期錯誤或被限流？）");
    process.exit(1);
  }

  console.log(`\n=== ${label} ===`);
  report(prices);

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = join(here, "..", "src", "data", `sample-${label}.json`);
  writeFileSync(outPath, JSON.stringify({ label, kind, prices }));
  console.log(`\n已寫入 ${outPath}`);
}

main();
