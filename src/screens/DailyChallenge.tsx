import { useEffect, useRef, useState } from "react";
import Sparkline from "../components/Sparkline";
import { dailyTrack, dailyKey } from "../data/pick";
import { fetchDailyTop, invalidateDailyTop, isLeaderboardConfigured, type ScoreRow } from "../lib/leaderboard";
import { fetchHardestDailyMap, resolveSessionDate, resolveSessionDisplayDate } from "../lib/dailyMap";
import { signInWithGoogle, type User } from "../lib/auth";
import { getPlayerName } from "../lib/playerId";
import { getAttempts, incrementAttempts, consumeAttemptServer, MAX_ATTEMPTS, FREE_ATTEMPTS } from "../lib/challengeAttempts";
import { recordStreak, getStreak, playedThisSession, writeStreakCache } from "../lib/streak";
import { fetchDeathHeatmap, type HeatBucket } from "../lib/deathHeatmap";
import { getDailyQuests } from "../lib/quests";
import { getWeeklyQuests, syncWeeklyFromServer, weekKey, type WeeklyQuestView } from "../lib/weeklyQuests";
import { getAdsRemoved, syncWalletFromServer } from "../lib/garage";
import { checkPendingSettlement, ackSettlement, type PendingSettlement } from "../lib/dailyDiamondSettlement";
import CoinIcon from "../components/CoinIcon";
import type { TrackData } from "../data/tracks";
import "./DailyChallenge.css";

// 死亡熱點顏色：0=賽道基準青、(0,0.5]=綠→紅、(0.5,1]=紅→紫，v 為死亡數/當日最大值正規化。
// 用 HSL 色相插值（不是 RGB 直線插值）：RGB 從綠(0,255,136)直接補間到紅(255,34,68)
// 中間會經過一段濁褐色（兩色同時升降沒有共同亮點），色相插值改沿黃橙路徑過渡，
// 顏色乾淨鮮明，符合霓虹賽道的視覺風格。
function heatColor(v: number): string {
  if (v <= 0) return "rgba(45, 226, 230, 0.35)";
  const hue = v <= 0.5
    ? 152 - 162 * (v / 0.5)             // 152°綠 → -10°(≡350°紅)，途經黃橙
    : 350 - 65 * ((v - 0.5) / 0.5);     // 350°紅 → 285°紫
  return `hsl(${((hue % 360) + 360) % 360}, 88%, 54%)`;
}

const fmtMs = (ms: number) => {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}`;
};

export default function DailyChallenge({
  user,
  onPlay,
  onBack,
}: {
  user: User | null;
  onPlay: (t: TrackData) => void;
  onBack: () => void;
}) {
  const fallbackTrack = dailyTrack();
  // 標題日期 = 實際盤勢日（resolveSessionDate − 1），連假時 ≠ 今天 − 1。先放今天當 fallback，解析後更新。
  const [dateStr, setDateStr] = useState(() => {
    const t = new Date();
    return `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, "0")}/${String(t.getDate()).padStart(2, "0")}`;
  });
  const [track, setTrack] = useState<TrackData>(fallbackTrack);
  const [isLive, setIsLive] = useState(false);
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // 排行榜的「目前這一期」key（= max(map_date)），連假整段沿用同一張榜。
  // 非日曆日 dailyKey()，避免連假第二天起換到空榜。handleRefresh 也讀它。
  const sessionKeyRef = useRef<string>(dailyKey());
  const [attempts, setAttempts] = useState(() => getAttempts(dailyKey(), user?.id ?? null));
  const [serverMaxed, setServerMaxed] = useState(false); // 伺服器判定今日已達上限（優先於本地計數，防清 localStorage 繞過）
  const [checkingStart, setCheckingStart] = useState(false);
  const [streak, setStreak] = useState(0);
  const [streakLive, setStreakLive] = useState(false); // 本期已參賽（🔥 實心）或待延續（提示）
  const [heat, setHeat] = useState<HeatBucket[]>([]); // 今日全服死亡熱點（20 等分）
  const [quests, setQuests] = useState(() => getDailyQuests(dailyKey(), user?.id ?? null)); // 每日任務（裝置本地日曆日，跨模式共用）
  const [adsRemoved] = useState(() => getAdsRemoved()); // 永久去廣告：第 3~5 次挑戰不再顯示「看廣告」標籤
  const [weeklyQuests, setWeeklyQuests] = useState<WeeklyQuestView[]>([]); // 本週任務（ISO 週別，已登入才有伺服器權威進度）
  const [pendingSettlement, setPendingSettlement] = useState<PendingSettlement | null>(null); // 前一期排行榜鑽石結算彈窗

  // 2026-07-07：同裝置切換帳號時，本地次數快取重新從「這個 uid」自己的 key 讀取
  // （見 challengeAttempts.ts 頂部說明），避免沿用前一個使用者當天用掉的次數；
  // serverMaxed 也一併重置（那是針對前一個 uid 判定的，換人要重新問伺服器）。
  useEffect(() => {
    setAttempts(getAttempts(sessionKeyRef.current, user?.id ?? null));
    setServerMaxed(false);
    setQuests(getDailyQuests(dailyKey(), user?.id ?? null)); // 換帳號/登出重讀，避免沿用前一個使用者的任務快取
  }, [user?.id]);

  useEffect(() => {
    let alive = true;
    fetchDeathHeatmap().then((rows) => { if (alive) setHeat(rows); });
    return () => { alive = false; };
  }, []);

  // 已登入時先跟伺服器同步一次本週進度，避免顯示同步前的舊本地快取
  useEffect(() => {
    let alive = true;
    const week = weekKey();
    syncWeeklyFromServer(week).then(() => { if (alive) setWeeklyQuests(getWeeklyQuests(week, user?.id ?? null)); });
    return () => { alive = false; };
  }, [user]);

  // 前一期排行榜鑽石結算（參與+名次）：GitHub Actions 排程已在台灣 00:00 結算完，
  // 這裡只查「還沒看過的結果」跳彈窗，看過後 ack 掉不再跳。
  useEffect(() => {
    let alive = true;
    checkPendingSettlement().then((s) => { if (alive && s) setPendingSettlement(s); });
    return () => { alive = false; };
  }, [user]);

  const handleAckSettlement = () => {
    if (!pendingSettlement) return;
    ackSettlement(pendingSettlement.challengeDate);
    setPendingSettlement(null);
    syncWalletFromServer(); // 重新讀取伺服器最新鑽石餘額（結算已經加過了，本地只是刷新顯示）
  };

  useEffect(() => {
    let alive = true;
    fetchHardestDailyMap(dailyKey()).then((row) => {
      if (!alive) return;
      if (row) {
        setTrack({ label: row.stock_code, name: row.stock_name, kind: "taiex", mode: "intraday", desc: "前一交易日走勢", prices: row.prices });
        setIsLive(true);
      }
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    resolveSessionDate(dailyKey()).then((key) => {
      sessionKeyRef.current = key;
      if (alive) {
        setAttempts(getAttempts(key, user?.id ?? null)); // 用正確的 session key 重新讀取次數
        setStreak(getStreak(key));
        setStreakLive(playedThisSession(key));
      }
      return fetchDailyTop(key);
    }).then((r) => {
      if (alive) { setRows(r); setLoaded(true); }
    });
    return () => { alive = false; };
  }, []);

  // 標題日期改用實際盤勢日（= map_date − 1），與畫面顯示的盤一致（連假時 ≠ 今天 − 1）
  useEffect(() => {
    let alive = true;
    resolveSessionDisplayDate(dailyKey()).then((d) => {
      if (alive) setDateStr(`${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`);
    });
    return () => { alive = false; };
  }, []);

  const handleRefresh = () => {
    if (refreshing) return;
    const key = sessionKeyRef.current;
    invalidateDailyTop(key);
    setRefreshing(true);
    fetchDailyTop(key).then((r) => {
      setRows(r);
      setLoaded(true);
      setRefreshing(false);
    });
  };

  return (
    <div className="daily-screen">
      <button className="back-btn" onClick={onBack}>‹ 返回</button>

      {pendingSettlement && (
        <div className="modal-overlay" onClick={handleAckSettlement}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              {pendingSettlement.rank === 1 ? "🥇 前一日排行榜冠軍！"
                : pendingSettlement.rank === 2 ? "🥈 前一日排行榜第 2 名！"
                : pendingSettlement.rank !== null && pendingSettlement.rank <= 4 ? `🥉 前一日排行榜第 ${pendingSettlement.rank} 名！`
                : pendingSettlement.rank !== null ? `🎖️ 前一日排行榜第 ${pendingSettlement.rank} 名！`
                : "🎁 前一日參加獎"}
            </div>
            <div className="modal-item">💎 +{pendingSettlement.diamonds} 鑽石</div>
            <button className="modal-btn" onClick={handleAckSettlement}>太棒了！</button>
          </div>
        </div>
      )}

      <div className="daily-head">
        <div className="daily-tag">🏆 每日排名賽 ・ {dateStr}</div>

        <div className="daily-chart">
          <Sparkline prices={track.prices} width={320} height={150} />
        </div>

        {(() => {
          const total = heat.reduce((s, h) => s + h.deaths, 0);
          if (total === 0) return null;
          const maxD = Math.max(...heat.map((h) => h.deaths));
          const cells = Array.from({ length: 20 }, (_, i) => heat.find((h) => h.bucket === i + 1)?.deaths ?? 0);
          // 死亡數對「當日最大值」正規化成 0~1，再依比例走色：0=賽道基準青（融入走勢圖）
          // →綠(少)→紅(中)→紫(死最多)。同一條線用顏色深淺表達密度，人多人少視覺都不擠。
          const stops = cells.map((d, i) => {
            const v = maxD > 0 ? d / maxD : 0;
            return `${heatColor(v)} ${(i / 19) * 100}%`;
          });
          return (
            <div className="death-heat">
              <div className="death-heat-line" style={{ backgroundImage: `linear-gradient(to right, ${stops.join(", ")})` }} />
              <div className="death-heat-label">☠️ 今日全服已陣亡 {total} 人次・顏色越深越多人摔在那</div>
            </div>
          );
        })()}

        <div className="daily-info">
          <span className="daily-label">{track.label}</span>
          <span className="daily-name">{track.name}</span>
        </div>
        <div className="daily-period">{isLive ? "前次盤勢 ・ 今日地圖" : "近月日線 ・ 今日地圖"}</div>

        {streak > 0 && (
          <div className={`daily-streak${streakLive ? " live" : ""}`}>
            🔥 連續參賽 {streak} 天{streakLive ? "" : "・今天玩一場保持紀錄！"}
          </div>
        )}

        <div className="daily-quests">
          <div className="daily-quests-title">📋 今日任務</div>
          {quests.map((q) => (
            <div key={q.id} className={`quest-item${q.done ? " done" : ""}`}>
              <span className="quest-check">{q.done ? "✅" : "⬜"}</span>
              <span className="quest-title">{q.title}</span>
              <span className="quest-progress">{q.progress}/{q.target}・+{q.reward}<CoinIcon size={11} /></span>
            </div>
          ))}
        </div>

        <div className="weekly-quests">
          <div className="weekly-quests-title">🗓️ 本週任務</div>
          {weeklyQuests.map((q) => (
            <div key={q.id} className={`quest-item${q.done ? " done" : ""}`}>
              <span className="quest-check">{q.done ? "✅" : "⬜"}</span>
              <span className="quest-title">{q.title}</span>
              <span className="quest-progress">{q.progress}/{q.target}・+{q.reward}<CoinIcon size={11} /></span>
            </div>
          ))}
        </div>

        {user ? (
          <div className="auth-row">
            <span className="auth-as-text">以 <strong>{getPlayerName()}</strong> 參賽</span>
          </div>
        ) : (
          <div className="auth-row auth-row--guest">
            <span className="auth-guest-hint">登入後成績才會上榜</span>
            <button className="google-signin-btn" onClick={signInWithGoogle}>
              <GoogleIcon />Google 登入
            </button>
          </div>
        )}

        {(() => {
          // 2026-07-07：未登入玩家完全鎖住不能開始（原本只是提示「登入後成績才會
          // 上榜」，卻仍能實際遊玩、還會消耗次數——同張地圖想玩免登入版本可以走
          // 自選賽道，排行榜這裡直接要求登入比較單純）。
          const canPlay = !!user && attempts < MAX_ATTEMPTS && !serverMaxed;
          const showAd  = !adsRemoved && attempts >= FREE_ATTEMPTS;
          const num     = attempts + 1; // 即將進行的第幾次
          // 已登入玩家先問伺服器 consume_attempt()（真正把關，清 localStorage 也繞不過）；
          // 未登入/RPC 尚未建立時直接回 true，維持現行純前端計數行為不變。
          const handleStart = async () => {
            setCheckingStart(true);
            const result = await consumeAttemptServer();
            setCheckingStart(false);
            if (!result.ok) { setServerMaxed(true); return; }
            incrementAttempts(sessionKeyRef.current, user?.id ?? null);
            setAttempts(prev => prev + 1);
            // 連續參賽：進遊戲即算本期參賽。已登入時伺服器已算好最新 streak（見
            // consume_attempt() RPC），未登入才 fallback 本地 recordStreak()。
            if (result.streak !== null) {
              writeStreakCache(result.lastSessionKey, result.streak);
              setStreak(result.streak);
            } else {
              setStreak(recordStreak(sessionKeyRef.current));
            }
            setStreakLive(true);
            onPlay(track);
          };
          return (
            <button
              className={`daily-challenge-btn${showAd && canPlay ? " ad" : ""}${!canPlay ? " maxed" : ""}`}
              disabled={!canPlay || checkingStart}
              onClick={canPlay ? handleStart : undefined}
            >
              {!user
                ? "登入才能挑戰"
                : !canPlay
                  ? "今日已達上限"
                  : checkingStart
                    ? "確認中…"
                    : showAd
                      ? `看廣告開始 (${num}/5)`
                      : `開始挑戰 (${num}/5)`}
            </button>
          );
        })()}
      </div>

      <div className="rank-section">
        <div className="rank-section-title">
          今日排行榜
          <button
            className={`rank-refresh-btn${refreshing ? " spinning" : ""}`}
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="重整排行榜"
          >
            <RefreshIcon />
          </button>
        </div>
        <div className="rank-header">
          <span className="rk-pos">#</span>
          <span className="rk-score">分數</span>
          <span className="rk-time">時間</span>
          <span className="rk-user">玩家</span>
        </div>
        {!isLeaderboardConfigured ? (
          <div className="rank-empty">
            <div className="rank-empty-icon">🔒</div>
            排行榜將於後端上線後開放（Phase 4）<br />
            <span className="rank-empty-sub">
              屆時依「通關分數」排名，分數相同比「通關時間」（越短越前），顯示前 100 名
            </span>
          </div>
        ) : loaded && rows.length === 0 ? (
          <div className="rank-empty">
            <div className="rank-empty-icon">🏁</div>
            今日尚無成績，搶頭香！
          </div>
        ) : (
          <div className="rank-list">
            {rows.map((r, i) => (
              <div className={`rank-row ${i < 3 ? "top" : ""}`} key={i}>
                <span className="rk-pos">{i + 1}</span>
                <span className="rk-score">{r.score}</span>
                <span className="rk-time">{fmtMs(r.time_ms)}</span>
                <span className="rk-user">{r.player_name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" style={{ display: "inline", verticalAlign: "middle", marginRight: 5 }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  );
}
