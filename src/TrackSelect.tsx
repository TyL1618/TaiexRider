import { TRACKS, type TrackData } from "./data/tracks";
import "./TrackSelect.css";

export default function TrackSelect({ onPick }: { onPick: (t: TrackData) => void }) {
  return (
    <div className="select-screen">
      <h1 className="select-title">TAIEX&shy;RIDER</h1>
      <p className="select-sub">選一條賽道 ・ 真實台股走勢</p>

      <div className="track-list">
        {TRACKS.map((t) => (
          <button key={t.label} className="track-card" onClick={() => onPick(t)}>
            <span className="track-label">{t.label}</span>
            <span className="track-name">{t.name}</span>
            <span className="track-desc">{t.desc}</span>
          </button>
        ))}
      </div>

      <p className="select-foot">純娛樂・非投資建議</p>
    </div>
  );
}
