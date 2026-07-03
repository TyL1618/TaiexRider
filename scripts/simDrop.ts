// ============================================================
// 平地縫隙卡輪 headless 定點落下模擬（CLAUDE.md 家裡 Claude 剩餘任務）
//
// 使用者回報：高速墜落、落點正好在「兩段平坦梯形共用垂直邊」→ 輪子楔入
// 縫隙卡住（放開油門可脫困）。本腳本在全平地賽道上做「定點高空落下」
// 矩陣測試：落下高度 × 接縫偏移 × 有/無前進速度，量化卡住率，
// 並比較修法候選：
//   none    = 現況（terrain.ts buildTerrainBodies，topExtra=3）
//   extraN  = 接縫頂部重疊加大為 N px（如 extra6 / extra10）
//   merge   = 共線相鄰段合併成單一梯形 → 平地完全無接縫（結構性根治）
//
// 執行（同 simStuck 需先 esbuild 打包）：
//   ./node_modules/.bin/esbuild scripts/simDrop.ts --bundle --platform=node \
//     --format=cjs --outfile=sim-build/simDrop.cjs
//   node sim-build/simDrop.cjs [fix=none|extra6|extra10|merge] [offStep=0.5]
// 報告輸出：sim-build/sim-drop-report-{fix}.json（已 gitignore）
// ============================================================

import { Engine, Events, Composite, Body, Bodies, Vertices, type IEventCollision } from "matter-js";
import { buildTerrainBodies, terrainYAt, type Track } from "../src/game/terrain";
import { createBike, type Bike } from "../src/game/bike";
import { BIKE, DRIVE, TRACK, RULES } from "../src/game/constants";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------- 參數 ----------
const FIX = process.argv[2] || "none";
const OFF_STEP = parseFloat(process.argv[3] || "0.5");
const STEP = 1000 / 60;
const HEIGHTS = [400, 800, 1500];           // 落下高度 (px，輪底距地面)
const OFF_RANGE = 10;                       // 接縫偏移 ±px
const VXS = [0, DRIVE.cruiseSpeed];         // 垂直落下 / 帶巡航前速落下
const TILTS = [-15, 0, 15];                 // 落下時車身傾角（°，正=車頭朝下）→ 單輪先著地
const SETTLE_STEPS = 60;   // 落地後等穩定
const PROBE_STEPS = 240;   // 之後持續按住油門觀察 4 秒（對應使用者「按住卡死」）
const STUCK_DX = 40;       // 4 秒前進 < 40px 即判卡住

// ---------- 地形變體 ----------
// 真實地圖的「視覺平地」有價格噪音 → 接縫頂點可能比鄰居低/高 1~3px。
// 頂點比兩鄰居低（micro-peak）會觸發 buildTerrainBodies 的「峰頂不延伸」規則
// → topExtra 歸零 → 裸露垂直接縫角（嫌疑最大）。
type Variant = { name: string; d: number }; // d>0 = 接縫頂點抬高 d px（micro-peak）；d<0 = 壓低（micro-valley）；0 = 純平
const VARIANTS: Variant[] = [
  { name: "flat", d: 0 },
  { name: "peak0.5", d: 0.5 }, { name: "peak1", d: 1 }, { name: "peak2", d: 2 }, { name: "peak4", d: 4 },
  { name: "valley1", d: -1 }, { name: "valley2", d: -2 },
];

const GROUND_Y = 560;
const N_SEG = 64;                    // 賽道長 64×80=5120px：探測期 300 步 × ~6.9px 不會衝出盡頭
const MID = 20;                      // 目標接縫 x=1600，後方留 ~3500px 跑道

// 手工建 Track：平地 + 中央接縫頂點 y 微調（d>0 = 抬高 = y 減小）
function makeTrack(d: number): Track {
  const vertices = Array.from({ length: N_SEG + 1 }, (_, i) => ({
    x: i * TRACK.segmentWidth,
    y: i === MID ? GROUND_Y - d : GROUND_Y,
  }));
  const ys = vertices.map((v) => v.y);
  return {
    vertices,
    colors: Array(N_SEG).fill("#2de2e6"),
    startX: TRACK.segmentWidth,
    finishX: vertices[N_SEG].x,
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

// 參數化版 buildTerrainBodies（copy 自 terrain.ts，topExtra 可調 + 可共線合併）
function buildParamBodies(t: Track, topExtra: number, merge: boolean): Body[] {
  const bodies: Body[] = [];
  const v = t.vertices;
  const baseY = t.maxY + 800;
  const overlap = TRACK.segmentWidth;

  // 分組：merge 時把「共線」的相鄰段合成一組（cross ≈ 0），否則每段一組
  const groups: { i0: number; i1: number }[] = [];
  let i0 = 0;
  for (let i = 1; i < v.length - 1; i++) {
    const a = v[i - 1], b = v[i], c = v[i + 1];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const collinear = Math.abs(cross) < 1e-6;
    if (!(merge && collinear)) {
      groups.push({ i0, i1: i });
      i0 = i;
    }
  }
  groups.push({ i0, i1: v.length - 1 });

  for (const g of groups) {
    const a = v[g.i0];
    const b = v[g.i1];
    const aPrev = g.i0 > 0 ? v[g.i0 - 1] : null;
    const bNext = g.i1 < v.length - 1 ? v[g.i1 + 1] : null;
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

function buildBodies(track: Track): Body[] {
  if (FIX === "none") return buildTerrainBodies(track);
  if (FIX === "merge") return buildParamBodies(track, 3, true);
  const m = /^extra(\d+)$/.exec(FIX);
  if (m) return buildParamBodies(track, parseInt(m[1], 10), false);
  throw new Error(`unknown fix: ${FIX}`);
}

// ---------- 單次落下 ----------
interface DropResult {
  variant: string;
  h: number; off: number; vx: number; tilt: number;
  outcome: "ok" | "stuck" | "crash"; // crash=遊戲內會判死（車頂觸地）→ 非卡輪 bug
  landed: boolean;
  progress: number;      // 油門探測期前進距離
  maxSinkRear: number;   // 輪心低於「正常貼地位置」最大深度 (px)
  maxSinkFront: number;
  impactSpeed: number;   // 首次觸地瞬間垂直速度 (px/step)
  // 終局狀態（stuck 診斷用）
  end?: { angleDeg: number; chassisSink: number; rearSink: number; frontSink: number; rc: number; fc: number };
}

function dropRun(variant: Variant, track: Track, h: number, off: number, vx: number, tiltDeg: number): DropResult {
  const engine = Engine.create();
  engine.gravity.y = 0.5;
  const world = engine.world;
  Composite.add(world, buildBodies(track));

  // 目標：後輪心 x 落在「中央接縫 seamX + off」
  const seamX = track.vertices[MID].x;
  const spawnX = seamX + off + BIKE.wheelBaseHalf; // chassis 中心 → 後輪 = spawnX - wheelBaseHalf
  const wheelRestY = GROUND_Y - BIKE.wheelRadius;   // 正常貼地時輪心 y（微起伏 ≤4px 忽略）
  const spawnY = wheelRestY - h - BIKE.wheelDropY;  // 輪心先於 chassis 下方 wheelDropY
  const bike: Bike = createBike(world, spawnX, spawnY);
  // 傾角：繞 chassis 中心旋轉整台車（正=順時針=車頭朝下）→ 單輪先著地
  if (tiltDeg !== 0) {
    const rad = (tiltDeg * Math.PI) / 180;
    const cx = bike.chassis.position.x, cy = bike.chassis.position.y;
    Body.setAngle(bike.chassis, rad);
    for (const w of [bike.rearWheel, bike.frontWheel]) {
      const dx = w.position.x - cx, dy = w.position.y - cy;
      Body.setPosition(w, {
        x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
        y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
      });
    }
  }
  if (vx > 0) {
    for (const b of [bike.chassis, bike.rearWheel, bike.frontWheel]) {
      Body.setVelocity(b, { x: vx, y: 0 });
    }
  }
  // 輪子帶巡航轉速（真實跳落情境：起跳前輪子在地面滾動，ω = v/r）。
  // 旋轉中的輪子以 friction=1 咬接縫邊緣，是靜止輪重現不了的 catch 條件。
  const wheelSpin = DRIVE.cruiseSpeed / BIKE.wheelRadius;
  Body.setAngularVelocity(bike.rearWheel, wheelSpin);
  Body.setAngularVelocity(bike.frontWheel, wheelSpin);

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

  // applyControls — 對照 GameCanvas（safe bot：著地才油門）
  let throttle = false;
  let hasEverGrounded = false;
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
        if (throttle) {
          const vt = c.velocity.x * tx + c.velocity.y * ty;
          const delta = (DRIVE.cruiseSpeed - vt) * DRIVE.groundLockEase;
          Body.setVelocity(c, { x: c.velocity.x + delta * tx, y: c.velocity.y + delta * ty });
          Body.setVelocity(bike.rearWheel, { x: bike.rearWheel.velocity.x + delta * tx, y: bike.rearWheel.velocity.y + delta * ty });
          Body.setVelocity(bike.frontWheel, { x: bike.frontWheel.velocity.x + delta * tx, y: bike.frontWheel.velocity.y + delta * ty });
        }
      }
      // 平地 slope = 0
      let d = 0 - c.angle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      let av = d * DRIVE.groundAlignGain;
      if (Math.abs(av) > DRIVE.groundedAvMax) av = Math.sign(av) * DRIVE.groundedAvMax;
      Body.setAngularVelocity(c, av);
    } else if (throttle && hasEverGrounded) {
      const nv = Math.max(-DRIVE.airSpinMax, c.angularVelocity - DRIVE.airSpinAccel);
      Body.setAngularVelocity(c, nv);
    } else {
      let av = c.angularVelocity;
      if (av < 0) av = Math.min(0, av + DRIVE.airSpinBrakeAccel);
      Body.setAngularVelocity(c, Math.min(DRIVE.airNoseForwardMax, av + DRIVE.airNoseForwardAccel));
    }
  };

  let wasGrounded = false;
  let landedStep = -1;
  let probeStartX = 0;
  let maxSinkRear = 0, maxSinkFront = 0;
  let impactSpeed = 0;
  let progress = 0;
  let outcome: DropResult["outcome"] = "ok";
  let landed = false;
  let crashTimer = 0;

  const MAX = 1800;
  for (let step = 0; step < MAX; step++) {
    const grounded = rearContacts > 0 || frontContacts > 0;
    // 首次觸地前＝純自由落體（不跑 applyControls，鎖角度）→ 落地傾角完全由 TILT 控制，
    // 排除空中車頭前壓漂移污染實驗（真實遊戲落地角度本就千變萬化，這裡逐一掃描）。
    // 觸地後＝「永遠按住」：對應使用者回報「按住卡死、放開才脫困」。
    throttle = hasEverGrounded;
    if (hasEverGrounded) applyControls(grounded);
    else Body.setAngularVelocity(bike.chassis, 0);
    const preVy = bike.rearWheel.velocity.y;
    Engine.update(engine, STEP);

    const groundedNow = rearContacts > 0 || frontContacts > 0;
    if (groundedNow && !hasEverGrounded) {
      hasEverGrounded = true;
      landed = true;
      landedStep = step;
      impactSpeed = Math.round(preVy * 100) / 100;
    }
    if (!groundedNow && wasGrounded) Body.setAngularVelocity(bike.chassis, 0);
    wasGrounded = groundedNow;

    if (hasEverGrounded) {
      maxSinkRear = Math.max(maxSinkRear, bike.rearWheel.position.y - wheelRestY);
      maxSinkFront = Math.max(maxSinkFront, bike.frontWheel.position.y - wheelRestY);
    }
    if (process.env.DROP_DEBUG && hasEverGrounded && (step - landedStep) % 5 === 0 && step - landedStep <= 120) {
      const cc = bike.chassis;
      console.log(`[dr] s=${step - landedStep} thr=${throttle ? 1 : 0} g=${grounded ? 1 : 0} cx=${cc.position.x.toFixed(1)} cy=${cc.position.y.toFixed(1)} ang=${(cc.angle * 180 / Math.PI).toFixed(1)}° av=${cc.angularVelocity.toFixed(3)} rW=(${bike.rearWheel.position.x.toFixed(1)},${bike.rearWheel.position.y.toFixed(1)}) fW=(${bike.frontWheel.position.x.toFixed(1)},${bike.frontWheel.position.y.toFixed(1)}) rc=${rearContacts} fc=${frontContacts}`);
    }

    // 死亡判定（對照 GameCanvas）：遊戲內會判死的 case 不算「卡輪」bug
    const c = bike.chassis;
    const tippedOver = Math.cos(c.angle) < RULES.crashTipCos;
    if (tippedOver) {
      const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
      const topHit = BIKE.crashZone.some(({ x: lx, y: ly }) => {
        const wx = ca * lx - sa * ly + c.position.x;
        const wy = sa * lx + ca * ly + c.position.y;
        return wy > terrainYAt(track, wx);
      });
      if (topHit) {
        crashTimer += STEP / 1000;
        if (crashTimer >= RULES.crashUpsideDownSec) {
          if (process.env.DROP_DEBUG) console.log(`[crash] step=${step} ang=${(c.angle * 180 / Math.PI).toFixed(1)}° cy=${c.position.y.toFixed(1)} rW=${bike.rearWheel.position.y.toFixed(1)} fW=${bike.frontWheel.position.y.toFixed(1)} landedStep=${landedStep}`);
          outcome = "crash"; break;
        }
      } else crashTimer = 0;
    } else crashTimer = 0;

    if (landedStep >= 0 && step === landedStep + SETTLE_STEPS) probeStartX = c.position.x;
    if (landedStep >= 0 && step === landedStep + SETTLE_STEPS + PROBE_STEPS) {
      progress = Math.round(c.position.x - probeStartX);
      if (progress < STUCK_DX) outcome = "stuck";
      break;
    }
  }

  Events.off(engine, "collisionStart");
  Events.off(engine, "collisionEnd");
  Engine.clear(engine);
  const end = outcome === "stuck" ? {
    angleDeg: Math.round((bike.chassis.angle * 180 / Math.PI) % 360),
    chassisSink: Math.round(bike.chassis.position.y - (wheelRestY - BIKE.wheelDropY)),
    rearSink: Math.round(bike.rearWheel.position.y - wheelRestY),
    frontSink: Math.round(bike.frontWheel.position.y - wheelRestY),
    rc: rearContacts, fc: frontContacts,
  } : undefined;
  return {
    variant: variant.name,
    h, off, vx: Math.round(vx * 100) / 100, tilt: tiltDeg,
    outcome, landed, progress,
    maxSinkRear: Math.round(maxSinkRear * 10) / 10,
    maxSinkFront: Math.round(maxSinkFront * 10) / 10,
    impactSpeed,
    end,
  };
}

// ---------- 單案例 debug（DROP_DEBUG="h,off,vx,tilt,variantName"）----------
function debugOne(spec: string) {
  const [h, off, vx, tilt, vname] = spec.split(",");
  const variant = VARIANTS.find((v) => v.name === (vname || "flat"))!;
  const track = makeTrack(variant.d);
  const engine = Engine.create();
  engine.gravity.y = 0.5;
  Composite.add(engine.world, buildBodies(track));
  const seamX = track.vertices[MID].x;
  const spawnX = seamX + parseFloat(off) + BIKE.wheelBaseHalf;
  const wheelRestY = GROUND_Y - BIKE.wheelRadius;
  const spawnY = wheelRestY - parseFloat(h) - BIKE.wheelDropY;
  const bike = createBike(engine.world, spawnX, spawnY);
  let rc = 0, fc = 0;
  const onC = (d: number) => (e: IEventCollision<Engine>) => {
    for (const p of e.pairs) {
      const L = [p.bodyA.label, p.bodyB.label];
      if (!L.includes("terrain")) continue;
      if (L.includes("rearWheel")) rc = Math.max(0, rc + d);
      if (L.includes("frontWheel")) fc = Math.max(0, fc + d);
    }
  };
  Events.on(engine, "collisionStart", onC(1));
  Events.on(engine, "collisionEnd", onC(-1));
  let grounded0 = false;
  for (let s = 0; s < 600; s++) {
    Engine.update(engine, STEP);
    const g = rc > 0 || fc > 0;
    if (g && !grounded0) { grounded0 = true; console.log(`--- 首次觸地 @step ${s} ---`); }
    if (grounded0 && s % 5 === 0) {
      const c = bike.chassis;
      console.log(`s=${s} cx=${c.position.x.toFixed(1)} cy=${c.position.y.toFixed(1)} vy=${c.velocity.y.toFixed(2)} ang=${(c.angle * 180 / Math.PI).toFixed(0)}° rW.y=${bike.rearWheel.position.y.toFixed(1)} fW.y=${bike.frontWheel.position.y.toFixed(1)} rc=${rc} fc=${fc} (rest=${wheelRestY})`);
    }
  }
  // 對照：帶控制邏輯的正式 dropRun 跑同一 case
  console.log("--- dropRun 對照 ---");
  console.log(JSON.stringify(dropRun(variant, track, parseFloat(h), parseFloat(off), parseFloat(vx), parseFloat(tilt)), null, 1));
}

// ---------- 主程式 ----------
function main() {
  if (process.env.DROP_DEBUG) { debugOne(process.env.DROP_DEBUG); return; }
  const t0 = Date.now();
  const results: DropResult[] = [];
  const offs: number[] = [];
  for (let o = -OFF_RANGE; o <= OFF_RANGE + 1e-9; o += OFF_STEP) offs.push(Math.round(o * 100) / 100);

  let done = 0;
  const total = VARIANTS.length * HEIGHTS.length * offs.length * VXS.length * TILTS.length;
  for (const variant of VARIANTS) {
    const track = makeTrack(variant.d);
    for (const h of HEIGHTS) {
      for (const vx of VXS) {
        for (const tilt of TILTS) {
          for (const off of offs) {
            results.push(dropRun(variant, track, h, off, vx, tilt));
            done++;
            if (done % 500 === 0) console.log(`[${done}/${total}] ${(Date.now() - t0) / 1000}s`);
          }
        }
      }
    }
  }

  const stuckList = results.filter((r) => r.outcome === "stuck");
  const crashList = results.filter((r) => r.outcome === "crash");
  const byVariant: Record<string, { runs: number; stuck: number; crash: number; stuckPct: string; maxSink: number }> = {};
  for (const variant of VARIANTS) {
    const rs = results.filter((r) => r.variant === variant.name);
    const st = rs.filter((r) => r.outcome === "stuck");
    byVariant[variant.name] = {
      runs: rs.length,
      stuck: st.length,
      crash: rs.filter((r) => r.outcome === "crash").length,
      stuckPct: ((st.length / rs.length) * 100).toFixed(1) + "%",
      maxSink: Math.max(...rs.map((r) => Math.max(r.maxSinkRear, r.maxSinkFront))),
    };
  }

  const summary = {
    config: { FIX, OFF_STEP, HEIGHTS, OFF_RANGE, VXS: VXS.map((v) => Math.round(v * 100) / 100), TILTS, VARIANTS: VARIANTS.map((v) => v.name), SETTLE_STEPS, PROBE_STEPS, STUCK_DX },
    elapsedSec: Math.round((Date.now() - t0) / 100) / 10,
    total: results.length,
    stuckTotal: stuckList.length,
    crashTotal: crashList.length,
    stuckPct: ((stuckList.length / results.length) * 100).toFixed(1) + "%",
    byVariant,
    stuckCases: stuckList.map((r) => ({ variant: r.variant, h: r.h, off: r.off, vx: r.vx, tilt: r.tilt, progress: r.progress, sinkR: r.maxSinkRear, sinkF: r.maxSinkFront, impact: r.impactSpeed, end: r.end })),
  };

  console.log("\n===== SUMMARY =====");
  console.log(JSON.stringify(summary, null, 2));

  const outDir = path.resolve("sim-build");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `sim-drop-report-${FIX}.json`),
    JSON.stringify({ summary, results }, null, 1),
  );
  console.log(`\n詳細已寫入 sim-build/sim-drop-report-${FIX}.json（${results.length} 筆）`);
}

main();
