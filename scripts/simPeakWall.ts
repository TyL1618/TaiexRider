// ============================================================
// 峰頂隱形牆迴歸測試（2026-07-07，配合 simSteepLanding.ts 的 topExtra 加大候選解法）
//
// 使用者提出的重要疑慮：以前某版本每個 K 棒接縫都做延伸，導致「峰頂」處延伸出
// 隱形牆物理凸起，車子過峰頂會被異常彈起。terrain.ts 現行邏輯已對峰頂特殊處理
// （aIsPeak/bIsPeak 判定為峰頂時 leftExtra/rightExtra 強制 0，不受 topExtra 大小
// 影響），理論上把 topExtra 從 3 加大到 10 不會重現這個 bug——但這裡直接跑模擬
// 驗證，不只憑程式碼推理。
//
// 方法：建一系列「上坡→峰頂→下坡」賽道（不同峰頂夾角），讓車子帶油門真實
// 通過峰頂，比較 topExtra=3（現行）vs topExtra=10（候選）在峰頂瞬間的垂直
// 速度/角速度變化，抓「異常彈起」（凸起隱形牆的特徵：峰頂瞬間垂直速度出現
// 不該有的正向跳變，或是滯空時間比预期長很多）。
//
// 執行：
//   ./node_modules/.bin/esbuild scripts/simPeakWall.ts --bundle --platform=node \
//     --format=cjs --outfile=sim-build/simPeakWall.cjs
//   node sim-build/simPeakWall.cjs
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

// 上坡（角度 upDeg，長度 upSegs 段）→ 峰頂 → 下坡（downDeg，downSegs 段）
function makeTrack(upDeg: number, upSegs: number, downDeg: number, downSegs: number): { track: Track; peakX: number } {
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
  for (let i = 1; i <= 20; i++) { x += segW; vertices.push({ x, y }); } // 尾端平地緩衝
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

interface PeakResult {
  upDeg: number; downDeg: number; upSegs: number; downSegs: number;
  topExtra: number;
  maxUpwardVyJump: number; // 峰頂附近一步內垂直速度「向上」跳變量的最大值（負值=向上，這裡取絕對值比較）
  airborneStepsAfterPeak: number; // 過峰頂後連續滯空幾步
  peakSinkOrPop: number; // 過峰頂瞬間車身 y 相對地形理論高度的偏差（負=浮起/彈起，正=陷入）
}

function runOne(upDeg: number, upSegs: number, downDeg: number, downSegs: number, topExtra: number): PeakResult {
  const { track, peakX } = makeTrack(upDeg, upSegs, downDeg, downSegs);
  const engine = Engine.create();
  engine.gravity.y = 0.5;
  const world = engine.world;
  Composite.add(world, buildTerrainBodiesParam(track, topExtra));

  const spawnX = TRACK.segmentWidth * 2;
  const spawnY = 0 - BIKE.wheelDropY - BIKE.wheelRadius;
  const bike: Bike = createBike(world, spawnX, spawnY);
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

  let maxUpwardVyJump = 0;
  let airborneStepsAfterPeak = 0;
  let peakSinkOrPop = 0;
  let sawPeak = false;
  let prevVy = 0;
  const DEBUG = process.env.PEAK_DEBUG === "1";

  for (let step = 0; step < 500; step++) {
    const grounded = rearContacts > 0 || frontContacts > 0;
    applyControls(grounded);
    const preVy = bike.chassis.velocity.y;
    Engine.update(engine, STEP);
    const c = bike.chassis;
    const vy = c.velocity.y;

    if (DEBUG && step >= 30 && step <= 150) {
      console.log(
        `s=${step} cx=${c.position.x.toFixed(1)} cy=${c.position.y.toFixed(1)} vy=${vy.toFixed(3)} ` +
        `rW=(${bike.rearWheel.position.x.toFixed(1)},${bike.rearWheel.position.y.toFixed(1)}) ` +
        `fW=(${bike.frontWheel.position.x.toFixed(1)},${bike.frontWheel.position.y.toFixed(1)}) ` +
        `rc=${rearContacts} fc=${frontContacts} ang=${(c.angle * 180 / Math.PI).toFixed(1)}°`,
      );
    }

    if (Math.abs(c.position.x - peakX) < TRACK.segmentWidth * 1.5) {
      sawPeak = true;
      const jump = preVy - vy; // 向上跳變 = preVy>vy（vy 變更負）
      if (jump > maxUpwardVyJump) maxUpwardVyJump = jump;
      const expectedY = terrainYAt(track, c.position.x) - BIKE.wheelDropY - BIKE.wheelRadius;
      const dev = c.position.y - expectedY; // 負=浮在理論地形之上（彈起），正=陷入
      if (Math.abs(dev) > Math.abs(peakSinkOrPop)) peakSinkOrPop = dev;
    }
    if (sawPeak && !grounded && c.position.x > peakX) airborneStepsAfterPeak++;
    if (sawPeak && grounded && c.position.x > peakX + TRACK.segmentWidth * 2) break;
    prevVy = vy;
  }

  return {
    upDeg, downDeg, upSegs, downSegs, topExtra,
    maxUpwardVyJump: Math.round(maxUpwardVyJump * 1000) / 1000,
    airborneStepsAfterPeak,
    peakSinkOrPop: Math.round(peakSinkOrPop * 10) / 10,
  };
}

function main() {
  if (process.env.PEAK_DEBUG === "1" && process.env.SCAN_ONE) {
    const [u, us, d, ds] = process.env.SCAN_ONE.split(",").map(Number);
    const te = parseInt(process.env.TOPEXTRA || "3", 10);
    console.log(`--- ${u}°(${us})→${d}°(${ds}) topExtra=${te} ---`);
    const r = runOne(u, us, d, ds, te);
    console.log(`結果: air=${r.airborneStepsAfterPeak} dev=${r.peakSinkOrPop}`);
    return;
  }
  if (process.env.SCAN_ONE) {
    // SCAN_ONE="60,1,60,1" 掃 topExtra=3..20 找副作用出現的門檻
    const [u, us, d, ds] = process.env.SCAN_ONE.split(",").map(Number);
    console.log(`掃描 ${u}°(${us})→${d}°(${ds}) 各 topExtra 值：\n`);
    for (const te of [3, 4, 5, 6, 7, 8, 9, 10, 12, 15]) {
      const r = runOne(u, us, d, ds, te);
      console.log(`topExtra=${String(te).padStart(2)}  air=${String(r.airborneStepsAfterPeak).padStart(3)}  dev=${r.peakSinkOrPop}  vyJump=${r.maxUpwardVyJump}`);
    }
    return;
  }

  const COMBOS: [number, number, number, number][] = [
    [30, 3, 30, 3], [45, 2, 45, 2], [45, 3, 60, 2], [55, 2, 55, 2],
    [60, 1, 60, 1], [60, 2, 45, 2], [70, 1, 70, 1], [75, 1, 75, 1],
    [75, 2, 75, 2], [30, 1, 75, 1], [75, 1, 30, 1],
  ];
  console.log("比較 topExtra=3（現行）vs topExtra=10（候選）在峰頂通過時的表現\n");
  console.log("up/down° upSegs/downSegs | topExtra=3: vyJump/airSteps/dev | topExtra=10: vyJump/airSteps/dev");
  for (const [u, us, d, ds] of COMBOS) {
    const r3 = runOne(u, us, d, ds, 3);
    const r10 = runOne(u, us, d, ds, 10);
    const flag = (r10.maxUpwardVyJump > r3.maxUpwardVyJump * 1.5 && r10.maxUpwardVyJump > 1) ? " ⚠️ 惡化" : "";
    console.log(
      `${u}°(${us})→${d}°(${ds})  |  3: vy=${r3.maxUpwardVyJump} air=${r3.airborneStepsAfterPeak} dev=${r3.peakSinkOrPop}  |  10: vy=${r10.maxUpwardVyJump} air=${r10.airborneStepsAfterPeak} dev=${r10.peakSinkOrPop}${flag}`,
    );
  }
}

main();
