// ============================================================
// 可調參數集中區 — 遊戲手感幾乎都在這裡微調
// Phase 1 prototype：數值先求「能玩、好調」，手感請邊玩邊回報一起 tune
// ============================================================

export const TRACK = {
  segmentWidth: 95, // 每個資料點的水平間距 (px)
  heightRange: 340, // 基準 heightRange（對應 REF_PCT=3% 的單步漲幅）
  heightMin: 180,   // 最平穩賽道的最小高度（不讓 TAIEX 完全變水平）
  heightMax: 600,   // 最狂野賽道的高度上限
  baselineY: 560, // 賽道基準線 (世界座標 y，越大越下面)
  startFlat: 4, // 起點平台補幾個平坦點
  endFlat: 3, // 終點平台補幾個平坦點
  // 斜率限制：相鄰兩點高度差上限 = tan(maxSlopeDeg) * segmentWidth
  // 放寬到 60° 讓漲停/跌停級的尖峰形成真正的跳台 kicker
  maxSlopeDeg: 60,
} as const;

// 車輛＝敞篷跑車（低重心、寬輪距 → 較穩；輪子較小）
export const BIKE = {
  chassisW: 92, // 車身較長
  chassisH: 20,
  wheelRadius: 11, // 跑車小輪
  wheelBaseHalf: 34, // 前後輪距車身中心的水平距離（寬輪距=穩）
  wheelDropY: 13, // 輪軸相對車身中心往下的距離
  chassisDensity: 0.0016,
  wheelDensity: 0.0012,
  wheelFriction: 0.95,
  wheelFrictionStatic: 0.9, // 過高(>3)輪子會黏住不滾動
  chassisFrictionAir: 0.012,
  wheelFrictionAir: 0.012,
  axleStiffness: 0.9, // 輪軸剛性 (1=完全剛體，過高會抖)
} as const;

export const DRIVE = {
  // 著地時：沿車身朝向施加前進力（force=mass*accel，效果≈每step加速度）
  accel: 0.0022, // 微加（保證上坡基礎推力）
  maxSpeed: 16, // 車身水平速度上限 (px/step)
  uphillBoost: 2.0, // 上坡低速時的驅動力倍數（保證任何坡都爬得上）
  rearWheelSpin: 0.014, // 後輪驅動扭矩 (讓輪子實際轉動、視覺與抓地)
  // 空中後翻：直接以角速度(rad/step)控制，逼近目標角速度（負=逆時針=後空翻）
  airSpinAccel: 0.006, // 每 step 朝目標角速度逼近的量
  airSpinMax: 0.12, // 後翻最大角速度
  // 騰空寬限：離地連續超過這麼多 step（≈0.07s）才開始後翻，
  // 避免小坡細微彈跳就被觸發後翻；數字越小後翻反應越靈敏
  airSpinDelaySteps: 4,
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
