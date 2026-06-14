// ============================================================
// 可調參數集中區 — 遊戲手感幾乎都在這裡微調
// Phase 1 prototype：數值先求「能玩、好調」，手感請邊玩邊回報一起 tune
// ============================================================

export const TRACK = {
  segmentWidth: 95, // 每個資料點的水平間距 (px)
  heightRange: 280, // 價格 min~max 對應的垂直高度 (px)
  baselineY: 560, // 賽道基準線 (世界座標 y，越大越下面)
  startFlat: 4, // 起點平台補幾個平坦點
  endFlat: 3, // 終點平台補幾個平坦點
  // 斜率限制：相鄰兩點高度差上限 = tan(maxSlopeDeg) * segmentWidth
  // 超過就夾平，確保一定爬得上去（陡牆設計之後再開放）
  maxSlopeDeg: 52,
} as const;

export const BIKE = {
  chassisW: 72,
  chassisH: 16,
  wheelRadius: 14,
  wheelBaseHalf: 27, // 前後輪距離車身中心的水平距離
  wheelDropY: 16, // 輪軸相對車身中心往下的距離
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
  accel: 0.0016,
  maxSpeed: 13, // 車身水平速度上限 (px/step)，避免暴衝
  rearWheelSpin: 0.012, // 後輪驅動扭矩 (讓輪子實際轉動、視覺與抓地)
  // 空中後翻：直接以角速度(rad/step)控制，逼近目標角速度（負=逆時針=後空翻）
  airSpinAccel: 0.012, // 每 step 朝目標角速度逼近的量
  airSpinMax: 0.22, // 後翻最大角速度 (≈2 圈/秒)
} as const;

export const RULES = {
  // 落地判定為「正面朝上」的容許角度（車身上向量與世界上向量夾角內）
  uprightCosThreshold: 0.55, // cosθ > 此值算正立 (≈ 57°內)
  crashUpsideDownSec: 2.0, // 輪朝上持續幾秒判定摔車 (DEVDOC 5.4)
  flipBaseScore: 100, // 第1圈分數
  flipScoreStep: 150, // 每多一圈遞增量 (1圈100/2圈250/3圈450...)
} as const;

export const CAMERA = {
  offsetXRatio: 0.34, // 車子保持在畫面靠左約 1/3 處
  offsetYRatio: 0.52,
  ease: 0.12, // 鏡頭跟隨平滑度 (0~1，越大越緊)
} as const;

// neon 賽博龐克調色（與 index.css 變數對應）
export const COLOR = {
  track: "#2de2e6",
  trackGlow: "rgba(45, 226, 230, 0.55)",
  fillTop: "rgba(45, 226, 230, 0.10)",
  fillBottom: "rgba(45, 226, 230, 0.0)",
  bike: "#ffb300",
  bikeGlow: "rgba(255, 179, 0, 0.6)",
  wheel: "#cdd9e5",
  start: "#2de2e6",
  finish: "#ffb300",
} as const;
