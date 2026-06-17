import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { TRACKS, difficultyStars, trackDifficulty, type TrackData } from "./data/tracks";
import { fetchDailyMapList, fetchStockDailyMap, type DailyMapMeta } from "./lib/dailyMap";
import { dailyKey } from "./data/pick";
import "./TrackSelect.css";

type Mode = "intraday" | "monthly";
type SortBy = "code" | "difficulty";
type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortBy, string> = { code: "股號", difficulty: "困難度" };
const DEFAULT_DIR: Record<SortBy, SortDir> = { code: "asc", difficulty: "desc" };
const PAGE = 30;

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
  const [sortDir, setSortDir]     = useState<SortDir>("asc");
  const [query, setQuery]         = useState("");
  const [remoteList, setRemote]   = useState<DailyMapMeta[]>([]);
  const [remoteLoaded, setLoaded] = useState(false);
  const [picking, setPicking]     = useState(false);
  const [visibleCount, setVisible] = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 篩選條件改變時重置可見數量
  useEffect(() => { setVisible(PAGE); }, [mode, sortBy, sortDir, query]);

  const handleSortClick = (s: SortBy) => {
    if (sortBy === s) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(s);
      setSortDir(DEFAULT_DIR[s]);
    }
  };

  useEffect(() => {
    fetchDailyMapList(dailyKey()).then((list) => { setRemote(list); setLoaded(true); });
  }, []);

  // 捲到底自動載入更多（IntersectionObserver 偵測 sentinel 進入畫面）
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVisible((n) => n + PAGE); },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }); // 無 deps：每次 render 後重新 attach，確保 sentinel 位置正確

  // 前日盤勢：優先 Supabase，fallback 本地 24 支
  const intradayList = useMemo(() => {
    const src: DailyMapMeta[] = remoteList.length > 0
      ? remoteList
      : LOCAL_INTRADAY.map((t) => ({ stock_code: t.label, stock_name: t.name, difficulty: trackDifficulty(t.prices) }));
    const q = query.trim().toLowerCase();
    let out = q ? src.filter((t) => t.stock_code.includes(q) || t.stock_name.toLowerCase().includes(q)) : src;
    if (sortBy === "difficulty") {
      out = [...out].sort((a, b) => sortDir === "desc" ? b.difficulty - a.difficulty : a.difficulty - b.difficulty);
    } else {
      out = [...out].sort((a, b) => {
        const cmp = a.stock_code.localeCompare(b.stock_code);
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [remoteList, sortBy, sortDir, query]);

  // 近月日線：本地 24 支
  const monthlyList = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = q ? LOCAL_MONTHLY.filter((t) => t.label.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)) : LOCAL_MONTHLY;
    if (sortBy === "difficulty") {
      out = [...out].sort((a, b) => {
        const diff = trackDifficulty(b.prices) - trackDifficulty(a.prices);
        return sortDir === "desc" ? diff : -diff;
      });
    } else {
      out = [...out].sort((a, b) => {
        const cmp = (a as typeof LOCAL_MONTHLY[0]).label.localeCompare((b as typeof LOCAL_MONTHLY[0]).label);
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [sortBy, sortDir, query]);

  const handlePickIntraday = useCallback(async (item: DailyMapMeta) => {
    if (picking) return;
    const local = LOCAL_INTRADAY.find((t) => t.label === item.stock_code);
    if (local) { onPick(local); return; }
    setPicking(true);
    const row = await fetchStockDailyMap(dailyKey(), item.stock_code);
    setPicking(false);
    if (!row) return;
    onPick({ label: row.stock_code, name: row.stock_name, kind: "stock", mode: "intraday", desc: "前日盤中走勢", prices: row.prices });
  }, [picking, onPick]);

  const intradayCount = remoteList.length > 0 ? remoteList.length : LOCAL_INTRADAY.length;
  const activeList    = mode === "intraday" ? intradayList : monthlyList;
  const visibleList   = activeList.slice(0, visibleCount);
  const hasMore       = visibleCount < activeList.length;

  return (
    <div className={`select-screen${picking ? " is-picking" : ""}`}>
      <button className="back-btn" onClick={onBack}>‹ 返回</button>
      <h1 className="select-title">自選賽道</h1>

      <div className="mode-tabs">
        <button className={`mode-tab ${mode === "intraday" ? "active" : ""}`} onClick={() => setMode("intraday")}>
          前日盤勢
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
            <button key={s} className={`sort-btn ${sortBy === s ? "active" : ""}`} onClick={() => handleSortClick(s)}>
              {SORT_LABELS[s]}{sortBy === s ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="track-list">
        {mode === "intraday" && !remoteLoaded && remoteList.length === 0 ? (
          <p className="empty-hint">市場資料載入中…</p>
        ) : activeList.length === 0 ? (
          <p className="empty-hint">
            找不到「{query}」
            {mode === "monthly" && <><br /><span className="empty-sub">近月日線收錄精選 {LOCAL_MONTHLY.length} 支</span></>}
          </p>
        ) : (
          <>
            {mode === "intraday"
              ? visibleList.map((t) => (
                  <button
                    key={(t as DailyMapMeta).stock_code}
                    className="track-card"
                    onClick={() => handlePickIntraday(t as DailyMapMeta)}
                    disabled={picking}
                  >
                    <div className="track-card-row">
                      <span className="track-label">{(t as DailyMapMeta).stock_code}</span>
                      <span className="track-name">{(t as DailyMapMeta).stock_name}</span>
                      <span className="track-diff">{"★".repeat(starsFromScore((t as DailyMapMeta).difficulty))}</span>
                    </div>
                    <span className="track-desc">前日盤勢</span>
                  </button>
                ))
              : visibleList.map((t) => (
                  <button key={(t as TrackData).label} className="track-card" onClick={() => onPick(t as TrackData)}>
                    <div className="track-card-row">
                      <span className="track-label">{(t as TrackData).label}</span>
                      <span className="track-name">{(t as TrackData).name}</span>
                      <span className="track-diff">{"★".repeat(difficultyStars((t as TrackData).prices))}</span>
                    </div>
                    <span className="track-desc">{(t as TrackData).desc}</span>
                  </button>
                ))}

            {/* sentinel：捲到底觸發載入更多 */}
            <div ref={sentinelRef} className="list-sentinel">
              {hasMore
                ? `顯示 ${visibleList.length} / ${activeList.length} 支`
                : activeList.length > PAGE ? `全部 ${activeList.length} 支已顯示` : ""}
            </div>
          </>
        )}
      </div>

      {picking && <div className="picking-overlay">載入賽道資料…</div>}
    </div>
  );
}
