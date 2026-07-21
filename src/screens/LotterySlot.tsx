// 抽獎轉輪（LOTTERY_DESIGN.md）。視覺語言仿 RandomSlot.tsx（同一套滾輪動畫機制），
// 但音效/質感獨立設計（playLottery* 系列，見 game/audio.ts），跟選賽道的拉霸機
// 做出區隔——這是「賭運氣」的儀式感畫面，選賽道只是功能性導覽。
//
// 中獎結果一律由伺服器 lottery_spin() RPC 決定（機率表寫死在 SQL 裡），這裡的
// 「視覺滾輪」只是動畫用的隨機填充物，最後一格永遠放伺服器實際回傳的獎項
// （跟 RandomSlot 的 winner-at-end 手法完全一致，見該檔）。
import { useEffect, useRef, useState } from "react";
import { BIKE_SKINS } from "../lib/garage";
import { lotterySpin, lotteryState, getDiamonds, type LotterySpinResult } from "../lib/garage";
import { requestRewardedAd, preloadRewardedAd } from "../lib/ads";
import { playLotteryTick, playLotteryStop, playLotteryWin } from "../game/audio";
import type { User } from "../lib/auth";
import "./RandomSlot.css";
import "./Garage.css"; // 重用 .garage-guest-notice 樣式（訪客提示）
import "./LotterySlot.css";

const ITEM_H = 72;
const VISIBLE = 7;
const VIEWPORT_H = ITEM_H * VISIBLE;
const CENTER_OFFSET = (VIEWPORT_H - ITEM_H) / 2;
const REPEAT = 8;
const VISUAL_SIZE = 24;
const T1 = 2.2, T2 = 2.3; // 比選賽道拉霸機稍長，儀式感更足
const FREE_SPINS_PER_DAY = 2;
const PAID_SPIN_COST = 20;

// 機率表文案（見 LOTTERY_DESIGN.md，跟伺服器 lottery_spin() 的機率區間同步）——
// 純顯示用，不影響實際抽獎（實際結果一律伺服器決定）。
const ODDS_TABLE: { label: string; pct: string }[] = [
  { label: "5 鑽石", pct: "75.00%" },
  { label: "10 鑽石", pct: "18.00%" },
  { label: "30 鑽石", pct: "3.50%" },
  { label: "100 鑽石", pct: "0.60%" },
  { label: "300 鑽石", pct: "0.09%" },
  { label: "1000 鑽石（大獎）", pct: "0.01%" },
  { label: "🖤 黑天鵝（隱藏車款）", pct: "0.05%" },
  { label: "赤紅暴走（P1）", pct: "1.00%" },
  { label: "電馭武士（P4）", pct: "0.70%" },
  { label: "黃金期貨（P3）", pct: "0.50%" },
  { label: "匿蹤幽靈（P5）", pct: "0.35%" },
  { label: "銀河鍍鉻（P2，最稀有）", pct: "0.20%" },
];

// 視覺滾輪的填充符號池（跟真實機率無關，純粹讓轉輪跑起來好看）。
type Sym = { key: string; icon: string; label: string };
const SYMBOL_POOL: Sym[] = [
  { key: "d5", icon: "💎", label: "5" },
  { key: "d10", icon: "💎", label: "10" },
  { key: "d30", icon: "💎", label: "30" },
  { key: "d100", icon: "💎", label: "100" },
  { key: "d300", icon: "💎", label: "300" },
  { key: "d1000", icon: "💎", label: "1000" },
  { key: "p1-crimson", icon: "🏍️", label: "赤紅暴走" },
  { key: "p4-samurai", icon: "🏍️", label: "電馭武士" },
  { key: "p3-gold", icon: "🏍️", label: "黃金期貨" },
  { key: "p5-phantom", icon: "🏍️", label: "匿蹤幽靈" },
  { key: "p2-galaxy", icon: "🏍️", label: "銀河鍍鉻" },
  { key: "hidden-blackswan", icon: "🖤", label: "黑天鵝" },
];

function symbolFor(prizeKind: "diamond" | "skin", prizeId: string): Sym {
  if (prizeKind === "diamond") {
    const found = SYMBOL_POOL.find((s) => s.key === `d${prizeId}`);
    return found ?? { key: `d${prizeId}`, icon: "💎", label: prizeId };
  }
  const found = SYMBOL_POOL.find((s) => s.key === prizeId);
  if (found) return found;
  const skin = BIKE_SKINS.find((s) => s.id === prizeId);
  return { key: prizeId, icon: "🏍️", label: skin?.name ?? prizeId };
}

type Phase = "idle" | "watching-ad" | "spinning" | "result";

export default function LotterySlot({ user, onBack }: { user: User | null; onBack: () => void }) {
  const [diamonds, setDiamonds] = useState(() => getDiamonds());
  const [freeSpinsUsed, setFreeSpinsUsed] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [reel, setReel] = useState<Sym[]>([]);
  const [result, setResult] = useState<LotterySpinResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [showOdds, setShowOdds] = useState(false);
  const [shake, setShake] = useState<"" | "rare" | "epic">("");
  const stripRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    preloadRewardedAd("lottery");
    lotteryState().then((n) => setFreeSpinsUsed(n ?? 0));
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(timerRef.current);
    };
  }, []);

  const runSpin = async (paid: boolean) => {
    setErrorMsg("");
    setResult(null);
    setShake("");
    const res = await lotterySpin(paid);
    if (!res || !res.ok || !res.prizeKind || !res.prizeId) {
      setPhase("idle");
      setDiamonds(getDiamonds());
      setErrorMsg(paid ? "鑽石不足，無法抽獎" : "今日免費次數已用完");
      return;
    }

    const winner = symbolFor(res.prizeKind, res.prizeId);
    const others = SYMBOL_POOL
      .filter((s) => s.key !== winner.key)
      .sort(() => Math.random() - 0.5)
      .slice(0, VISUAL_SIZE - 1);
    const visualPool = [...others, winner];
    const newReel = Array.from({ length: REPEAT }, () => visualPool).flat();
    setReel(newReel);
    setPhase("spinning");
    if (stripRef.current) stripRef.current.style.transform = "translateY(0px)";

    const targetIndex = (REPEAT - 2) * VISUAL_SIZE + (VISUAL_SIZE - 1);
    const D = targetIndex * ITEM_H - CENTER_OFFSET;
    const v = D / (T1 + T2 / 2);
    const start = performance.now();
    let lastItemIdx = -1;
    let lastTickAt = 0;

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
      const itemIdx = Math.floor(off / ITEM_H);
      if (itemIdx !== lastItemIdx) {
        lastItemIdx = itemIdx;
        if (now - lastTickAt > 30) {
          lastTickAt = now;
          playLotteryTick();
        }
      }
      if (e < T1 + T2) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        if (stripRef.current) stripRef.current.style.transform = `translateY(${-D}px)`;
        playLotteryStop();
        setDiamonds(res.diamonds);
        if (!paid) setFreeSpinsUsed((n) => (n ?? 0) + 1);

        const isBlackSwan = res.prizeKind === "skin" && res.prizeId === "hidden-blackswan";
        const isPSeries = res.prizeKind === "skin" && res.prizeId?.startsWith("p");
        if (isBlackSwan || isPSeries) {
          const rarity = isBlackSwan ? "epic" : "rare";
          timerRef.current = setTimeout(() => {
            playLotteryWin(rarity);
            setShake(rarity);
          }, 150);
        }
        setResult(res);
        setPhase("result");
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const startFreeSpin = async () => {
    if (phase !== "idle" || freeSpinsUsed === null || freeSpinsUsed >= FREE_SPINS_PER_DAY) return;
    setPhase("watching-ad");
    setErrorMsg("");
    const watched = await requestRewardedAd("lottery");
    if (!watched) {
      setPhase("idle");
      setErrorMsg("廣告未完整觀看，未消耗次數");
      return;
    }
    preloadRewardedAd("lottery");
    await runSpin(false);
  };

  const startPaidSpin = async () => {
    if (phase !== "idle") return;
    if (diamonds < PAID_SPIN_COST) {
      setErrorMsg(`鑽石不足（需要 ${PAID_SPIN_COST} 顆）`);
      return;
    }
    await runSpin(true);
  };

  const reset = () => {
    setPhase("idle");
    setResult(null);
    setReel([]);
    setShake("");
    if (stripRef.current) stripRef.current.style.transform = "translateY(0px)";
  };

  const freeLeft = freeSpinsUsed === null ? null : Math.max(0, FREE_SPINS_PER_DAY - freeSpinsUsed);
  const canFreeSpin = freeLeft !== null && freeLeft > 0 && phase === "idle";
  const showPaidBtn = freeLeft === 0;

  const spinLabel =
    phase === "watching-ad" ? "廣告播放中…"
    : phase === "spinning" ? "轉動中…"
    : freeLeft === null ? "載入中…"
    : canFreeSpin ? `🎬 看廣告抽獎（${freeLeft}/${FREE_SPINS_PER_DAY}）`
    : "";

  const placeholder = Array.from({ length: VISIBLE + 2 }, (_, i) => ({ key: `ph${i}`, icon: "❔", label: "?" }));

  // 抽獎需要伺服器錢包才能進行（跟鑽石一樣，訪客沒有伺服器錢包可寫入）。
  if (!user) {
    return (
      <div className="slot-screen lottery-screen">
        <button className="back-btn" onClick={onBack}>‹ 返回</button>
        <h1 className="slot-title lottery-title">🎰 幸運轉輪</h1>
        <p className="garage-guest-notice">🔒 請先登入 Google 帳號才能使用抽獎轉輪——抽獎結果需要伺服器記錄，訪客沒有雲端錢包可以寫入。</p>
      </div>
    );
  }

  return (
    <div className={`slot-screen lottery-screen${shake ? ` lottery-shake-${shake}` : ""}`}>
      <button className="back-btn" onClick={onBack}>‹ 返回</button>
      <h1 className="slot-title lottery-title">🎰 幸運轉輪</h1>
      <p className="slot-pool-hint">💎 目前鑽石 {diamonds}</p>

      <div className="slot-machine lottery-machine">
        <div className="slot-viewport" style={{ height: VIEWPORT_H }}>
          <div className="slot-strip" ref={stripRef}>
            {reel.length === 0
              ? placeholder.map((p) => (
                  <div className="slot-item lottery-item" key={p.key} style={{ height: ITEM_H }}>
                    <span className="lottery-item-icon">{p.icon}</span>
                    <span className="slot-item-name">{p.label}</span>
                  </div>
                ))
              : reel.map((s, i) => (
                  <div className="slot-item lottery-item" key={i} style={{ height: ITEM_H }}>
                    <span className="lottery-item-icon">{s.icon}</span>
                    <span className="slot-item-name">{s.label}</span>
                  </div>
                ))}
          </div>
          <div className="slot-winline lottery-winline" style={{ top: CENTER_OFFSET, height: ITEM_H }} />
          <div className="slot-fade top" />
          <div className="slot-fade bottom" />
        </div>
      </div>

      {phase === "idle" && !showPaidBtn && (
        <button className="slot-spin-btn lottery-spin-btn" onClick={startFreeSpin} disabled={!canFreeSpin}>
          {spinLabel}
        </button>
      )}
      {phase === "idle" && showPaidBtn && (
        <button
          className="slot-spin-btn lottery-spin-btn lottery-paid-btn"
          onClick={startPaidSpin}
          disabled={diamonds < PAID_SPIN_COST}
        >
          💎 {PAID_SPIN_COST} 鑽石 / 次
        </button>
      )}
      {phase !== "idle" && (
        <button className="slot-spin-btn lottery-spin-btn" disabled>{spinLabel}</button>
      )}

      {errorMsg && <p className="lottery-error">{errorMsg}</p>}

      <button className="modal-link lottery-odds-link" onClick={() => setShowOdds(true)}>📋 查看機率表</button>

      {phase === "result" && result && (
        <div className="modal-overlay" onClick={(e) => e.stopPropagation()}>
          <div className={`slot-result lottery-result${shake ? ` lottery-result-${shake}` : ""}`}>
            <div className="lottery-result-icon">
              {symbolFor(result.prizeKind ?? "diamond", result.prizeId ?? "0").icon}
            </div>
            <div className="slot-result-info">
              <span className="slot-result-name">
                {result.prizeKind === "diamond"
                  ? `獲得 ${result.prizeId} 鑽石`
                  : `獲得車款：${symbolFor("skin", result.prizeId!).label}`}
              </span>
            </div>
            <div className="slot-result-actions">
              <button className="modal-btn" onClick={reset}>太棒了！</button>
            </div>
          </div>
        </div>
      )}

      {showOdds && (
        <div className="modal-overlay" onClick={() => setShowOdds(false)}>
          <div className="slot-result lottery-odds-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="lottery-odds-title">機率表</h2>
            <div className="lottery-odds-list">
              {ODDS_TABLE.map((o) => (
                <div className="lottery-odds-row" key={o.label}>
                  <span>{o.label}</span>
                  <span className="lottery-odds-pct">{o.pct}</span>
                </div>
              ))}
            </div>
            <button className="modal-btn" onClick={() => setShowOdds(false)}>關閉</button>
          </div>
        </div>
      )}
    </div>
  );
}
