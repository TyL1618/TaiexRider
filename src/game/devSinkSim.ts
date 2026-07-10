// ============================================================
// [DEV ONLY] 瀏覽器內「沉沒率」自動驗證
//
// 用**目前面板上的參數**（constants 物件已被 devTuning 就地改過）跑 N 局隨機股價賽道，
// 統計「車子還活著時陷進地形」的比例。讓你在調手感的同一個畫面上，立刻知道這組參數
// 有沒有把穿透 bug 修掉，不用切回終端機跑 headless 腳本。
//
// 邏輯與 scripts/simSinkScan.ts 同源（含真實 topHit/stuckMidAir 摔車判定與卡住脫困
// watchdog）。⚠️ 這裡是 GameCanvas 物理迴圈的鏡像，改 GameCanvas 的控制律/子步換算時
// 兩邊都要同步改，否則驗證結果會失真。
// ============================================================

import { Engine, Events, Composite, Body, type IEventCollision } from "matter-js";
import { pricesToTrack, buildTerrainBodies, surfaceDistance, surfaceNormal, terrainYAt, type Track } from "./terrain";
import { createBike } from "./bike";
import { BIKE, DRIVE, PHYSICS, RULES } from "./constants";

const STEP = 1000 / 60;
const SINK_DEEP = 12; // ≥ 2×輪半徑 = 整顆輪子沒入（玩家看得到的破圖）

export interface ScanResult {
  runs: number;
  finished: number;
  deathTopHit: number;
  deathStuckMidAir: number;
  timeout: number;
  submergedRuns: number; // 存活中輪心沒入地表(>6px)的局數
  deepRuns: number;      // 存活中整顆輪子沒入(>12px)的局數
  maxSink: number;
  subSteps: number;
  stepMove: number;      // 單步位移 = cruiseSpeed / subSteps
}

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function genPrices(seed: number): number[] {
  const rand = seededRand(seed * 7919 + 13);
  const n = 90 + Math.floor(rand() * 60);
  const vol = 0.001 + rand() * 0.059;
  const prices = [100];
  for (let i = 1; i < n; i++) {
    let stepPct = (rand() * 2 - 1) * vol;
    if (rand() < 0.02) stepPct = (rand() > 0.5 ? 1 : -1) * (0.06 + rand() * 0.04);
    prices.push(Math.max(1, prices[i - 1] * (1 + stepPct)));
  }
  return prices;
}

function segIdxOf(track: Track, x: number): number {
  const v = track.vertices;
  let lo = 0, hi = v.length - 2;
  while (lo < hi) { const m = (lo + hi) >> 1; if (v[m + 1].x < x) lo = m + 1; else hi = m; }
  return lo;
}
function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

type Outcome = "finished" | "death_topHit" | "death_stuckMidAir" | "timeout";

function simulateOne(seed: number): { outcome: Outcome; maxSinkAlive: number } {
  const sub = Math.max(1, Math.round(PHYSICS.subSteps));
  const subDelta = STEP / sub;
  const easeSub = sub === 1 ? DRIVE.groundLockEase : 1 - Math.pow(1 - DRIVE.groundLockEase, 1 / sub);

  const engine = Engine.create();
  engine.gravity.y = PHYSICS.gravityY * sub;
  engine.positionIterations = PHYSICS.positionIterations;
  engine.velocityIterations = PHYSICS.velocityIterations;

  const track = pricesToTrack(genPrices(seed));
  Composite.add(engine.world, buildTerrainBodies(track));

  const HOVER = 67;
  const bike = createBike(
    engine.world,
    track.startX,
    track.vertices[0].y - BIKE.wheelDropY - BIKE.wheelRadius - 1 - HOVER,
  );

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

  // safe 玩法（地面按住、空中放開）＝最貼近真實玩家的操作
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
          const v = Body.getVelocity(b);
          const vn = v.x * nx + v.y * ny;
          if (vn > 0) Body.setVelocity(b, { x: v.x - vn * nx, y: v.y - vn * ny });
        }
        if (thr) {
          const vc = Body.getVelocity(c);
          const vt = vc.x * tx + vc.y * ty;
          const dv = (DRIVE.cruiseSpeed - vt) * easeSub;
          for (const b of [c, bike.rearWheel, bike.frontWheel]) {
            const v = Body.getVelocity(b);
            Body.setVelocity(b, { x: v.x + dv * tx, y: v.y + dv * ty });
          }
        }
      }
      const v = track.vertices;
      const i = segIdxOf(track, bike.frontWheel.position.x);
      const slope = Math.atan2(v[i + 1].y - v[i].y, v[i + 1].x - v[i].x);
      let av = angleDelta(c.angle, slope) * DRIVE.groundAlignGain;
      if (Math.abs(av) > DRIVE.groundedAvMax) av = Math.sign(av) * DRIVE.groundedAvMax;
      Body.setAngularVelocity(c, av);
    } else if (thr) {
      Body.setAngularVelocity(c, Math.max(-DRIVE.airSpinMax, Body.getAngularVelocity(c) - DRIVE.airSpinAccel / sub));
    } else {
      let av = Body.getAngularVelocity(c);
      if (av < 0) av = Math.min(0, av + DRIVE.airSpinBrakeAccel / sub);
      Body.setAngularVelocity(c, Math.min(DRIVE.airNoseForwardMax, av + DRIVE.airNoseForwardAccel / sub));
    }
  };

  // 穿透修正（與 GameCanvas 同邏輯）：陷入 >1px 就沿地形法線推回，消掉往內速度
  const depen = (w: Body) => {
    const { dist, nx, ny } = surfaceNormal(track, w.position);
    const pen = BIKE.wheelRadius - dist;
    if (pen <= 1.0) return;
    const push = Math.min(pen, BIKE.wheelRadius);
    Body.setPosition(w, { x: w.position.x + nx * push, y: w.position.y + ny * push });
    const v = Body.getVelocity(w);
    const vn = v.x * nx + v.y * ny;
    if (vn < 0) Body.setVelocity(w, { x: v.x - vn * nx, y: v.y - vn * ny });
  };

  const vFirst = track.vertices[0].x;
  const vLast = track.vertices[track.vertices.length - 1].x;
  const inRange = (b: Body) => b.position.x > vFirst + 2 && b.position.x < vLast - 2;

  let hasEverGrounded = false, crashTimer = 0, maxSinkAlive = 0;
  let assistLeft = 0;
  const jamHist: number[] = [];
  let outcome: Outcome = "timeout";

  for (let step = 0; step < 6000; step++) {
    const grounded = rc > 0 || fc > 0;
    if (grounded) hasEverGrounded = true;
    const botThr = grounded; // safe bot

    if (assistLeft > 0) { assistLeft--; jamHist.length = 0; }
    else if (grounded && botThr) {
      jamHist.push(bike.chassis.position.x);
      if (jamHist.length > 40) jamHist.shift();
      if (jamHist.length === 40 && Math.abs(bike.chassis.position.x - jamHist[0]) < 3) {
        assistLeft = 60; jamHist.length = 0;
      }
    } else jamHist.length = 0;
    const thr = botThr && assistLeft <= 0;

    for (let s = 0; s < sub; s++) {
      applyControls(rc > 0 || fc > 0, thr);
      Engine.update(engine, subDelta);
      if (PHYSICS.depenetrate !== 0) { depen(bike.rearWheel); depen(bike.frontWheel); }
    }

    const c = bike.chassis;
    if (hasEverGrounded) {
      const cv = Body.getVelocity(c);
      const speed = Math.hypot(cv.x, cv.y);
      const tipped = Math.cos(c.angle) < RULES.crashTipCos;
      const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
      const topHit = tipped && BIKE.crashZone.some(({ x: lx, y: ly }) => {
        const wx = ca * lx - sa * ly + c.position.x;
        const wy = sa * lx + ca * ly + c.position.y;
        return wy > terrainYAt(track, wx);
      });
      if (topHit) { outcome = "death_topHit"; break; }
      if (rc === 0 && fc === 0 && speed < 0.5) {
        crashTimer += STEP / 1000;
        if (crashTimer >= RULES.crashUpsideDownSec) { outcome = "death_stuckMidAir"; break; }
      } else crashTimer = 0;

      if (inRange(bike.rearWheel) && inRange(bike.frontWheel)) {
        const sink = Math.max(
          BIKE.wheelRadius - surfaceDistance(track, bike.rearWheel.position),
          BIKE.wheelRadius - surfaceDistance(track, bike.frontWheel.position),
        );
        if (sink > maxSinkAlive) maxSinkAlive = sink;
      }
    }

    if (c.position.x >= track.finishX) { outcome = "finished"; break; }
  }

  // 釋放：Matter 物件都在區域 engine 裡，交給 GC 即可
  Composite.clear(engine.world, false);
  Engine.clear(engine);
  return { outcome, maxSinkAlive };
}

/** 跑 N 局；每 8 局讓出主執行緒一次，面板才不會凍住。 */
export async function runSinkScan(runs: number, onProgress?: (done: number) => void): Promise<ScanResult> {
  const r: ScanResult = {
    runs, finished: 0, deathTopHit: 0, deathStuckMidAir: 0, timeout: 0,
    submergedRuns: 0, deepRuns: 0, maxSink: 0,
    subSteps: Math.max(1, Math.round(PHYSICS.subSteps)),
    stepMove: DRIVE.cruiseSpeed / Math.max(1, Math.round(PHYSICS.subSteps)),
  };
  for (let seed = 1; seed <= runs; seed++) {
    const one = simulateOne(seed);
    if (one.outcome === "finished") r.finished++;
    else if (one.outcome === "death_topHit") r.deathTopHit++;
    else if (one.outcome === "death_stuckMidAir") r.deathStuckMidAir++;
    else r.timeout++;
    if (one.maxSinkAlive > BIKE.wheelRadius) r.submergedRuns++;
    if (one.maxSinkAlive > SINK_DEEP) r.deepRuns++;
    if (one.maxSinkAlive > r.maxSink) r.maxSink = one.maxSinkAlive;

    if (seed % 8 === 0) {
      onProgress?.(seed);
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  onProgress?.(runs);
  return r;
}
