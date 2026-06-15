// ============================================================
// 可調參數集中區 — 遊戲手感幾乎都在這裡微調
// Phase 1 prototype：數值先求「能玩、好調」，手感請邊玩邊回報一起 tune
// ============================================================

export const TRACK = {
  segmentWidth: 80, // 每個資料點的水平間距 (px)，越小坡越陡（Route B 由 120 收窄）
  heightRange: 420,  // 基準 heightRange（對應 REF_PCT 的單步漲幅，越大地形越高）
  heightMin: 250,    // 最平穩賽道的最小高度（不讓 TAIEX 完全變水平）
  heightMax: 1000,   // 最狂野賽道的高度上限
  refPct: 0.022,     // 對應 heightRange 的「基準單步漲幅」，越小越放大地形起伏
  baselineY: 560, // 賽道基準線 (世界座標 y，越大越下面)
  startFlat: 4, // 起點平台補幾個平坦點
  endFlat: 3, // 終點平台補幾個平坦點
  // 斜率限制：相鄰兩點高度差上限 = tan(maxSlopeDeg) * segmentWidth
  maxSlopeDeg: 75,
} as const;

// 車輛＝摩托車（chassis = 車架物理體；drawBike 貼 public/bike.png，缺檔則畫向量備援）
export const BIKE = {
  chassisW: 48, // 車身（縮至 52%，接近 Rider 比例）
  chassisH: 10,
  wheelRadius: 6, // 跑車小輪
  wheelBaseHalf: 22, // 前後輪距車身中心的水平距離（加大→前輪突出車頭，利於頂上坡）
  wheelDropY: 7, // 輪軸相對車身中心往下的距離
  chassisDensity: 0.0016,
  rearWheelDensity: 0.0012, // 後輪＝驅動輪，較輕
  frontWheelDensity: 0.0030, // 前輪加重→重心前移，車頭自然下壓（非自動旋轉，純配重）
  wheelFriction: 0.95,
  wheelFrictionStatic: 0.9, // 過高(>3)輪子會黏住不滾動
  chassisFrictionAir: 0.012,
  wheelFrictionAir: 0.012,
  axleStiffness: 0.9, // 輪軸剛性 (1=完全剛體，過高會抖)
  restitution: 0.05, // 車輪彈性（低→落地不彈跳，穩穩貼地）
  // ── 貼圖（決定①：整張含輪的去背 PNG，輪子不轉）──
  spriteW: 64, // 貼圖寬度 (px)，依物理輪距微調
  spriteOffsetX: 0, // 貼圖相對車身中心水平偏移（修正圖中車體不置中，如左側速度線）
  spriteOffsetY: -2, // 貼圖相對車身中心垂直偏移（輪子在中心下方→圖略上移）
} as const;

export const DRIVE = {
  // ── 真物理模型（Route B，Rider 風格）──
  // 著地按住 → 驅動「後輪」轉速（用 setAngularVelocity，避免 torque 被 ×delta² 爆量）；
  // 只在低於目標轉速時加速 → 下坡靠重力自然超速、保留動量；放開＝滑行（不主動煞車）。
  driveWheelSpin: 1.9, // 後輪目標角速度 (rad/step)，×輪半徑≈巡航速度；越大越快
  driveAccel: 0.08, // 後輪每 step 朝目標轉速逼近量（油門加速感）
  maxSpeed: 22, // 著地速度上限 (px/step)，避免陡下坡暴衝失控
  groundAlignGain: 0.3, // 著地時車身角速度朝「坡面切線」修正的比例（平滑貼地，治本翹頭/落地翻車）
  groundedAvMax: 0.28, // 著地角速度上限（修正量的硬上限，阻止翻滾累積）
  airSpinAccel: 0.030, // 空中後翻每 step 逼近量（由 0.010 加快→短滯空也轉得動）
  airSpinMax: 0.24, // 後翻最大角速度（配合地形變陡＝滯空變長→可轉兩圈）
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
