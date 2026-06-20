import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { TRACKS, trackDifficulty, type TrackData } from "./data/tracks";
import { fetchDailyMapList, fetchStockDailyMap, resolveSessionDisplayDate, type DailyMapMeta } from "./lib/dailyMap";
import { fetchLongTrack, fetchLongPreview, type LongPick } from "./lib/longTrack";
import Sparkline from "./components/Sparkline";
import { dailyKey } from "./data/pick";
import "./TrackSelect.css";

type Mode = "intraday" | "long";
type SortBy = "code" | "difficulty";
type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortBy, string> = { code: "股號", difficulty: "困難度" };
const DEFAULT_DIR: Record<SortBy, SortDir> = { code: "asc", difficulty: "desc" };
const PAGE = 30;

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
  const [mode, setMode]               = useState<Mode>("intraday");
  const [sortBy, setSortBy]           = useState<SortBy>("code");
  const [sortDir, setSortDir]         = useState<SortDir>("asc");
  const [query, setQuery]             = useState("");
  const [remoteList, setRemote]       = useState<DailyMapMeta[]>([]);
  const [remoteLoaded, setLoaded]     = useState(false);
  const [picking, setPicking]         = useState(false);
  const [longPicking, setLongPicking] = useState(false);
  const [longPreview, setLongPreview] = useState<LongPick[]>([]);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [visibleCount, setVisible]    = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 進「每日長征」tab 時抓 5 股預覽走勢（純呈現）
  useEffect(() => {
    if (mode !== "long") return;
    let alive = true;
    setPreviewLoaded(false);
    fetchLongPreview(dailyKey()).then((p) => {
      if (alive) { setLongPreview(p); setPreviewLoaded(true); }
    });
    return () => { alive = false; };
  }, [mode]);

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

  // 前次盤勢：優先 Supabase，fallback 本地 24 支
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

  const handlePickIntraday = useCallback(async (item: DailyMapMeta) => {
    if (picking) return;
    const local = LOCAL_INTRADAY.find((t) => t.label === item.stock_code);
    if (local) { onPick(local); return; }
    setPicking(true);
    const row = await fetchStockDailyMap(dailyKey(), item.stock_code);
    setPicking(false);
    if (!row) return;
    onPick({ label: row.stock_code, name: row.stock_name, kind: "stock", mode: "intraday", desc: "前次盤中走勢", prices: row.prices });
  }, [picking, onPick]);

  const handlePickLong = useCallback(async () => {
    if (longPicking) return;
    setLongPicking(true);
    const result = await fetchLongTrack(dailyKey());
    setLongPicking(false);
    if (!result) return;
    onPick({
      label: "長征",
      name: "5 股串接",
      kind: "stock",
      mode: "long",
      desc: "今日 5 股串接・長征路線",
      prices: result.prices,
      // 5 個股號改放副標、垂直堆疊（換行），避免 HUD 頂線過長橫向蓋住中央分數
      subtitle: result.labels.join("\n"),
    });
  }, [longPicking, onPick]);

  const intradayCount = remoteList.length > 0 ? remoteList.length : LOCAL_INTRADAY.length;
  const visibleList   = intradayList.slice(0, visibleCount);
  const hasMore       = visibleCount < intradayList.length;

  // 圖池對應的股市日期 = 實際盤勢日（resolveSessionDate − 1），連假時 ≠ 今天 − 1。
  const [poolDateStr, setPoolDateStr] = useState("載入中…");
  useEffect(() => {
    let alive = true;
    resolveSessionDisplayDate(dailyKey()).then((d) => {
      if (alive) setPoolDateStr(`${d.getUTCMonth() + 1}/${d.getUTCDate()} 走勢`);
    });
    return () => { alive = false; };
  }, []);

  return (
    <div className={`select-screen${picking || longPicking ? " is-picking" : ""}`}>
      <button className="back-btn" onClick={onBack}>‹ 返回</button>
      <h1 className="select-title">自選賽道</h1>

      <div className="mode-tabs">
        <button className={`mode-tab ${mode === "intraday" ? "active" : ""}`} onClick={() => setMode("intraday")}>
          前次盤勢
          <span className="mode-tab-desc">
            {remoteLoaded ? `${intradayCount} 支` : "載入中…"}・{poolDateStr}
          </span>
        </button>
        <button className={`mode-tab ${mode === "long" ? "active" : ""}`} onClick={() => setMode("long")}>
          每日長征
          <span className="mode-tab-desc">{poolDateStr}・5 股串接</span>
        </button>
      </div>

      {mode === "intraday" && (
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
      )}

      <div className="track-list">
        {mode === "intraday" ? (
          !remoteLoaded && remoteList.length === 0 ? (
            <p className="empty-hint">市場資料載入中…</p>
          ) : intradayList.length === 0 ? (
            <p className="empty-hint">找不到「{query}」</p>
          ) : (
            <>
              {visibleList.map((t) => (
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
                  <span className="track-desc">前次盤勢</span>
                </button>
              ))}

              {/* sentinel：捲到底觸發載入更多 */}
              <div ref={sentinelRef} className="list-sentinel">
                {hasMore
                  ? `顯示 ${visibleList.length} / ${intradayList.length} 支`
                  : intradayList.length > PAGE ? `全部 ${intradayList.length} 支已顯示` : ""}
              </div>
            </>
          )
        ) : (
          // 每日長征模式
          <div className="long-track-section">
            <p className="long-track-desc">
              今日隨機（日期種子固定）從全市場
              {remoteLoaded ? ` ${remoteList.length} 支` : "所有"}
              股票中挑選 5 支串接，全台玩家今天跑同一條路。
            </p>
            {remoteLoaded && remoteList.length === 0 ? (
              <p className="empty-hint">需連線才能載入今日長征路線</p>
            ) : (
              <button
                className="long-track-btn"
                onClick={handlePickLong}
                disabled={longPicking || !remoteLoaded}
              >
                {longPicking
                  ? "載入路線中…"
                  : !remoteLoaded
                  ? "市場資料載入中…"
                  : "今日長征 →"}
              </button>
            )}

            {/* 今日 5 股走勢預覽（純呈現，不可點）；超出畫面由 track-list 捲動 */}
            {previewLoaded && longPreview.length > 0 && (
              <div className="long-preview">
                <div className="long-preview-title">今日 5 股走勢</div>
                {longPreview.map((p) => (
                  <div className="long-preview-item" key={p.code}>
                    <div className="long-preview-info">
                      <span className="lp-code">{p.code}</span>
                      <span className="lp-name">{p.name}</span>
                    </div>
                    <Sparkline prices={p.prices} width={300} height={46} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {(picking || longPicking) && <div className="picking-overlay">載入賽道資料…</div>}
    </div>
  );
}

