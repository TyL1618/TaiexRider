// ============================================================
// 可調參數集中區 — 遊戲手感幾乎都在這裡微調
// Phase 1 prototype：數值先求「能玩、好調」，手感請邊玩邊回報一起 tune
// ============================================================

export const TRACK = {
  segmentWidth: 80, // 每個資料點的水平間距 (px)，越小坡越陡（Route B 由 120 收窄）
  heightRange: 420,  // 基準 heightRange（對應 REF_PCT 的單步漲幅，越大地形越高）
  heightMin: 350,    // 最平穩賽道的最小高度（不讓 TAIEX 完全變水平）
  heightMax: 1400,   // 最狂野賽道的高度上限
  refPct: 0.015,     // 對應 heightRange 的「基準單步漲幅」，越小越放大地形起伏
  // 全日振幅（(高-低)/起點）對應 heightRange 的基準（BETA_FEEDBACK #1，v0.12.3）：
  // 盤中 5 分 K 單步漲跌極小，僅靠 refPct 幾乎所有盤中賽道都被壓在 heightMin → 太平緩。
  // 振幅 3.5% = 基準 420px，10% 漲跌停級 ≈ 1200px。與單步分量取大者驅動高度。
  ampRefPct: 0.035,
  baselineY: 560, // 賽道基準線 (世界座標 y，越大越下面)
  startFlat: 4, // 起點平台補幾個平坦點
  endFlat: 3, // 終點平台補幾個平坦點
  // 斜率限制（非對稱）：下坡保留陡度刺激感，上坡限制確保車子爬得上去
  maxDownSlopeDeg: 75,
  maxUpSlopeDeg: 55,
  flatBottomW: 80,  // V 谷夾角 < 90° 時插入的平底寬度 (px)，約一個車身長
  // 淺尖 V 谷（h2 ≤ segmentWidth、夾角 < 120°）插入的小平底寬度 (px)。
  // headless 模擬（scripts/simStuck.ts，6000 局）證實這類淺尖谷是「輪子卡縫」主因：
  // 卡住事件 97% 發生在 h2<80 的尖谷，插 40px 小平底後發生率 7.4% → 0.6%。
  sharpFlatW: 40,
  sharpIncludedMaxDeg: 120, // 淺谷兩壁夾角 < 此值才算「尖」谷需插平底
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
  // ── 車頂致命碰撞點（局部座標，y 負 = 往上）──
  // 對應貼圖紅線弧：前擾流→風鏡→油箱→座椅前緣，刻意不延伸到尾殼
  // 避免陡坡朝上時屁股碰前一段地形誤判死亡
  crashZone: [
    { x:  22, y: -20 }, // 前擾流
    { x:  14, y: -25 }, // 風鏡最高
    { x:   4, y: -23 }, // 油箱頂
    { x:  -5, y: -18 }, // 座椅前緣
    { x: -13, y: -13 }, // 座椅後緣（尾殼前，不再往後）
  ],
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

// ── 物理步進設定 ────────────────────────────────────────────────────────────
// subSteps：把每幀的 1/60 秒拆成 n 個子步（Engine.update(STEP/n) 跑 n 次）。
//   Matter.js 沒有連續碰撞偵測(CCD)，只檢查「移動後的新位置」有沒有重疊。
//   單步位移 ≥ 輪半徑(6px) 時，輪子第一次被偵測到接觸就已經埋進地表近一個半徑，
//   接觸法線退化 → solver 把它愈推愈深 → 卡住 / crashZone 觸地判死。
//   而 cruiseSpeed 是 6.912 px/step，本身就 > 6px ⇒ 正常騎乘就會中（見 simSinkScan.ts）。
//   subSteps=2 讓單步位移砍半到 ~3.5px < 輪半徑，結構性消除這個穿透。
//
// ⚠️ Matter 的 velocity/angularVelocity 是「每次 Engine.update 的位移量」，不是每秒。
//   所以開子步時 GameCanvas 會把 DRIVE 的速度/角速度做等比換算（速度 ÷n、角加速度 ÷n²、
//   重力 ×n、frictionAir 開 n 次方），確保「每幀」的物理表現與 subSteps=1 完全一致，
//   只有碰撞取樣變密。換算細節見 GameCanvas.tsx applyControls 與 bike.ts。
//
// ⚠️ 不是 `as const`：DEV 調參面板（src/game/tuning.ts）要在執行期直接改這些值。
export const PHYSICS = {
  // subSteps=2 也能修穿透，但真機實測會掉幀+上不了坡（每幀 2× 物理），故不走這條，維持 1。
  subSteps: 1,
  gravityY: 0.5, // 低重力 → 空中時間更長，翻轉窗口更寬（Ketch Rider 風格）
  positionIterations: 6, // Matter 預設 6，提高可改善深穿透的推出品質
  velocityIterations: 4, // Matter 預設 4
  // depenetrate：每幀 Engine.update 後偵測輪子有沒有陷進地表，有的話沿地形法線推回表面 +
  // 消掉往內速度。這是「騎乘中車子陷進地形/被彈飛/假死」的正解——不加子步(不掉幀)、不改
  // 手感/輪徑，只在真的穿透時才作用。headless 驗證：深陷率 15.3%→0%，最深 66.9px→9px，
  // 假死 119→36（見 simSinkScan.ts depen=on）。1=開 0=關（面板可 A/B）。
  depenetrate: 1,
};

export const RULES = {
  // 落地判定為「正面朝上」的容許角度（車身上向量與世界上向量夾角內）
  uprightCosThreshold: 0.55, // cosθ > 此值算正立 (≈ 57°內)，用於後空翻計分
  // 車頂致命判定的傾倒門檻：只有車身真的「翻過 90°」(cos < 0，車頂朝下半球) 才啟動 crashZone
  // 與 uprightCosThreshold 分離 → 爬陡坡前傾(<90°)不再被誤判死亡（discussion 第 1 點）
  crashTipCos: 0,
  crashUpsideDownSec: 0.1, // 車頂碰地判死緩衝（消除單幀誤判；100ms ≈ 6 步）
  // 翻轉計分（v0.12.14 改線性）：每圈固定 flipBaseScore，不隨圈數遞增（1圈100/2圈200/3圈300...）；
  // 完美落地＝剛才那趟翻轉分 ×2（不論落地面平或斜，只看落地角是否貼合坡面）
  flipBaseScore: 100,
  minAirSec: 0.3, // 騰空超過幾秒才算「真實跳躍」（過濾微跳）
  perfectLevelRad: 0.55, // 落地時車身與坡面夾角 < 此值(≈31°)算完美
  // 落地「延遲結算」步數：連續著地滿 N 步才結算翻轉/完美落地（≈67ms，玩家無感）。
  // 微彈跳/擦地（< N 步又離地）不清空累積旋轉、不煞停翻轉 →
  // 修「明明雙輪同時落地卻沒觸發完美落地」（headless 模擬：漏判 85% → 5%）。
  landingSettleSteps: 4,
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
  // 視覺 A：填滿賽道下方的 K 棒柱（頂部較實、往下淡出），漲紅/跌綠/平青
  fillUpTop: "rgba(255, 34, 68, 0.32)",
  fillUpBot: "rgba(255, 34, 68, 0.03)",
  fillDownTop: "rgba(0, 255, 136, 0.28)",
  fillDownBot: "rgba(0, 255, 136, 0.03)",
  fillFlatTop: "rgba(45, 226, 230, 0.20)",
  fillFlatBot: "rgba(45, 226, 230, 0.03)",
  bike: "#ffb300",
  bikeGlow: "rgba(255, 179, 0, 0.6)",
  wheel: "#cdd9e5",
  start: "#2de2e6",
  finish: "#ffb300",
} as const;
