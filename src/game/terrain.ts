import { Bodies, type Body } from "matter-js";
import { COLOR, TRACK } from "./constants";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Track {
  vertices: Vec2[];       // 原始折線頂點（股市圖，結束畫面用）
  smoothVertices: Vec2[]; // Catmull-Rom 平滑頂點（物理碰撞 + 騎乘渲染）
  colors: string[];       // 每段顏色（對應 vertices 間段）：漲=紅/跌=綠/平=青
  startX: number;         // 起點平台中段 x（機車生成處）
  finishX: number;        // 終點 x
  minY: number;           // 用於鏡頭/渲染範圍
  maxY: number;
}

// Catmull-Rom spline 插值：在每對原始頂點之間插入 STEPS 個中間點
export const SMOOTH_STEPS = 4;

function catmullRomSmooth(pts: Vec2[]): Vec2[] {
  if (pts.length < 2) return [...pts];
  const result: Vec2[] = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    for (let j = 0; j < SMOOTH_STEPS; j++) {
      const t = j / SMOOTH_STEPS;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push({
        x: 0.5 * (2*p1.x + (-p0.x+p2.x)*t + (2*p0.x-5*p1.x+4*p2.x-p3.x)*t2 + (-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
        y: 0.5 * (2*p1.y + (-p0.y+p2.y)*t + (2*p0.y-5*p1.y+4*p2.y-p3.y)*t2 + (-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
      });
    }
  }
  result.push(pts[n - 1]);
  return result;
}

// 價格陣列 → 賽道頂點（DEVDOC 第 4 節）
export function pricesToTrack(prices: number[]): Track {
  const { segmentWidth, heightRange, heightMin, heightMax, baselineY, startFlat, endFlat, maxSlopeDeg } =
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
  const REF_PCT = 0.03;
  const scaledHeight = maxStepPct > 0
    ? Math.max(heightMin, Math.min(heightMax, heightRange * (maxStepPct / REF_PCT)))
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
  const colors: string[] = [];
  for (let i = 0; i < padded.length - 1; i++) {
    if (padded[i + 1] > padded[i]) colors.push(COLOR.trackUp);
    else if (padded[i + 1] < padded[i]) colors.push(COLOR.trackDown);
    else colors.push(COLOR.track);
  }

  const smoothVertices = catmullRomSmooth(vertices);
  const ys = smoothVertices.map((v) => v.y);
  return {
    vertices,
    smoothVertices,
    colors,
    startX: (startFlat * segmentWidth) / 2,
    finishX: vertices[vertices.length - 1].x,
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

// 賽道頂點 → 一串靜態碰撞體（每段一個旋轉矩形，略為重疊避免接縫卡頓）
export function buildTerrainBodies(track: Track, thickness = 26): Body[] {
  const bodies: Body[] = [];
  const { smoothVertices } = track;
  for (let i = 0; i < smoothVertices.length - 1; i++) {
    const a = smoothVertices[i];
    const b = smoothVertices[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) + 2; // +2 略為重疊
    const angle = Math.atan2(dy, dx);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2 + thickness / 2; // 矩形中心壓在線段下方
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
  return bodies;
}
