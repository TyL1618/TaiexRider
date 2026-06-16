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
  flatBottomW: 80,  // V 谷夾角 < 90° 時插入的平底寬度 (px)，約一個車身長
} as const;

// 車輛＝摩托車（chassis = 車架物理體；drawBike 貼 public/bike.png，缺檔則畫向量備援）
export const BIKE = {
  chassisW: 48,
  chassisH: 10,
  chassisRadius: 10, // 圓形物理體半徑（替代矩形，避免坡頂稜角抖動與自動翻正）
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
  // ── 定速引擎（Rider 風格街機手感，刻意「非真實物理」）──
  // 著地按住 → 沿「前後輪所踩地形連線(弦)」方向鎖速（只改切線分量、保留垂直分量）：
  //   任何坡都爬得上、上下坡平地同速；過坡頂保留垂直速度＝自然飛出去。
  // 用兩輪取坡而非車身中心 → 前輪一上陡坡整台車跟著轉上去（不會用鼻頭水平爬）。
  cruiseSpeed: 6.912, // 沿坡面鎖定速度 (px/step)，5.76×1.2
  groundLockEase: 0.7, // 速度趨近 cruiseSpeed 的平滑度 (0~1)，越大越快收斂（0.7≈3步內達速，減少折點burst感）
groundAlignGain: 0.3, // 著地時車身角速度朝「坡面切線」修正的比例（平滑貼地，治本翹頭/落地翻車）
  groundedAvMax: 0.15, // 著地角速度上限（貼坡速度；新驅動不再硬設方向→目標可達，不會狂轉翻過頭）
  airSpinAccel: 0.024, // 空中「按住」後空翻每 step 逼近量
  airSpinMax: 0.192, // 後空翻最大角速度
  airSpinBrakeAccel: 0.06, // 空中「放開」後翻制動力（每 step 朝0推進量，≈4步從最大速停下）
  airNoseForwardAccel: 0.0006, // 空中「放開」車頭往前壓每 step 逼近量（很緩，備降）
  airNoseForwardMax: 0.008, // 空中車頭前壓最大角速度
} as const;

export const RULES = {
  // 落地判定為「正面朝上」的容許角度（車身上向量與世界上向量夾角內）
  uprightCosThreshold: 0.55, // cosθ > 此值算正立 (≈ 57°內)
  crashUpsideDownSec: 1.0, // 翻倒持續幾秒判定摔車
  flipBaseScore: 100, // 第1圈分數
  flipScoreStep: 150, // 每多一圈遞增量 (1圈100/2圈250/3圈450...)
  minAirSec: 0.3, // 騰空超過幾秒才算「真實跳躍」（過濾微跳）
  perfectBonus: 200, // 完美落地獎勵
  perfectLevelRad: 0.55, // 落地時車身與坡面夾角 < 此值(≈31°)算完美
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
