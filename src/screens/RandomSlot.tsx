import { useEffect, useRef, useState } from "react";
import Sparkline from "../components/Sparkline";
import { fetchDailyMapList, fetchStockDailyMap, type DailyMapMeta } from "../lib/dailyMap";
import { STOCK_POOL, dailyKey } from "../data/pick";
import { trackDifficulty, type TrackData } from "../data/tracks";
import "./RandomSlot.css";

const ITEM_H = 72;
const VISIBLE = 7;
const VIEWPORT_H = ITEM_H * VISIBLE;
const CENTER_OFFSET = (VIEWPORT_H - ITEM_H) / 2;
const REPEAT = 8;
const VISUAL_SIZE = 30; // 每次 spin 的視覺滾輪大小（從 pool 隨機採樣）
const T1 = 2, T2 = 2;

type Phase = "idle" | "spinning" | "loading" | "result";

// 本地 pool fallback
const FALLBACK_POOL: DailyMapMeta[] = STOCK_POOL.map((t) => ({
  stock_code: t.label,
  stock_name: t.name,
  difficulty: trackDifficulty(t.prices),
}));

export default function RandomSlot({
  onPick,
  onBack,
}: {
  onPick: (t: TrackData) => void;
  onBack: () => void;
}) {
  const [pool, setPool]         = useState<DailyMapMeta[]>([]);
  const [poolLoaded, setLoaded] = useState(false);
  const [phase, setPhase]       = useState<Phase>("idle");
  const [reel, setReel]         = useState<DailyMapMeta[]>([]);
  const [result, setResult]     = useState<TrackData | null>(null);
  const stripRef  = useRef<HTMLDivElement>(null);
  const rafRef    = useRef(0);
  const timerRef  = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    fetchDailyMapList(dailyKey()).then((list) => {
      setPool(list.length > 0 ? list : FALLBACK_POOL);
      setLoaded(true);
    });
  }, []);

  const spin = () => {
    if (phase !== "idle" || !poolLoaded || pool.length === 0) return;
    setResult(null);
    setPhase("spinning");
    if (stripRef.current) stripRef.current.style.transform = "translateY(0px)";

    // 從全部 pool 隨機挑 winner
    const winnerIdx = Math.floor(Math.random() * pool.length);
    const winner = pool[winnerIdx];

    // 建立視覺滾輪：VISUAL_SIZE-1 支隨機其他 + winner 放最後
    const others = pool
      .filter((_, i) => i !== winnerIdx)
      .sort(() => Math.random() - 0.5)
      .slice(0, VISUAL_SIZE - 1);
    const visualPool = [...others, winner];
    const newReel = Array.from({ length: REPEAT }, () => visualPool).flat();
    setReel(newReel);

    // winner 落在 (REPEAT-2) 個週期的最後一格
    const targetIndex = (REPEAT - 2) * VISUAL_SIZE + (VISUAL_SIZE - 1);
    const D = targetIndex * ITEM_H - CENTER_OFFSET;
    const v = D / (T1 + T2 / 2);
    const start = performance.now();

    const tick = (now: number) => {
      const e = (now - start) / 1000;
      let off: number;
      if (e <= T1) {
        off = v * e;
      } else if (e < T1 + T2) {
        const tau = e - T1;
        off = v * T1 + v * tau - (v / (2 * T2)) * tau * tau;
      } else {
        off = D;
      }
      if (stripRef.current) stripRef.current.style.transform = `translateY(${-off}px)`;
      if (e < T1 + T2) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        if (stripRef.current) stripRef.current.style.transform = `translateY(${-D}px)`;
        setPhase("loading");
        // 停住後抓 prices（通常 <200ms，幾乎無感）
        timerRef.current = setTimeout(async () => {
          // 本地有的直接用
          const localTrack = STOCK_POOL.find((t) => t.label === winner.stock_code);
          if (localTrack) {
            setResult(localTrack);
            setPhase("result");
            return;
          }
          const row = await fetchStockDailyMap(dailyKey(), winner.stock_code);
          if (row) {
            setResult({ label: row.stock_code, name: row.stock_name, kind: "stock", mode: "intraday", desc: "前次盤中走勢", prices: row.prices });
            setPhase("result");
          } else {
            setPhase("idle"); // fetch 失敗，靜默回到待機
          }
        }, 800);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const reset = () => {
    setPhase("idle");
    setResult(null);
    setReel([]);
    if (stripRef.current) stripRef.current.style.transform = "translateY(0px)";
  };

  const spinLabel = !poolLoaded
    ? "載入市場資料…"
    : phase === "spinning" || phase === "loading"
    ? "轉動中…"
    : "🎰 拉霸抽賽道";

  const placeholder = Array.from({ length: VISIBLE + 2 }, (_, i) => ({
    stock_code: "—",
    stock_name: poolLoaded ? "準備抽籤" : "載入中",
    difficulty: 0,
    _key: i,
  }));

  return (
    <div className="slot-screen">
      <button className="back-btn" onClick={onBack}>‹ 返回</button>
      <h1 className="slot-title">隨機賽道</h1>
      {poolLoaded && (
        <p className="slot-pool-hint">{pool.length} 支股票・前次盤中走勢</p>
      )}

      <div className="slot-machine">
        <div className="slot-viewport" style={{ height: VIEWPORT_H }}>
          <div className="slot-strip" ref={stripRef}>
            {reel.length === 0
              ? placeholder.map((p) => (
                  <div className="slot-item" key={p._key} style={{ height: ITEM_H }}>
                    <span className="slot-item-label">{p.stock_code}</span>
                    <span className="slot-item-name">{p.stock_name}</span>
                  </div>
                ))
              : reel.map((t, i) => (
                  <div className="slot-item" key={i} style={{ height: ITEM_H }}>
                    <span className="slot-item-label">{t.stock_code}</span>
                    <span className="slot-item-name">{t.stock_name}</span>
                  </div>
                ))}
          </div>
          <div className="slot-winline" style={{ top: CENTER_OFFSET, height: ITEM_H }} />
          <div className="slot-fade top" />
          <div className="slot-fade bottom" />
        </div>
      </div>

      <button
        className="slot-spin-btn"
        onClick={spin}
        disabled={phase !== "idle" || !poolLoaded}
      >
        {spinLabel}
      </button>

      {phase === "result" && result && (
        <div className="modal-overlay" onClick={(e) => e.stopPropagation()}>
          <div className="slot-result">
            <div className="slot-result-chart">
              <Sparkline prices={result.prices} width={300} height={140} />
            </div>
            <div className="slot-result-info">
              <span className="slot-result-name">{result.name}</span>
              <span className="slot-result-label">{result.label}</span>
            </div>
            <div className="slot-result-actions">
              <button className="modal-btn" onClick={() => onPick(result)}>出發！</button>
              <button className="modal-link" onClick={reset}>再轉一次</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
