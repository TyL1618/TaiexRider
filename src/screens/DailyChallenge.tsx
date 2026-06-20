import { useEffect, useRef, useState } from "react";
import Sparkline from "../components/Sparkline";
import { dailyTrack, dailyKey } from "../data/pick";
import { fetchDailyTop, invalidateDailyTop, isLeaderboardConfigured, type ScoreRow } from "../lib/leaderboard";
import { fetchHardestDailyMap, resolveSessionDate, resolveSessionDisplayDate } from "../lib/dailyMap";
import { signInWithGoogle, type User } from "../lib/auth";
import { getPlayerName } from "../lib/playerId";
import type { TrackData } from "../data/tracks";
import "./DailyChallenge.css";

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

      <div className="daily-head">
        <div className="daily-tag">🏆 每日排名賽 ・ {dateStr}</div>

        <div className="daily-chart">
          <Sparkline prices={track.prices} width={320} height={150} />
        </div>

        <div className="daily-info">
          <span className="daily-label">{track.label}</span>
          <span className="daily-name">{track.name}</span>
        </div>
        <div className="daily-period">{isLive ? "前日盤勢 ・ 今日地圖" : "近月日線 ・ 今日地圖"}</div>

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

        <button className="daily-challenge-btn" onClick={() => onPlay(track)}>
          開始挑戰
        </button>
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
