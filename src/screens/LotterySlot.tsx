// 抽獎轉輪（LOTTERY_DESIGN.md）。視覺語言仿 RandomSlot.tsx（同一套滾輪動畫機制），
// 但音效/質感獨立設計（playLottery* 系列，見 game/audio.ts），跟選賽道的拉霸機
// 做出區隔——這是「賭運氣」的儀式感畫面，選賽道只是功能性導覽。
//
// 中獎結果一律由伺服器 lottery_spin() RPC 決定（機率表寫死在 SQL 裡），這裡的
// 「視覺滾輪」只是動畫用的隨機填充物，最後一格永遠放伺服器實際回傳的獎項
// （跟 RandomSlot 的 winner-at-end 手法完全一致，見該檔）。
import { useEffect, useRef, useState } from "react";
import { BIKE_SKINS } from "../lib/garage";
import {
  lotterySpin, lotterySpinX10, lotteryState, getDiamonds, getAdsRemoved,
  type LotterySpinResult, type LotterySpinX10Result, type LotteryPrizeItem,
} from "../lib/garage";
import { requestRewardedAd, preloadRewardedAd } from "../lib/ads";
import { playLotteryTick, playLotteryStop, playLotteryWin } from "../game/audio";
import type { User } from "../lib/auth";
import "./RandomSlot.css";
import "./Garage.css"; // 重用 .garage-guest-notice 樣式（訪客提示）
import "./LotterySlot.css";

const ITEM_H = 72;
// 2026-07-23 使用者回報版面太滿(標題貼頂/按鈕貼底/機率表被擠到最下面)：跟 RandomSlot
// 2026-07-21 同一個修法一樣，VISIBLE 7→5 讓滾輪變矮、整組內容自然往畫面中央靠。
const VISIBLE = 5;
const VIEWPORT_H = ITEM_H * VISIBLE;
const CENTER_OFFSET = (VIEWPORT_H - ITEM_H) / 2;
const REPEAT = 8;
const VISUAL_SIZE = 24;
const T1 = 2.2, T2 = 2.3; // 比選賽道拉霸機稍長，儀式感更足
const TAP_SPEED_MUL = 3.5; // 2026-07-23 新增：轉動中點擊畫面加速用的倍率
const FREE_SPINS_PER_DAY = 2;
const PAID_SPIN_COST = 20;
const TEN_SPIN_COST = 190; // 十連抽（比單抽 ×10=200 便宜 10）

// 機率表文案（見 LOTTERY_DESIGN.md，跟伺服器 lottery_spin() 的機率區間同步）——
// 純顯示用，不影響實際抽獎（實際結果一律伺服器決定）。
const ODDS_TABLE: { label: string; pct: string }[] = [
  { label: "🎫 1 張廣告抵用券", pct: "8.00%" },
  { label: "🎫 2 張廣告抵用券", pct: "2.00%" },
  { label: "5 鑽石", pct: "67.00%" },
  { label: "10 鑽石", pct: "16.00%" },
  { label: "30 鑽石", pct: "3.50%" },
  { label: "100 鑽石", pct: "0.60%" },
  { label: "300 鑽石", pct: "0.09%" },
  { label: "1000 鑽石（大獎）", pct: "0.01%" },
  { label: "黑天鵝（隱藏車款）", pct: "0.05%" },
  { label: "看不見的手（隱藏車款）", pct: "0.05%" },
  { label: "赤紅暴走", pct: "1.00%" },
  { label: "電馭武士", pct: "0.70%" },
  { label: "黃金期貨", pct: "0.50%" },
  { label: "匿蹤幽靈", pct: "0.35%" },
  { label: "銀河鍍鉻", pct: "0.20%" },
];

// 視覺滾輪的填充符號池（跟真實機率無關，純粹讓轉輪跑起來好看）。
type Sym = { key: string; icon: string; label: string };
const SYMBOL_POOL: Sym[] = [
  { key: "t1", icon: "🎫", label: "1 張廣告抵用券" },
  { key: "t2", icon: "🎫", label: "2 張廣告抵用券" },
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
  { key: "hidden-invisiblehand", icon: "🫥", label: "看不見的手" },
];

function symbolFor(prizeKind: "diamond" | "skin" | "ticket", prizeId: string): Sym {
  if (prizeKind === "ticket") {
    const found = SYMBOL_POOL.find((s) => s.key === `t${prizeId}`);
    return found ?? { key: `t${prizeId}`, icon: "🎫", label: `${prizeId} 張廣告抵用券` };
  }
  if (prizeKind === "diamond") {
    const found = SYMBOL_POOL.find((s) => s.key === `d${prizeId}`);
    return found ?? { key: `d${prizeId}`, icon: "💎", label: prizeId };
  }
  const found = SYMBOL_POOL.find((s) => s.key === prizeId);
  if (found) return found;
  const skin = BIKE_SKINS.find((s) => s.id === prizeId);
  return { key: prizeId, icon: "🏍️", label: skin?.name ?? prizeId };
}

// 各獎項機率（跟上面 ODDS_TABLE / 伺服器 lottery_roll_prize() 同步）——十連抽只跑
// 一次滾輪動畫，用這張表找出「這次十連裡機率最低（最稀有）的一項」讓滾輪停在那裡
// 撐住儀式感，其餘 9 個直接開獎顯示，不用真的跑滿 10 輪動畫（太久）。
const PRIZE_PCT: Record<string, number> = {
  t1: 8.0, t2: 2.0,
  d5: 67.0, d10: 16.0, d30: 3.5, d100: 0.6, d300: 0.09, d1000: 0.01,
  "hidden-blackswan": 0.05, "hidden-invisiblehand": 0.05,
  "p1-crimson": 1.0, "p4-samurai": 0.7, "p3-gold": 0.5, "p5-phantom": 0.35, "p2-galaxy": 0.2,
};
function prizeRarity(item: LotteryPrizeItem): number {
  const kind = item.duplicateOf ? "skin" : item.prizeKind;
  const id = item.duplicateOf ?? item.prizeId;
  const key = symbolFor(kind, id).key;
  return PRIZE_PCT[key] ?? 100;
}
function symbolForPrize(item: LotteryPrizeItem): Sym {
  return item.duplicateOf ? symbolFor("skin", item.duplicateOf) : symbolFor(item.prizeKind, item.prizeId);
}
// 十連抽結果格用：稀有度分級決定卡片邊框顏色（隱藏車款=epic金紫、P系列=rare金）。
function cardRarityFor(item: LotteryPrizeItem): "common" | "rare" | "epic" {
  const drawnId = item.duplicateOf ?? item.prizeId;
  if (drawnId === "hidden-blackswan" || drawnId === "hidden-invisiblehand") return "epic";
  const isPSeries = item.duplicateOf ? item.duplicateOf.startsWith("p") : (item.prizeKind === "skin" && item.prizeId.startsWith("p"));
  return isPSeries ? "rare" : "common";
}

type Phase = "idle" | "watching-ad" | "spinning" | "result" | "result-x10";

export default function LotterySlot({
  user, onBack, onLockBack,
}: { user: User | null; onBack: () => void; onLockBack?: (locked: boolean) => void }) {
  const [diamonds, setDiamonds] = useState(() => getDiamonds());
  const [adsRemoved] = useState(() => getAdsRemoved());
  const [freeSpinsUsed, setFreeSpinsUsed] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [reel, setReel] = useState<Sym[]>([]);
  const [result, setResult] = useState<LotterySpinResult | null>(null);
  const [xResult, setXResult] = useState<LotterySpinX10Result | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [showOdds, setShowOdds] = useState(false);
  const [shake, setShake] = useState<"" | "rare" | "epic">("");
  const stripRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const speedMulRef = useRef(1); // 轉動中點擊畫面 → 調高，讓虛擬經過時間走比較快

  useEffect(() => {
    preloadRewardedAd("lottery");
    lotteryState().then((n) => setFreeSpinsUsed(n ?? 0));
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(timerRef.current);
      onLockBack?.(false); // 卸載時保險解鎖，避免殘留鎖住其他畫面的返回鍵
    };
  }, []);

  // 看廣告/轉動中鎖住返回鍵：伺服器抽獎結果在動畫開始前就已經到帳（見 runSpin 開頭
  // await lotterySpin），中途離開不會弄丟獎勵，但會讓玩家看不到抽到什麼、體感很怪
  // （2026-07-23 使用者實測回報）。灰掉返回鍵比跳確認視窗省事，反正按了也不該讓他走。
  useEffect(() => {
    onLockBack?.(phase === "watching-ad" || phase === "spinning");
  }, [phase, onLockBack]);

  // 滾輪動畫本體：跟結果無關，單抽/十連共用。跑完固定停在 winner 那格，呼叫 onDone。
  // ⚠️ 2026-07-21 修過的 bug：SYMBOL_POOL 只有 14 種符號，VISUAL_SIZE 卻設 24，
  // 原本用 filter+slice「不重複抽樣」最多只能抓到 13 個（扣掉 winner），導致
  // 每個循環區塊實際只有 14 格而不是預期的 24 格，但下面算「中獎格要停在哪」
  // 的數學是照 24 格算的，造成轉輪捲到超出實際內容範圍的空白處（畫面看起來
  // 像動畫跑到一半圖示全部消失，音效/結果都正常，因為那兩者不依賴視覺捲動）。
  // 改成「有放回抽樣」，不管 VISUAL_SIZE 多大都一定能填滿，不再受符號池大小限制。
  const animateToSymbol = (winner: Sym, onDone: () => void) => {
    const others = Array.from(
      { length: VISUAL_SIZE - 1 },
      () => SYMBOL_POOL[Math.floor(Math.random() * SYMBOL_POOL.length)],
    );
    const visualPool = [...others, winner];
    const newReel = Array.from({ length: REPEAT }, () => visualPool).flat();
    setReel(newReel);
    setPhase("spinning");
    speedMulRef.current = 1;
    if (stripRef.current) stripRef.current.style.transform = "translateY(0px)";

    const targetIndex = (REPEAT - 2) * VISUAL_SIZE + (VISUAL_SIZE - 1);
    const D = targetIndex * ITEM_H - CENTER_OFFSET;
    const v = D / (T1 + T2 / 2);
    // 虛擬經過時間：正常速度下每幀累加真實 dt，點擊加速時 speedMulRef 調高，
    // 讓同一套緩動曲線用更快的節奏跑完，不是瞬間跳結果（跟 RandomSlot 同一套做法）。
    let vt = 0;
    let lastFrame = performance.now();
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
        onDone();
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // 稀有中獎震動+音效（單抽/十連共用，十連傳「這次十連裡最稀有那項」判斷）。
  const maybeShakeFor = (kind: "diamond" | "skin" | "ticket", prizeId: string, duplicateOf: string | null) => {
    const drawnId = duplicateOf ?? prizeId;
    const isHiddenTier = drawnId === "hidden-blackswan" || drawnId === "hidden-invisiblehand";
    const isPSeries = duplicateOf ? duplicateOf.startsWith("p") : (kind === "skin" && prizeId.startsWith("p"));
    if (isHiddenTier || isPSeries) {
      const rarity = isHiddenTier ? "epic" : "rare";
      timerRef.current = setTimeout(() => {
        playLotteryWin(rarity);
        setShake(rarity);
      }, 150);
    }
  };

  const runSpin = async (paid: boolean) => {
    setErrorMsg("");
    setResult(null);
    setXResult(null);
    setShake("");
    const res = await lotterySpin(paid);
    if (!res || !res.ok || !res.prizeKind || !res.prizeId) {
      setPhase("idle");
      setDiamonds(getDiamonds());
      setErrorMsg(paid ? "鑽石不足，無法抽獎" : "今日免費次數已用完");
      return;
    }

    // 重複補償（res.duplicateOf 非 null）：轉輪要照「實際抽到的車」停格，不是照
    // 換算後的鑽石數字停格，畫面才會跟結算文案（「已擁有，換成等值鑽石」）對得上。
    const winner = res.duplicateOf ? symbolFor("skin", res.duplicateOf) : symbolFor(res.prizeKind, res.prizeId);
    animateToSymbol(winner, () => {
      setDiamonds(res.diamonds);
      if (!paid) setFreeSpinsUsed((n) => (n ?? 0) + 1);
      // 重複補償一樣算「抽中稀有車款」，特效等級照原本抽到的車判斷，不是照
      // 換算後的鑽石結果（不然重複補償永遠只會是普通鑽石特效，不合理）。
      maybeShakeFor(res.prizeKind!, res.prizeId!, res.duplicateOf);
      setResult(res);
      setPhase("result");
    });
  };

  const runSpinX10 = async () => {
    if (phase !== "idle") return;
    if (diamonds < TEN_SPIN_COST) {
      setErrorMsg(`鑽石不足（需要 ${TEN_SPIN_COST} 顆）`);
      return;
    }
    setErrorMsg("");
    setResult(null);
    setXResult(null);
    setShake("");
    const res = await lotterySpinX10();
    if (!res || !res.ok || res.prizes.length === 0) {
      setPhase("idle");
      setDiamonds(getDiamonds());
      setErrorMsg("鑽石不足，無法十連抽");
      return;
    }

    // 滾輪只跑一次，停在「這次十連裡機率最低（最稀有）」的那一項撐住儀式感，
    // 其餘 9 個直接開獎顯示在下面的結果格（不用真的跑滿 10 輪動畫，太久）。
    let rarest = res.prizes[0];
    let rarestPct = prizeRarity(rarest);
    for (const p of res.prizes) {
      const pct = prizeRarity(p);
      if (pct < rarestPct) { rarest = p; rarestPct = pct; }
    }
    animateToSymbol(symbolForPrize(rarest), () => {
      setDiamonds(res.diamonds);
      maybeShakeFor(rarest.prizeKind, rarest.prizeId, rarest.duplicateOf);
      setXResult(res);
      setPhase("result-x10");
    });
  };

  const startFreeSpin = async () => {
    if (phase !== "idle" || freeSpinsUsed === null || freeSpinsUsed >= FREE_SPINS_PER_DAY) return;
    setErrorMsg("");
    // 已買永久去廣告：不用看廣告，直接抽（比照車庫/結算畫面既有的 adsRemoved 判斷，
    // 2026-07-23 使用者回報這裡漏接，之前完全沒有這段判斷）
    if (adsRemoved) {
      await runSpin(false);
      return;
    }
    setPhase("watching-ad");
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
    setXResult(null);
    setReel([]);
    setShake("");
    if (stripRef.current) stripRef.current.style.transform = "translateY(0px)";
  };

  const backLocked = phase === "watching-ad" || phase === "spinning";
  const freeLeft = freeSpinsUsed === null ? null : Math.max(0, FREE_SPINS_PER_DAY - freeSpinsUsed);
  const canFreeSpin = freeLeft !== null && freeLeft > 0 && phase === "idle";
  const showPaidBtn = freeLeft === 0;

  const spinLabel =
    phase === "watching-ad" ? "廣告播放中…"
    : phase === "spinning" ? "轉動中…"
    : freeLeft === null ? "載入中…"
    : canFreeSpin ? (adsRemoved ? `🎰 免費抽獎（${freeLeft}/${FREE_SPINS_PER_DAY}）` : `🎬 看廣告抽獎（${freeLeft}/${FREE_SPINS_PER_DAY}）`)
    : "";

  const placeholder = Array.from({ length: VISIBLE + 2 }, (_, i) => ({ key: `ph${i}`, icon: "❔", label: "?" }));

  // 轉動中點擊畫面加速（不是瞬間跳結果，是把同一套緩動曲線的虛擬時間調快）
  const handleTapAccelerate = () => {
    if (phase === "spinning") speedMulRef.current = TAP_SPEED_MUL;
  };

  // 按鈕按下去的顏色互閃感（2026-07-23 使用者要求）：純視覺效果，直接操作 DOM
  // classList 短暫加 .flash 再移除，不用另開 React state（跟結果無關，不需要
  // 觸發重繪）。stopPropagation 避免同時觸發外層 handleTapAccelerate。
  const flashPress = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    el.classList.remove("flash");
    void el.offsetWidth; // 強制 reflow，讓連續點擊也能重新觸發動畫
    el.classList.add("flash");
    window.setTimeout(() => el.classList.remove("flash"), 380);
  };

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
    <div
      className={`slot-screen lottery-screen${shake ? ` lottery-shake-${shake}` : ""}`}
      onClick={handleTapAccelerate}
    >
      <button className="back-btn" onClick={onBack} disabled={backLocked}>‹ 返回</button>
      <h1 className="slot-title lottery-title">🎰 幸運轉輪</h1>
      <p className="slot-pool-hint lottery-diamond-chip">💎 {diamonds}</p>
      {phase === "spinning" && <p className="slot-tap-hint">👆 點擊畫面可加速</p>}

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

      {phase === "idle" && (
        <div className="lottery-btn-row">
          {!showPaidBtn && (
            <button
              className="slot-spin-btn lottery-spin-btn"
              onClick={(e) => { flashPress(e); startFreeSpin(); }}
              disabled={!canFreeSpin}
            >
              {spinLabel}
            </button>
          )}
          {showPaidBtn && (
            <button
              className="slot-spin-btn lottery-spin-btn lottery-paid-btn"
              onClick={(e) => { flashPress(e); startPaidSpin(); }}
              disabled={diamonds < PAID_SPIN_COST}
            >
              <span className="lottery-btn-main">🎲 單抽</span>
              <span className="lottery-btn-price">💎 {PAID_SPIN_COST}<span className="unit">/次</span></span>
            </button>
          )}
          <button
            className="slot-spin-btn lottery-spin-btn lottery-ten-btn"
            onClick={(e) => { flashPress(e); runSpinX10(); }}
            disabled={diamonds < TEN_SPIN_COST}
          >
            <span className="lottery-ten-tag">省10</span>
            <span className="lottery-btn-main">✨ 十連抽</span>
            <span className="lottery-btn-price">💎 {TEN_SPIN_COST}<span className="unit">/次</span></span>
          </button>
        </div>
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
              {result.duplicateOf
                ? symbolFor("skin", result.duplicateOf).icon
                : symbolFor(result.prizeKind ?? "diamond", result.prizeId ?? "0").icon}
            </div>
            <div className="slot-result-info">
              <span className="slot-result-name">
                {result.duplicateOf
                  ? `抽中：${symbolFor("skin", result.duplicateOf).label}`
                  : result.prizeKind === "diamond"
                  ? `獲得 ${result.prizeId} 鑽石`
                  : result.prizeKind === "ticket"
                  ? `獲得 ${result.prizeId} 張廣告抵用券`
                  : `獲得車款：${symbolFor("skin", result.prizeId!).label}`}
              </span>
              {result.duplicateOf && (
                <span className="lottery-duplicate-note">您已擁有這台車，已換成等值 {result.prizeId} 鑽石</span>
              )}
            </div>
            <div className="slot-result-actions">
              <button className="modal-btn" onClick={reset}>太棒了！</button>
            </div>
          </div>
        </div>
      )}

      {phase === "result-x10" && xResult && (
        <div className="modal-overlay" onClick={(e) => e.stopPropagation()}>
          <div className={`slot-result lottery-x10-result${shake ? ` lottery-result-${shake}` : ""}`}>
            <div className="lottery-x10-title">✨ 十連抽結果</div>
            <div className="lottery-x10-grid">
              {xResult.prizes.map((p, i) => {
                const sym = symbolForPrize(p);
                const rarity = cardRarityFor(p);
                const label = p.duplicateOf
                  ? `+${p.prizeId}💎`
                  : p.prizeKind === "diamond" ? p.prizeId
                  : p.prizeKind === "ticket" ? `${p.prizeId}張`
                  : sym.label;
                return (
                  <div className={`lottery-x10-card${rarity !== "common" ? ` lottery-x10-card-${rarity}` : ""}`} key={i}>
                    <span className="lottery-x10-card-icon">{sym.icon}</span>
                    <span className="lottery-x10-card-label">{label}</span>
                  </div>
                );
              })}
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
