// ============================================================
// 「單一整條地形物理體」根治候選（2026-07-07）——取代現行「每根 K 棒各自一個
// 重疊梯形」的架構。用 poly-decomp 讓 Matter.js 把整條（非凸）地形折線自動
// 分解成一個 compound body 內部的多個凸多邊形——同一個 body，不是多個各自
// 獨立碰撞的 body，理論上結構性消除「內部接縫雙重碰撞」的可能，因為碰撞判定
// 是針對整個 compound body 一次解算，不是逐段各自解算再疊加。
//
// 驗證兩件事（用真正的 bike.ts/applyControls，未改動 shipped code）：
// ① 陡坡衝下+平地接縫深陷（simSteepLanding.ts 的 65 組矩陣）是否消失
// ② 陡峰頂正常彈跳（simPeakWall.ts 的峰頂案例）是否維持正常
//
// 執行前需要（僅測試用，未寫進 package.json）：
//   npm install --no-save poly-decomp
// 執行：
//   ./node_modules/.bin/esbuild scripts/simSingleBody.ts --bundle --platform=node \
//     --format=cjs --outfile=sim-build/simSingleBody.cjs --external:poly-decomp
//   node sim-build/simSingleBody.cjs
// ============================================================

import { Engine, Events, Composite, Body, Vertices, Bodies, Common, type IEventCollision, type Body as MatterBody, type World } from "matter-js";
import { slopeAt, terrainYAt, type Track, type Vec2 } from "../src/game/terrain";
import { createBike, type Bike } from "../src/game/bike";
import { BIKE, DRIVE, TRACK } from "../src/game/constants";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const decomp = require("poly-decomp");
Common.setDecomp(decomp);

const STEP = 1000 / 60;

function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// 單一整條地形 body：頂面＝完整折線本身（不做任何延伸/重疊），
// 底面＝左右端點拉到 baseY 圍起來，整體當一個（可能是 compound）body 丟給物理引擎。
function buildSingleBodyTerrain(track: Track): MatterBody {
  const { vertices, maxY } = track;
  const baseY = maxY + 800;
  const full: Vec2[] = [
    ...vertices,
    { x: vertices[vertices.length - 1].x, y: baseY },
    { x: vertices[0].x, y: baseY },
  ];
  const centre = Vertices.centre(full);
  return Bodies.fromVertices(centre.x, centre.y, [full], {
    isStatic: true, friction: 1, frictionStatic: 1, label: "terrain",
    render: { visible: false },
  });
}

function makeCornerTrack(angleDeg: number, slopeSegs: number, flatSegsAfter: number): Track {
  const segW = TRACK.segmentWidth;
  const rad = (angleDeg * Math.PI) / 180;
  const dyPerSeg = Math.tan(rad) * segW;
  const RUN_UP = 6;
  const vertices: Vec2[] = [];
  for (let i = 0; i <= RUN_UP; i++) vertices.push({ x: i * segW, y: 0 });
  let x = RUN_UP * segW, y = 0;
  for (let i = 1; i <= slopeSegs; i++) { x += segW; y += dyPerSeg; vertices.push({ x, y }); }
  for (let i = 1; i <= flatSegsAfter; i++) { x += segW; vertices.push({ x, y }); }
  const ys = vertices.map((v) => v.y);
  return {
    vertices, colors: Array(vertices.length - 1).fill("#2de2e6"),
    startX: segW, finishX: vertices[vertices.length - 1].x,
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
}

function makePeakTrack(upDeg: number, upSegs: number, downDeg: number, downSegs: number): { track: Track; peakX: number } {
  const segW = TRACK.segmentWidth;
  const RUN_UP = 6;
  const vertices: Vec2[] = [];
  for (let i = 0; i <= RUN_UP; i++) vertices.push({ x: i * segW, y: 0 });
  let x = RUN_UP * segW, y = 0;
  const upRad = (upDeg * Math.PI) / 180;
  const dyUp = Math.tan(upRad) * segW;
  for (let i = 1; i <= upSegs; i++) { x += segW; y -= dyUp; vertices.push({ x, y }); }
  const peakX = x;
  const downRad = (downDeg * Math.PI) / 180;
  const dyDown = Math.tan(downRad) * segW;
  for (let i = 1; i <= downSegs; i++) { x += segW; y += dyDown; vertices.push({ x, y }); }
  for (let i = 1; i <= 20; i++) { x += segW; vertices.push({ x, y }); }
  const ys = vertices.map((v) => v.y);
  return {
    track: {
      vertices, colors: Array(vertices.length - 1).fill("#2de2e6"),
      startX: segW, finishX: vertices[vertices.length - 1].x,
      minY: Math.min(...ys), maxY: Math.max(...ys),
    },
    peakX,
  };
}

function makeApplyControls(bike: Bike, track: Track) {
  return (grounded: boolean) => {
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
}

function makeBikeWithContacts(world: World, spawnX: number, spawnY: number) {
  const bike = createBike(world, spawnX, spawnY);
  Body.setVelocity(bike.chassis, { x: DRIVE.cruiseSpeed, y: 0 });
  Body.setVelocity(bike.rearWheel, { x: DRIVE.cruiseSpeed, y: 0 });
  Body.setVelocity(bike.frontWheel, { x: DRIVE.cruiseSpeed, y: 0 });
  const wheelSpin0 = DRIVE.cruiseSpeed / BIKE.wheelRadius;
  Body.setAngularVelocity(bike.rearWheel, wheelSpin0);
  Body.setAngularVelocity(bike.frontWheel, wheelSpin0);
  return bike;
}

function testCorner(angleDeg: number, slopeSegs: number): { deepSink: boolean; maxSink: number; segIdx: number } {
  const track = makeCornerTrack(angleDeg, slopeSegs, 30);
  const engine = Engine.create();
  engine.gravity.y = 0.5;
  Composite.add(engine.world, buildSingleBodyTerrain(track));

  const spawnX = TRACK.segmentWidth * 2;
  const spawnY = 0 - BIKE.wheelDropY - BIKE.wheelRadius;
  const bike = makeBikeWithContacts(engine.world, spawnX, spawnY);

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
  const applyControls = makeApplyControls(bike, track);

  const flatStartX = track.vertices[6 + slopeSegs].x;
  let hasHitFlat = false;
  let maxSinkDepth = 0;
  let stuckSegIndex = -1;
  let stuckWindowStartX = 0, stuckWindowStartStep = -1;
  let stuckDetected = false;

  for (let step = 0; step < 900; step++) {
    const grounded = rearContacts > 0 || frontContacts > 0;
    applyControls(grounded);
    Engine.update(engine, STEP);
    const c = bike.chassis;
    const x = c.position.x;
    if (!hasHitFlat && x >= flatStartX) hasHitFlat = true;
    if (hasHitFlat) {
      const rearSink = bike.rearWheel.position.y - (terrainYAt(track, bike.rearWheel.position.x) - BIKE.wheelRadius);
      const frontSink = bike.frontWheel.position.y - (terrainYAt(track, bike.frontWheel.position.x) - BIKE.wheelRadius);
      const sink = Math.max(rearSink, frontSink);
      if (sink > maxSinkDepth) maxSinkDepth = sink;
      if (stuckWindowStartStep < 0) { stuckWindowStartStep = step; stuckWindowStartX = x; }
      else if (step - stuckWindowStartStep >= 40) {
        const disp = Math.abs(x - stuckWindowStartX);
        if (disp < 3 && sink > 4 && !stuckDetected) {
          stuckDetected = true;
          stuckSegIndex = Math.floor((x - flatStartX) / TRACK.segmentWidth);
        }
        stuckWindowStartStep = step; stuckWindowStartX = x;
      }
      if (x > flatStartX + TRACK.segmentWidth * 20) break;
    }
  }
  return { deepSink: maxSinkDepth > 50, maxSink: Math.round(maxSinkDepth * 10) / 10, segIdx: stuckSegIndex };
}

function testPeak(upDeg: number, upSegs: number, downDeg: number, downSegs: number): { airSteps: number } {
  const { track, peakX } = makePeakTrack(upDeg, upSegs, downDeg, downSegs);
  const engine = Engine.create();
  engine.gravity.y = 0.5;
  Composite.add(engine.world, buildSingleBodyTerrain(track));

  const spawnX = TRACK.segmentWidth * 2;
  const spawnY = 0 - BIKE.wheelDropY - BIKE.wheelRadius;
  const bike = makeBikeWithContacts(engine.world, spawnX, spawnY);

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
  const applyControls = makeApplyControls(bike, track);

  let sawPeak = false, airSteps = 0;
  for (let step = 0; step < 500; step++) {
    const grounded = rearContacts > 0 || frontContacts > 0;
    applyControls(grounded);
    Engine.update(engine, STEP);
    const c = bike.chassis;
    if (Math.abs(c.position.x - peakX) < TRACK.segmentWidth * 1.5) sawPeak = true;
    if (sawPeak && !grounded && c.position.x > peakX) airSteps++;
    if (sawPeak && grounded && c.position.x > peakX + TRACK.segmentWidth * 2) break;
  }
  return { airSteps };
}

function main() {
  console.log("=== 單一整條地形物理體：轉角深陷測試（65 組矩陣） ===\n");
  const ANGLES = [40, 45, 50, 52, 55, 57, 60, 62, 65, 67, 70, 72, 75];
  const SLOPE_SEGS = [1, 2, 3, 4, 6];
  let deepCount = 0, total = 0;
  const deepList: string[] = [];
  for (const a of ANGLES) {
    for (const s of SLOPE_SEGS) {
      total++;
      const r = testCorner(a, s);
      if (r.deepSink) { deepCount++; deepList.push(`${a}°/${s}seg(sink=${r.maxSink},segIdx=${r.segIdx})`); }
    }
  }
  console.log(`深陷(>50px)：${deepCount}/${total}`);
  if (deepList.length) console.log("案例：" + deepList.join(", "));

  console.log("\n=== 單一整條地形物理體：峰頂彈跳測試 ===\n");
  const COMBOS: [number, number, number, number][] = [
    [30, 3, 30, 3], [45, 2, 45, 2], [55, 2, 55, 2],
    [60, 1, 60, 1], [70, 1, 70, 1], [75, 1, 75, 1], [75, 2, 75, 2], [75, 1, 30, 1],
  ];
  for (const [u, us, d, ds] of COMBOS) {
    const r = testPeak(u, us, d, ds);
    console.log(`${u}°(${us})→${d}°(${ds})  air=${r.airSteps}`);
  }
}

main();
