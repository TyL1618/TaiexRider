// 可選賽道清單（Phase 2：24 支股票 × 日盤/月盤 = 48 條賽道）
// 資料來源：
//   日盤 (intraday) = Yahoo Finance 5分K，~54點，前次交易日
//   月盤 (monthly)  = TWSE STOCK_DAY 日收盤，近3個月 ~51點（TAIEX 用 Yahoo Finance ^TWII）
// Phase 4 起改成後端每日自動更新；這裡先用打包進 build 的預抓樣本。

import taiex_i from "./sample-TAIEX-intraday.json";
import taiex_m from "./sample-TAIEX-monthly.json";
import s2330_i from "./sample-2330-intraday.json";
import s2330_m from "./sample-2330-monthly.json";
import s0050_i from "./sample-0050-intraday.json";
import s0050_m from "./sample-0050-monthly.json";
import s2454_i from "./sample-2454-intraday.json";
import s2454_m from "./sample-2454-monthly.json";
import s0056_i from "./sample-0056-intraday.json";
import s0056_m from "./sample-0056-monthly.json";
import s2317_i from "./sample-2317-intraday.json";
import s2317_m from "./sample-2317-monthly.json";
import s2382_i from "./sample-2382-intraday.json";
import s2382_m from "./sample-2382-monthly.json";
import s2303_i from "./sample-2303-intraday.json";
import s2303_m from "./sample-2303-monthly.json";
import s2412_i from "./sample-2412-intraday.json";
import s2412_m from "./sample-2412-monthly.json";
import s2882_i from "./sample-2882-intraday.json";
import s2882_m from "./sample-2882-monthly.json";
import s3008_i from "./sample-3008-intraday.json";
import s3008_m from "./sample-3008-monthly.json";
import s2002_i from "./sample-2002-intraday.json";
import s2002_m from "./sample-2002-monthly.json";
import s2357_i from "./sample-2357-intraday.json";
import s2357_m from "./sample-2357-monthly.json";
import s2912_i from "./sample-2912-intraday.json";
import s2912_m from "./sample-2912-monthly.json";
import s2603_i from "./sample-2603-intraday.json";
import s2603_m from "./sample-2603-monthly.json";
import s2308_i from "./sample-2308-intraday.json";
import s2308_m from "./sample-2308-monthly.json";
import s2891_i from "./sample-2891-intraday.json";
import s2891_m from "./sample-2891-monthly.json";
import s2881_i from "./sample-2881-intraday.json";
import s2881_m from "./sample-2881-monthly.json";
import s1301_i from "./sample-1301-intraday.json";
import s1301_m from "./sample-1301-monthly.json";
import s2609_i from "./sample-2609-intraday.json";
import s2609_m from "./sample-2609-monthly.json";
import s3711_i from "./sample-3711-intraday.json";
import s3711_m from "./sample-3711-monthly.json";
import s2379_i from "./sample-2379-intraday.json";
import s2379_m from "./sample-2379-monthly.json";
import s00878_i from "./sample-00878-intraday.json";
import s00878_m from "./sample-00878-monthly.json";
import s2615_i from "./sample-2615-intraday.json";
import s2615_m from "./sample-2615-monthly.json";

export interface TrackData {
  label: string;         // 股號 / TAIEX
  name: string;          // 中文名稱
  kind: string;          // 'stock' | 'taiex' | 'classic'
  mode: "intraday" | "monthly" | "long";
  desc: string;          // 簡短描述
  prices: number[];
  subtitle?: string;     // 遊戲內 HUD 副標（經典模式用：期間・標的）
}

// 月盤在前（決定人氣排序順序）；日盤接在後、維持相同股票順序。
// TrackSelect 的 POPULARITY 用 label 作 key，相同 label 後寫覆蓋先寫，
// 但兩段順序相同，相對排名不受影響。
export const TRACKS: TrackData[] = [
  // ── 月盤（近3個月日收盤，~51點）─────────────────────────────────────
  { label: "TAIEX", name: "加權指數",   kind: "taiex", mode: "monthly",  desc: "近月日線・大盤走勢",   prices: taiex_m.prices },
  { label: "2330",  name: "台積電",     kind: "stock", mode: "monthly",  desc: "近月日線・半導體龍頭", prices: s2330_m.prices },
  { label: "0050",  name: "元大台灣50", kind: "stock", mode: "monthly",  desc: "近月日線・市場縮影",   prices: s0050_m.prices },
  { label: "2454",  name: "聯發科",     kind: "stock", mode: "monthly",  desc: "近月日線・狂野跳台",   prices: s2454_m.prices },
  { label: "0056",  name: "元大高股息", kind: "stock", mode: "monthly",  desc: "近月日線・穩健配息",   prices: s0056_m.prices },
  { label: "2317",  name: "鴻海精密",   kind: "stock", mode: "monthly",  desc: "近月日線・代工龍頭",   prices: s2317_m.prices },
  { label: "2382",  name: "廣達電腦",   kind: "stock", mode: "monthly",  desc: "近月日線・AI 伺服器",  prices: s2382_m.prices },
  { label: "2303",  name: "聯華電子",   kind: "stock", mode: "monthly",  desc: "近月日線・半導體週期", prices: s2303_m.prices },
  { label: "2412",  name: "中華電信",   kind: "stock", mode: "monthly",  desc: "近月日線・超穩防守",   prices: s2412_m.prices },
  { label: "2882",  name: "國泰金控",   kind: "stock", mode: "monthly",  desc: "近月日線・金融起伏",   prices: s2882_m.prices },
  { label: "3008",  name: "大立光電",   kind: "stock", mode: "monthly",  desc: "近月日線・高價劇烈",   prices: s3008_m.prices },
  { label: "2002",  name: "中國鋼鐵",   kind: "stock", mode: "monthly",  desc: "近月日線・景氣循環",   prices: s2002_m.prices },
  { label: "2357",  name: "華碩電腦",   kind: "stock", mode: "monthly",  desc: "近月日線・科技消費",   prices: s2357_m.prices },
  { label: "2912",  name: "統一超商",   kind: "stock", mode: "monthly",  desc: "近月日線・防守穩健",   prices: s2912_m.prices },
  { label: "2603",  name: "長榮",       kind: "stock", mode: "monthly",  desc: "近月日線・航運狂飆",   prices: s2603_m.prices },
  { label: "2308",  name: "台達電",     kind: "stock", mode: "monthly",  desc: "近月日線・AI 電源飆漲", prices: s2308_m.prices },
  { label: "2891",  name: "中信金",     kind: "stock", mode: "monthly",  desc: "近月日線・金控龍頭",   prices: s2891_m.prices },
  { label: "2881",  name: "富邦金",     kind: "stock", mode: "monthly",  desc: "近月日線・金控起伏",   prices: s2881_m.prices },
  { label: "1301",  name: "台塑",       kind: "stock", mode: "monthly",  desc: "近月日線・塑化景氣",   prices: s1301_m.prices },
  { label: "2609",  name: "陽明",       kind: "stock", mode: "monthly",  desc: "近月日線・航運起伏",   prices: s2609_m.prices },
  { label: "3711",  name: "日月光投控", kind: "stock", mode: "monthly",  desc: "近月日線・封測飆漲",   prices: s3711_m.prices },
  { label: "2379",  name: "瑞昱",       kind: "stock", mode: "monthly",  desc: "近月日線・IC 設計",   prices: s2379_m.prices },
  { label: "00878", name: "國泰永續高股息", kind: "stock", mode: "monthly", desc: "近月日線・高股息 ETF", prices: s00878_m.prices },
  { label: "2615",  name: "萬海",       kind: "stock", mode: "monthly",  desc: "近月日線・航運",       prices: s2615_m.prices },

  // ── 日盤（前次交易日 5分K，~54點）───────────────────────────────────
  { label: "TAIEX", name: "加權指數",   kind: "taiex", mode: "intraday", desc: "前次日盤・盤中指數",   prices: taiex_i.prices },
  { label: "2330",  name: "台積電",     kind: "stock", mode: "intraday", desc: "前次日盤・半導體龍頭", prices: s2330_i.prices },
  { label: "0050",  name: "元大台灣50", kind: "stock", mode: "intraday", desc: "前次日盤・平穩巡航",   prices: s0050_i.prices },
  { label: "2454",  name: "聯發科",     kind: "stock", mode: "intraday", desc: "前次日盤・高波動",     prices: s2454_i.prices },
  { label: "0056",  name: "元大高股息", kind: "stock", mode: "intraday", desc: "前次日盤・超穩平緩",   prices: s0056_i.prices },
  { label: "2317",  name: "鴻海精密",   kind: "stock", mode: "intraday", desc: "前次日盤・中等起伏",   prices: s2317_i.prices },
  { label: "2382",  name: "廣達電腦",   kind: "stock", mode: "intraday", desc: "前次日盤・近期熱門",   prices: s2382_i.prices },
  { label: "2303",  name: "聯華電子",   kind: "stock", mode: "intraday", desc: "前次日盤・高波動",     prices: s2303_i.prices },
  { label: "2412",  name: "中華電信",   kind: "stock", mode: "intraday", desc: "前次日盤・極平穩",     prices: s2412_i.prices },
  { label: "2882",  name: "國泰金控",   kind: "stock", mode: "intraday", desc: "前次日盤・中等起伏",   prices: s2882_i.prices },
  { label: "3008",  name: "大立光電",   kind: "stock", mode: "intraday", desc: "前次日盤・高波動",     prices: s3008_i.prices },
  { label: "2002",  name: "中國鋼鐵",   kind: "stock", mode: "intraday", desc: "前次日盤・平穩",       prices: s2002_i.prices },
  { label: "2357",  name: "華碩電腦",   kind: "stock", mode: "intraday", desc: "前次日盤・中等起伏",   prices: s2357_i.prices },
  { label: "2912",  name: "統一超商",   kind: "stock", mode: "intraday", desc: "前次日盤・平穩",       prices: s2912_i.prices },
  { label: "2603",  name: "長榮",       kind: "stock", mode: "intraday", desc: "前次日盤・航運",       prices: s2603_i.prices },
  { label: "2308",  name: "台達電",     kind: "stock", mode: "intraday", desc: "前次日盤・AI 電源",   prices: s2308_i.prices },
  { label: "2891",  name: "中信金",     kind: "stock", mode: "intraday", desc: "前次日盤・金控",       prices: s2891_i.prices },
  { label: "2881",  name: "富邦金",     kind: "stock", mode: "intraday", desc: "前次日盤・金控",       prices: s2881_i.prices },
  { label: "1301",  name: "台塑",       kind: "stock", mode: "intraday", desc: "前次日盤・塑化",       prices: s1301_i.prices },
  { label: "2609",  name: "陽明",       kind: "stock", mode: "intraday", desc: "前次日盤・航運",       prices: s2609_i.prices },
  { label: "3711",  name: "日月光投控", kind: "stock", mode: "intraday", desc: "前次日盤・封測",       prices: s3711_i.prices },
  { label: "2379",  name: "瑞昱",       kind: "stock", mode: "intraday", desc: "前次日盤・IC 設計",   prices: s2379_i.prices },
  { label: "00878", name: "國泰永續高股息", kind: "stock", mode: "intraday", desc: "前次日盤・高股息 ETF", prices: s00878_i.prices },
  { label: "2615",  name: "萬海",       kind: "stock", mode: "intraday", desc: "前次日盤・航運",       prices: s2615_i.prices },
];

// 困難度 = 最大單步漲跌幅（波動度），越大地形越狂野
export function trackDifficulty(prices: number[]): number {
  let maxStepPct = 0;
  for (let i = 1; i < prices.length; i++) {
    const pct = Math.abs(prices[i] / prices[i - 1] - 1);
    if (pct > maxStepPct) maxStepPct = pct;
  }
  return maxStepPct;
}

// 1~5 星難度
export function difficultyStars(prices: number[]): number {
  const d = trackDifficulty(prices);
  if (d < 0.005) return 1;
  if (d < 0.02)  return 2;
  if (d < 0.05)  return 3;
  if (d < 0.085) return 4;
  return 5;
}
