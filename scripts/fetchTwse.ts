// Phase 2：抓真實台股資料，驗證「資料 → 賽道」品質
// 用法：node scripts/fetchTwse.ts 2330 3    （股票代號 月數，預設 2330 3）
// Node 24 原生支援 TS 型別剝除，可直接用 node 執行，無需編譯。
//
// 資料源＝TWSE STOCK_DAY（個股每日，一次回傳一個月）。後端/腳本抓沒有 CORS 問題。

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

interface StockDay {
  stat: string;
  fields: string[];
  data: string[][];
}

const STOCK_NO = process.argv[2] ?? "2330";
const MONTHS = Number(process.argv[3] ?? "3");

// 產生最近 N 個月的 date 參數（YYYYMM01，西元）
function recentMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}01`);
  }
  return out;
}

async function fetchMonthCloses(date: string): Promise<number[]> {
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${STOCK_NO}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 TaiexRider/0.1" } });
  const j = (await res.json()) as StockDay;
  if (j.stat !== "OK" || !Array.isArray(j.data)) return [];
  const closeIdx = j.fields.indexOf("收盤價");
  return j.data
    .map((row) => parseFloat((row[closeIdx] ?? "").replace(/,/g, "")))
    .filter((v) => Number.isFinite(v) && v > 0);
}

async function main() {
  console.log(`抓取 ${STOCK_NO} 最近 ${MONTHS} 個月日線…`);
  const prices: number[] = [];
  for (const m of recentMonths(MONTHS)) {
    const p = await fetchMonthCloses(m);
    console.log(`  ${m.slice(0, 6)}: ${p.length} 個交易日`);
    prices.push(...p);
    await new Promise((r) => setTimeout(r, 600)); // 禮貌延遲，避免限流
  }

  if (prices.length === 0) {
    console.error("沒抓到資料（代號錯誤或被限流？）");
    process.exit(1);
  }

  // 統計：賽道品質檢查
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const changes = prices.slice(1).map((p, i) => ((p - prices[i]) / prices[i]) * 100);
  const maxUp = Math.max(...changes);
  const maxDown = Math.min(...changes);
  const avgAbs = changes.reduce((s, c) => s + Math.abs(c), 0) / changes.length;

  console.log(`\n=== ${STOCK_NO}｜${prices.length} 個交易日 ===`);
  console.log(`收盤區間：${min} ~ ${max}（振幅 ${(((max - min) / min) * 100).toFixed(1)}%）`);
  console.log(`單日最大漲 +${maxUp.toFixed(2)}%、最大跌 ${maxDown.toFixed(2)}%、平均單日波動 ${avgAbs.toFixed(2)}%`);

  // 輸出供 app 使用
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = join(here, "..", "src", "data", `sample-${STOCK_NO}.json`);
  writeFileSync(outPath, JSON.stringify({ stockNo: STOCK_NO, prices }));
  console.log(`\n已寫入 ${outPath}`);
}

main();
