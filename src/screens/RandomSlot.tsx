import { useEffect, useRef, useState } from "react";
import Sparkline from "../components/Sparkline";
import { fetchDailyMapList, fetchStockDailyMap, type DailyMapMeta } from "../lib/dailyMap";
import { dailyKey } from "../data/pick";
import type { TrackData } from "../data/tracks";
import { playSlotTick, playSlotStop } from "../game/audio";
import "./RandomSlot.css";

const ITEM_H = 72;
// 2026-07-21 使用者回報「抽賽道」按鈕貼在畫面最下緣不好按：VISIBLE 從 7 縮到 5
// （少 2 個項目高度＝144px），.slot-screen 用 justify-content:center 置中整個
// 區塊，滾輪變矮後整組（標題/滾輪/按鈕）自然往畫面中央靠、按鈕跟著往上移。
const VISIBLE = 5;
const VIEWPORT_H = ITEM_H * VISIBLE;
const CENTER_OFFSET = (VIEWPORT_H - ITEM_H) / 2;
const REPEAT = 8;
const VISUAL_SIZE = 30; // 每次 spin 的視覺滾輪大小（從 pool 隨機採樣）
const T1 = 2, T2 = 2;
const TAP_SPEED_MUL = 3.5; // 2026-07-23 新增：轉動中點擊畫面加速用的倍率

type Phase = "idle" | "spinning" | "loading" | "result";

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
  const speedMulRef = useRef(1); // 轉動中點擊畫面 → 調高，讓虛擬經過時間走比較快

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(timerRef.current);
    };
  }, []);

  // 一律用 Supabase daily_map（抓不到＝離線，spin 鈕顯示需連線）。
  // 曾有 24 支靜態月盤當 fallback／抽中熱門股時「本地優先」直接用 6/15 舊快照——已移除。
  useEffect(() => {
    fetchDailyMapList(dailyKey()).then((list) => {
      setPool(list);
      setLoaded(true);
    });
  }, []);

  const spin = () => {
    if (phase !== "idle" || !poolLoaded || pool.length === 0) return;
    setResult(null);
    setPhase("spinning");
    speedMulRef.current = 1;
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
    // 虛擬經過時間：正常速度下每幀累加真實 dt，點擊加速時 speedMulRef 調高，
    // 讓同一套緩動曲線（唰唰唰…咖…咖……咖）用更快的節奏跑完，不是瞬間跳結果。
    let vt = 0;
    let lastFrame = performance.now();

    // 「咖」聲節奏：跨過一格（ITEM_H 整數倍）就 tick 一次，音效節奏自然跟著
    // T1 等速快、T2 減速慢的位移曲線走（唰唰唰…咖…咖……咖）。
    // 等速段每秒跨 ~69 格太密，tick 率上限 ~35/s → 快段變密集機械聲、慢段逐格清晰。
    let lastItemIdx = -1;
    let lastTickAt = 0;

    const tick = (now: number) => {
      const dt = (now - lastFrame) / 1000;
      lastFrame = now;
      vt += dt * speedMulRef.current;
      const e = vt;
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
      const itemIdx = Math.floor(off / ITEM_H);
      if (itemIdx !== lastItemIdx) {
        lastItemIdx = itemIdx;
        if (now - lastTickAt > 28) {
          lastTickAt = now;
          playSlotTick();
        }
      }
      if (e < T1 + T2) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        if (stripRef.current) stripRef.current.style.transform = `translateY(${-D}px)`;
        playSlotStop();
        setPhase("loading");
        // 停住後抓 prices（通常 <200ms，幾乎無感）
        timerRef.current = setTimeout(async () => {
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
    : pool.length === 0
    ? "需連線才能載入市場資料"
    : phase === "spinning" || phase === "loading"
    ? "轉動中…"
    : "🎰 拉霸抽賽道";

  const placeholder = Array.from({ length: VISIBLE + 2 }, (_, i) => ({
    stock_code: "—",
    stock_name: poolLoaded ? "準備抽籤" : "載入中",
    difficulty: 0,
    _key: i,
  }));

  // 轉動中點擊畫面加速（不是瞬間跳結果，是把同一套緩動曲線的虛擬時間調快）
  const handleTapAccelerate = () => {
    if (phase === "spinning") speedMulRef.current = TAP_SPEED_MUL;
  };

  return (
    <div className="slot-screen" onClick={handleTapAccelerate}>
      <button className="back-btn" onClick={onBack}>‹ 返回</button>
      <h1 className="slot-title">隨機賽道</h1>
      {poolLoaded && (
        <p className="slot-pool-hint">{pool.length} 支股票・前次盤中走勢</p>
      )}
      {phase === "spinning" && <p className="slot-tap-hint">👆 點擊畫面可加速</p>}

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
        disabled={phase !== "idle" || !poolLoaded || pool.length === 0}
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
