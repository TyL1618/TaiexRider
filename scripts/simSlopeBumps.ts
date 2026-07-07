// ============================================================
// 上坡「顆粒感」微彈跳分析（2026-07-07 使用者回報：爬長上坡時車子一直輕微
// 彈起，不至於翻車但手感很不安，長度越長越明顯）。
//
// 假說：terrain.ts buildTerrainBodies 的 topExtra=3 水平延伸，在「非峰頂」的
// 一般轉角（包含同向延續上坡途中，每個價格點都是一個轉角，只要不是嚴格峰頂
// 就會延伸）一律套用固定 3px「水平」延伸——但上坡本身是斜的，水平延伸出去的
// 端點會偏離斜坡切線，等同把梯形頂邊局部旋轉，在每個轉角處形成 ≤3px 的微
// 階梯。長上坡由許多真實股價轉折點組成，每個點都是一個轉角、都有這個微階梯，
// 連續騎過去就是「顆粒感彈跳」。DEVDOC.md §5.4b 已記錄這個機制的存在（當初
// 是在討論「加大延伸」的副作用時發現的），這裡直接用真實地形量化驗證。
//
// 方法：用 pricesToTrack() 生一段真實感的多段上坡（模擬股價噪音），完整複製
// GameCanvas.tsx 控制邏輯讓車子爬坡，記錄逐步垂直速度變化量（vy jump），
// 比較 topExtra=3（現行） vs topExtra=0（無延伸，驗證用，非建議修法）。
//
// 執行：
//   ./node_modules/.bin/esbuild scripts/simSlopeBumps.ts --bundle --platform=node \
//     --format=cjs --outfile=sim-build/simSlopeBumps.cjs
//   node sim-build/simSlopeBumps.cjs
// ============================================================

import { Engine, Events, Composite, Body, Vertices, Bodies, type IEventCollision, type Body as MatterBody } from "matter-js";
import { slopeAt, terrainYAt, type Track, type Vec2 } from "../src/game/terrain";
import { createBike, type Bike } from "../src/game/bike";
import { BIKE, DRIVE, TRACK } from "../src/game/constants";

const STEP = 1000 / 60;

function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// 容差簡化（貪婪版 Douglas-Peucker）：從起點開始盡量往後延伸，只要區間內每個
// 中間點到「起點-候選終點」直線的垂直距離都 < maxDevPx，就繼續延伸；
// 一旦超過容差，就把目前這段收斂成一條線（只保留頭尾兩點），從下一點重新開始。
// 這樣視覺上近似直線的一長串真實資料點，會被簡化成少數幾條乾淨線段，
// 只有真正轉向明顯（超過容差）的地方才會保留為新的轉角。
function simplifyByDeviation(vertices: Vec2[], maxDevPx: number): Vec2[] {
  if (vertices.length <= 2) return vertices.slice();
  const out: Vec2[] = [vertices[0]];
  let start = 0;
  while (start < vertices.length - 1) {
    let end = start + 1;
    for (let cand = start + 2; cand < vertices.length; cand++) {
      const a = vertices[start], b = vertices[cand];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len; // 法向量
      let maxDev = 0;
      for (let k = start + 1; k < cand; k++) {
        const p = vertices[k];
        const dev = Math.abs((p.x - a.x) * nx + (p.y - a.y) * ny);
        if (dev > maxDev) maxDev = dev;
      }
      if (maxDev <= maxDevPx) end = cand;
      else break;
    }
    out.push(vertices[end]);
    start = end;
  }
  return out;
}

function buildTerrainBodiesParam(track: Track, topExtra: number): MatterBody[] {
  const bodies: MatterBody[] = [];
  const { vertices, maxY } = track;
  const baseY = maxY + 800;
  const overlap = TRACK.segmentWidth;
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const aPrev = i > 0 ? vertices[i - 1] : null;
    const bNext = i < vertices.length - 2 ? vertices[i + 2] : null;
    const aIsPeak = aPrev !== null && aPrev.y > a.y && b.y > a.y;
    const bIsPeak = bNext !== null && a.y > b.y && bNext.y > b.y;
    const leftExtra = aIsPeak ? 0 : topExtra;
    const rightExtra = bIsPeak ? 0 : topExtra;
    const verts = [
      { x: a.x - leftExtra, y: a.y },
      { x: b.x + rightExtra, y: b.y },
      { x: b.x + overlap, y: baseY },
      { x: a.x - overlap, y: baseY },
    ];
    const centre = Vertices.centre(verts);
    bodies.push(
      Bodies.fromVertices(centre.x, centre.y, [verts], {
        isStatic: true, friction: 1, frictionStatic: 1, label: "terrain",
        render: { visible: false },
      }),
    );
  }
  return bodies;
}

// 真實感長上坡：模擬股價噪音——整體趨勢向上（每段平均漲 avgPct），
// 但每段實際漲幅有隨機噪音（noisePct），跟真實 K 棒一樣不會是完美直線。
function makeNoisyUpslope(nSegs: number, avgPct: number, noisePct: number, seed: number): Track {
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const prices: number[] = [100];
  for (let i = 0; i < nSegs; i++) {
    const pct = avgPct + (rand() * 2 - 1) * noisePct;
    prices.push(prices[prices.length - 1] * (1 + pct));
  }
  // 手動轉成 track（模擬 pricesToTrack 的核心：等寬 segmentWidth，高度依價格正規化）
  const segW = TRACK.segmentWidth;
  const min = Math.min(...prices), max = Math.max(...prices);
  const span = max - min || 1;
  const heightRange = 1600; // 整段上坡總落差 px，模擬夠陡的長多頭段
  const RUN_UP = 4;
  const vertices: Vec2[] = [];
  for (let i = 0; i <= RUN_UP; i++) vertices.push({ x: i * segW, y: 0 });
  const baseX = RUN_UP * segW;
  for (let i = 0; i < prices.length; i++) {
    const y = -((prices[i] - prices[0]) / span) * heightRange;
    vertices.push({ x: baseX + i * segW, y });
  }
  const lastY = vertices[vertices.length - 1].y;
  for (let i = 1; i <= 10; i++) vertices.push({ x: vertices[vertices.length - 1].x + segW, y: lastY }); // 頂部平地緩衝
  const ys = vertices.map((v) => v.y);
  return {
    vertices, colors: Array(vertices.length - 1).fill("#ff2244"),
    startX: segW, finishX: vertices[vertices.length - 1].x,
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
}

interface ClimbResult {
  nSegs: number; topExtra: number;
  bumpCount: number;       // |vy jump| 超過閾值的次數
  maxBumpVy: number;       // 最大單步垂直速度跳變
  totalBumpEnergy: number; // 所有 bump 的 |vy jump| 加總（代表整體顛簸程度）
  finalVertCount: number;  // 簡化後實際頂點數（驗證簡化有沒有真的減少轉角）
}

function runClimb(nSegs: number, topExtra: number, seed: number, simplifyDevPx = 0): ClimbResult {
  const track0 = makeNoisyUpslope(nSegs, 0.008, 0.006, seed); // 平均每段漲 0.8%、噪音 ±0.6%（貼近真實 5 分 K 尺度）
  const track: Track = simplifyDevPx > 0
    ? { ...track0, vertices: simplifyByDeviation(track0.vertices, simplifyDevPx) }
    : track0;
  const engine = Engine.create();
  engine.gravity.y = 0.5;
  Composite.add(engine.world, buildTerrainBodiesParam(track, topExtra));

  const spawnX = TRACK.segmentWidth * 2;
  const spawnY = 0 - BIKE.wheelDropY - BIKE.wheelRadius;
  const bike: Bike = createBike(engine.world, spawnX, spawnY);
  Body.setVelocity(bike.chassis, { x: DRIVE.cruiseSpeed, y: 0 });
  Body.setVelocity(bike.rearWheel, { x: DRIVE.cruiseSpeed, y: 0 });
  Body.setVelocity(bike.frontWheel, { x: DRIVE.cruiseSpeed, y: 0 });
  const wheelSpin0 = DRIVE.cruiseSpeed / BIKE.wheelRadius;
  Body.setAngularVelocity(bike.rearWheel, wheelSpin0);
  Body.setAngularVelocity(bike.frontWheel, wheelSpin0);

  let rearContacts = 0, frontContacts = 0;
  const onCollision = (delta: number) => (e: IEventCollision<Engine>) => {
    for (const pair of e.pairs) {
      const labels = [pair.bodyA.label, pair.bodyB.label];
      if (!labels.includes("terrain")) continue;
      if (labels.includes("rearWheel")) rearContacts = Math.max(0, rearContacts + delta);
      if (labels.includes("frontWheel")) frontContacts = Math.max(0, frontContacts + delta);
    }
  };
  Events.on(engine, "collisionStart", onCollision(1));
  Events.on(engine, "collisionEnd", onCollision(-1));

  const applyControls = (grounded: boolean) => {
    const c = bike.chassis;
    if (grounded) {
      const dx = bike.frontWheel.position.x - bike.rearWheel.position.x;
      const dy = bike.frontWheel.position.y - bike.rearWheel.position.y;
      const len = Math.hypot(dx, dy);
      if (len > 0.001) {
        const tx = dx / len, ty = dy / len;
        const nx = ty, ny = -tx;
        let vn = c.velocity.x * nx + c.velocity.y * ny;
        if (vn > 0) Body.setVelocity(c, { x: c.velocity.x - vn * nx, y: c.velocity.y - vn * ny });
        vn = bike.rearWheel.velocity.x * nx + bike.rearWheel.velocity.y * ny;
        if (vn > 0) Body.setVelocity(bike.rearWheel, { x: bike.rearWheel.velocity.x - vn * nx, y: bike.rearWheel.velocity.y - vn * ny });
        vn = bike.frontWheel.velocity.x * nx + bike.frontWheel.velocity.y * ny;
        if (vn > 0) Body.setVelocity(bike.frontWheel, { x: bike.frontWheel.velocity.x - vn * nx, y: bike.frontWheel.velocity.y - vn * ny });
        const vt = c.velocity.x * tx + c.velocity.y * ty;
        const delta = (DRIVE.cruiseSpeed - vt) * DRIVE.groundLockEase;
        Body.setVelocity(c, { x: c.velocity.x + delta * tx, y: c.velocity.y + delta * ty });
        Body.setVelocity(bike.rearWheel, { x: bike.rearWheel.velocity.x + delta * tx, y: bike.rearWheel.velocity.y + delta * ty });
        Body.setVelocity(bike.frontWheel, { x: bike.frontWheel.velocity.x + delta * tx, y: bike.frontWheel.velocity.y + delta * ty });
      }
      const slope = slopeAt(track, bike.frontWheel.position.x);
      const da = angleDelta(c.angle, slope);
      let av = da * DRIVE.groundAlignGain;
      if (Math.abs(av) > DRIVE.groundedAvMax) av = Math.sign(av) * DRIVE.groundedAvMax;
      Body.setAngularVelocity(c, av);
    } else {
      let av = c.angularVelocity;
      if (av < 0) av = Math.min(0, av + DRIVE.airSpinBrakeAccel);
      Body.setAngularVelocity(c, Math.min(DRIVE.airNoseForwardMax, av + DRIVE.airNoseForwardAccel));
    }
  };

  let bumpCount = 0, maxBumpVy = 0, totalBumpEnergy = 0;
  const finishX = track.vertices[track.vertices.length - 1].x - TRACK.segmentWidth * 8;

  for (let step = 0; step < 2000; step++) {
    const grounded = rearContacts > 0 || frontContacts > 0;
    applyControls(grounded);
    const preVy = bike.chassis.velocity.y;
    Engine.update(engine, STEP);
    const c = bike.chassis;
    const jump = Math.abs(preVy - c.velocity.y);
    if (grounded && jump > 0.3) { // 正常貼坡速度變化很平滑，>0.3px/step 跳變視為「顆粒感」bump
      bumpCount++;
      totalBumpEnergy += jump;
      if (jump > maxBumpVy) maxBumpVy = jump;
    }
    if (c.position.x > finishX) break;
  }

  return {
    nSegs, topExtra, bumpCount,
    maxBumpVy: Math.round(maxBumpVy * 1000) / 1000,
    totalBumpEnergy: Math.round(totalBumpEnergy * 10) / 10,
    finalVertCount: track.vertices.length,
  };
}

function main() {
  if (process.env.SIMPLIFY_TEST) {
    console.log("容差簡化（simplifyByDeviation）對顆粒感的影響，topExtra=3（現行）不變\n");
    console.log("段數  原始頂點數  容差0(原樣): bumps/energy | 容差2px: verts/bumps/energy | 容差4px: verts/bumps/energy | 容差8px: verts/bumps/energy");
    for (const nSegs of [10, 15, 20, 30]) {
      const r0 = runClimb(nSegs, 3, 42, 0);
      const r2 = runClimb(nSegs, 3, 42, 2);
      const r4 = runClimb(nSegs, 3, 42, 4);
      const r8 = runClimb(nSegs, 3, 42, 8);
      console.log(
        `${String(nSegs).padStart(3)}段  verts0=${r0.finalVertCount}  ` +
        `原樣: bumps=${r0.bumpCount} energy=${r0.totalBumpEnergy}  |  ` +
        `2px: verts=${r2.finalVertCount} bumps=${r2.bumpCount} energy=${r2.totalBumpEnergy}  |  ` +
        `4px: verts=${r4.finalVertCount} bumps=${r4.bumpCount} energy=${r4.totalBumpEnergy}  |  ` +
        `8px: verts=${r8.finalVertCount} bumps=${r8.bumpCount} energy=${r8.totalBumpEnergy}`,
      );
    }
    return;
  }

  console.log("上坡顆粒感量化：topExtra=3（現行）vs topExtra=0（假設無延伸，驗證用非建議修法）\n");
  console.log("段數  現行(topExtra=3): bumps/maxVy/總能量  |  無延伸(topExtra=0): bumps/maxVy/總能量");
  for (const nSegs of [3, 6, 10, 15, 20]) {
    const r3 = runClimb(nSegs, 3, 42);
    const r0 = runClimb(nSegs, 0, 42);
    console.log(
      `${String(nSegs).padStart(3)}段  ` +
      `現行: bumps=${String(r3.bumpCount).padStart(3)} maxVy=${String(r3.maxBumpVy).padStart(6)} energy=${String(r3.totalBumpEnergy).padStart(6)}  |  ` +
      `無延伸: bumps=${String(r0.bumpCount).padStart(3)} maxVy=${String(r0.maxBumpVy).padStart(6)} energy=${String(r0.totalBumpEnergy).padStart(6)}`,
    );
  }
}

main();
