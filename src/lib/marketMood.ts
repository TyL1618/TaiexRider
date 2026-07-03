// 全站盤勢主題氛圍（RETENTION_PLAN.md「盤勢事件化」）：讀當期大盤（TAIEX）漲跌，
// 分類大漲/大跌/平盤，驅動背景色調 + 首頁說明文字。刻意只查詢既有 daily_map 的
// TAIEX 那列（scripts/fetchDailyMap.ts 寫入 stock_code="TAIEX"），不用新端點。

import { fetchStockDailyMap, resolveSessionDisplayDate } from "./dailyMap";
import { dailyKey } from "../data/pick";

export type Mood = "up" | "down" | "flat";

export interface MarketMood {
  mood: Mood;
  changePct: number;
  dateStr: string; // "7/2"
}

const THRESHOLD = 0.01; // ±1% 大漲/大跌門檻，之後可依實際資料分布微調

export async function resolveMarketMood(): Promise<MarketMood | null> {
  const date = dailyKey();
  const [row, displayDate] = await Promise.all([
    fetchStockDailyMap(date, "TAIEX"),
    resolveSessionDisplayDate(date),
  ]);
  if (!row || row.prices.length < 2) return null;
  const first = row.prices[0];
  const last = row.prices[row.prices.length - 1];
  if (first <= 0) return null;
  const changePct = (last - first) / first;
  const mood: Mood = changePct > THRESHOLD ? "up" : changePct < -THRESHOLD ? "down" : "flat";
  const dateStr = `${displayDate.getUTCMonth() + 1}/${displayDate.getUTCDate()}`;
  return { mood, changePct, dateStr };
}
