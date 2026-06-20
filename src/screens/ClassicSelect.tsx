import Sparkline from "../components/Sparkline";
import { CLASSICS, classicToTrack } from "../data/classics";
import type { TrackData } from "../data/tracks";
import "../TrackSelect.css";
import "./ClassicSelect.css";

export default function ClassicSelect({
  onPick,
  onBack,
}: {
  onPick: (t: TrackData) => void;
  onBack: () => void;
}) {
  return (
    <div className="select-screen">
      <button className="back-btn" onClick={onBack}>‹ 返回</button>
      <h1 className="select-title">經典模式</h1>
      <p className="classic-intro">歷史上著名的股市盤勢，化成賽道。純娛樂・非投資建議。</p>

      <div className="track-list">
        {CLASSICS.map((c) => (
          <button key={c.id} className="track-card classic-card" onClick={() => onPick(classicToTrack(c))}>
            <div className="classic-card-head">
              <span className="classic-title">{c.title}</span>
              <span className="classic-period">{c.period}・{c.index}</span>
            </div>
            <Sparkline prices={c.prices} width={300} height={66} />
            <p className="classic-blurb">{c.blurb}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
