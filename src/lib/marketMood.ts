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
  isRage: boolean; // 狂暴盤：|漲跌|≥ RAGE_THRESHOLD，當日任務獎勵 ×2（伺服器 wallet_earn/claim_weekly_quest 各自重算，這裡只供顯示用）
}

const THRESHOLD = 0.01; // ±1% 大漲/大跌門檻，之後可依實際資料分布微調
// 狂暴盤門檻：2026-07-06 用 TAIEX 近 2 年（482 交易日）實測資料校準，2% 出現機率
// 14.9%（約每 6.7 個交易日一次，等於幾乎每週都來，太常見無法構成「特殊事件」），
// 2.5% 出現機率 10.0%（約每 10 個交易日一次，兩週一次），使用者拍板選 2.5%。
const RAGE_THRESHOLD = 0.025;

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
  const isRage = Math.abs(changePct) >= RAGE_THRESHOLD;
  return { mood, changePct, dateStr, isRage };
}
