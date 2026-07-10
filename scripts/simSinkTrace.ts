// ============================================================
// 深陷穿透「逐步追蹤 + 摔車判定」診斷腳本
// （2026-07-10：iOS PWA 玩家回報「車子沉下去、被彈上來、有時候死掉」）
//
// ⚠️ 為什麼不能直接用 simSteepLanding.ts 的結果下結論：
// 那支腳本沒有摔車判定，車子翻覆後仍繼續模擬，量到的「深陷」很多是
// 「一台已經該判死的殘骸陷進地形」——真實遊戲根本走不到那裡。本腳本補上
// GameCanvas.tsx 的真實死亡判定（topHit / stuckMidAir），把結果分成：
//   DEATH_topHit      → 對應玩家說的「有時候是死掉」
//   SURVIVED_DEEP     → 對應玩家說的「沉下去又被彈上來」（真正要修的 bug）
//   OK                → 正常
//
// 並記錄深陷當下的姿態，回答「從高處掉落 vs 側著進去」：
//   uprightAtSink（cos>0.55 正立）、vy（垂直速度）、單步位移 vs 輪半徑。
//
// 執行：
//   ./node_modules/.bin/esbuild scripts/simSinkTrace.ts --bundle --platform=node \
//     --format=cjs --outfile=sim-build/simSinkTrace.cjs
//   node sim-build/simSinkTrace.cjs trace [angle=72] [segs=4] [airThr=on|off]
//   node sim-build/simSinkTrace.cjs matrix [airThr=on|off]
// ============================================================

import { Engine, Events, Composite, Body, type IEventCollision } from "matter-js";
import { buildTerrainBodies, slopeAt, terrainYAt, type Track, type Vec2 } from "../src/game/terrain";
import { createBike, type Bike } from "../src/game/bike";
import { BIKE, DRIVE, TRACK, RULES } from "../src/game/constants";

const STEP = 1000 / 60;
const MODE = (process.argv[2] || "trace").replace(/^mode=/, "");

function argOf(name: string, dflt: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`${name}=`));
  return hit ? hit.split("=")[1] : dflt;
}

function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
function norm360(rad: number): number {
  let d = ((rad * 180) / Math.PI) % 360;
  if (d < 0) d += 360;
  return d;
}

function makeTrack(angleDeg: number, slopeSegs: number, flatSegsAfter: number): Track {
  const segW = TRACK.segmentWidth;
  const dyPerSeg = Math.tan((angleDeg * Math.PI) / 180) * segW;
  const RUN_UP = 6;
  const vertices: Vec2[] = [];
  let x = 0, y = 0;
  for (let i = 0; i <= RUN_UP; i++) vertices.push({ x: i * segW, y: 0 });
  x = RUN_UP * segW;
  for (let i = 1; i <= slopeSegs; i++) { x += segW; y += dyPerSeg; vertices.push({ x, y }); }
  for (let i = 1; i <= flatSegsAfter; i++) { x += segW; vertices.push({ x, y }); }
  const ys = vertices.map((v) => v.y);
  return {
    vertices, colors: Array(vertices.length - 1).fill("#2de2e6"),
    startX: segW, finishX: vertices[vertices.length - 1].x,
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
}

type Outcome = "OK" | "SURVIVED_DEEP" | "DEATH_topHit" | "DEATH_stuckMidAir";

interface Snap {
  step: number; x: number; ang: number; spd: number; vy: number;
  rearSink: number; frontSink: number; rearMove: number; frontMove: number;
  rc: number; fc: number; upright: boolean;
}

interface Result {
  angleDeg: number; slopeSegs: number;
  outcome: Outcome;
  deathStep: number;
  maxSinkAlive: number;        // 「還活著」期間量到的最大 sink（真正的 bug 指標）
  sinkStep: number;            // 首次 alive 深陷(>20px) 的 step
  uprightAtSink: boolean;      // 深陷當下是否正立（判斷 高處落下 vs 側翻插入）
  angAtSink: number;
  vyAtSink: number;
  moveAtSink: number;          // 深陷該步輪心位移
  dSinkAtSink: number;         // 深陷該步 sink 增量
  ejectVy: number;             // 深陷後最大向上速度（被彈上來的強度）
  snaps: Snap[];
}

function run(angleDeg: number, slopeSegs: number, airThrottle: boolean): Result {
  const track = makeTrack(angleDeg, slopeSegs, 30);
  const engine = Engine.create();
  engine.gravity.y = 0.5;
  Composite.add(engine.world, buildTerrainBodies(track)); // 真正上線的 terrain.ts

  const spawnX = TRACK.segmentWidth * 2;
  const spawnY = 0 - BIKE.wheelDropY - BIKE.wheelRadius;
  const bike: Bike = createBike(engine.world, spawnX, spawnY);
  for (const b of [bike.chassis, bike.rearWheel, bike.frontWheel]) {
    Body.setVelocity(b, { x: DRIVE.cruiseSpeed, y: 0 });
  }
  const spin0 = DRIVE.cruiseSpeed / BIKE.wheelRadius;
  Body.setAngularVelocity(bike.rearWheel, spin0);
  Body.setAngularVelocity(bike.frontWheel, spin0);

  let rc = 0, fc = 0;
  const onCol = (d: number) => (e: IEventCollision<Engine>) => {
    for (const p of e.pairs) {
      const L = [p.bodyA.label, p.bodyB.label];
      if (!L.includes("terrain")) continue;
      if (L.includes("rearWheel")) rc = Math.max(0, rc + d);
      if (L.includes("frontWheel")) fc = Math.max(0, fc + d);
    }
  };
  Events.on(engine, "collisionStart", onCol(1));
  Events.on(engine, "collisionEnd", onCol(-1));

  // 完整複製 GameCanvas.applyControls（含放開油門的空中自動回正分支）
  const applyControls = (grounded: boolean, thr: boolean) => {
    const c = bike.chassis;
    if (grounded) {
      const dx = bike.frontWheel.position.x - bike.rearWheel.position.x;
      const dy = bike.frontWheel.position.y - bike.rearWheel.position.y;
      const len = Math.hypot(dx, dy);
      if (len > 0.001) {
        const tx = dx / len, ty = dy / len;
        const nx = ty, ny = -tx;
        for (const b of [c, bike.rearWheel, bike.frontWheel]) {
          const vn = b.velocity.x * nx + b.velocity.y * ny;
          if (vn > 0) Body.setVelocity(b, { x: b.velocity.x - vn * nx, y: b.velocity.y - vn * ny });
        }
        if (thr) {
          const vt = c.velocity.x * tx + c.velocity.y * ty;
          const dv = (DRIVE.cruiseSpeed - vt) * DRIVE.groundLockEase;
          for (const b of [c, bike.rearWheel, bike.frontWheel]) {
            Body.setVelocity(b, { x: b.velocity.x + dv * tx, y: b.velocity.y + dv * ty });
          }
        }
      }
      const da = angleDelta(c.angle, slopeAt(track, bike.frontWheel.position.x));
      let av = da * DRIVE.groundAlignGain;
      if (Math.abs(av) > DRIVE.groundedAvMax) av = Math.sign(av) * DRIVE.groundedAvMax;
      Body.setAngularVelocity(c, av);
    } else if (thr) {
      Body.setAngularVelocity(c, Math.max(-DRIVE.airSpinMax, c.angularVelocity - DRIVE.airSpinAccel));
    } else {
      let av = c.angularVelocity;
      if (av < 0) av = Math.min(0, av + DRIVE.airSpinBrakeAccel);
      Body.setAngularVelocity(c, Math.min(DRIVE.airNoseForwardMax, av + DRIVE.airNoseForwardAccel));
    }
  };

  // ⚠️ 不可用「輪心y −(地表y − r)」：那只在平地成立（斜坡上輪子靜止時輪心是沿法線離
  // 地表 r，垂直距離是 r/cosθ，75° 坡完美貼地會被誤算成 ±17px）。見 simSinkScan.ts。
  const segIdx = (x: number) => {
    const v = track.vertices;
    let lo = 0, hi = v.length - 2;
    while (lo < hi) { const m = (lo + hi) >> 1; if (v[m + 1].x < x) lo = m + 1; else hi = m; }
    return lo;
  };
  const surfaceDist = (p: { x: number; y: number }): number => {
    const v = track.vertices;
    const i = segIdx(p.x);
    let best = Infinity;
    for (let k = Math.max(0, i - 2); k <= Math.min(v.length - 2, i + 2); k++) {
      const a = v[k], b = v[k + 1];
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
      const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      if (d < best) best = d;
    }
    return p.y < terrainYAt(track, p.x) ? best : -best;
  };
  const sinkOf = (b: Body) => BIKE.wheelRadius - surfaceDist(b.position);

  const snaps: Snap[] = [];
  let prevRear = { ...bike.rearWheel.position };
  let prevFront = { ...bike.frontWheel.position };
  let crashTimer = 0;
  let outcome: Outcome = "OK";
  let deathStep = -1;
  let maxSinkAlive = 0, sinkStep = -1, uprightAtSink = false, angAtSink = 0, vyAtSink = 0;
  let moveAtSink = 0, dSinkAtSink = 0;
  let prevSink = 0;

  const MAX_STEPS = 900;
  for (let step = 0; step < MAX_STEPS; step++) {
    const grounded = rc > 0 || fc > 0;
    // 空中是否按油門：airThr=on → 一直按（後空翻）；off → 空中放開（自動回正）
    const thr = grounded ? true : airThrottle;
    applyControls(grounded, thr);
    Engine.update(engine, STEP);

    const c = bike.chassis;
    const rearMove = Math.hypot(bike.rearWheel.position.x - prevRear.x, bike.rearWheel.position.y - prevRear.y);
    const frontMove = Math.hypot(bike.frontWheel.position.x - prevFront.x, bike.frontWheel.position.y - prevFront.y);
    prevRear = { ...bike.rearWheel.position };
    prevFront = { ...bike.frontWheel.position };

    const rearSink = sinkOf(bike.rearWheel);
    const frontSink = sinkOf(bike.frontWheel);
    const sink = Math.max(rearSink, frontSink);
    const upright = Math.cos(c.angle) > RULES.uprightCosThreshold;

    snaps.push({
      step, x: c.position.x, ang: norm360(c.angle),
      spd: Math.hypot(c.velocity.x, c.velocity.y), vy: c.velocity.y,
      rearSink, frontSink, rearMove, frontMove, rc, fc, upright,
    });

    // ── 真實死亡判定（複製 GameCanvas.tsx）──
    const bothOff = rc === 0 && fc === 0;
    const speed = Math.hypot(c.velocity.x, c.velocity.y);
    const tippedOver = Math.cos(c.angle) < RULES.crashTipCos;
    const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
    const topHit = tippedOver && BIKE.crashZone.some(({ x: lx, y: ly }) => {
      const wx = ca * lx - sa * ly + c.position.x;
      const wy = sa * lx + ca * ly + c.position.y;
      return wy > terrainYAt(track, wx);
    });
    const stuckMidAir = bothOff && speed < 0.5;

    if (topHit) { outcome = "DEATH_topHit"; deathStep = step; break; }
    if (stuckMidAir) {
      crashTimer += STEP / 1000;
      if (crashTimer >= RULES.crashUpsideDownSec) { outcome = "DEATH_stuckMidAir"; deathStep = step; break; }
    } else crashTimer = 0;

    // ── 還活著時的深陷（這才是要修的 bug）──
    if (sink > maxSinkAlive) maxSinkAlive = sink;
    if (sink > 20 && sinkStep < 0) {
      sinkStep = step; uprightAtSink = upright; angAtSink = norm360(c.angle); vyAtSink = c.velocity.y;
      moveAtSink = Math.max(rearMove, frontMove);
      dSinkAtSink = sink - prevSink;
    }
    prevSink = sink;

    if (c.position.x > track.finishX - TRACK.segmentWidth) break;
  }

  if (outcome === "OK" && maxSinkAlive > 20) outcome = "SURVIVED_DEEP";

  const after = sinkStep >= 0 ? snaps.slice(sinkStep, sinkStep + 40) : [];
  const ejectVy = after.length ? -Math.min(...after.map((s) => s.vy)) : 0;

  return {
    angleDeg, slopeSegs, outcome, deathStep,
    maxSinkAlive: Math.round(maxSinkAlive * 10) / 10,
    sinkStep, uprightAtSink, angAtSink, vyAtSink, moveAtSink, dSinkAtSink,
    ejectVy, snaps,
  };
}

function doTrace() {
  const angle = parseFloat(argOf("angle", "72"));
  const segs = parseInt(argOf("segs", "4"), 10);
  const airThr = argOf("airThr", "on") === "on";
  const r = run(angle, segs, airThr);

  console.log(`=== angle=${angle}° segs=${segs} airThrottle=${airThr ? "on(後空翻)" : "off(自動回正)"} ===`);
  console.log(`結果: ${r.outcome}${r.deathStep >= 0 ? ` @step ${r.deathStep}` : ""}`);
  console.log(`存活期間最大 sink = ${r.maxSinkAlive}px（輪半徑 ${BIKE.wheelRadius}px）\n`);

  if (r.sinkStep < 0) { console.log("存活期間沒有深陷（sink 從未 >20px）"); return; }

  console.log(`首次「存活深陷」@step ${r.sinkStep}：`);
  console.log(`  車身角度=${r.angAtSink.toFixed(0)}°  正立=${r.uprightAtSink ? "是" : "否"}  vy=${r.vyAtSink.toFixed(2)}px/step`);
  console.log(`  該步輪心位移=${r.moveAtSink.toFixed(2)}px  sink 增量=${r.dSinkAtSink.toFixed(2)}px  輪半徑=${BIKE.wheelRadius}px`);
  if (r.moveAtSink > BIKE.wheelRadius) console.log(`  → 單步位移 > 輪半徑：具備離散碰撞穿透(tunneling)條件`);
  console.log(`  深陷後最大向上速度=${r.ejectVy.toFixed(2)}px/step ${r.ejectVy > 8 ? "→ 明顯彈飛" : ""}\n`);

  const i0 = Math.max(0, r.sinkStep - 8), i1 = Math.min(r.snaps.length - 1, r.sinkStep + 14);
  console.log("step |    x    ang°  spd    vy   | rearSink frontSink | rMove fMove | ct  upright");
  console.log("-".repeat(96));
  for (let i = i0; i <= i1; i++) {
    const s = r.snaps[i];
    console.log(
      `${String(s.step).padStart(4)} |${s.x.toFixed(0).padStart(6)} ${s.ang.toFixed(0).padStart(4)} ` +
      `${s.spd.toFixed(2).padStart(5)} ${s.vy.toFixed(2).padStart(6)} |` +
      `${s.rearSink.toFixed(1).padStart(9)} ${s.frontSink.toFixed(1).padStart(9)} |` +
      `${s.rearMove.toFixed(1).padStart(6)}${s.frontMove.toFixed(1).padStart(6)} |` +
      ` r${s.rc}f${s.fc} ${s.upright ? "正立" : "翻覆"}${s.step === r.sinkStep ? " <== 首次存活深陷" : ""}`,
    );
  }
}

function doMatrix() {
  const airThr = argOf("airThr", "on") === "on";
  const ANGLES = [40, 45, 50, 52, 55, 57, 60, 62, 65, 67, 70, 72, 75];
  const SEGS = [1, 2, 3, 4, 6];
  const rows: Result[] = [];
  for (const a of ANGLES) for (const s of SEGS) rows.push(run(a, s, airThr));

  console.log(`airThrottle=${airThr ? "on(空中按住=後空翻)" : "off(空中放開=自動回正)"}\n`);
  console.log("angle segs | outcome           | maxSinkAlive | 深陷時正立? ang°   vy    單步位移");
  console.log("-".repeat(94));
  for (const r of rows) {
    if (r.outcome === "OK") continue;
    console.log(
      `${String(r.angleDeg).padStart(3)}° ${r.slopeSegs}seg | ${r.outcome.padEnd(17)} | ` +
      `${String(r.maxSinkAlive).padStart(11)} | ` +
      (r.sinkStep >= 0
        ? `${(r.uprightAtSink ? "正立" : "翻覆").padEnd(6)} ${r.angAtSink.toFixed(0).padStart(4)} ${r.vyAtSink.toFixed(1).padStart(6)} ${r.moveAtSink.toFixed(1).padStart(6)}px`
        : "—"),
    );
  }

  const n = rows.length;
  const cnt = (o: Outcome) => rows.filter((r) => r.outcome === o).length;
  const survivedDeep = rows.filter((r) => r.outcome === "SURVIVED_DEEP");
  console.log(`\n===== 共 ${n} 組：OK=${cnt("OK")}  SURVIVED_DEEP=${cnt("SURVIVED_DEEP")}  DEATH_topHit=${cnt("DEATH_topHit")}  DEATH_stuckMidAir=${cnt("DEATH_stuckMidAir")} =====`);
  if (survivedDeep.length) {
    const upr = survivedDeep.filter((r) => r.uprightAtSink).length;
    const tunnel = survivedDeep.filter((r) => r.moveAtSink > BIKE.wheelRadius).length;
    console.log(`SURVIVED_DEEP 中：正立時深陷 ${upr}/${survivedDeep.length}；單步位移 > 輪半徑 ${tunnel}/${survivedDeep.length}`);
    console.log(`最深：${Math.max(...survivedDeep.map((r) => r.maxSinkAlive))}px`);
  }
}

if (MODE === "matrix") doMatrix(); else doTrace();
