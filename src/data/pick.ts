import { TRACKS, type TrackData } from "./tracks";

// 月盤賽道（圖形較完整，給每日挑戰 / 隨機結果用）
const MONTHLY = TRACKS.filter((t) => t.mode === "monthly");

// 以 label 去重的「股票池」（每支取月盤那筆），給隨機拉霸滾輪用
export const STOCK_POOL: TrackData[] = MONTHLY;

// 今日日期序號（以本地午夜為界）→ 全台同一天會選到同一張地圖，無需後端
export function dayNumber(d = new Date()): number {
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor(local.getTime() / 86_400_000);
}

// 每日挑戰：依日期種子選一張月盤地圖（同一天固定）
export function dailyTrack(d = new Date()): TrackData {
  return MONTHLY[dayNumber(d) % MONTHLY.length];
}

// 排行榜分組用的當日 key（本地時區 YYYY-MM-DD，對齊 dailyTrack 的日期種子）
export function dailyKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 隨機：從股票池抽一張
export function randomTrack(): TrackData {
  return STOCK_POOL[Math.floor(Math.random() * STOCK_POOL.length)];
}
