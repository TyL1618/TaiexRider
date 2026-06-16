import { Bodies, type Body } from "matter-js";
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
  const { segmentWidth, heightRange, heightMin, heightMax, refPct, baselineY, startFlat, endFlat, maxSlopeDeg, flatBottomW } =
    TRACK;

  // 1. 正規化高度（依波動度動態縮放：越狂野的股票地形越高）
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;

  // 以最大單步漲跌幅決定 scaledHeight（3% 基準=340px，9.8% 漲停≈600px）
  let maxStepPct = 0;
  for (let i = 1; i < prices.length; i++) {
    const pct = Math.abs(prices[i] / prices[i - 1] - 1);
    if (pct > maxStepPct) maxStepPct = pct;
  }
  const scaledHeight = maxStepPct > 0
    ? Math.max(heightMin, Math.min(heightMax, heightRange * (maxStepPct / refPct)))
    : heightRange;

  const toY = (p: number) => baselineY - ((p - min) / span) * scaledHeight;

  // 頭尾加平坦緩衝（用首/末價的高度）
  const padded: number[] = [
    ...Array(startFlat).fill(prices[0]),
    ...prices,
    ...Array(endFlat).fill(prices[prices.length - 1]),
  ];

  // 2. 水平間距固定 + 3. 斜率限制（夾平過陡段，確保爬得上去）
  const maxDelta = Math.tan((maxSlopeDeg * Math.PI) / 180) * segmentWidth;
  const vertices: Vec2[] = [];
  let prevY = toY(padded[0]);
  for (let i = 0; i < padded.length; i++) {
    let y = toY(padded[i]);
    if (i > 0) {
      const dy = y - prevY;
      if (Math.abs(dy) > maxDelta) y = prevY + Math.sign(dy) * maxDelta;
    }
    vertices.push({ x: i * segmentWidth, y });
    prevY = y;
  }

  // 每段顏色：比較 padded 相鄰兩值方向（漲=紅/跌=綠/平=青）
  const rawColors: string[] = [];
  for (let i = 0; i < padded.length - 1; i++) {
    if (padded[i + 1] > padded[i]) rawColors.push(COLOR.trackUp);
    else if (padded[i + 1] < padded[i]) rawColors.push(COLOR.trackDown);
    else rawColors.push(COLOR.track);
  }

  // 後處理：V 谷夾角 < 90°（h1×h2 > segW²）時插入一小段平底，讓車有地方轉向再爬坡
  const threshold = segmentWidth * segmentWidth;
  const finalVerts: Vec2[] = [];
  const finalColors: string[] = [];
  let xOff = 0;
  for (let i = 0; i < vertices.length; i++) {
    finalVerts.push({ x: vertices[i].x + xOff, y: vertices[i].y });
    const isValley =
      i > 0 &&
      i < vertices.length - 1 &&
      vertices[i].y > vertices[i - 1].y &&  // came down (y 向下為正)
      vertices[i].y > vertices[i + 1].y;    // going up
    const h1 = isValley ? vertices[i].y - vertices[i - 1].y : 0;
    const h2 = isValley ? vertices[i].y - vertices[i + 1].y : 0;
    if (isValley && h1 * h2 > threshold) {
      // 插入平底段：同高度、往右延伸 flatBottomW
      xOff += flatBottomW;
      finalVerts.push({ x: vertices[i].x + xOff, y: vertices[i].y });
      finalColors.push(COLOR.track); // 平底段顏色 = 平盤青
    }
    if (i < rawColors.length) finalColors.push(rawColors[i]);
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

// 賽道頂點 → 靜態碰撞體（旋轉矩形 + 頂點填縫圓）
// 矩形沿法線偏移半厚 → 頂面貼線；各頂點加圓形（r=thickness/2）→ 數學上填滿任何角度的接縫，不製造台階
export function buildTerrainBodies(track: Track, thickness = 26): Body[] {
  const bodies: Body[] = [];
  const { vertices } = track;
  const r = thickness / 2;

  // 每段一個旋轉矩形
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen = Math.hypot(dx, dy) || 1;
    const len = segLen + 6; // +6 兩端各 3px 重疊，消除接縫不需頂點圓
    const angle = Math.atan2(dy, dx);
    const downNx = -dy / segLen;
    const downNy = dx / segLen;
    const cx = (a.x + b.x) / 2 + downNx * r;
    const cy = (a.y + b.y) / 2 + downNy * r;
    bodies.push(
      Bodies.rectangle(cx, cy, len, thickness, {
        isStatic: true,
        angle,
        friction: 1,
        frictionStatic: 1,
        label: "terrain",
        render: { visible: false },
      }),
    );
  }

  // 頂點圓已移除：矩形兩端各 +3px 重疊已填縫，頂點圓反而造成凸角彈射（隱形牆）

  return bodies;
}
