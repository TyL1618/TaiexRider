import { useEffect, useRef, useState } from "react";
import Sparkline from "../components/Sparkline";
import { STOCK_POOL } from "../data/pick";
import type { TrackData } from "../data/tracks";
import "./RandomSlot.css";

const ITEM_H = 72;        // 每格高度 (px)
const VISIBLE = 7;        // 視窗顯示格數（垂直空間多）
const VIEWPORT_H = ITEM_H * VISIBLE;
const CENTER_OFFSET = (VIEWPORT_H - ITEM_H) / 2;
const REPEAT = 8;         // 滾輪重複池次數（夠長才轉得久）
const T1 = 2, T2 = 2;     // 等速 2s + 減速 2s（停住後再 hold 1s 出結果）

// 滾輪長串：把股票池重複多次
const REEL: TrackData[] = Array.from({ length: REPEAT }, () => STOCK_POOL).flat();

type Phase = "idle" | "spinning" | "result";

export default function RandomSlot({
  onPick,
  onBack,
}: {
  onPick: (t: TrackData) => void;
  onBack: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<TrackData | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    window.history.pushState({ taiexRandom: true }, "");
    const onPop = () => onBack();
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      cancelAnimationFrame(rafRef.current);
      clearTimeout(timerRef.current);
    };
  }, [onBack]);

  const spin = () => {
    if (phase !== "idle") return;
    setResult(null);
    setPhase("spinning");

    const chosen = Math.floor(Math.random() * STOCK_POOL.length);
    const targetIndex = (REPEAT - 2) * STOCK_POOL.length + chosen; // 落在尾段、下方留足視窗
    const D = targetIndex * ITEM_H - CENTER_OFFSET;
    const v = D / (T1 + T2 / 2); // 等速段速度；減速段平均 v/2，恰好停在 D
    const start = performance.now();

    const tick = (now: number) => {
      const e = (now - start) / 1000;
      let off: number;
      if (e <= T1) {
        off = v * e;                                   // 等速
      } else if (e < T1 + T2) {
        const tau = e - T1;
        off = v * T1 + v * tau - (v / (2 * T2)) * tau * tau; // 減速（線性減速，停在 D）
      } else {
        off = D;
      }
      if (stripRef.current) stripRef.current.style.transform = `translateY(${-off}px)`;
      if (e < T1 + T2) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        if (stripRef.current) stripRef.current.style.transform = `translateY(${-D}px)`;
        timerRef.current = setTimeout(() => {           // 停住 1 秒再浮現結果
          setResult(STOCK_POOL[chosen]);
          setPhase("result");
        }, 1000);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const reset = () => {
    setPhase("idle");
    setResult(null);
    if (stripRef.current) stripRef.current.style.transform = "translateY(0px)";
  };

  return (
    <div className="slot-screen">
      <button className="back-btn" onClick={onBack}>‹ 返回</button>
      <h1 className="slot-title">隨機賽道</h1>

      <div className="slot-machine">
        <div className="slot-viewport" style={{ height: VIEWPORT_H }}>
          <div className="slot-strip" ref={stripRef}>
            {REEL.map((t, i) => (
              <div className="slot-item" key={i} style={{ height: ITEM_H }}>
                <span className="slot-item-label">{t.label}</span>
                <span className="slot-item-name">{t.name}</span>
              </div>
            ))}
          </div>
          {/* 中央得獎線 */}
          <div className="slot-winline" style={{ top: CENTER_OFFSET, height: ITEM_H }} />
          {/* 上下漸層遮罩 */}
          <div className="slot-fade top" />
          <div className="slot-fade bottom" />
        </div>
      </div>

      <button className="slot-spin-btn" onClick={spin} disabled={phase !== "idle"}>
        {phase === "spinning" ? "轉動中…" : "🎰 拉霸抽賽道"}
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
