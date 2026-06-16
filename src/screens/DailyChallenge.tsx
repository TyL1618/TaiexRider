import { useEffect } from "react";
import Sparkline from "../components/Sparkline";
import { dailyTrack } from "../data/pick";
import type { TrackData } from "../data/tracks";
import "./DailyChallenge.css";

export default function DailyChallenge({
  onPlay,
  onBack,
}: {
  onPlay: (t: TrackData) => void;
  onBack: () => void;
}) {
  const track = dailyTrack();
  const today = new Date();
  const dateStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;

  useEffect(() => {
    window.history.pushState({ taiexDaily: true }, "");
    const onPop = () => onBack();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onBack]);

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
        <div className="daily-period">近月日線 ・ 今日地圖</div>

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
        <div className="rank-empty">
          <div className="rank-empty-icon">🔒</div>
          排行榜將於後端上線後開放（Phase 4）<br />
          <span className="rank-empty-sub">
            屆時依「通關分數」排名，分數相同比「通關時間」（越短越前），顯示前 100 名
          </span>
        </div>
      </div>
    </div>
  );
}
