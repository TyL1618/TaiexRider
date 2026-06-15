import { useState, useMemo } from "react";
import { TRACKS, trackDifficulty, difficultyStars, type TrackData } from "./data/tracks";
import "./TrackSelect.css";

type Mode = "monthly" | "intraday";
type SortBy = "popular" | "difficulty" | "code";

const SORT_LABELS: Record<SortBy, string> = {
  popular: "熱門",
  difficulty: "困難度",
  code: "股號",
};

// 熱門排名 = TRACKS 原始順序（之後可改成成交量 / 點擊數）
const POPULARITY = new Map(TRACKS.map((t, i) => [t.label, i]));

export default function TrackSelect({ onPick }: { onPick: (t: TrackData) => void }) {
  const [mode, setMode] = useState<Mode>("monthly");
  const [sortBy, setSortBy] = useState<SortBy>("popular");
  const [query, setQuery] = useState("");

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = TRACKS.filter((t) => t.mode === mode);
    if (q) {
      out = out.filter(
        (t) => t.label.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
      );
    }
    out = [...out].sort((a, b) => {
      if (sortBy === "popular") return (POPULARITY.get(a.label) ?? 0) - (POPULARITY.get(b.label) ?? 0);
      if (sortBy === "difficulty") return trackDifficulty(b.prices) - trackDifficulty(a.prices);
      // 股號：數字小到大，TAIEX 等非數字排最後
      const na = Number(a.label);
      const nb = Number(b.label);
      if (isNaN(na) && isNaN(nb)) return a.label.localeCompare(b.label);
      if (isNaN(na)) return 1;
      if (isNaN(nb)) return -1;
      return na - nb;
    });
    return out;
  }, [mode, sortBy, query]);

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
          前次日盤
          <span className="mode-tab-desc">盤中每 5 分鐘</span>
        </button>
      </div>

      <div className="toolbar">
        <input
          className="search-box"
          type="text"
          inputMode="numeric"
          placeholder="搜尋股號 / 名稱"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="sort-group">
          {(Object.keys(SORT_LABELS) as SortBy[]).map((s) => (
            <button
              key={s}
              className={`sort-btn ${sortBy === s ? "active" : ""}`}
              onClick={() => setSortBy(s)}
            >
              {SORT_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="track-list">
        {list.length === 0 ? (
          <p className="empty-hint">
            找不到「{query}」<br />
            <span className="empty-sub">目前僅收錄預抓股票，更多股號需待後端上線</span>
          </p>
        ) : (
          list.map((t) => (
            <button key={t.label} className="track-card" onClick={() => onPick(t)}>
              <div className="track-card-row">
                <span className="track-label">{t.label}</span>
                <span className="track-name">{t.name}</span>
                <span className="track-diff">{"★".repeat(difficultyStars(t.prices))}</span>
              </div>
              <span className="track-desc">{t.desc}</span>
            </button>
          ))
        )}
      </div>

      <p className="select-foot">純娛樂・非投資建議</p>
    </div>
  );
}
