import { Bodies, type Body } from "matter-js";
import { TRACK } from "./constants";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Track {
  vertices: Vec2[]; // 賽道頂點（世界座標，y 向下為正）
  startX: number; // 起點平台中段 x（機車生成處）
  finishX: number; // 終點 x
  minY: number; // 用於鏡頭/渲染範圍
  maxY: number;
}

// 價格陣列 → 賽道頂點（DEVDOC 第 4 節）
export function pricesToTrack(prices: number[]): Track {
  const { segmentWidth, heightRange, baselineY, startFlat, endFlat, maxSlopeDeg } =
    TRACK;

  // 1. 正規化高度
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const toY = (p: number) => baselineY - ((p - min) / span) * heightRange;

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

  const ys = vertices.map((v) => v.y);
  return {
    vertices,
    startX: (startFlat * segmentWidth) / 2,
    finishX: vertices[vertices.length - 1].x,
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

// 賽道頂點 → 一串靜態碰撞體（每段一個旋轉矩形，略為重疊避免接縫卡頓）
export function buildTerrainBodies(track: Track, thickness = 26): Body[] {
  const bodies: Body[] = [];
  const { vertices } = track;
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
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
