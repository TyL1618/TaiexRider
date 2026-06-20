// 經典模式關卡資料抓取（一次性、靜態，跑完 commit JSON 就不用再動）。
// 從 Yahoo Finance 抓歷史「日線」(interval=1d, period1~period2)，降採樣後寫入 src/data/classics.json。
// metadata（事件名、期間、發生什麼）在這裡手動策展，與 prices 一起輸出成靜態檔。
//
// 執行：node scripts/fetchClassics.ts
// 抓不到（或點數太少）的事件會跳過並在 log 標示，方便確認哪些做得出來。

import { writeFileSync } from "node:fs";

const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };
const TARGET = 140;   // 降採樣目標點數（比每日 110 略多，經典關卡長一點更有史詩感）
const MIN_PTS = 15;   // 少於這個點數視為抓取失敗
const DELAY   = 1500;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function downsample(arr: number[], target: number): number[] {
  if (arr.length <= target) return arr;
  const out: number[] = [];
  for (let i = 0; i < target; i++)
    out.push(arr[Math.round((i * (arr.length - 1)) / (target - 1))]);
  return out;
}

const epoch = (d: string) => Math.floor(new Date(d + "T00:00:00Z").getTime() / 1000);

interface Candidate {
  id: string;
  symbol: string;     // Yahoo 代號
  index: string;      // 標的中文（HUD/列表顯示）
  title: string;      // 事件名
  period: string;     // 期間標籤
  blurb: string;      // 一兩句說明發生什麼
  from: string;       // period1 (YYYY-MM-DD)
  to: string;         // period2
  interval?: string;  // 預設 1d
}

// 候選清單（抓得到就做幾條）。涵蓋台股 + 全球，崩跌 / V 轉 / 拋物線 / 長空各種地形。
const CANDIDATES: Candidate[] = [
  // ── 台股 ^TWII ──────────────────────────────────────────
  { id: "tw1990", symbol: "^TWII", index: "加權指數", title: "萬點大崩盤", period: "1990",
    blurb: "加權指數衝上傳奇的 12,682 點，8 個月狂瀉到 2,485 點，跌掉近 8 成。", from: "1990-01-01", to: "1990-12-31" },
  { id: "tw2000", symbol: "^TWII", index: "加權指數", title: "網路泡沫", period: "2000–01",
    blurb: "科技狂熱破滅加上政黨輪替，台股從萬點一路腰斬。", from: "2000-01-01", to: "2001-10-31" },
  { id: "tw2008", symbol: "^TWII", index: "加權指數", title: "金融海嘯", period: "2007–08",
    blurb: "雷曼倒閉引爆全球金融海嘯，台股從 9,800 崩到 3,955 點。", from: "2007-07-01", to: "2009-03-31" },
  { id: "tw2020", symbol: "^TWII", index: "加權指數", title: "COVID 股災與 V 轉", period: "2020",
    blurb: "疫情急殺到 8,523 點，又一路噴上萬八，史上最快深 V。", from: "2020-01-01", to: "2020-09-30" },
  { id: "tw2022", symbol: "^TWII", index: "加權指數", title: "升息空頭年", period: "2022",
    blurb: "通膨升息，台股從 18,619 高點一路陰跌到 12,629 點。", from: "2022-01-01", to: "2022-12-31" },
  { id: "tw319",  symbol: "^TWII", index: "加權指數", title: "319 槍擊事件", period: "2004/03",
    blurb: "總統大選前夕槍擊案，隔個交易日開盤一片跌停。", from: "2004-03-01", to: "2004-04-09" },
  { id: "tw2024", symbol: "^TWII", index: "加權指數", title: "史上最大單日跌點", period: "2024/08",
    blurb: "日圓套利解除全球崩跌，8/5 單日重挫 1,807 點（-8.35%）。", from: "2024-07-15", to: "2024-08-16" },
  // ── 美股 ────────────────────────────────────────────────
  { id: "us1987", symbol: "^GSPC", index: "標普 500", title: "黑色星期一", period: "1987/10",
    blurb: "1987/10/19 單日崩跌逾 20%，史上最猛的一天。", from: "1987-08-01", to: "1987-12-31" },
  { id: "us2000", symbol: "^IXIC", index: "那斯達克", title: "網路泡沫破滅", period: "2000–02",
    blurb: "那斯達克從 5,000 點泡沫頂腰斬再腰斬。", from: "2000-01-01", to: "2002-10-31" },
  { id: "us2008", symbol: "^GSPC", index: "標普 500", title: "金融海嘯", period: "2007–09",
    blurb: "次貸危機與雷曼倒閉，全球股市自由落體。", from: "2007-07-01", to: "2009-03-31" },
  { id: "us2020", symbol: "^GSPC", index: "標普 500", title: "COVID 股災", period: "2020",
    blurb: "疫情引爆史上最快熊市，隨後 V 型反彈創高。", from: "2020-01-01", to: "2020-09-30" },
  { id: "gme2021", symbol: "GME", index: "GameStop", title: "迷因股軋空", period: "2021/01",
    blurb: "散戶大軍逼空，股價飆到 483 美元再崩落。", from: "2020-11-01", to: "2021-03-31" },
  // ── 日股 ────────────────────────────────────────────────
  { id: "jp1989", symbol: "^N225", index: "日經 225", title: "日本泡沫頂", period: "1989–92",
    blurb: "1989 年底攻上 38,957 史上最高，之後展開失落的 30 年。", from: "1988-01-01", to: "1992-12-31" },
];

async function fetchSeries(c: Candidate): Promise<number[]> {
  const iv = c.interval ?? "1d";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(c.symbol)}` +
    `?period1=${epoch(c.from)}&period2=${epoch(c.to)}&interval=${iv}`;
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
    const j = await r.json() as Record<string, any>;
    const res = j.chart?.result?.[0];
    const closes = (res?.indicators?.quote?.[0]?.close ?? []) as (number | null)[];
    return closes.filter((v): v is number => v != null && Number.isFinite(v));
  } catch {
    return [];
  }
}

async function main() {
  const out: any[] = [];
  for (const c of CANDIDATES) {
    const raw = await fetchSeries(c);
    if (raw.length < MIN_PTS) {
      console.log(`✗ ${c.id.padEnd(8)} ${c.symbol.padEnd(7)} 抓到 ${raw.length} 點 → 跳過`);
    } else {
      const prices = downsample(raw, TARGET);
      out.push({
        id: c.id, index: c.index, title: c.title, period: c.period,
        blurb: c.blurb, prices,
      });
      const lo = Math.min(...raw), hi = Math.max(...raw);
      console.log(`✓ ${c.id.padEnd(8)} ${c.symbol.padEnd(7)} 原始 ${String(raw.length).padStart(4)} → ${prices.length} 點 ` +
        `(low ${lo.toFixed(0)} / high ${hi.toFixed(0)}, 最大跌幅 ${(100*(hi-lo)/hi).toFixed(0)}%)`);
    }
    await sleep(DELAY);
  }
  writeFileSync("src/data/classics.json", JSON.stringify(out));
  console.log(`\n寫入 src/data/classics.json：共 ${out.length} 條經典關卡`);
}

main();
