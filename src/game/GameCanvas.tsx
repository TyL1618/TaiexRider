import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Engine, Events, Composite, Body, type IEventCollision } from "matter-js";
import "./GameCanvas.css";

// [DEV ONLY] 手感調參面板。三元的 false 分支讓 Vite 在正式建置直接消掉這個 import，
// 面板與 devSinkSim/devTuning 都不會進玩家的 bundle。
const DevTuner = import.meta.env.DEV ? lazy(() => import("./DevTuner")) : null;
import { pricesToTrack, buildTerrainBodies, slopeAt, surfaceDistance, surfaceNormal, terrainYAt, type Track } from "./terrain";
import { createBike, resetBike, type Bike } from "./bike";
import { BIKE, CAMERA, COLOR, DRIVE, PHYSICS, RULES } from "./constants";
import { APP_VERSION } from "../version";
import { playFlip, playPerfectLanding, playCrash, playFinish, startEngine, updateEngine, stopEngine, getVolume, setVolume } from "./audio";
import { logEvent } from "../lib/analytics";
import { haptics } from "../lib/haptics";
import { fetchDeathHeatmap } from "../lib/deathHeatmap";
import { startWakeLock } from "../lib/wakeLock";
import { getActiveBikeSkin, addCoins, earnCoins, getAdsRemoved } from "../lib/garage";
import { requestRewardedAd, preloadRewardedAd } from "../lib/ads";
import { grantPlayReward, computePlayReward } from "../lib/playRewards";
import { maybeRequestReview } from "../lib/review";
import { dailyKey } from "../data/pick";
import { Capacitor } from "@capacitor/core";

export interface GameOverStats {
  score: number;
  timeMs: number;
  flips: number;
  perfect: number;
  finished: boolean;
  progressPct: number; // 0~1，完賽固定 1，摔車＝死亡當下跑到賽道的比例（長征金幣按比例用）
}

interface GameCanvasProps {
  prices: number[];
  label: string;
  name: string;
  subtitle?: string;   // HUD 副標（經典模式：期間・標的）
  onExit: () => void;
  onGameOver?: (stats: GameOverStats) => void;
  hideMinimap?: boolean;
  revivalEnabled?: boolean; // 每日排名賽：死亡後可「看廣告復活」（每局一次）
  analyticsMode?: string;   // 打點用模式標籤（daily/slot/custom/long/classic）
  pbKey?: string;           // 個人最佳紀錄的 localStorage key 尾碼（模式+標的）
  uid?: string | null;      // 已登入玩家 id，看廣告雙倍金幣要用來隔離每日上限快取（見 playRewards.ts）
  dailyRank?: number | null; // 每日排名賽即時名次（App.tsx 提交成功後非同步算出才會有值，結算畫面顯示用）
  completedQuests?: { title: string; reward: number }[]; // 本局新完成的每日/週任務（App.tsx 算好傳入，結算畫面顯示用）
}

interface Hud {
  distance: number;
  points: number;
  airborne: boolean;
  airFlips: number;
  throttle: boolean;
  timer: string;
  totalFlips: number;
  perfectLandings: number;
}

const fmtTime = (ms: number): string => {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = (totalSec % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
};

// 兩角差取最短路徑 (-π, π]
function angleDelta(prev: number, next: number): number {
  let d = next - prev;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function calcDifficulty(prices: number[]): number {
  let max = 0;
  for (let i = 1; i < prices.length; i++) {
    const pct = Math.abs(prices[i] / prices[i - 1] - 1);
    if (pct > max) max = pct;
  }
  return max;
}

function difficultyStars(d: number): number {
  if (d < 0.005) return 1;
  if (d < 0.02)  return 2;
  if (d < 0.05)  return 3;
  if (d < 0.085) return 4;
  return 5;
}

// 輕量偽隨機（seeded），給城市天際線用
function seededRand(seed: number) {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = (s ^ (s >>> 16)) >>> 0;
    return s / 0xffffffff;
  };
}

type CityBuilding = {
  x: number; w: number; hFrac: number;
  windows: { lx: number; lyFrac: number; color: string }[];
};

// 生成城市天際線建築群（虛擬寬度 BPERIOD，用 parallax mod 循環）
const BPERIOD = 2400;
function generateCity(seed: number): CityBuilding[] {
  const rand = seededRand(seed);
  const buildings: CityBuilding[] = [];
  let bx = 0;
  while (bx < BPERIOD) {
    const bw = 30 + rand() * 60;
    const hFrac = 0.07 + rand() * 0.52;
    const rows = Math.floor(hFrac * 680 / 16);
    const cols = Math.max(1, Math.floor((bw - 10) / 14));
    const windows: CityBuilding["windows"] = [];
    for (let r = 1; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rand() > 0.4) {
          windows.push({
            lx: 5 + c * 14 + rand() * 2,
            lyFrac: r / rows,
            color: rand() > 0.55
              ? `rgba(45,226,230,${(0.45 + rand() * 0.35).toFixed(2)})`
              : `rgba(255,179,0,${(0.38 + rand() * 0.3).toFixed(2)})`,
          });
        }
      }
    }
    buildings.push({ x: bx, w: bw, hFrac, windows });
    bx += bw + 3 + rand() * 22;
  }
  return buildings;
}


// 翻轉總分：每圈固定 flipBaseScore（線性，不遞增）
function flipScore(flips: number): number {
  return flips * RULES.flipBaseScore;
}

// 車皮圖片快取（模組層級，跨局重用，避免每次進遊戲重新請求）：
// key = 完整 URL，value = { img, ready }。預設車皮在模組載入時就開始抓，
// 避免前幾秒顯示向量備援；其他車皮圖第一次被選用時才抓（Garage 頁按縮圖預覽時
// 用的是 <img> 標籤，不會提前熱進這份快取，但機率低不特別處理）。
interface BikeImgEntry { img: HTMLImageElement; ready: boolean }
const _bikeImgCache = new Map<string, BikeImgEntry>();
function getBikeImageEntry(src: string): BikeImgEntry {
  let entry = _bikeImgCache.get(src);
  if (!entry) {
    const img = new Image();
    const e: BikeImgEntry = { img, ready: false };
    img.onload = () => { e.ready = true; };
    img.src = src;
    _bikeImgCache.set(src, e);
    entry = e;
  }
  return entry;
}
getBikeImageEntry(`${import.meta.env.BASE_URL}bike.png`); // 預熱預設車皮

export default function GameCanvas({ prices, label, name, subtitle, onExit, onGameOver, hideMinimap = false, revivalEnabled = false, analyticsMode, pbKey, uid = null, dailyRank = null, completedQuests = [] }: GameCanvasProps) {
  const stars = difficultyStars(calcDifficulty(prices));
  const cityBuildings = generateCity(prices.length * 31 + Math.round((prices[0] || 0) * 100));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 結算畫面滾動動畫的真正終點分數（見下方 useEffect）：hud.points 每 5 幀才節流同步一次
  // （效能考量，遊玩中不用每幀 setState），車速快時終點/摔車瞬間 hud.points 可能落後真實分數
  // 1~4 幀，導致動畫終點抓到偏低的舊值（2026-07-08 使用者實測回報：衝線瞬間顯示 96 分，
  // 減速後 98 分，皆非真正最終分）。這個 ref 每個物理步都同步（不節流），永遠是真正最終分。
  const finalScoreRef = useRef(0);
  const [hud, setHud] = useState<Hud>({
    distance: 0,
    points: 0,
    airborne: false,
    airFlips: 0,
    throttle: false,
    timer: "0:00.0",
    totalFlips: 0,
    perfectLandings: 0,
  });
  const [crashed, setCrashed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [dying, setDying] = useState(false);
  const [showChart, setShowChart] = useState(false); // 結算時切換 走勢圖/賽道
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [volume, setVolumeState] = useState(() => Math.round(getVolume() * 100));
  const [paused, setPaused] = useState(false); // 暫停（discussion 第 13 點）
  const [confirmExit, setConfirmExit] = useState(false); // 返回主選單確認
  const [showStartPrompt, setShowStartPrompt] = useState(true); // 觸碰才開始計時
  const [revivalUsed, setRevivalUsed] = useState(false); // 每局限復活一次
  // 永久去廣告（IAP）：已購買者跳過所有「看廣告」標籤/流程，見 garage.ts getAdsRemoved()
  const [adsRemoved] = useState(() => getAdsRemoved());
  const [newPb, setNewPb] = useState(false); // 本局打破個人最佳（結算徽章）
  // 結算畫面「看廣告雙倍本局金幣」，每局限一次（排行榜/經典模式沒有金幣可以雙倍，不顯示）。
  // 摔車當下走到賽道的比例（0~1），長征模式摔車金幣按比例、雙倍時也照這個比例算。
  const deathProgressRef = useRef(0);
  const [adDoubleState, setAdDoubleState] = useState<"idle" | "watching" | "claimed">("idle");
  const coinRewardEligible = analyticsMode !== "daily" && analyticsMode !== "classic";
  const isLongMarch = analyticsMode === "long";
  const handleWatchAdDouble = () => {
    if (!coinRewardEligible || adDoubleState !== "idle") return;
    const grantDouble = () => {
      const progressPct = finished ? 1 : deathProgressRef.current;
      const amount = computePlayReward(isLongMarch, finished, progressPct);
      addCoins(grantPlayReward(dailyKey(), amount, uid));
      const kind = isLongMarch
        ? (finished ? "long_finish" : "long_crash")
        : (finished ? "finish" : "crash");
      earnCoins(kind, kind === "long_crash" ? amount : undefined);
    };
    // 已買永久去廣告：不用看廣告，點擊直接領取雙倍（比照看廣告復活的既有作法）
    if (adsRemoved) {
      setAdDoubleState("claimed");
      grantDouble();
      return;
    }
    setAdDoubleState("watching");
    requestRewardedAd("coin").then((ok) => {
      setAdDoubleState(ok ? "claimed" : "idle");
      if (ok) grantDouble();
    });
  };
  // 結算面板剛彈出時短暫吃掉點擊（防止摔車/完賽瞬間手指還按著油門，畫面切換後
  // 抬指剛好落在新出現的「分享成績」等按鈕上被誤判成一次點擊）
  const [resultReady, setResultReady] = useState(false);
  // 結算畫面分數滾動動畫（原生感 juice）：0 → 最終分數，跟畫面淡入同時發生
  const [displayScore, setDisplayScore] = useState(0);
  // 讓事件處理可讀到最新的結束狀態
  const overRef = useRef(false);
  const dyingRef = useRef(false); // 死亡動畫進行中（在 useEffect 閉包內設定）
  const showChartRef = useRef(false); // 走勢圖模式（canvas 閉包即時讀取）
  const pausedRef = useRef(false); // 暫停（主迴圈閉包即時讀取）
  const onGameOverRef = useRef(onGameOver);
  onGameOverRef.current = onGameOver;
  overRef.current = crashed || finished || dyingRef.current;
  showChartRef.current = showChart;
  pausedRef.current = paused || confirmExit || showSettings; // 任一彈窗開啟也凍住遊戲

  // 外部觸發重置（R 鍵 / 按鈕）
  const resetSignal = useRef(0);
  const requestReset = () => { resetSignal.current++; };

  // 外部觸發復活（死亡位置上方懸空，保留分數/時間）
  const reviveSignal = useRef(0);
  const requestRevive = () => { reviveSignal.current++; };

  // 「看廣告復活」按鈕過去點下去就直接免費復活，從沒真的呼叫過廣告——
  // 補上真正的廣告閘門，跟按鈕文字（已購買永久去廣告才顯示「復活」）一致。
  const [reviveWatching, setReviveWatching] = useState(false);
  const handleWatchAdRevive = () => {
    if (reviveWatching) return;
    if (adsRemoved) {
      setRevivalUsed(true);
      requestRevive();
      return;
    }
    setReviveWatching(true);
    requestRewardedAd("revive").then((ok) => {
      setReviveWatching(false);
      if (ok) {
        setRevivalUsed(true);
        requestRevive();
      }
    });
  };

  // 進遊戲就在背景把「復活」廣告備好——摔車是隨時可能發生、也最想「立刻復活」的
  // 情境，事先備好使用者點下去幾乎瞬開（見 ads.ts preloadRewardedAd）。
  useEffect(() => {
    preloadRewardedAd("revive");
  }, []);

  // 結算面板出現後 350ms 才接受點擊（見上方 resultReady 註解）
  useEffect(() => {
    if (!crashed && !finished) { setResultReady(false); return; }
    setResultReady(false);
    // 遊戲結束、結算畫面彈出：背景備好「結算雙倍」用的廣告（跟復活是不同備載槽，
    // 這裡重備成 coin），使用者點「領取 ×2」時也能瞬開。
    preloadRewardedAd("coin");
    const t = setTimeout(() => setResultReady(true), 350);
    return () => clearTimeout(t);
  }, [crashed, finished]);

  // In-App Review（原生殼限定）：破個人紀錄的結算畫面是最自然的「爽點」開口時機。
  // newPb 本身要求舊 PB > 0（回鍋玩家才會 true），節流/次數上限都在 maybeRequestReview()
  // 內部處理，這裡無腦呼叫即可；網頁版 no-op。
  useEffect(() => {
    if ((crashed || finished) && newPb) maybeRequestReview();
  }, [crashed, finished, newPb]);

  // 結算分數滾動動畫：0 → 真正最終分，ease-out 約 550ms（原生感 juice）
  // 終點讀 finalScoreRef（每步同步、不節流），不能讀 hud.points——那是每 5 幀才
  // 節流同步一次的顯示用值，衝線/摔車瞬間可能落後真實分數，車速越快落差越大
  // （2026-07-08 使用者實測：衝線瞬間顯示 96 分、減速後 98 分，皆非真正最終分）。
  useEffect(() => {
    if (!crashed && !finished) { setDisplayScore(0); return; }
    const target = finalScoreRef.current;
    const t0 = performance.now();
    const DUR = 550;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / DUR);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplayScore(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [crashed, finished]);

  // 分享成績：文案連動股票/當日走勢（本遊戲的天然哏），圖卡+檔案分享優先（圖+文轉發效果最好）。
  // 2026-07-12：原生殼改走 @capacitor/share（見 lib/nativeShare.ts 檔頭說明——WebView 的
  // navigator.share() 帶檔案分享常直接失敗，這是 TWA→Capacitor 換殼後的體驗退化，改用官方
  // 原生分享 Intent 修復，恢復系統分享面板＋LINE/FB/IG 捷徑圖示）。網頁/PWA 版邏輯不變。
  const shareScore = async () => {
    const trackDesc = subtitle ? `${name}（${subtitle}）` : `${label} ${name}`;
    const text = finished
      ? `我把 ${trackDesc} 的真實走勢騎好騎滿！🏁 ${hud.points} 分・翻轉 ${hud.totalFlips} 圈・完美落地 ${hud.perfectLandings} 次\n你也來挑戰 TAIEX RIDER：把股市走勢騎成霓虹賽道`
      : `${trackDesc} 的走勢把我摔飛了 🏍️💥 ${hud.points} 分陣亡（翻轉 ${hud.totalFlips} 圈）\n不服來騎 TAIEX RIDER：把股市走勢騎成霓虹賽道`;
    const url = "https://taiexrider.pages.dev";
    logEvent("share", analyticsMode, { label, finished });

    // 圖卡兩條路徑都要用，先產生（renderShareCard 失敗回 null，兩條路徑各自處理 fallback）
    let blob: Blob | null = null;
    try {
      const { renderShareCard } = await import("../lib/shareCard");
      blob = await renderShareCard({
        label, name, subtitle,
        prices,
        score: hud.points,
        timer: hud.timer,
        flips: hud.totalFlips,
        perfect: hud.perfectLandings,
        finished,
      });
    } catch { /* 圖卡產生失敗，blob 維持 null，走純文字分享 */ }

    if (Capacitor.isNativePlatform()) {
      const { shareNative } = await import("../lib/nativeShare");
      await shareNative(blob, "TAIEX RIDER", text, url);
      return;
    }

    // ① 圖卡 + 檔案分享（web／PWA）
    try {
      if (blob) {
        const file = new File([blob], "taiexrider-score.png", { type: "image/png" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: "TAIEX RIDER", text: `${text}\n${url}` });
          return;
        }
      }
    } catch (e) {
      // AbortError = 使用者取消分享面板：結束、不 fallback
      if (e instanceof DOMException && e.name === "AbortError") return;
      /* 其他失敗 → 往下走純文字 */
    }
    // ② 純文字 share
    try {
      if (navigator.share) {
        await navigator.share({ title: "TAIEX RIDER", text, url });
        return;
      }
    } catch { return; }
    // ③ 剪貼簿
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setToast({ text: "成績已複製，貼給朋友吧！", id: Date.now() });
    } catch { /* 靜默 */ }
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    // ---- 車體貼圖（決定①：整張含輪去背 PNG，輪子不轉）----
    // 車庫選用車皮：開局讀一次即可，中途不變。有 src 用獨立圖檔（各自校正過
    // spriteW/offsetX/Y 讓兩個輪子對齊物理輪位）；無 src 套預設圖 + hue-rotate 濾鏡。
    const activeSkin = getActiveBikeSkin();
    const bikeImgSrc = activeSkin.src
      ? `${import.meta.env.BASE_URL}${activeSkin.src}`
      : `${import.meta.env.BASE_URL}bike.png`;
    const bikeEntry = getBikeImageEntry(bikeImgSrc);
    const bikeSpriteW = activeSkin.spriteW ?? BIKE.spriteW;
    const bikeOffsetX = activeSkin.spriteOffsetX ?? BIKE.spriteOffsetX;
    const bikeOffsetY = activeSkin.spriteOffsetY ?? BIKE.spriteOffsetY;
    const bikeHueDeg = activeSkin.src ? 0 : activeSkin.hueRotateDeg;
    const bikeFilter = bikeHueDeg !== 0 ? `hue-rotate(${bikeHueDeg}deg)` : "none";

    // ---- 建立世界 ----
    // subSteps 每幀重讀（沒有任何東西被烘進剛體裡），DEV 面板可即時切換不用重開一局。
    let subSteps = Math.max(1, Math.round(PHYSICS.subSteps));
    let SUB_DELTA = (1000 / 60) / subSteps;
    let easeSub: number = DRIVE.groundLockEase; // 型別要標 number：DRIVE 是 as const（字面量型別）
    const engine = Engine.create();
    // 重力 ×subSteps：Matter 每次 update 的重力速度增量 ∝ delta²，n 個 (Δ/n) 子步累積起來
    // 只有原本的 1/n，乘回 n 才能讓每幀的重力加速度與 subSteps=1 相同。
    engine.gravity.y = PHYSICS.gravityY * subSteps;
    engine.positionIterations = PHYSICS.positionIterations;
    engine.velocityIterations = PHYSICS.velocityIterations;
    const world = engine.world;

    const track: Track = pricesToTrack(prices);
    Composite.add(world, buildTerrainBodies(track));

    // 全服死亡熱點（每日排名賽限定）：今日死亡最多的前 3 個位置畫 ☠️ 標記
    // （黑魂血跡式社群感；資料匿名彙總，fetch 失敗/尚無資料 = 空陣列不顯示）
    let heatSpots: { x: number; deaths: number }[] = [];
    if (analyticsMode === "daily") {
      fetchDeathHeatmap().then((rows) => {
        heatSpots = rows
          .filter((r) => r.deaths > 0)
          .sort((a, b) => b.deaths - a.deaths)
          .slice(0, 3)
          .map((r) => ({
            x: track.startX + ((r.bucket - 0.5) / 20) * (track.finishX - track.startX),
            deaths: r.deaths,
          }));
      }).catch(() => {});
    }

    const spawnX = track.startX;
    // 懸空高度：初始進場與復活都從空中落下，等觸碰才計時；復活落下時間即為自然懲罰
    const HOVER_HEIGHT = 67;
    const spawnY = track.vertices[0].y - BIKE.wheelDropY - BIKE.wheelRadius - 1 - HOVER_HEIGHT;
    const bike: Bike = createBike(world, spawnX, spawnY);

    // 初始凍結：等待觸碰，車身靜止懸空，不開始計時也不允許翻滾
    Body.setStatic(bike.chassis, true);
    Body.setStatic(bike.rearWheel, true);
    Body.setStatic(bike.frontWheel, true);
    let waitingToStart = true;
    let hasEverGrounded = false; // 首次落地後才開放空中翻滾
    let devMaxSink = 0; // [DEV] 本局最大穿透深度（調參面板讀）

    // ---- 插值用：記錄上一物理步的位置/角度，渲染時平滑消除步進鋸齒 ----
    let prevChassisPos = { x: bike.chassis.position.x, y: bike.chassis.position.y };
    let prevChassisAngle = bike.chassis.angle;
    let prevRearPos = { x: bike.rearWheel.position.x, y: bike.rearWheel.position.y };
    let prevRearAngle = bike.rearWheel.angle;
    let prevFrontPos = { x: bike.frontWheel.position.x, y: bike.frontWheel.position.y };
    let prevFrontAngle = bike.frontWheel.angle;

    // ---- 著地偵測（輪子 vs terrain 計數）----
    let rearContacts = 0;
    let frontContacts = 0;
    let chassisContacts = 0;
    const onCollision = (delta: number) => (e: IEventCollision<Engine>) => {
      for (const pair of e.pairs) {
        const labels = [pair.bodyA.label, pair.bodyB.label];
        if (!labels.includes("terrain")) continue;
        if (labels.includes("rearWheel")) rearContacts = Math.max(0, rearContacts + delta);
        if (labels.includes("frontWheel")) frontContacts = Math.max(0, frontContacts + delta);
        if (labels.includes("chassis")) chassisContacts = Math.max(0, chassisContacts + delta);
      }
    };
    const collStart = onCollision(1);
    const collEnd = onCollision(-1);
    Events.on(engine, "collisionStart", collStart);
    Events.on(engine, "collisionEnd", collEnd);

    // ---- 輸入：單鍵（按住=油門/空中後翻，放開=滑行）----
    let throttle = false;
    const press = () => {
      if (overRef.current) return;
      if (waitingToStart) {
        // 第一次觸碰：解凍車身，開始計時，啟動引擎聲
        Body.setStatic(bike.chassis, false);
        Body.setStatic(bike.rearWheel, false);
        Body.setStatic(bike.frontWheel, false);
        waitingToStart = false;
        setShowStartPrompt(false);
        startEngine();
      }
      throttle = true;
    };
    const release = () => {
      throttle = false;
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.code === "Space") {
        ev.preventDefault();
        press();
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.code === "Space") release();
    };
    window.addEventListener("pointerdown", press);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    const stopWakeLock = startWakeLock();

    // ---- 畫布尺寸 ----
    let W = 0;
    let H = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    // ---- 遊戲狀態 ----
    let camX = spawnX - W * CAMERA.offsetXRatio;
    let camY = spawnY - H * CAMERA.offsetYRatio;
    let scale = 1;
    let targetScale = 1;
    let overviewCamX = 0;
    let overviewCamY = 0;
    let overviewComputed = false;
    let prevAngle = bike.chassis.angle;
    let airRotation = 0;
    let airTime = 0; // 連續騰空時間（雙輪皆離地）
    let airborneSteps = 0; // 連續離地 step 數（後翻寬限用）
let crashTimer = 0;
    let points = 0;
    let bonusPoints = 0; // 特技分（後翻＋完美落地），行進分另算疊加
    let maxDistScore = 0; // 歷史最大行進分 → 分數只增不減（discussion 第 5 點）
    let totalFlips = 0; // 全程累計後空翻圈數（結算顯示，discussion 第 9 點）
    let perfectLandings = 0; // 全程完美落地次數
    let wasGrounded = false;
    // 落地延遲結算（v0.12.1）：首次觸地只快照，連續 landingSettleSteps 步著地才結算。
    // 微彈跳/擦地（< N 步又離地）不清 airRotation、不煞停翻轉。
    let groundedRun = 0;          // 連續著地步數
    let landingSettled = true;    // 本次落地是否已結算（開局站地上視為已結算）
    let landingSnap: { rot: number; air: number; angle: number; x: number } | null = null;
    // 卡縫自動脫困 watchdog（v0.12.13）：著地+油門下 40 步（0.67s）淨位移 < 3px
    // ＝輪子楔死（平地接陡上坡的牆角縫等）→ 自動暫停驅動 60 步（≈1s，等效
    // 「放開油門」讓碰撞回彈把輪子擠出——正是玩家手動脫困的操作）後恢復。
    // headless 模擬驗證（scripts/simStuck.ts fix=assist，2000 局×3 bot）：
    // 完賽/摔車率與現況相同（±0.3%，不影響難度與排行榜）、卡死全部自動脫困。
    // 窗長 40 步是下限：15 步窗會誤傷正常騎乘的短暫減速（實測完賽率 +6% 難度跑掉）。
    const jamHist: number[] = [];
    let assistLeft = 0;
    let hudTick = 0;
    let raceTimeMs = 0;
    // 完美落地雙輪特效（剩餘幀數 + 觸發時兩輪世界座標）
    let perfectFxFrames = 0;
    let perfectFxPts: { x: number; y: number }[] = [];
    let toastId = 0;
    const showToast = (text: string) => setToast({ text, id: ++toastId });

    // 個人最佳（PB）：分數 > 既有紀錄即更新 localStorage；
    // 只有「打破舊紀錄」（舊值 > 0，非首次遊玩）才亮結算徽章
    // key 帶 uid 隔離（訪客固定 "guest"）——同裝置切換帳號才不會沿用前一個使用者的
    // PB，跟 quests.ts/adRewards.ts 2026-07-08 修過的同一種跨帳號快取污染問題。
    const checkPb = (score: number) => {
      if (!pbKey) return;
      try {
        const k = `tr_pb_${pbKey}_${uid ?? "guest"}`;
        const old = parseInt(localStorage.getItem(k) ?? "0", 10);
        if (score > old) {
          localStorage.setItem(k, String(score));
          if (old > 0) setNewPb(true);
        }
      } catch { /* localStorage 不可用時略過 */ }
    };

    // ---- 死亡動畫狀態 ----
    type DeathParticle = { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number };
    let deathParticles: DeathParticle[] = [];
    let deathFlashAlpha = 0;
    let deathShakeAmp = 0;
    let deathElapsed = 0;
    const DEATH_DUR = 1.5;

    const spawnDeathParticles = (ox: number, oy: number) => {
      deathParticles = [];
      const cols = [
        COLOR.bike, COLOR.bike,          // 琥珀（主色，較多）
        COLOR.start, COLOR.start,        // 青
        "#ff4dff", "#cc44ff",            // 品紅/紫
        "#ffffff", "#ffffff",            // 白光
      ];
      for (let i = 0; i < 42; i++) {
        const a = Math.random() * Math.PI * 2;
        // 分兩速度層：快層爆出遠、慢層漫散近
        const fast = i < 18;
        const spd = fast ? 3.5 + Math.random() * 5 : 0.8 + Math.random() * 2.5;
        deathParticles.push({
          x: ox, y: oy,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd - (fast ? 3.5 : 1.5),
          life: 1,
          color: cols[Math.floor(Math.random() * cols.length)],
          size: fast ? 2 + Math.random() * 5 : 1.5 + Math.random() * 3,
        });
      }
    };

    const doReset = () => {
      devMaxSink = 0; // [DEV] 每局重新統計最大穿透
      Body.setStatic(bike.chassis, false);
      Body.setStatic(bike.rearWheel, false);
      Body.setStatic(bike.frontWheel, false);
      resetBike(bike);
      prevChassisPos = { x: bike.chassis.position.x, y: bike.chassis.position.y };
      prevChassisAngle = bike.chassis.angle;
      prevRearPos = { x: bike.rearWheel.position.x, y: bike.rearWheel.position.y };
      prevRearAngle = bike.rearWheel.angle;
      prevFrontPos = { x: bike.frontWheel.position.x, y: bike.frontWheel.position.y };
      prevFrontAngle = bike.frontWheel.angle;
      rearContacts = 0;
      frontContacts = 0;
      chassisContacts = 0;
      throttle = false;
      jamHist.length = 0;
      assistLeft = 0;
      prevAngle = bike.chassis.angle;
      airRotation = 0;
      airTime = 0;
      airborneSteps = 0;
      crashTimer = 0;
      points = 0;
      finalScoreRef.current = 0;
      bonusPoints = 0;
      maxDistScore = 0;
      totalFlips = 0;
      perfectLandings = 0;
      raceTimeMs = 0;
      wasGrounded = false;
      groundedRun = 0;
      landingSettled = true;
      landingSnap = null;
      perfectFxFrames = 0;
      perfectFxPts = [];
      deathParticles = [];
      deathFlashAlpha = 0;
      deathShakeAmp = 0;
      deathElapsed = 0;
      dyingRef.current = false;
      showChartRef.current = false;
      scale = 1;
      targetScale = 1;
      overviewComputed = false;
      // 重置為等待觸碰狀態（再玩一次也從懸空開始）
      waitingToStart = true;
      hasEverGrounded = false;
      Body.setStatic(bike.chassis, true);
      Body.setStatic(bike.rearWheel, true);
      Body.setStatic(bike.frontWheel, true);
      setShowStartPrompt(true);
      setCrashed(false);
      setFinished(false);
      setDying(false);
      setShowChart(false);
      setToast(null);
      setNewPb(false);
    };

    // 復活：在死亡位置上方懸空，保留分數/時間，重置碰撞與特效狀態
    const doRevive = () => {
      logEvent("revive", analyticsMode, { label });
      const deathX = bike.chassis.position.x;
      const terrainY = terrainYAt(track, deathX);
      const reviveY = terrainY - BIKE.wheelDropY - BIKE.wheelRadius - 1 - HOVER_HEIGHT;

      Body.setPosition(bike.chassis,    { x: deathX,                       y: reviveY });
      Body.setPosition(bike.rearWheel,  { x: deathX - BIKE.wheelBaseHalf,  y: reviveY + BIKE.wheelDropY });
      Body.setPosition(bike.frontWheel, { x: deathX + BIKE.wheelBaseHalf,  y: reviveY + BIKE.wheelDropY });

      for (const b of [bike.chassis, bike.rearWheel, bike.frontWheel]) {
        Body.setVelocity(b, { x: 0, y: 0 });
        Body.setAngularVelocity(b, 0);
        Body.setStatic(b, true);
      }
      Body.setAngle(bike.chassis, 0);

      prevChassisPos   = { ...bike.chassis.position };
      prevChassisAngle = bike.chassis.angle;
      prevRearPos      = { ...bike.rearWheel.position };
      prevRearAngle    = bike.rearWheel.angle;
      prevFrontPos     = { ...bike.frontWheel.position };
      prevFrontAngle   = bike.frontWheel.angle;

      rearContacts = 0; frontContacts = 0; chassisContacts = 0;
      throttle = false;
      jamHist.length = 0;
      assistLeft = 0;
      prevAngle = 0;
      airRotation = 0; airTime = 0; airborneSteps = 0;
      crashTimer = 0;
      wasGrounded = false;
      groundedRun = 0; landingSettled = true; landingSnap = null;
      perfectFxFrames = 0; perfectFxPts = [];
      deathParticles = []; deathFlashAlpha = 0; deathShakeAmp = 0; deathElapsed = 0;
      dyingRef.current = false;
      waitingToStart = true;
      hasEverGrounded = false;
      scale = 1; targetScale = 1; overviewComputed = false;
      // 分數、時間、totalFlips、perfectLandings 刻意不清零

      overRef.current = false;
      setShowStartPrompt(true);
      setCrashed(false);
      setFinished(false);
      setDying(false);
      setShowChart(false);
      setToast(null);
      setNewPb(false);
    };

    // ---- 物理步進 ----
    const STEP = 1000 / 60;
    // 定速引擎（Rider 風格街機手感）：
    //  著地按住 → 鎖「後輪→前輪連線方向（坡面切線，永遠朝前）」的速度分量到 cruiseSpeed：
    //    任何坡面同速（陡坡不再蝸牛），tx 永遠 > 0 → 不倒退，凸坡頂有向上動量 → 自然飛出去。
    //  著地恆時 → 車身角速度朝前輪坡段平滑修正（貼坡、不翹頭）
    //  離地：按住＝後空翻、放開＝車頭緩緩往前壓（準備落地）
    // ⚠️ 單位鐵則（Matter 0.20，2026-07-10 實作子步時踩過）：
    //   · Body.setVelocity/setAngularVelocity 接受的是「每 _baseDelta(16.666ms) 的量」，
    //     內部自己用 body.deltaTime 換算 → 與子步大小無關，常數不用除以 n。
    //   · 但直接讀 body.velocity / body.angularVelocity 拿到的是「每次 update 的位移」
    //     （= 每子步），兩者單位不同！subSteps=1 時剛好相等所以以前不會出錯。
    //   → 讀取一律走 Body.getVelocity()/getAngularVelocity()（回傳 per-baseDelta），
    //     寫入一律用原始常數，讀寫單位才一致。
    //   · 唯一要按 n 換算的是「每個子步都會累加一次」的增量（空中角加速度），因為控制律
    //     每個子步都跑一次，一幀會被套用 n 次 → 增量除以 n。上限/目標值是絕對量，不用改。
    //   · ease 類（groundLockEase）一幀會收斂 n 次 → 取 n 次方根維持每幀收斂速度相同。
    const applyControls = (grounded: boolean, _upright: boolean) => {
      if (overRef.current) return;
      const c = bike.chassis;
      // 有效油門：自動脫困期間視同放開（只影響驅動/空中翻滾，吸地與貼坡對齊照常）
      const thr = throttle && assistLeft <= 0;

      if (grounded) {
        // 後輪→前輪連線 = 坡面切線（tx 恆正 = 永遠朝前）
        const dx = bike.frontWheel.position.x - bike.rearWheel.position.x;
        const dy = bike.frontWheel.position.y - bike.rearWheel.position.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.001) {
          const tx = dx / len;
          const ty = dy / len;
          // ① 法線速度歸零（吸地消彈跳）
          //    坡面外法線 = (ty, -tx)（y 向下座標系：flat→(0,-1)=朝上 ✓）
          //    只移除「離坡」分量(vn>0)；「入坡」分量留給物理碰撞處理，不干涉落地
          const nx = ty, ny = -tx;
          for (const b of [c, bike.rearWheel, bike.frontWheel]) {
            const v = Body.getVelocity(b);
            const vn = v.x * nx + v.y * ny;
            if (vn > 0) Body.setVelocity(b, { x: v.x - vn * nx, y: v.y - vn * ny });
          }
          // ② 油門：切線鎖速到 cruiseSpeed（絕對目標值，與子步數無關）
          if (thr) {
            const vc = Body.getVelocity(c);
            const vt = vc.x * tx + vc.y * ty;
            const delta = (DRIVE.cruiseSpeed - vt) * easeSub;
            for (const b of [c, bike.rearWheel, bike.frontWheel]) {
              const v = Body.getVelocity(b);
              Body.setVelocity(b, { x: v.x + delta * tx, y: v.y + delta * ty });
            }
          }
        }
        // ③ 對齊前輪坡段：以比例修正車身角速度（gain），並夾在 groundedAvMax 內
        //    這是「直接設定」不是累加 → 每個子步設同一個目標值，不需除以 n
        const slope = slopeAt(track, bike.frontWheel.position.x);
        const da = angleDelta(c.angle, slope);
        let av = da * DRIVE.groundAlignGain;
        if (Math.abs(av) > DRIVE.groundedAvMax) av = Math.sign(av) * DRIVE.groundedAvMax;
        Body.setAngularVelocity(c, av);
      } else if (thr && hasEverGrounded) {
        // 空中按住 → 後空翻（首次落地後才開放，避免懸空落下時誤觸翻滾）
        // 任意角度均可持續旋轉；移除 cos 條件，修「倒置區間停轉」bug
        // 角加速度是每子步累加一次 → ÷n；上限 airSpinMax 是絕對值 → 不變
        const avNow = Body.getAngularVelocity(c);
        const nv = Math.max(-DRIVE.airSpinMax, avNow - DRIVE.airSpinAccel / subSteps);
        Body.setAngularVelocity(c, nv);
      } else {
        // 空中放開：線性制動（airSpinBrakeAccel/step 朝 0 推，≈4步停），不瞬間歸零保留手感
        let av = Body.getAngularVelocity(c);
        if (av < 0) av = Math.min(0, av + DRIVE.airSpinBrakeAccel / subSteps);
        Body.setAngularVelocity(c, Math.min(DRIVE.airNoseForwardMax, av + DRIVE.airNoseForwardAccel / subSteps));
      }
    };

    // 穿透修正：每個子步 Engine.update 後，把陷進地表的輪子沿地形法線推回表面 +
    // 消掉往內速度。cruiseSpeed(6.9) ≥ 輪半徑(6) 讓輪子第一次接觸就埋進去，solver 會愈推
    // 愈深 → 卡住/假死。這裡每幀主動修正，不讓穿透累積。只在陷入 >1px 時才作用，正常
    // 貼地(輪子本來就會微重疊)不動它，故手感零改變。單幀最多推一個輪半徑，避免瞬移彈飛。
    const DEPEN_TOL = 1.0;
    const depenetrate = (w: typeof bike.rearWheel) => {
      const { dist, nx, ny } = surfaceNormal(track, w.position);
      const pen = BIKE.wheelRadius - dist; // >0 = 輪面已陷入地表
      if (pen <= DEPEN_TOL) return;
      const push = Math.min(pen, BIKE.wheelRadius);
      Body.setPosition(w, { x: w.position.x + nx * push, y: w.position.y + ny * push });
      const v = Body.getVelocity(w);
      const vn = v.x * nx + v.y * ny;
      if (vn < 0) Body.setVelocity(w, { x: v.x - vn * nx, y: v.y - vn * ny });
    };

    // 結算一趟翻轉（落地當下 or 飛越終點線時強制結算，見下方兩處呼叫）：
    // 給分／toast／音效／震動／特效全部集中在這裡，避免兩處呼叫各寫一份分岔。
    const settleFlip = (rot: number, air: number, angle: number, x: number) => {
      // 圈數：差 0.3π（85%+）內進位，貼近體感
      const flips = Math.floor((Math.abs(rot) + 0.3 * Math.PI) / (2 * Math.PI));
      const realAir = air > RULES.minAirSec;
      const uprightAtLand = Math.cos(angle) > RULES.uprightCosThreshold;
      const landSlope = slopeAt(track, Math.min(x, track.finishX));
      const levelOk = Math.abs(angleDelta(angle, landSlope)) < RULES.perfectLevelRad;
      const isPerfect = realAir && Math.abs(rot) > Math.PI * 1.7 && levelOk;
      if (isPerfect) {
        // 完美落地：剛才那趟翻轉分 ×2（v0.12.14 定案，不論落地面平或斜）
        const perfectFlips = Math.max(1, flips);
        const gained = flipScore(perfectFlips) * 2;
        bonusPoints += gained;
        totalFlips += perfectFlips;
        perfectLandings++;
        showToast(`完美落地 ${perfectFlips} 圈 +${gained}`);
        playPerfectLanding();
        haptics.perfect();
        perfectFxFrames = 30;
        perfectFxPts = [
          { x: bike.rearWheel.position.x, y: bike.rearWheel.position.y },
          { x: bike.frontWheel.position.x, y: bike.frontWheel.position.y },
        ];
      } else if (uprightAtLand && flips > 0) {
        const gained = flipScore(flips);
        bonusPoints += gained;
        totalFlips += flips;
        showToast(`${flips} 圈 +${gained}`);
        playFlip();
      }
    };

    const step = (dtMs: number) => {
      const rearGrounded = rearContacts > 0;
      const frontGrounded = frontContacts > 0;
      const grounded = rearGrounded || frontGrounded;
      const uprightNow = Math.cos(bike.chassis.angle) > RULES.uprightCosThreshold;
      airborneSteps = grounded ? 0 : airborneSteps + 1;
      // 卡縫自動脫困 watchdog：偵測「按著油門+著地卻原地不動」→ 暫停驅動讓輪子回彈
      if (assistLeft > 0) {
        assistLeft--;
        jamHist.length = 0;
      } else if (grounded && throttle && !overRef.current) {
        jamHist.push(bike.chassis.position.x);
        if (jamHist.length > 40) jamHist.shift();
        if (jamHist.length === 40 && Math.abs(bike.chassis.position.x - jamHist[0]) < 3) {
          assistLeft = 60;
          jamHist.length = 0;
        }
      } else {
        jamHist.length = 0;
      }
      // 存下本步物理狀態，供渲染插值（frame 裡用 alpha=acc/STEP 取中間位置）
      prevChassisPos = { x: bike.chassis.position.x, y: bike.chassis.position.y };
      prevChassisAngle = bike.chassis.angle;
      prevRearPos = { x: bike.rearWheel.position.x, y: bike.rearWheel.position.y };
      prevRearAngle = bike.rearWheel.angle;
      prevFrontPos = { x: bike.frontWheel.position.x, y: bike.frontWheel.position.y };
      prevFrontAngle = bike.frontWheel.angle;
      // 物理參數每幀重讀 → DEV 調參面板改滑桿即時生效，不用重開一局。
      // （子步數沒有被烘進任何剛體：frictionAir 由 Matter 自己按 delta 正規化，見 bike.ts）
      subSteps = Math.max(1, Math.round(PHYSICS.subSteps));
      SUB_DELTA = STEP / subSteps;
      // ease 一幀會收斂 subSteps 次 → 取 n 次方根，讓每幀的收斂速度與單步時相同
      easeSub = subSteps === 1 ? DRIVE.groundLockEase : 1 - Math.pow(1 - DRIVE.groundLockEase, 1 / subSteps);
      engine.gravity.y = PHYSICS.gravityY * subSteps;
      engine.positionIterations = PHYSICS.positionIterations;
      engine.velocityIterations = PHYSICS.velocityIterations;
      // 子步：把這一幀拆成 subSteps 次較小的 Engine.update，讓碰撞取樣更密
      // （單步位移 = cruiseSpeed/subSteps，subSteps≥2 時就小於輪半徑，不會一接觸就埋進去）。
      // 控制律每個子步都要套用，否則驅動只生效 1/n 幀。
      const doDepen = PHYSICS.depenetrate !== 0;
      for (let s = 0; s < subSteps; s++) {
        applyControls(rearContacts > 0 || frontContacts > 0, uprightNow);
        Engine.update(engine, SUB_DELTA);
        if (doDepen) { depenetrate(bike.rearWheel); depenetrate(bike.frontWheel); }
      }

      const c = bike.chassis;
      const groundedNow = rearContacts > 0 || frontContacts > 0;
      const airborneFully = rearContacts === 0 && frontContacts === 0;
      if (groundedNow && !hasEverGrounded) hasEverGrounded = true;

      // [DEV] 即時穿透讀數：sink = 輪半徑 − 輪心到地形折線的最短距離。
      // 0 = 完美貼地；>0 = 輪心已在地表下；≥ 2×輪半徑 = 整顆輪子沒入（＝玩家看到的破圖）。
      // 寫到 window 而非 import DEV 模組，正式建置這段會被整個消掉。
      if (import.meta.env.DEV) {
        const rs = BIKE.wheelRadius - surfaceDistance(track, bike.rearWheel.position);
        const fs = BIKE.wheelRadius - surfaceDistance(track, bike.frontWheel.position);
        const sink = Math.max(rs, fs);
        if (sink > devMaxSink) devMaxSink = sink;
        const dv = Body.getVelocity(c);
        const spd = Math.hypot(dv.x, dv.y);
        (window as unknown as { __devStats: unknown }).__devStats = {
          sink, maxSink: devMaxSink, speed: spd,
          stepMove: spd / subSteps, // 單步位移，必須 < 輪半徑才不會一接觸就埋進去
          subSteps, grounded: groundedNow, wheelRadius: BIKE.wheelRadius,
        };
      }

      // 空中累積旋轉 / 滯空時間
      if (!groundedNow) {
        airRotation += angleDelta(prevAngle, c.angle);
      }
      if (airborneFully) airTime += dtMs / 1000;
      prevAngle = c.angle;

      // 正立判定：車身上向量 = (sin a, -cos a)，朝上 ⇔ cos a > threshold
      const upright = Math.cos(c.angle) > RULES.uprightCosThreshold;

      // 落地結算（v0.12.1 改「延遲結算」settle-after-N）：
      // 舊邏輯單 step 邊緣觸發 + 任何 grounded step 清空 airRotation → 落地微彈跳/
      // 翻轉途中輪子擦過山頂一幀就把累積旋轉歸零 → 真正落地時量到 ≈0，過不了 1.7π
      //（headless 模擬 scripts/simPerfect.ts 證實漏判 85%）。
      // 新邏輯：首次觸地快照（rot/air/角度/位置＝玩家看到的落地瞬間），連續
      // landingSettleSteps 步著地才結算給分；擦地（<N 步又離地）不清旋轉、不煞停翻轉。
      if (groundedNow) {
        groundedRun++;
        if (groundedRun === 1 && !landingSettled) {
          landingSnap = { rot: airRotation, air: airTime, angle: c.angle, x: c.position.x };
        }
        if (!landingSettled && groundedRun >= RULES.landingSettleSteps && landingSnap) {
          // 用「觸地瞬間快照」（玩家看到的那一刻）結算，而非本刻（可能已滾動數步）
          settleFlip(landingSnap.rot, landingSnap.air, landingSnap.angle, landingSnap.x);
          landingSettled = true;
          landingSnap = null;
          airRotation = 0;
          airTime = 0;
        }
      } else {
        if (wasGrounded && landingSettled) {
          // 只有「真落地後再起跳」才歸零殘留角速度（消除爬坡貼坡帶上來的「莫名往後翻」）；
          // 擦地後回到空中不歸零 → 不打斷正在進行的翻轉
          Body.setAngularVelocity(c, 0);
        }
        groundedRun = 0;
        landingSettled = false;
      }
      wasGrounded = groundedNow;

      // 行進分：到終點剛好 1000，即時疊加在特技分上。
      // 只增不減（discussion 第 5 點）：車身向後滑不扣回已達到的行進分。
      const traveled = Math.max(0, c.position.x - track.startX);
      const distScore = Math.min(1000, Math.round((traveled / (track.finishX - track.startX)) * 1000));
      if (distScore > maxDistScore) maxDistScore = distScore;
      points = bonusPoints + maxDistScore;
      finalScoreRef.current = points; // 不節流，隨時是真正的最終分（供結算動畫抓終點用）

      // 死亡判定（懸空等待觸碰期間完全略過：static 車身 velocity=0、雙輪離地，
      // 否則 stuckMidAir 會把「等待中」誤判成卡死 → 開場立刻爆炸）
      const bothWheelsOff = rearContacts === 0 && frontContacts === 0;
      // 用 getVelocity（per-baseDelta = 每幀位移），子步數不影響這個門檻值(0.5)
      const cv = Body.getVelocity(c);
      const speed = Math.hypot(cv.x, cv.y);
      // 車頂碰地：把局部 crashZone 座標轉世界，任一點低於地形 → 死
      // 前提：車身真的「翻過 90°」(cos < crashTipCos)，爬陡坡前傾(<90°)不誤判（discussion 第 1 點）
      const tippedOver = !waitingToStart && Math.cos(c.angle) < RULES.crashTipCos;
      const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
      const topHit = tippedOver && BIKE.crashZone.some(({ x: lx, y: ly }) => {
        const wx = ca * lx - sa * ly + c.position.x;
        const wy = sa * lx + ca * ly + c.position.y;
        return wy > terrainYAt(track, wx);
      });
      // 空中完全卡住：飛行中 speed ≈ 6.9，只有真死局（卡谷等）才 < 0.5
      const stuckMidAir = !waitingToStart && bothWheelsOff && speed < 0.5;
      // topHit（車頂碰地）：瞬間定格，不等計時器
      if (topHit && !overRef.current) {
        Body.setStatic(bike.chassis, true);
        Body.setStatic(bike.rearWheel, true);
        Body.setStatic(bike.frontWheel, true);
        spawnDeathParticles(bike.chassis.position.x, bike.chassis.position.y);
        deathFlashAlpha = 1.0;
        deathShakeAmp = 8;
        deathElapsed = 0;
        overRef.current = true;
        dyingRef.current = true;
        setDying(true);
        playCrash(); stopEngine(); haptics.crash();
        crashTimer = 0;
        deathProgressRef.current = Math.round(Math.max(0, Math.min(1, (c.position.x - track.startX) / (track.finishX - track.startX))) * 1000) / 1000;
        logEvent("death", analyticsMode, { cause: "topHit", label, xr: deathProgressRef.current });
      } else if (stuckMidAir && !overRef.current) {
        // stuckMidAir 仍需計時確認（瞬間速度<0.5 可能是正常落地）
        crashTimer += dtMs / 1000;
        if (crashTimer >= RULES.crashUpsideDownSec) {
          Body.setStatic(bike.chassis, true);
          Body.setStatic(bike.rearWheel, true);
          Body.setStatic(bike.frontWheel, true);
          spawnDeathParticles(bike.chassis.position.x, bike.chassis.position.y);
          deathProgressRef.current = Math.round(Math.max(0, Math.min(1, (c.position.x - track.startX) / (track.finishX - track.startX))) * 1000) / 1000;
          logEvent("death", analyticsMode, { cause: "stuckMidAir", label, xr: deathProgressRef.current });
          deathFlashAlpha = 1.0;
          deathShakeAmp = 8;
          deathElapsed = 0;
          overRef.current = true;
          dyingRef.current = true;
          setDying(true);
          playCrash(); stopEngine(); haptics.crash();
        }
      } else {
        crashTimer = 0;
      }

      // 完賽：凍住車身讓縮放全覽時車不掉下去
      if (c.position.x >= track.finishX && !overRef.current) {
        // 飛越終點線時人還在空中（尾段把你彈飛、平坦終點台沒機會真正落地）：
        // 用「當下」狀態強制結算這趟翻轉，不讓完賽提早凍結車身把分數吃掉
        if (!landingSettled) {
          settleFlip(airRotation, airTime, c.angle, c.position.x);
          landingSettled = true;
          points = bonusPoints + maxDistScore;
          finalScoreRef.current = points;
        }
        Body.setStatic(bike.chassis, true);
        Body.setStatic(bike.rearWheel, true);
        Body.setStatic(bike.frontWheel, true);
        setFinished(true);
        playFinish(); stopEngine();
        logEvent("finish", analyticsMode, {
          label, score: points, timeMs: Math.round(raceTimeMs), flips: totalFlips, perfect: perfectLandings,
        });
        checkPb(points);
        onGameOverRef.current?.({ score: points, timeMs: raceTimeMs, flips: totalFlips, perfect: perfectLandings, finished: true, progressPct: 1 });
      }
      return { grounded: groundedNow, upright };
    };

    // [DEV] 手動步進測試鉤子（隱藏分頁 rAF 被暫停時用來驗證物理/計分）
    if (import.meta.env.DEV) {
      (window as unknown as { __test: unknown }).__test = {
        step: (n = 1) => {
          for (let i = 0; i < n; i++) step(STEP);
        },
        press: () => {
          throttle = true;
        },
        release: () => {
          throttle = false;
        },
        reset: () => doReset(),
        state: () => ({
          x: Math.round(bike.chassis.position.x),
          vx: +bike.chassis.velocity.x.toFixed(2),
          ang: Math.round((bike.chassis.angle * 180) / Math.PI),
          grounded: rearContacts > 0 || frontContacts > 0,
          rc: rearContacts,
          fc: frontContacts,
          points,
          perfectFx: perfectFxFrames,
          totalFlips,
          perfectLandings,
          over: overRef.current,
          finishX: track.finishX,
          airRotation,
        }),
      };
    }

    // ---- 渲染（neon）----
    const wx = (x: number) => (x - camX) * scale;
    const wy = (y: number) => (y - camY) * scale;

    // 夜景城市天際線（視差 0.12x，模組化循環 BPERIOD px）
    const drawCityBg = () => {
      const rawOffset = camX * 0.12;
      const offset = ((rawOffset % BPERIOD) + BPERIOD) % BPERIOD;
      ctx.save();
      for (let rep = -1; rep <= 1; rep++) {
        const baseX = rep * BPERIOD - offset;
        for (const b of cityBuildings) {
          const sx = baseX + b.x;
          if (sx + b.w < -10 || sx > W + 10) continue;
          const bh = b.hFrac * H;
          const sy = H - bh;
          // 建築剪影
          ctx.fillStyle = "#06091a";
          ctx.fillRect(sx, sy, b.w, bh + 2);
          // 頂線霓虹光暈
          ctx.strokeStyle = "rgba(45,226,230,0.18)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + b.w, sy);
          ctx.stroke();
          // 窗燈
          for (const win of b.windows) {
            const wx2 = sx + win.lx;
            const wy2 = sy + win.lyFrac * bh;
            ctx.fillStyle = win.color;
            ctx.fillRect(wx2, wy2, 3, 4);
          }
        }
      }
      ctx.restore();
    };

    const drawTrack = () => {
      const v = track.vertices;
      ctx.save();
      // 視覺 A：每段填滿成 K 棒柱（漲紅/跌綠/平青），上緣 = 折線、往下填到畫面底。
      // 與物理梯形碰撞體同形，所見即所撞。
      for (let i = 0; i < v.length - 1; i++) {
        const col = track.colors[i];
        const x1 = wx(v[i].x), y1 = wy(v[i].y);
        const x2 = wx(v[i + 1].x), y2 = wy(v[i + 1].y);
        const top = Math.min(y1, y2);
        const fillTop = col === COLOR.trackUp ? COLOR.fillUpTop
          : col === COLOR.trackDown ? COLOR.fillDownTop
          : COLOR.fillFlatTop;
        const fillBot = col === COLOR.trackUp ? COLOR.fillUpBot
          : col === COLOR.trackDown ? COLOR.fillDownBot
          : COLOR.fillFlatBot;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x2, H);
        ctx.lineTo(x1, H);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, top, 0, H);
        grad.addColorStop(0, fillTop);
        grad.addColorStop(1, fillBot);
        ctx.fillStyle = grad;
        ctx.fill();
      }
      // 霓虹折線（漲=紅/跌=綠，連續同色段合為一條 path 減少 draw call）
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowBlur = 0;
      let si = 0;
      while (si < v.length - 1) {
        const col = track.colors[si];
        const glow = col === COLOR.trackUp ? COLOR.trackUpGlow
          : col === COLOR.trackDown ? COLOR.trackDownGlow
          : COLOR.trackGlow;
        ctx.beginPath();
        ctx.moveTo(wx(v[si].x), wy(v[si].y));
        while (si < v.length - 1 && track.colors[si] === col) {
          ctx.lineTo(wx(v[si + 1].x), wy(v[si + 1].y));
          si++;
        }
        // 光暈層（寬半透明線，取代 shadowBlur）
        ctx.strokeStyle = glow;
        ctx.lineWidth = 10;
        ctx.globalAlpha = 0.35;
        ctx.stroke();
        // 實線層
        ctx.strokeStyle = col;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 1;
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawFlag = (x: number, y: number, color: string, label: string) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wx(x), wy(y));
      ctx.lineTo(wx(x), wy(y) - 60);
      ctx.stroke();
      ctx.fillRect(wx(x), wy(y) - 60, 34, 18);
      ctx.fillStyle = "#05080f";
      ctx.font = "bold 11px system-ui";
      ctx.fillText(label, wx(x) + 3, wy(y) - 47);
      ctx.restore();
    };

    const drawWheel = (px: number, py: number, angle: number, r: number) => {
      ctx.save();
      ctx.translate(wx(px), wy(py));
      ctx.rotate(angle);
      const sr = r * scale; // 依鏡頭縮放比例縮小輪子
      ctx.beginPath();
      ctx.arc(0, 0, sr, 0, Math.PI * 2);
      ctx.fillStyle = "#0a0f18";
      ctx.fill();
      ctx.strokeStyle = COLOR.bikeGlow;
      ctx.lineWidth = 7 * scale;
      ctx.globalAlpha = 0.4;
      ctx.stroke();
      ctx.strokeStyle = COLOR.wheel;
      ctx.lineWidth = 2.5 * scale;
      ctx.globalAlpha = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, sr * 0.34, 0, Math.PI * 2);
      ctx.moveTo(0, 0);
      ctx.lineTo(sr, 0);
      ctx.lineWidth = 1.4 * scale;
      ctx.stroke();
      ctx.restore();
    };

    // 霓虹賽車側面輪廓（Rider 風格，無人，前低後高扁平跑車）
    // local space：+x 朝前，y 負朝上。物理輪心 ≈ (±35, +13) — 輪子另畫於 ctx.restore() 後
    const drawBike = (alpha: number) => {
      const c = bike.chassis;
      const cx = prevChassisPos.x + (c.position.x - prevChassisPos.x) * alpha;
      const cy = prevChassisPos.y + (c.position.y - prevChassisPos.y) * alpha;
      const cAngle = prevChassisAngle + (c.angle - prevChassisAngle) * alpha;

      // 有貼圖：整張圖（含輪）貼到車身，不另畫向量輪（決定①：輪子不轉）
      if (bikeEntry.ready) {
        const w = bikeSpriteW;
        const h = w * (bikeEntry.img.naturalHeight / bikeEntry.img.naturalWidth);
        const sw = w * scale; // 隨鏡頭縮放（overview 時縮小，不遮賽道）
        const sh = h * scale;
        ctx.save();
        ctx.translate(wx(cx), wy(cy));
        ctx.rotate(cAngle);
        ctx.filter = bikeFilter;
        ctx.drawImage(
          bikeEntry.img,
          (-w / 2 + bikeOffsetX) * scale,
          (-h / 2 + bikeOffsetY) * scale,
          sw,
          sh,
        );
        ctx.restore();
        return;
      }

      ctx.save();
      ctx.translate(wx(cx), wy(cy));
      ctx.rotate(cAngle);
      ctx.scale(0.52 * scale, 0.52 * scale);

      ctx.shadowBlur = 0;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // ── 車體主輪廓（後高前低楔形）───────────────────────────
      // 物理輪心在 (±35, +13)，輪頂在 y=+2，車底在 y=+6 略高於輪頂 → 車身低伏壓輪
      ctx.beginPath();
      ctx.moveTo(-44, 6);    // 後底
      ctx.lineTo(-44, -8);   // 後壁直立
      ctx.lineTo(-34, -24);  // 後頂斜
      ctx.lineTo(-8, -28);   // 頂部後段（最高點）
      ctx.lineTo(16, -26);   // 頂部前段
      ctx.lineTo(38, -14);   // 車鼻斜面
      ctx.lineTo(44, -2);    // 車鼻尖
      ctx.lineTo(38, 6);     // 車鼻底
      ctx.lineTo(26, 6);     // 前底板
      ctx.lineTo(-26, 6);    // 後底板
      ctx.closePath();
      ctx.fillStyle = "rgba(255, 179, 0, 0.14)";
      ctx.fill();
      // 光暈層
      ctx.strokeStyle = COLOR.bikeGlow;
      ctx.lineWidth = 10;
      ctx.globalAlpha = 0.45;
      ctx.stroke();
      // 實線層
      ctx.strokeStyle = COLOR.bike;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 1;
      ctx.stroke();

      // ── 座艙暗玻璃（無人，純造型）──────────────────────────
      ctx.beginPath();
      ctx.moveTo(-28, -24);  // 艙後底（接後頂斜面）
      ctx.lineTo(-20, -32);  // 艙後頂
      ctx.lineTo(10, -28);   // 艙前頂
      ctx.lineTo(16, -24);   // 艙前底（接頂部前段）
      ctx.closePath();
      ctx.fillStyle = "rgba(5, 10, 20, 0.82)";
      ctx.fill();
      ctx.strokeStyle = COLOR.bike;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // ── 前頭燈（車鼻 LED 亮點）──────────────────────────────
      ctx.beginPath();
      ctx.moveTo(40, -10);
      ctx.lineTo(44, -2);
      ctx.lineTo(40, -2);
      ctx.strokeStyle = COLOR.bikeGlow;
      ctx.lineWidth = 5;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.strokeStyle = COLOR.bike;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 1;
      ctx.stroke();

      ctx.restore();

      // 輪子（插值位置，在主 transform 外畫）
      drawWheel(
        prevRearPos.x + (bike.rearWheel.position.x - prevRearPos.x) * alpha,
        prevRearPos.y + (bike.rearWheel.position.y - prevRearPos.y) * alpha,
        prevRearAngle + (bike.rearWheel.angle - prevRearAngle) * alpha,
        bike.rearWheel.circleRadius!,
      );
      drawWheel(
        prevFrontPos.x + (bike.frontWheel.position.x - prevFrontPos.x) * alpha,
        prevFrontPos.y + (bike.frontWheel.position.y - prevFrontPos.y) * alpha,
        prevFrontAngle + (bike.frontWheel.angle - prevFrontAngle) * alpha,
        bike.frontWheel.circleRadius!,
      );
    };

    // 完美落地雙輪特效：兩輪各冒一圈擴散光環 + 放射火花
    const drawPerfectFx = () => {
      if (perfectFxFrames <= 0) return;
      const p = 1 - perfectFxFrames / 30; // 0→1 進度
      ctx.save();
      for (const pt of perfectFxPts) {
        const sx = wx(pt.x);
        const sy = wy(pt.y);
        const r = 6 + p * 28;
        ctx.strokeStyle = COLOR.start; // cyan
        ctx.shadowBlur = 0;
        // 光環（光暈 + 實線）
        ctx.lineWidth = 8;
        ctx.globalAlpha = (1 - p) * 0.3;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1 - p;
        ctx.stroke();
        // 放射火花
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
          ctx.beginPath();
          ctx.moveTo(sx + Math.cos(a) * r * 0.6, sy + Math.sin(a) * r * 0.6);
          ctx.lineTo(sx + Math.cos(a) * r * 1.2, sy + Math.sin(a) * r * 1.2);
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    // 結算用股價迷你圖：直接用原始 prices[] 在螢幕中段畫折線，比例與物理世界無關
    const drawMinimap = () => {
      if (prices.length < 2) return;
      const padX = 28;
      const topY = H * 0.33;
      const botY = H * 0.70;
      const mapW = W - padX * 2;
      const mapH = botY - topY;
      const vpad = mapH * 0.08; // 上下各 8% 留白，線不貼邊
      const minP = Math.min(...prices);
      const maxP = Math.max(...prices);
      const span = maxP - minP || 1;
      const toX = (i: number) => padX + (i / (prices.length - 1)) * mapW;
      const toY2 = (p: number) => botY - vpad - ((p - minP) / span) * (mapH - 2 * vpad);

      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // 漸層填色
      ctx.beginPath();
      ctx.moveTo(toX(0), toY2(prices[0]));
      for (let i = 1; i < prices.length; i++) ctx.lineTo(toX(i), toY2(prices[i]));
      ctx.lineTo(toX(prices.length - 1), botY);
      ctx.lineTo(toX(0), botY);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, topY, 0, botY);
      grad.addColorStop(0, "rgba(45,226,230,0.07)");
      grad.addColorStop(1, "rgba(45,226,230,0)");
      ctx.fillStyle = grad;
      ctx.fill();

      // 開盤基準線
      const refPrice = prices[0];
      const refY = toY2(refPrice);
      ctx.beginPath();
      ctx.moveTo(padX, refY);
      ctx.lineTo(padX + mapW, refY);
      ctx.strokeStyle = "rgba(180,180,180,0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // 霓虹折線：相對開盤價 → 高於開盤=紅(漲)/低於開盤=綠(跌)/持平=青
      for (let i = 0; i < prices.length - 1; i++) {
        const mid = (prices[i] + prices[i + 1]) / 2;
        const col =
          mid > refPrice ? COLOR.trackUp
          : mid < refPrice ? COLOR.trackDown
          : COLOR.track;
        const glow =
          col === COLOR.trackUp ? COLOR.trackUpGlow
          : col === COLOR.trackDown ? COLOR.trackDownGlow
          : COLOR.trackGlow;
        const x1 = toX(i), y1 = toY2(prices[i]);
        const x2 = toX(i + 1), y2 = toY2(prices[i + 1]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = glow;
        ctx.lineWidth = 7;
        ctx.globalAlpha = 0.3;
        ctx.stroke();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.globalAlpha = 1;
        ctx.stroke();
      }
      ctx.restore();
    };

    const render = (alpha: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // 夜景城市背景（走勢圖模式下也畫，增加質感）
      drawCityBg();

      if (overRef.current && showChartRef.current) {
        // 走勢圖模式：純折線圖，賽道不渲染
        drawMinimap();
      } else {
        // 賽道模式（遊戲中 + 結算賽道視角 + 死亡動畫）
        drawTrack();
        // 全服死亡熱點 ☠️（每日賽）：漂浮在地形上方，數字 = 今日陣亡人次
        if (heatSpots.length > 0) {
          ctx.save();
          ctx.textAlign = "center";
          for (const s of heatSpots) {
            const sx = wx(s.x);
            if (sx < -40 || sx > W + 40) continue;
            const sy = wy(terrainYAt(track, s.x) - 46);
            ctx.globalAlpha = 0.8;
            ctx.font = `${Math.max(10, 15 * scale)}px sans-serif`;
            ctx.fillText("☠️", sx, sy);
            ctx.globalAlpha = 0.6;
            ctx.fillStyle = "#ff4dff";
            ctx.font = `${Math.max(8, 10 * scale)}px sans-serif`;
            ctx.fillText(`×${s.deaths}`, sx, sy + 13 * scale);
          }
          ctx.restore();
        }
        drawFlag(track.vertices[0].x, track.vertices[0].y, COLOR.start, "START");
        drawFlag(track.finishX, track.vertices[track.vertices.length - 1].y, COLOR.finish, "FIN");
        drawBike(alpha);
        drawPerfectFx();
        // 死亡特效：粒子爆炸（A）+ 白色閃光（B）
        if (dyingRef.current) {
          ctx.save();
          for (const p of deathParticles) {
            if (p.life <= 0) continue;
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(wx(p.x), wy(p.y), Math.max(1, p.size * scale), 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
          if (deathFlashAlpha > 0.01) {
            ctx.save();
            ctx.globalAlpha = deathFlashAlpha;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
          }
        }
      }
    };

    // ---- 主迴圈（固定步進累加器）----
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    let lastResetSignal  = resetSignal.current;
    let lastReviveSignal = reviveSignal.current;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (resetSignal.current !== lastResetSignal) {
        lastResetSignal = resetSignal.current;
        doReset();
        last = now;
        acc = 0;
      }
      if (reviveSignal.current !== lastReviveSignal) {
        lastReviveSignal = reviveSignal.current;
        doRevive();
        last = now;
        acc = 0;
      }
      // 暫停：不步進物理、不累計時間，僅維持畫面（last=now 防止恢復時 dt 暴衝）
      if (pausedRef.current && !overRef.current) {
        last = now;
        render(Math.min(acc / STEP, 1));
        return;
      }
      let dt = now - last;
      last = now;
      if (dt > 60) dt = 60; // 防止分頁切回時爆衝
      if (!overRef.current && !waitingToStart) raceTimeMs += dt;
      acc += dt;

      let grounded = false;
      while (acc >= STEP) {
        const r = step(STEP);
        grounded = r.grounded;
        acc -= STEP;
      }
      if (!overRef.current && !pausedRef.current) {
        // getVelocity = per-baseDelta（每幀位移），引擎聲的速度對應關係不受子步數影響
        const v = Body.getVelocity(bike.chassis);
        updateEngine(Math.hypot(v.x, v.y), grounded);
      }

      // 鏡頭跟隨 / 終點全覽（dying 時鏡頭凍住，等動畫結束再開始縮放）
      const c = bike.chassis;
      if (overRef.current && !dyingRef.current) {
        if (!overviewComputed) {
          const trackW = track.finishX;
          const trackH = track.maxY - track.minY + 60; // +60 for flags
          targetScale = Math.min((W - 80) / trackW, (H - 100) / trackH);
          overviewCamX = trackW / 2 - W / (2 * targetScale);
          overviewCamY = (track.minY - 60 + track.maxY) / 2 - H / (2 * targetScale);
          overviewComputed = true;
        }
        scale += (targetScale - scale) * 0.04;
        camX += (overviewCamX - camX) * 0.04;
        camY += (overviewCamY - camY) * 0.04;
      } else if (!overRef.current) {
        const tx = c.position.x - W * CAMERA.offsetXRatio;
        const ty = c.position.y - H * CAMERA.offsetYRatio;
        camX += (Math.max(0, tx) - camX) * CAMERA.ease;
        camY += (ty - camY) * CAMERA.ease;
      }
      // else: dying=true → 鏡頭靜止，保持爆炸現場在畫面中

      // 死亡動畫更新
      if (dyingRef.current) {
        const dtSec = Math.min(dt, 60) / 1000;
        deathElapsed += dtSec;
        for (const p of deathParticles) {
          if (p.life <= 0) continue;
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.1; // 粒子重力（慢，讓 1.5s 內不落出畫面）
          p.life -= dtSec / DEATH_DUR;
        }
        deathFlashAlpha *= 0.72; // 白閃約 3 幀淡出
        deathShakeAmp *= 0.82;   // 震動逐漸衰減
        if (deathElapsed >= DEATH_DUR) {
          dyingRef.current = false;
          setDying(false);
          setCrashed(true);
          checkPb(points);
          onGameOverRef.current?.({ score: points, timeMs: raceTimeMs, flips: totalFlips, perfect: perfectLandings, finished: false, progressPct: deathProgressRef.current });
        }
      }
      // 鏡頭震動（暫時偏移，渲染後還原，不汙染 camX/camY 平滑狀態）
      const shakeDx = dyingRef.current && deathShakeAmp > 0.5 ? (Math.random() * 2 - 1) * deathShakeAmp : 0;
      const shakeDy = dyingRef.current && deathShakeAmp > 0.5 ? (Math.random() * 2 - 1) * deathShakeAmp : 0;
      camX += shakeDx; camY += shakeDy;
      const alpha = Math.min(acc / STEP, 1);
      render(alpha);
      camX -= shakeDx; camY -= shakeDy;
      if (perfectFxFrames > 0) perfectFxFrames--;

      // HUD（節流更新，避免每幀 setState）
      if (++hudTick % 5 === 0) {
        const dist = Math.max(
          0,
          Math.round((c.position.x - bike.spawn.x) / 20),
        );
        const flips = Math.floor(Math.abs(airRotation) / (2 * Math.PI));
        setHud({
          distance: dist,
          points,
          airborne: !grounded,
          airFlips: flips,
          throttle,
          timer: fmtTime(raceTimeMs),
          totalFlips,
          perfectLandings,
        });
      }
    };
    // startEngine() 在 press() 內首次觸碰時才呼叫（需要使用者手勢才能啟動 AudioContext）
    raf = requestAnimationFrame(frame);

    // ---- 清理 ----
    return () => {
      stopEngine();
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", resize);
      stopWakeLock();
      Events.off(engine, "collisionStart", collStart);
      Events.off(engine, "collisionEnd", collEnd);
      Engine.clear(engine);
    };
  }, [prices]);

  // 攔截裝置返回鍵（Android/TWA 的實體返回 → popstate）：遊戲中按返回 → 跳確認，不直接離開
  useEffect(() => {
    window.history.pushState({ taiexGame: true }, "");
    const onPop = () => {
      if (overRef.current) {
        onExit(); // 已結算畫面：返回直接回主選單
        return;
      }
      setConfirmExit(true);
      window.history.pushState({ taiexGame: true }, ""); // 重新攔住，停在遊戲
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onExit]);

  return (
    <div className="game-root">
      <canvas ref={canvasRef} className="game-canvas" />

      {DevTuner && <Suspense fallback={null}><DevTuner /></Suspense>}

      {/* 分數：螢幕正中央偏上（結算/死亡動畫時隱藏）*/}
      {!crashed && !finished && !dying && (
        <div className="score-center">
          <div className="score-num">{hud.points}</div>
          {hud.airborne && hud.airFlips > 0 && (
            <div className="score-air">空中 {hud.airFlips} 圈</div>
          )}
          <div className="score-timer">{hud.timer}</div>
        </div>
      )}

      {/* 角落小資訊 + 設定鈕 + 返回鈕：結算/死亡動畫時隱藏*/}
      {!crashed && !finished && !dying && (
        <>
          <div className="hud-corner">
            <div>{label} {name}</div>
            {subtitle && <div className="hud-sub">{subtitle}</div>}
            <div className="hud-stars">{"★".repeat(stars)}{"☆".repeat(5 - stars)}</div>
            <div>距離 {hud.distance}m</div>
          </div>
          <button className="icon-btn settings-btn" onClick={() => setShowSettings(true)} aria-label="設定">
            ⚙
          </button>
          <button className="exit-btn" onClick={() => setConfirmExit(true)}>
            返回主選單
          </button>
          <button className="pause-btn" onClick={() => setPaused((p) => !p)}>
            {paused ? "▶ 繼續" : "❚❚ 暫停"}
          </button>
        </>
      )}

      {/* 暫停遮罩（點任意處繼續）*/}
      {paused && !crashed && !finished && !dying && !confirmExit && !showSettings && (
        <div className="overlay" onClick={() => setPaused(false)}>
          <div className="overlay-title">已暫停</div>
          <div className="settings-row dim">點擊任意處繼續</div>
        </div>
      )}

      {/* 返回主選單確認（遊玩中按返回 / 裝置返回鍵）*/}
      {confirmExit && (
        <div className="overlay" onClick={() => setConfirmExit(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <div className="overlay-title">離開賽道？</div>
            <div className="settings-row dim">
              {analyticsMode === "daily"
                ? "本次挑戰次數將直接作廢，不會歸還"
                : "目前成績不會保存"}
            </div>
            <button className="overlay-btn" onClick={onExit}>
              確定離開
            </button>
            <button className="overlay-btn ghost" onClick={() => setConfirmExit(false)}>
              繼續遊玩
            </button>
          </div>
        </div>
      )}

      {/* 得分提示（後空翻 / 完美落地）*/}
      {toast && (
        <div key={toast.id} className="toast">
          {toast.text}
        </div>
      )}

      {showStartPrompt && !crashed && !finished && !dying && (
        <div className="start-prompt">
          <div className="start-prompt-text">觸碰螢幕開始</div>
          <div className="start-prompt-sub">TAP TO RIDE</div>
        </div>
      )}

      {!crashed && !finished && !showStartPrompt && <div className={`throttle-dot ${hud.throttle ? "on" : ""}`} />}

      {!crashed && !finished && !showStartPrompt && <div className="ctrl-hint">按住畫面 = 前進 ・ 空中按住 = 後空翻</div>}

      {showSettings && (
        <div className="overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <div className="overlay-title">設定</div>
            <div className="settings-volume-row">
              <span className="settings-volume-label">音量</span>
              <input
                type="range"
                className="settings-volume-slider"
                min={0} max={100} step={5}
                value={volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolumeState(v);
                  setVolume(v / 100);
                }}
              />
              <span className="settings-volume-val">{volume}%</span>
            </div>
            <div className="settings-row dim">版本 v{APP_VERSION}</div>
            <button className="overlay-btn ghost" onClick={() => setShowSettings(false)}>
              關閉
            </button>
          </div>
        </div>
      )}

      {(crashed || finished) && (
        <div className="overlay-result" style={resultReady ? undefined : { pointerEvents: "none" }}>
          <div className="overlay-top">
            <div className="overlay-title">{finished ? "完賽！" : "摔車"}</div>
            <div className="overlay-track-name">{label} {name}</div>
            {subtitle && <div className="overlay-track-sub">{subtitle}</div>}
            <div className="overlay-score">{displayScore} 分</div>
            {newPb && <div className="overlay-pb">🎉 新個人紀錄！</div>}
            {/* 每日排名賽即時名次：App.tsx 提交成功後非同步算出才會有值，晚個半秒才彈出屬正常 */}
            {dailyRank != null && <div className="overlay-rank">🏆 目前排名第 {dailyRank} 名</div>}
            <div className="overlay-time">{hud.timer}</div>
            <div className="overlay-stats">
              翻轉 {hud.totalFlips} 圈 ・ 完美落地 {hud.perfectLandings} 次
            </div>
            {completedQuests.length > 0 && (
              <div className="overlay-quests">
                {completedQuests.map((q, i) => (
                  <div key={i} className="overlay-quest-item">✅ {q.title} +{q.reward}💰</div>
                ))}
              </div>
            )}
            {coinRewardEligible && (() => {
              const baseReward = computePlayReward(isLongMarch, finished, finished ? 1 : deathProgressRef.current);
              const shownReward = adDoubleState === "claimed" ? baseReward * 2 : baseReward;
              return (
                <div className="overlay-play-reward">
                  <span className="overlay-play-reward-amount">
                    本局收益 {shownReward} 金幣{adDoubleState === "claimed" && " ✓"}
                  </span>
                  {adDoubleState !== "claimed" && (
                    <button
                      className="overlay-ad-coins-btn"
                      disabled={adDoubleState === "watching"}
                      onClick={handleWatchAdDouble}
                    >
                      {adDoubleState === "watching"
                        ? "廣告播放中…"
                        : adsRemoved
                          ? "🎁 領取 獎勵 ×2"
                          : "📺 觀看廣告 獎勵 ×2"}
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
          {/* 中段透明點擊區：切換賽道 / 走勢圖（長征模式無單一走勢圖，隱藏切換） */}
          {!hideMinimap ? (
            <div
              className="chart-toggle-area"
              onClick={() => setShowChart((s) => !s)}
            >
              <span className="chart-toggle-hint">
                {showChart ? "← 賽道" : "走勢圖 →"}
              </span>
            </div>
          ) : (
            <div className="chart-toggle-area" style={{ cursor: "default" }} />
          )}
          <div className="overlay-bottom">
            {revivalEnabled ? (
              <>
                {crashed && !revivalUsed && (
                  <button
                    className="overlay-btn ad-btn"
                    disabled={reviveWatching}
                    onClick={handleWatchAdRevive}
                  >
                    {adsRemoved ? "復活" : reviveWatching ? "廣告播放中…" : "看廣告復活"}
                  </button>
                )}
                <button className="overlay-btn share-btn" onClick={shareScore}>📤 分享成績</button>
                <button className="overlay-btn ghost" onClick={onExit}>
                  返回排名賽
                </button>
              </>
            ) : (
              <>
                <button className="overlay-btn" onClick={requestReset}>再玩一次</button>
                <button className="overlay-btn share-btn" onClick={shareScore}>📤 分享成績</button>
                <button className="overlay-btn ghost" onClick={onExit}>返回主選單</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
