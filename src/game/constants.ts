// ============================================================
// 可調參數集中區 — 遊戲手感幾乎都在這裡微調
// Phase 1 prototype：數值先求「能玩、好調」，手感請邊玩邊回報一起 tune
// ============================================================

export const TRACK = {
  segmentWidth: 120, // 每個資料點的水平間距 (px)
  heightRange: 340,  // 基準 heightRange（對應 REF_PCT=3% 的單步漲幅）
  heightMin: 250,    // 最平穩賽道的最小高度（不讓 TAIEX 完全變水平）
  heightMax: 1000,   // 最狂野賽道的高度上限
  baselineY: 560, // 賽道基準線 (世界座標 y，越大越下面)
  startFlat: 4, // 起點平台補幾個平坦點
  endFlat: 3, // 終點平台補幾個平坦點
  // 斜率限制：相鄰兩點高度差上限 = tan(maxSlopeDeg) * segmentWidth
  maxSlopeDeg: 75,
} as const;

// 車輛＝摩托車（chassis = 車架物理體；drawBike 繪製摩托車外觀）
export const BIKE = {
  chassisW: 48, // 車身（縮至 52%，接近 Rider 比例）
  chassisH: 10,
  wheelRadius: 6, // 跑車小輪
  wheelBaseHalf: 18, // 前後輪距車身中心的水平距離
  wheelDropY: 7, // 輪軸相對車身中心往下的距離
  chassisDensity: 0.0016,
  wheelDensity: 0.0012,
  wheelFriction: 0.95,
  wheelFrictionStatic: 0.9, // 過高(>3)輪子會黏住不滾動
  chassisFrictionAir: 0.012,
  wheelFrictionAir: 0.012,
  axleStiffness: 0.9, // 輪軸剛性 (1=完全剛體，過高會抖)
} as const;

export const DRIVE = {
  // ── 定速模型（Rider 風格）──
  // 著地時直接把水平速度鎖定為定值（不用 force 驅動），所以：
  // 任何坡都恆速爬得上、永遠不卡頓、不會 wheelie 後翻。
  cruiseSpeed: 15, // 按住時鎖定的「沿坡面」速度 (px/step)，越大越快
  groundLockEase: 0.3, // 速度趨近 cruiseSpeed 的平滑度 (0~1)，避免落地瞬間硬切
  rideableCos: 0.3, // 著地定速鎖定的門檻：cos(車身角) > 此值才鎖（≈72°內都算貼坡，避免陡坡失鎖）
  groundedAvMax: 0.28, // 著地時角速度上限（允許跟坡緩轉，阻止翻滾累積）
  airSpinAccel: 0.010, // 每 step 朝目標角速度逼近的量
  airSpinMax: 0.22, // 後翻最大角速度（×2，讓翻轉感明顯）
} as const;

export const RULES = {
  // 落地判定為「正面朝上」的容許角度（車身上向量與世界上向量夾角內）
  uprightCosThreshold: 0.55, // cosθ > 此值算正立 (≈ 57°內)
  crashUpsideDownSec: 2.0, // 輪朝上持續幾秒判定摔車 (DEVDOC 5.4)
  flipBaseScore: 100, // 第1圈分數
  flipScoreStep: 150, // 每多一圈遞增量 (1圈100/2圈250/3圈450...)
  minAirSec: 0.3, // 騰空超過幾秒才算「真實跳躍」（過濾微跳）
  perfectBonus: 200, // 完美落地獎勵
  perfectLevelRad: 0.5, // 落地時車身與水平夾角 < 此值(≈28°)算完美（≈雙輪幾乎同時觸地）；越小越嚴格
} as const;

export const CAMERA = {
  offsetXRatio: 0.34, // 車子保持在畫面靠左約 1/3 處
  offsetYRatio: 0.52,
  ease: 0.12, // 鏡頭跟隨平滑度 (0~1，越大越緊)
} as const;

// neon 賽博龐克調色（與 index.css 變數對應）
export const COLOR = {
  track: "#2de2e6",        // 平盤 / 起終點 cyan
  trackGlow: "rgba(45, 226, 230, 0.55)",
  trackUp: "#ff2244",      // 漲 neon 紅（台股慣例）
  trackUpGlow: "rgba(255, 34, 68, 0.55)",
  trackDown: "#00ff88",    // 跌 neon 綠
  trackDownGlow: "rgba(0, 255, 136, 0.55)",
  fillTop: "rgba(45, 226, 230, 0.10)",
  fillBottom: "rgba(45, 226, 230, 0.0)",
  bike: "#ffb300",
  bikeGlow: "rgba(255, 179, 0, 0.6)",
  wheel: "#cdd9e5",
  start: "#2de2e6",
  finish: "#ffb300",
} as const;
