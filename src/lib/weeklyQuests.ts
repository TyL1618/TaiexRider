// 週任務（RETENTION_PLAN.md 第二批，2026-07-06 使用者點頭 schema 後動工）。
// 跟 quests.ts 的每日任務同構（seeded 任務池 + GameOverStats 累計），差異只在週期：
// 用 ISO 週別（YYYY-Www）取代日曆日，目標數字放大成「週」的尺度。
//
// 已登入：record_weekly_run()/claim_weekly_quest() RPC 為權威（migration_20260706b.sql），
// 進度存伺服器，換帳號/裝置不會歸零（這正是 2026-07-06 才點頭做這個的原因——只存
// localStorage 會跟暱稱/成就/streak 同一類污染問題）。
// 未登入：純本地 localStorage，無法跨裝置保留，接受（跟 achievements/streak 同取捨）。

import { supabase } from "./supabase";

// 2026-07-08 晚間修正：key 原本不分帳號，同裝置切換帳號會沿用「前一個使用者」的本地
// 快取（跟 quests.ts/playRewards.ts/challengeAttempts.ts 修過的同一種跨帳號污染問題），
// 補上 uid 隔離（訪客固定用 "guest"）。已登入時這份本來就會被伺服器 sync 覆寫，這裡
// 主要是保護「伺服器 RPC 尚未建立/離線」時的本地 fallback 不互相污染。
function progressKey(uid: string | null): string {
  return `tr_weekly_quest_progress_${uid ?? "guest"}`;
}

interface WeekProgress {
  week: string;
  perfectSum: number;
  flipsSum: number;
  maxScore: number;
  maxSurviveSec: number;
  playCount: number;
  finishCount: number;        // 本週累計完賽次數
  longFinishCount: number;    // 本週完賽長征模式次數
  classicFinishCount: number; // 本週完賽經典模式次數
  upDayFinishCount: number;   // 本週在上漲盤完賽次數
  downDayFinishCount: number; // 本週在下跌盤完賽次數
  claimed: string[];
}

function emptyWeek(week: string): WeekProgress {
  return {
    week, perfectSum: 0, flipsSum: 0, maxScore: 0, maxSurviveSec: 0, playCount: 0,
    finishCount: 0, longFinishCount: 0, classicFinishCount: 0, upDayFinishCount: 0, downDayFinishCount: 0,
    claimed: [],
  };
}

function load(uid: string | null, week: string): WeekProgress {
  try {
    const raw = localStorage.getItem(progressKey(uid));
    if (!raw) return emptyWeek(week);
    const d = JSON.parse(raw) as WeekProgress;
    // 跨週重置；同週但欄位是舊格式（本次任務池擴充新增的欄位）就補預設值，避免 undefined
    return d.week === week ? { ...emptyWeek(week), ...d } : emptyWeek(week);
  } catch {
    return emptyWeek(week);
  }
}

function save(uid: string | null, d: WeekProgress): void {
  try { localStorage.setItem(progressKey(uid), JSON.stringify(d)); } catch { /* 靜默 */ }
}

interface QuestDef {
  id: string;
  title: string;
  target: number;
  progress: (d: WeekProgress) => number;
  reward: number; // 金幣（狂暴盤日伺服器端會自動 ×2，見 claim_weekly_quest RPC）
}

const POOL: QuestDef[] = [
  { id: "w_flips30",   title: "本週翻轉總圈數達 30 圈",  target: 30, reward: 40, progress: (d) => d.flipsSum },
  { id: "w_perfect10", title: "本週完美落地累計 10 次",   target: 10, reward: 40, progress: (d) => d.perfectSum },
  { id: "w_score2000", title: "單局拿到 2000 分以上",     target: 1,  reward: 40, progress: (d) => (d.maxScore >= 2000 ? 1 : 0) },
  { id: "w_play10",    title: "本週完成 10 場遊戲",       target: 10, reward: 35, progress: (d) => d.playCount },
  { id: "w_survive25", title: "單局撐過 25 秒",           target: 1,  reward: 35, progress: (d) => (d.maxSurviveSec >= 25 ? 1 : 0) },
  { id: "w_finish10",       title: "本週累計完賽 10 場",       target: 10, reward: 40, progress: (d) => d.finishCount },
  { id: "w_longFinish3",    title: "本週完賽 3 場長征模式",    target: 3,  reward: 45, progress: (d) => d.longFinishCount },
  { id: "w_classicFinish3", title: "本週完賽 3 場經典模式",    target: 3,  reward: 40, progress: (d) => d.classicFinishCount },
  { id: "w_upDayFinish3",   title: "本週在上漲盤完賽 3 次",    target: 3,  reward: 35, progress: (d) => d.upDayFinishCount },
  { id: "w_downDayFinish3", title: "本週在下跌盤完賽 3 次",    target: 3,  reward: 35, progress: (d) => d.downDayFinishCount },
];

// 依週別 seed 挑 3 個不重複任務，全服同一週看到同一組任務池（各自進度獨立）
function pickWeek(week: string): QuestDef[] {
  let seed = 0;
  for (let i = 0; i < week.length; i++) seed = (seed * 31 + week.charCodeAt(i)) >>> 0;
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

// ISO 8601 週別（YYYY-Www），用裝置本地日期（同 dailyKey() 的本地時區慣例，不可用 UTC）。
export function weekKey(d = new Date()): string {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (date.getDay() + 6) % 7; // Mon=0..Sun=6
  date.setDate(date.getDate() - day + 3); // 移到本週四
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  const firstDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${date.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface WeeklyQuestView {
  id: string;
  title: string;
  target: number;
  progress: number;
  done: boolean;
  claimed: boolean;
  reward: number;
}

export function getWeeklyQuests(week: string, uid: string | null = null): WeeklyQuestView[] {
  const d = load(uid, week);
  return pickWeek(week).map((q) => {
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

async function getUid(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user.id ?? null;
}

// 畫面掛載時呼叫：已登入時把伺服器進度同步進本地快取（跟 achievements/streak 同款模式），
// 避免顯示同步前的舊快取；未登入時 no-op（本地快取本來就是唯一真相）。
export async function syncWeeklyFromServer(week: string): Promise<void> {
  const uid = await getUid();
  if (!uid) return;
  const { data, error } = await supabase.rpc("get_weekly_quest", { p_week: week });
  if (error || !data || !data[0]) return;
  const row = data[0] as {
    perfect_sum: number; flips_sum: number; max_score: number; max_survive_sec: number; play_count: number;
    finish_count: number; long_finish_count: number; classic_finish_count: number;
    up_day_finish_count: number; down_day_finish_count: number; claimed: string[];
  };
  save(uid, {
    week, perfectSum: row.perfect_sum, flipsSum: row.flips_sum, maxScore: row.max_score,
    maxSurviveSec: row.max_survive_sec, playCount: row.play_count,
    finishCount: row.finish_count, longFinishCount: row.long_finish_count,
    classicFinishCount: row.classic_finish_count, upDayFinishCount: row.up_day_finish_count,
    downDayFinishCount: row.down_day_finish_count, claimed: row.claimed ?? [],
  });
}

// 每局結束呼叫：已登入時累加到伺服器（權威），未登入純本地。回傳「這一局新完成、
// 待自動領獎」的任務清單（呼叫端逐一呼叫 claimWeeklyQuest 發獎）。
// mode/marketMood 只在 finished 時才有意義（摔車不算「完賽」類任務的進度）。
export async function recordWeeklyRun(
  week: string,
  stats: {
    score: number; flips: number; perfect: number; timeMs: number;
    finished?: boolean; mode?: string; marketMood?: "up" | "down" | "flat" | null;
  },
): Promise<QuestDef[]> {
  const uid = await getUid();
  if (uid) {
    const { data, error } = await supabase.rpc("record_weekly_run", {
      p_week: week,
      p_score: Math.round(stats.score),
      p_flips: stats.flips,
      p_perfect: stats.perfect,
      p_time_ms: Math.round(stats.timeMs),
      p_finished: !!stats.finished,
      p_mode: stats.mode ?? null,
      p_market_mood: stats.marketMood ?? null,
    });
    if (!error && data && data[0]) {
      const row = data[0] as {
        perfect_sum: number; flips_sum: number; max_score: number; max_survive_sec: number; play_count: number;
        finish_count: number; long_finish_count: number; classic_finish_count: number;
        up_day_finish_count: number; down_day_finish_count: number; claimed: string[];
      };
      const d: WeekProgress = {
        week, perfectSum: row.perfect_sum, flipsSum: row.flips_sum, maxScore: row.max_score,
        maxSurviveSec: row.max_survive_sec, playCount: row.play_count,
        finishCount: row.finish_count, longFinishCount: row.long_finish_count,
        classicFinishCount: row.classic_finish_count, upDayFinishCount: row.up_day_finish_count,
        downDayFinishCount: row.down_day_finish_count, claimed: row.claimed ?? [],
      };
      save(uid, d);
      const todays = pickWeek(week);
      return todays.filter((q) => !d.claimed.includes(q.id) && q.progress(d) >= q.target);
    }
    // RPC 失敗（尚未跑 migration/網路問題）：退回本地累計，下次同步會被伺服器覆寫
  }
  const d = load(uid, week);
  d.perfectSum += stats.perfect;
  d.flipsSum += stats.flips;
  d.maxScore = Math.max(d.maxScore, stats.score);
  d.maxSurviveSec = Math.max(d.maxSurviveSec, stats.timeMs / 1000);
  d.playCount += 1;
  if (stats.finished) {
    d.finishCount += 1;
    if (stats.mode === "long") d.longFinishCount += 1;
    if (stats.mode === "classic") d.classicFinishCount += 1;
    if (stats.marketMood === "up") d.upDayFinishCount += 1;
    if (stats.marketMood === "down") d.downDayFinishCount += 1;
  }
  const todays = pickWeek(week);
  const newlyDone = todays.filter((q) => !d.claimed.includes(q.id) && q.progress(d) >= q.target);
  for (const q of newlyDone) d.claimed.push(q.id);
  save(uid, d);
  return newlyDone;
}

// 任務新完成時呼叫：已登入→伺服器驗證＋發幣（狂暴盤×2，回傳最新金幣餘額）；
// 未登入→本地已在 recordWeeklyRun 標記 claimed，回傳 coins:null 讓呼叫端自行本地加幣。
export async function claimWeeklyQuest(
  week: string,
  questId: string,
): Promise<{ claimed: boolean; coins: number | null }> {
  const uid = await getUid();
  if (!uid) return { claimed: true, coins: null };
  const { data, error } = await supabase.rpc("claim_weekly_quest", { p_week: week, p_quest_id: questId });
  if (error || !data || !data[0]) return { claimed: false, coins: null };
  const row = data[0] as { coins: number; ok: boolean };
  return { claimed: row.ok, coins: row.coins };
}
