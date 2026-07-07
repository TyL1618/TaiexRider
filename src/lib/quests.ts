// 每日任務（留存規劃「每日感」核心，見 RETENTION_PLAN.md）。
// 跟 streak.ts 的市場交易期別不同——任務是純個人習慣迴圈，用裝置本地日曆日
// （dailyKey()）而非 resolveSessionDate()，午夜就換一批，不用等非同步解析。
// 進度來自任何模式的 GameOverStats（每日賽/隨機/自選/經典皆算），累計一整天。

// 2026-07-08 晚間修正：key 原本不分帳號，同裝置切換帳號（例如開發者測試帳號重度測試
// 後登出改玩訪客）會沿用「前一個使用者」當天已經領過的任務清單，訪客那邊會誤判「今天
// 這些任務都領過了」——跟 challengeAttempts.ts 修過的同一種跨帳號快取污染問題，補上
// uid 隔離（訪客固定用 "guest"）。
function progressKey(uid: string | null): string {
  return `tr_quest_progress_${uid ?? "guest"}`;
}

interface DayProgress {
  day: string;
  perfectSum: number;    // 今日累計完美落地次數
  flipsSum: number;      // 今日累計翻轉圈數
  maxScore: number;      // 今日單局最高分
  maxSurviveSec: number; // 今日單局最長存活秒數
  playCount: number;     // 今日已玩局數
  finishCount: number;   // 今日完賽次數（不含摔車）
  longFinish: boolean;   // 今日是否完賽過一場長征模式
  classicFinish: boolean; // 今日是否完賽過一場經典模式
  upDayFinish: boolean;   // 今日是否在「上漲盤」完賽過
  downDayFinish: boolean; // 今日是否在「下跌盤」完賽過
  claimed: string[];     // 今日已領獎的任務 id
}

function emptyDay(day: string): DayProgress {
  return {
    day, perfectSum: 0, flipsSum: 0, maxScore: 0, maxSurviveSec: 0, playCount: 0,
    finishCount: 0, longFinish: false, classicFinish: false, upDayFinish: false, downDayFinish: false,
    claimed: [],
  };
}

function load(uid: string | null, day: string): DayProgress {
  try {
    const raw = localStorage.getItem(progressKey(uid));
    if (!raw) return emptyDay(day);
    const d = JSON.parse(raw) as DayProgress;
    // 跨日重置；同日但欄位是舊格式（本次任務池擴充新增的欄位）就補預設值，避免 undefined
    return d.day === day ? { ...emptyDay(day), ...d } : emptyDay(day);
  } catch {
    return emptyDay(day);
  }
}

function save(uid: string | null, d: DayProgress): void {
  try {
    localStorage.setItem(progressKey(uid), JSON.stringify(d));
  } catch { /* 靜默 */ }
}

interface QuestDef {
  id: string;
  title: string;
  target: number;
  progress: (d: DayProgress) => number;
  reward: number; // 金幣
}

// 任務池：2026-07-08 從 5 種擴充到 10 種（原本只有 5 種、久了同樣的任務會一直重複
// 用不同組合出現），新增的幾種需要 recordRun() 多傳 mode/marketMood/finished 才算得出來。
const POOL: QuestDef[] = [
  { id: "perfect2", title: "完美落地 2 次", target: 2, reward: 25, progress: (d) => d.perfectSum },
  { id: "score1200", title: "單局拿到 1200 分以上", target: 1, reward: 25, progress: (d) => (d.maxScore >= 1200 ? 1 : 0) },
  { id: "flips5", title: "翻轉總圈數達 5 圈", target: 5, reward: 25, progress: (d) => d.flipsSum },
  { id: "play1", title: "完成一場遊戲", target: 1, reward: 15, progress: (d) => (d.playCount >= 1 ? 1 : 0) },
  { id: "survive15", title: "單局撐過 15 秒", target: 1, reward: 20, progress: (d) => (d.maxSurviveSec >= 15 ? 1 : 0) },
  { id: "finish3", title: "累計完賽 3 場", target: 3, reward: 25, progress: (d) => d.finishCount },
  { id: "longFinish", title: "完賽一場長征模式", target: 1, reward: 30, progress: (d) => (d.longFinish ? 1 : 0) },
  { id: "classicFinish", title: "完賽一場經典模式", target: 1, reward: 25, progress: (d) => (d.classicFinish ? 1 : 0) },
  { id: "upDayFinish", title: "在今日上漲盤完賽一場", target: 1, reward: 20, progress: (d) => (d.upDayFinish ? 1 : 0) },
  { id: "downDayFinish", title: "在今日下跌盤完賽一場", target: 1, reward: 20, progress: (d) => (d.downDayFinish ? 1 : 0) },
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

export function getDailyQuests(day: string, uid: string | null = null): QuestView[] {
  const d = load(uid, day);
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
// mode/marketMood 只在 finished 時才有意義（摔車不算「完賽」類任務的進度）。
export function recordRun(
  day: string,
  stats: {
    score: number; flips: number; perfect: number; timeMs: number;
    finished?: boolean; mode?: string; marketMood?: "up" | "down" | "flat" | null;
  },
  uid: string | null = null,
): QuestDef[] {
  const d = load(uid, day);
  d.perfectSum += stats.perfect;
  d.flipsSum += stats.flips;
  d.maxScore = Math.max(d.maxScore, stats.score);
  d.maxSurviveSec = Math.max(d.maxSurviveSec, stats.timeMs / 1000);
  d.playCount += 1;
  if (stats.finished) {
    d.finishCount += 1;
    if (stats.mode === "long") d.longFinish = true;
    if (stats.mode === "classic") d.classicFinish = true;
    if (stats.marketMood === "up") d.upDayFinish = true;
    if (stats.marketMood === "down") d.downDayFinish = true;
  }

  const todays = pickToday(day);
  const newlyDone = todays.filter((q) => !d.claimed.includes(q.id) && q.progress(d) >= q.target);
  for (const q of newlyDone) d.claimed.push(q.id);

  save(uid, d);
  return newlyDone;
}
