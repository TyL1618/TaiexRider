// 每日任務（留存規劃「每日感」核心，見 RETENTION_PLAN.md）。
// 跟 streak.ts 的市場交易期別不同——任務是純個人習慣迴圈，用裝置本地日曆日
// （dailyKey()）而非 resolveSessionDate()，午夜就換一批，不用等非同步解析。
// 進度來自任何模式的 GameOverStats（每日賽/隨機/自選/經典皆算），累計一整天。

const PROGRESS_KEY = "tr_quest_progress";

interface DayProgress {
  day: string;
  perfectSum: number;    // 今日累計完美落地次數
  flipsSum: number;      // 今日累計翻轉圈數
  maxScore: number;      // 今日單局最高分
  maxSurviveSec: number; // 今日單局最長存活秒數
  playCount: number;     // 今日已玩局數
  claimed: string[];     // 今日已領獎的任務 id
}

function emptyDay(day: string): DayProgress {
  return { day, perfectSum: 0, flipsSum: 0, maxScore: 0, maxSurviveSec: 0, playCount: 0, claimed: [] };
}

function load(day: string): DayProgress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return emptyDay(day);
    const d = JSON.parse(raw) as DayProgress;
    return d.day === day ? d : emptyDay(day); // 跨日重置
  } catch {
    return emptyDay(day);
  }
}

function save(d: DayProgress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(d));
  } catch { /* 靜默 */ }
}

interface QuestDef {
  id: string;
  title: string;
  target: number;
  progress: (d: DayProgress) => number;
  reward: number; // 金幣
}

// 任務池：全部只依賴 GameOverStats 既有欄位，不需要股票分類等額外資料（v2 可擴充）
const POOL: QuestDef[] = [
  { id: "perfect2", title: "完美落地 2 次", target: 2, reward: 25, progress: (d) => d.perfectSum },
  { id: "score1200", title: "單局拿到 1200 分以上", target: 1, reward: 25, progress: (d) => (d.maxScore >= 1200 ? 1 : 0) },
  { id: "flips5", title: "翻轉總圈數達 5 圈", target: 5, reward: 25, progress: (d) => d.flipsSum },
  { id: "play1", title: "完成一場遊戲", target: 1, reward: 15, progress: (d) => (d.playCount >= 1 ? 1 : 0) },
  { id: "survive15", title: "單局撐過 15 秒", target: 1, reward: 20, progress: (d) => (d.maxSurviveSec >= 15 ? 1 : 0) },
];

// 依日期字串 seed 挑 3 個不重複任務，全服同一天看到同一組任務池（各自進度獨立）
function pickToday(day: string): QuestDef[] {
  let seed = 0;
  for (let i = 0; i < day.length; i++) seed = (seed * 31 + day.charCodeAt(i)) >>> 0;
  const idx = POOL.map((_, i) => i);
  const picked: number[] = [];
  for (let k = 0; k < 3 && idx.length > 0; k++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const j = seed % idx.length;
    picked.push(idx[j]);
    idx.splice(j, 1);
  }
  return picked.map((i) => POOL[i]);
}

export interface QuestView {
  id: string;
  title: string;
  target: number;
  progress: number;
  done: boolean;
  claimed: boolean;
  reward: number;
}

export function getDailyQuests(day: string): QuestView[] {
  const d = load(day);
  return pickToday(day).map((q) => {
    const progress = Math.min(q.target, q.progress(d));
    return {
      id: q.id,
      title: q.title,
      target: q.target,
      progress,
      done: progress >= q.target,
      claimed: d.claimed.includes(q.id),
      reward: q.reward,
    };
  });
}

// 每局結束呼叫：更新今日累計數據。回傳「這一局新完成、待自動領獎」的任務清單。
export function recordRun(
  day: string,
  stats: { score: number; flips: number; perfect: number; timeMs: number },
): QuestDef[] {
  const d = load(day);
  d.perfectSum += stats.perfect;
  d.flipsSum += stats.flips;
  d.maxScore = Math.max(d.maxScore, stats.score);
  d.maxSurviveSec = Math.max(d.maxSurviveSec, stats.timeMs / 1000);
  d.playCount += 1;

  const todays = pickToday(day);
  const newlyDone = todays.filter((q) => !d.claimed.includes(q.id) && q.progress(d) >= q.target);
  for (const q of newlyDone) d.claimed.push(q.id);

  save(d);
  return newlyDone;
}
