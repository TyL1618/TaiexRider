import { useEffect, useState } from "react";
import Sparkline from "../components/Sparkline";
import { dailyTrack, dailyKey } from "../data/pick";
import { fetchDailyTop, isLeaderboardConfigured, type ScoreRow } from "../lib/leaderboard";
import { fetchHardestDailyMap } from "../lib/dailyMap";
import { getPlayerName, setPlayerName } from "../lib/playerId";
import type { TrackData } from "../data/tracks";
import "./DailyChallenge.css";

const fmtMs = (ms: number) => {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

export default function DailyChallenge({
  onPlay,
  onBack,
}: {
  onPlay: (t: TrackData) => void;
  onBack: () => void;
}) {
  const fallbackTrack = dailyTrack();
  const today = new Date();
  const dateStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
  const [track, setTrack] = useState<TrackData>(fallbackTrack);
  const [isLive, setIsLive] = useState(false);
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [nickname, setNickname] = useState(() => getPlayerName());

  useEffect(() => {
    window.history.pushState({ taiexDaily: true }, "");
    const onPop = () => onBack();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onBack]);

  // 讀今日最難地圖（Supabase daily_map），失敗則用靜態 fallback
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

  // 讀今日排行榜（未設定後端時 fetchDailyTop 回 []，走佔位畫面）
  useEffect(() => {
    let alive = true;
    fetchDailyTop(dailyKey()).then((r) => {
      if (alive) {
        setRows(r);
        setLoaded(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

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

        <div className="nickname-row">
          <label className="nickname-label">暱稱</label>
          <input
            className="nickname-input"
            value={nickname}
            maxLength={16}
            onChange={(e) => {
              setNickname(e.target.value);
              setPlayerName(e.target.value);
            }}
          />
        </div>

        <button className="daily-challenge-btn" onClick={() => onPlay(track)}>
          開始挑戰
        </button>
      </div>

      <div className="rank-section">
        <div className="rank-section-title">今日排行榜</div>
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
