import { Bodies, Vertices, type Body } from "matter-js";
import { COLOR, TRACK } from "./constants";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Track {
  vertices: Vec2[]; // 賽道頂點（世界座標，y 向下為正）＝原始股市折線
  colors: string[]; // 每段顏色（長度 = vertices.length - 1）：漲=紅/跌=綠/平=青
  startX: number;   // 起點平台中段 x（機車生成處）
  finishX: number;  // 終點 x
  minY: number;     // 用於鏡頭/渲染範圍
  maxY: number;
}

// 價格陣列 → 賽道頂點（DEVDOC 第 4 節）
export function pricesToTrack(prices: number[]): Track {
  const { segmentWidth, heightRange, heightMin, heightMax, refPct, ampRefPct, baselineY, startFlat, endFlat, maxDownSlopeDeg, maxUpSlopeDeg, flatBottomW, sharpFlatW, sharpIncludedMaxDeg } =
    TRACK;

  // 1. 正規化高度（依波動度動態縮放：越狂野的股票地形越高）
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;

  // 高度驅動 = max(最大單步漲跌幅/refPct, 全日振幅/ampRefPct)（v0.12.3，BETA #1）：
  // 單步分量照顧日線/月線資料（單步可達 ±10%）；振幅分量照顧盤中 5 分 K
  // （單步極小但全日可能震盪 5~10%，舊版全被壓在 heightMin → 封測回饋「太平緩」）。
  let maxStepPct = 0;
  for (let i = 1; i < prices.length; i++) {
    const pct = Math.abs(prices[i] / prices[i - 1] - 1);
    if (pct > maxStepPct) maxStepPct = pct;
  }
  const amplitudePct = prices[0] > 0 ? (max - min) / prices[0] : 0;
  const drive = Math.max(maxStepPct / refPct, amplitudePct / ampRefPct);
  const scaledHeight = drive > 0
    ? Math.max(heightMin, Math.min(heightMax, heightRange * drive))
    : heightRange;

  const toY = (p: number) => baselineY - ((p - min) / span) * scaledHeight;

  // 頭尾加平坦緩衝（用首/末價的高度）
  const padded: number[] = [
    ...Array(startFlat).fill(prices[0]),
    ...prices,
    ...Array(endFlat).fill(prices[prices.length - 1]),
  ];

  // 2. 水平間距固定 + 3. 斜率限制（非對稱：下坡 75°/上坡 55°）
  const maxDeltaDown = Math.tan((maxDownSlopeDeg * Math.PI) / 180) * segmentWidth;
  const maxDeltaUp   = Math.tan((maxUpSlopeDeg   * Math.PI) / 180) * segmentWidth;
  const vertices: Vec2[] = [];
  let prevY = toY(padded[0]);
  for (let i = 0; i < padded.length; i++) {
    let y = toY(padded[i]);
    if (i > 0) {
      const dy = y - prevY;
      // dy > 0 = 地形往下（下坡）；dy < 0 = 地形往上（上坡）
      const limit = dy > 0 ? maxDeltaDown : maxDeltaUp;
      if (Math.abs(dy) > limit) y = prevY + Math.sign(dy) * limit;
    }
    vertices.push({ x: i * segmentWidth, y });
    prevY = y;
  }

  // 後處理：上坡 h2 > segmentWidth（>45°）時插入平底，確保車有地方起跑爬坡
  // 原條件 h1*h2 > segW² 在「緩下坡接陡上坡」時 h1 很小導致條件失敗，改為只看上坡高度。
  // v0.12.1 追加：「淺尖谷」（h2 ≤ segmentWidth 且兩壁夾角 < sharpIncludedMaxDeg）插小平底。
  // headless 模擬（scripts/simStuck.ts）證實輪子卡縫 97% 發生在這類淺尖谷（舊規則只顧深谷），
  // 插 40px 小平底後 safe-bot 卡住率 7.4% → 0.6%。
  const finalVerts: Vec2[] = [];
  let xOff = 0;
  for (let i = 0; i < vertices.length; i++) {
    finalVerts.push({ x: vertices[i].x + xOff, y: vertices[i].y });
    const isValley =
      i > 0 &&
      i < vertices.length - 1 &&
      vertices[i].y > vertices[i - 1].y &&  // came down (y 向下為正)
      vertices[i].y > vertices[i + 1].y;    // going up
    const h2 = isValley ? vertices[i].y - vertices[i + 1].y : 0;
    if (isValley && h2 > segmentWidth) {
      // 深谷：插入平底段（同高度、往右延伸 flatBottomW），讓車有地方起跑爬坡
      xOff += flatBottomW;
      finalVerts.push({ x: vertices[i].x + xOff, y: vertices[i].y });
    } else if (isValley && h2 > 4) {
      // 淺谷：夾角夠尖（兩壁向量夾角 < sharpIncludedMaxDeg）才插小平底，消除輪子楔入的 V 口袋
      const p = vertices[i - 1], q = vertices[i], r = vertices[i + 1];
      const l1 = Math.hypot(p.x - q.x, p.y - q.y);
      const l2 = Math.hypot(r.x - q.x, r.y - q.y);
      const cosInc = ((p.x - q.x) * (r.x - q.x) + (p.y - q.y) * (r.y - q.y)) / (l1 * l2);
      const includedDeg = (Math.acos(Math.max(-1, Math.min(1, cosInc))) * 180) / Math.PI;
      if (includedDeg < sharpIncludedMaxDeg) {
        xOff += sharpFlatW;
        finalVerts.push({ x: vertices[i].x + xOff, y: vertices[i].y });
      }
    }
  }

  // 每段顏色：依「最終頂點 y 方向」判斷（discussion 第 3 點）。
  // 不再用原始 price 漲跌——夾平/平底插入後視覺坡向可能與原始方向不符，
  // 一律以實際畫出來的折線方向上色（上升=紅/下降=綠/持平=青），顏色與視覺一致。
  const finalColors: string[] = [];
  for (let i = 0; i < finalVerts.length - 1; i++) {
    const dy = finalVerts[i + 1].y - finalVerts[i].y; // y 向下為正
    if (dy < -0.5) finalColors.push(COLOR.trackUp);    // 往上 = 漲 = 紅
    else if (dy > 0.5) finalColors.push(COLOR.trackDown); // 往下 = 跌 = 綠
    else finalColors.push(COLOR.track);                // 持平 = 青
  }

  const ys = finalVerts.map((v) => v.y);
  return {
    vertices: finalVerts,
    colors: finalColors,
    startX: (startFlat * segmentWidth) / 2,
    finishX: finalVerts[finalVerts.length - 1].x,
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

// 二分搜尋找到 x 所在的 segment index（V 谷插入後 x 不均勻，不能用 floor(x/segW)）
function segIdx(v: Vec2[], x: number): number {
  let lo = 0, hi = v.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (v[mid + 1].x < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// 取得賽道在世界 x 處的坡面傾角 (rad)，供著地時把車身對齊坡面切線
export function slopeAt(track: Track, x: number): number {
  const v = track.vertices;
  const i = segIdx(v, x);
  return Math.atan2(v[i + 1].y - v[i].y, v[i + 1].x - v[i].x);
}

// 取得賽道在世界 x 處的地形高度 y（線性內插），供車頂碰撞點查詢用
export function terrainYAt(track: Track, x: number): number {
  const v = track.vertices;
  const i = segIdx(v, x);
  const a = v[i], b = v[i + 1];
  const dx = b.x - a.x;
  if (dx === 0) return a.y;
  const t = Math.max(0, Math.min(1, (x - a.x) / dx));
  return a.y + (b.y - a.y) * t;
}

// 點到地形折線的最短距離：正 = 在地表上方，負 = 已經在地表下方（穿進去了）。
//
// ⚠️ 不可以用「p.y − terrainYAt(track, p.x)」代替：那是「垂直距離」，只在平地等價。
// 斜坡上輪子靜止時輪心是沿**法線**離地表 r，垂直距離是 r/cosθ——75° 坡完美貼地用垂直
// 公式會算出 17px 的假下沉。診斷「車子陷進地形」時被這個坑騙過一次，見 simSinkScan.ts。
//
// 用途：DEV 調參面板的即時 sink 讀數、headless 模擬的穿透量測。
// 判定車輪是否穿透：sink = wheelRadius − surfaceDistance(輪心)；sink>0 即已陷入。
export function surfaceDistance(track: Track, p: Vec2): number {
  const v = track.vertices;
  const i = segIdx(v, p.x);
  let best = Infinity;
  // 只掃鄰近幾段就夠（每段寬 segmentWidth），避免整條折線 O(n)
  for (let k = Math.max(0, i - 2); k <= Math.min(v.length - 2, i + 2); k++) {
    const a = v[k], b = v[k + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best) best = d;
  }
  return p.y < terrainYAt(track, p.x) ? best : -best;
}

// 賽道頂點 → 靜態碰撞體：每段一個「實心梯形」（凸四邊形）
// 上緣 = 折線本身、兩側垂直、下緣拉到 baseY（賽道下方全部填滿）。
// 相鄰梯形共用一條垂直邊 → 零縫、零凸角、頂面 = 折線本身 → 結構性根治
// 隱形牆 / 卡轉折（discussion 第 2/4/12 點）。取代舊「旋轉矩形沿法線偏移」
// 造成的頂點翹角；也繞過 fromVertices 整條地形薄片穿透問題（梯形又肥又深）。
export function buildTerrainBodies(track: Track): Body[] {
  const bodies: Body[] = [];
  const { vertices, maxY } = track;
  const baseY = maxY + 800; // 填滿深度：遠低於最低點，車永遠到不了下緣
  // 底部往兩側外擴 → 相鄰梯形在接縫「正下方」重疊成實心聯集，
  // 消除外露的垂直內部邊（Matter.js internal-edge 卡頓：從高處落下卡在 K 棒縫隙）。
  // 頂緣兩頂點維持精確不動 → 頂面=折線完全不變、零凸角，手感不受影響。
  const overlap = TRACK.segmentWidth;

  // 頂部左右各多延伸 3px，讓相鄰梯形在谷底接縫處有小重疊，
  // 消除輪子（圓形）從斜角落在兩段 K 棒接縫時插入縫隙的 bug。
  // ⚠️ 峰頂不延伸：若頂點是山峰（相鄰段都比它低），延伸反而製造左梯形的右垂直壁，
  //    輪子爬到快到頂時撞到那堵牆就會卡住。峰頂時兩梯形精確共用同一頂點即可。
  const topExtra = 3;

  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];

    // 判斷 a/b 是否為峰頂（y 值最小 = 畫面最高點）
    const aPrev = i > 0 ? vertices[i - 1] : null;
    const bNext = i < vertices.length - 2 ? vertices[i + 2] : null;
    const aIsPeak = aPrev !== null && aPrev.y > a.y && b.y > a.y;
    const bIsPeak = bNext !== null && a.y > b.y && bNext.y > b.y;

    const leftExtra  = aIsPeak ? 0 : topExtra;
    const rightExtra = bIsPeak ? 0 : topExtra;

    // 凸梯形（y 向下，順時針），上窄下寬：左上 → 右上 → 右下(外擴) → 左下(外擴)
    const verts = [
      { x: a.x - leftExtra,  y: a.y },
      { x: b.x + rightExtra, y: b.y },
      { x: b.x + overlap, y: baseY },
      { x: a.x - overlap, y: baseY },
    ];
    // 傳入真實形心 → fromVertices 不平移頂點，世界座標 = verts 原值
    const centre = Vertices.centre(verts);
    bodies.push(
      Bodies.fromVertices(centre.x, centre.y, [verts], {
        isStatic: true,
        friction: 1,
        frictionStatic: 1,
        label: "terrain",
        render: { visible: false },
      }),
    );
  }

  return bodies;
}
