// Google Play In-App Review——只在 Capacitor 原生殼生效，網頁/PWA 一律 no-op。
//
// 觸發策略（手遊慣例：在「爽點」才開口，且自己再包一層節流）：
//   - 只在「打破個人最佳紀錄」的結算畫面觸發（GameCanvas newPb；newPb 本身要求
//     舊 PB > 0，代表玩家至少是回鍋玩家，不會對第一次玩的人開口）。
//   - 自我節流：最多觸發 3 次、兩次間隔至少 14 天（REQUEST_LOG_KEY 記時間戳）。
//     Google 的 API 本身也有配額（呼叫太頻繁會靜默不顯示、且不回報有沒有顯示），
//     這層節流是避免把配額浪費在密集的破紀錄連發上。
//   - requestReview() 由 Google 決定顯不顯示評分卡，我們無從得知結果；失敗/不顯示
//     都靜默，絕不 block 遊戲流程。
import { Capacitor } from "@capacitor/core";
import { InAppReview } from "@capacitor-community/in-app-review";

const REQUEST_LOG_KEY = "tr_review_requests"; // JSON: number[]（每次觸發的 epoch ms）
const MAX_REQUESTS = 3;
const MIN_INTERVAL_MS = 14 * 86400000; // 14 天

function loadLog(): number[] {
  try { return JSON.parse(localStorage.getItem(REQUEST_LOG_KEY) ?? "[]") as number[]; }
  catch { return []; }
}

// 破 PB 的結算畫面呼叫。內部自己判斷該不該真的開口，呼叫端不用管條件。
export function maybeRequestReview(): void {
  if (!Capacitor.isNativePlatform()) return;
  const log = loadLog();
  const now = Date.now();
  if (log.length >= MAX_REQUESTS) return;
  if (log.length > 0 && now - log[log.length - 1] < MIN_INTERVAL_MS) return;
  try { localStorage.setItem(REQUEST_LOG_KEY, JSON.stringify([...log, now])); } catch { /* 靜默 */ }
  // 延遲 1.5s：讓「新個人紀錄！」徽章先被看到、分數滾動動畫跑完一段，評分卡才彈，
  // 不要跟結算資訊搶同一瞬間的注意力。
  setTimeout(() => {
    InAppReview.requestReview().catch((err) => console.warn("[review] requestReview 失敗", err));
  }, 1500);
}
