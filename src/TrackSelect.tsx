import { useState } from "react";
import { TRACKS, type TrackData } from "./data/tracks";
import "./TrackSelect.css";

type Mode = "monthly" | "intraday";

export default function TrackSelect({ onPick }: { onPick: (t: TrackData) => void }) {
  const [mode, setMode] = useState<Mode>("monthly");
  const filtered = TRACKS.filter((t) => t.mode === mode);

  return (
    <div className="select-screen">
      <h1 className="select-title">TAIEX&shy;RIDER</h1>

      <div className="mode-tabs">
        <button
          className={`mode-tab ${mode === "monthly" ? "active" : ""}`}
          onClick={() => setMode("monthly")}
        >
          近月日線
          <span className="mode-tab-desc">50 個交易日收盤</span>
        </button>
        <button
          className={`mode-tab ${mode === "intraday" ? "active" : ""}`}
          onClick={() => setMode("intraday")}
        >
          昨日盤線
          <span className="mode-tab-desc">盤中每 5 分鐘</span>
        </button>
      </div>

      <div className="track-list">
        {filtered.map((t) => (
          <button key={t.label} className="track-card" onClick={() => onPick(t)}>
            <div className="track-card-row">
              <span className="track-label">{t.label}</span>
              <span className="track-name">{t.name}</span>
            </div>
            <span className="track-desc">{t.desc}</span>
          </button>
        ))}
      </div>

      <p className="select-foot">純娛樂・非投資建議</p>
    </div>
  );
}
