import { useState, useMemo, useEffect, useCallback } from "react";
import { TRACKS, difficultyStars, trackDifficulty, type TrackData } from "./data/tracks";
import { fetchDailyMapList, fetchStockDailyMap, type DailyMapMeta } from "./lib/dailyMap";
import { dailyKey } from "./data/pick";
import "./TrackSelect.css";

type Mode = "intraday" | "monthly";
type SortBy = "code" | "difficulty";

const SORT_LABELS: Record<SortBy, string> = { code: "股號", difficulty: "困難度" };

const LOCAL_MONTHLY  = TRACKS.filter((t) => t.mode === "monthly");
const LOCAL_INTRADAY = TRACKS.filter((t) => t.mode === "intraday");

function starsFromScore(d: number): number {
  if (d < 0.005) return 1;
  if (d < 0.02)  return 2;
  if (d < 0.05)  return 3;
  if (d < 0.085) return 4;
  return 5;
}

export default function TrackSelect({
  onPick,
  onBack,
}: {
  onPick: (t: TrackData) => void;
  onBack: () => void;
}) {
  const [mode, setMode]           = useState<Mode>("intraday");
  const [sortBy, setSortBy]       = useState<SortBy>("code");
  const [query, setQuery]         = useState("");
  const [remoteList, setRemote]   = useState<DailyMapMeta[]>([]);
  const [remoteLoaded, setLoaded] = useState(false);
  const [picking, setPicking]     = useState(false);

  useEffect(() => {
    window.history.pushState({ taiexCustom: true }, "");
    const onPop = () => onBack();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onBack]);

  useEffect(() => {
    fetchDailyMapList(dailyKey()).then((list) => { setRemote(list); setLoaded(true); });
  }, []);

  // 前日盤中：優先 Supabase，fallback 本地 24 支
  const intradayList = useMemo(() => {
    const src: DailyMapMeta[] = remoteList.length > 0
      ? remoteList
      : LOCAL_INTRADAY.map((t) => ({ stock_code: t.label, stock_name: t.name, difficulty: trackDifficulty(t.prices) }));
    const q = query.trim().toLowerCase();
    let out = q ? src.filter((t) => t.stock_code.includes(q) || t.stock_name.toLowerCase().includes(q)) : src;
    if (sortBy === "difficulty") out = [...out].sort((a, b) => b.difficulty - a.difficulty);
    return out;
  }, [remoteList, sortBy, query]);

  // 近月日線：本地 24 支
  const monthlyList = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = q ? LOCAL_MONTHLY.filter((t) => t.label.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)) : LOCAL_MONTHLY;
    if (sortBy === "difficulty") out = [...out].sort((a, b) => trackDifficulty(b.prices) - trackDifficulty(a.prices));
    return out;
  }, [sortBy, query]);

  const handlePickIntraday = useCallback(async (item: DailyMapMeta) => {
    if (picking) return;
    // 本地有的直接用，免去一次 Supabase round-trip
    const local = LOCAL_INTRADAY.find((t) => t.label === item.stock_code);
    if (local) { onPick(local); return; }
    setPicking(true);
    const row = await fetchStockDailyMap(dailyKey(), item.stock_code);
    setPicking(false);
    if (!row) return;
    onPick({ label: row.stock_code, name: row.stock_name, kind: "stock", mode: "intraday", desc: "前日盤中走勢", prices: row.prices });
  }, [picking, onPick]);

  const intradayCount = remoteList.length > 0 ? remoteList.length : LOCAL_INTRADAY.length;

  return (
    <div className={`select-screen${picking ? " is-picking" : ""}`}>
      <button className="back-btn" onClick={onBack}>‹ 返回</button>
      <h1 className="select-title">自選賽道</h1>

      <div className="mode-tabs">
        <button className={`mode-tab ${mode === "intraday" ? "active" : ""}`} onClick={() => setMode("intraday")}>
          前日盤中
          <span className="mode-tab-desc">
            {remoteLoaded ? `${intradayCount} 支` : "載入中…"}・盤中走勢
          </span>
        </button>
        <button className={`mode-tab ${mode === "monthly" ? "active" : ""}`} onClick={() => setMode("monthly")}>
          近月日線
          <span className="mode-tab-desc">精選 {LOCAL_MONTHLY.length} 支・日收盤</span>
        </button>
      </div>

      <div className="toolbar">
        <input
          className="search-box"
          type="text"
          inputMode="search"
          placeholder="搜尋股號 / 名稱"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="sort-group">
          {(Object.keys(SORT_LABELS) as SortBy[]).map((s) => (
            <button key={s} className={`sort-btn ${sortBy === s ? "active" : ""}`} onClick={() => setSortBy(s)}>
              {SORT_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="track-list">
        {mode === "intraday" ? (
          !remoteLoaded && remoteList.length === 0 ? (
            <p className="empty-hint">市場資料載入中…</p>
          ) : intradayList.length === 0 ? (
            <p className="empty-hint">找不到「{query}」</p>
          ) : (
            intradayList.map((t) => (
              <button
                key={t.stock_code}
                className="track-card"
                onClick={() => handlePickIntraday(t)}
                disabled={picking}
              >
                <div className="track-card-row">
                  <span className="track-label">{t.stock_code}</span>
                  <span className="track-name">{t.stock_name}</span>
                  <span className="track-diff">{"★".repeat(starsFromScore(t.difficulty))}</span>
                </div>
                <span className="track-desc">前日盤中走勢</span>
              </button>
            ))
          )
        ) : (
          monthlyList.length === 0 ? (
            <p className="empty-hint">
              找不到「{query}」<br />
              <span className="empty-sub">近月日線收錄精選 {LOCAL_MONTHLY.length} 支</span>
            </p>
          ) : (
            monthlyList.map((t) => (
              <button key={t.label} className="track-card" onClick={() => onPick(t)}>
                <div className="track-card-row">
                  <span className="track-label">{t.label}</span>
                  <span className="track-name">{t.name}</span>
                  <span className="track-diff">{"★".repeat(difficultyStars(t.prices))}</span>
                </div>
                <span className="track-desc">{t.desc}</span>
              </button>
            ))
          )
        )}
      </div>

      {picking && <div className="picking-overlay">載入賽道資料…</div>}
    </div>
  );
}
