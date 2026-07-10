// ============================================================
// 陡坡衝下＋落在平地接縫 headless 模擬（2026-07-07 使用者回報：
// 整台車「沉下去很深」，跟先前 simDrop.ts 定點落下矩陣（VXS 只到 cruiseSpeed、
// 純垂直/固定 tilt 落下）測不出來的情境不同——真實情境是「沿著真實陡坡（可達
// maxDownSlopeDeg=75°）持續按油門衝下來，帶著坡面切線方向的高合速度＋自然產生的
// 車身角度，銜接到平地接縫」，衝擊速度/角度是物理自然產生，不是人工指定。
//
// 用真正的 buildTerrainBodies（terrain.ts，未修改，測目前上線版本）+ 完整複製
// GameCanvas.tsx 的 applyControls（含 slopeAt 對齊、watchdog）跑一次完整下坡→平地。
//
// 🚨 2026-07-10 複驗發現本腳本兩個量測缺陷，數字不可直接採信（結論已被推翻）：
//   1. 沒有摔車判定 → 車子翻覆後仍繼續模擬，回報的「深陷 117px」全部發生在真實
//      遊戲早已判死之後（見 scripts/simSinkTrace.ts 加上 topHit/stuckMidAir 後複驗，
//      存活期間深陷 = 0）。
//   2. sink 公式「輪心y − (地表y − r)」只在平地成立。斜坡上輪子靜止時輪心是沿法線
//      離地表 r，垂直距離是 r/cosθ；75° 坡完美貼地會被誤算成 ∓17px。
//      正解見 scripts/simSinkScan.ts 的 surfaceDist()（點到折線最短距離）。
// 真正能重現玩家「騎乘中陷進地形」的腳本是 scripts/simSinkScan.ts（真實股價地形）。
//
// 執行：
//   ./node_modules/.bin/esbuild scripts/simSteepLanding.ts --bundle --platform=node \
//     --format=cjs --outfile=sim-build/simSteepLanding.cjs
//   node sim-build/simSteepLanding.cjs [watchdog=on|off] [fix=none|extra6|extra10|extra15|extra20]
//
// fix 用來測試候選解法：把 terrain.ts buildTerrainBodies 的 topExtra（現行=3px）
// 加大，觀察深陷比例會不會下降。none=現行 3px（測目前上線行為）。
// ============================================================

import { Engine, Events, Composite, Body, Vertices, type IEventCollision } from "matter-js";
import { slopeAt, terrainYAt, type Track, type Vec2 } from "../src/game/terrain";
import { createBike, type Bike } from "../src/game/bike";
import { BIKE, DRIVE, TRACK } from "../src/game/constants";
import type { Body as MatterBody } from "matter-js";
import { Bodies } from "matter-js";

const STEP = 1000 / 60;
const WATCHDOG = (process.argv[2] || "on").replace("watchdog=", "") !== "off";
const FIX = (process.argv[3] || "fix=none").replace("fix=", "");
const TOP_EXTRA = FIX === "none" || FIX === "merge" ? 3 : parseInt(FIX.replace("extra", ""), 10);

// 共線相鄰段合併成單一梯形：真正同角度的路段（如平地接平地）之間完全沒有接縫，
// 結構性消除雙重碰撞卡死的可能；角度真的不同的地方（如下坡轉平地）維持現行
// topExtra=3，不去動它，不引入新雷（見討論：加大 topExtra 反而在角度變化的重疊
// 區產生雙重碰撞卡死，跟峰頂/一般轉角無關，是重疊機制本身的限制）。
function buildTerrainBodiesMerged(track: Track, topExtra: number): MatterBody[] {
  const bodies: MatterBody[] = [];
  const v = track.vertices;
  const baseY = track.maxY + 800;
  const overlap = TRACK.segmentWidth;

  const groups: { i0: number; i1: number }[] = [];
  let i0 = 0;
  for (let i = 1; i < v.length - 1; i++) {
    const a = v[i - 1], b = v[i], c = v[i + 1];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const collinear = Math.abs(cross) < 1e-6;
    if (!collinear) {
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

// 參數化版 buildTerrainBodies（複製自 terrain.ts，topExtra 可調，其餘邏輯不變）
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

function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// 建一條「平地起跑 → 陡坡下衝 → 平地」的賽道。angleDeg 為下坡角（<=75），
// slopeSegs 為下坡佔幾段（每段 segmentWidth=80px 水平距）。
function makeTrack(angleDeg: number, slopeSegs: number, flatSegsAfter: number): Track {
  const segW = TRACK.segmentWidth;
  const rad = (angleDeg * Math.PI) / 180;
  const dyPerSeg = Math.tan(rad) * segW;
  const RUN_UP = 6; // 起跑平地段數（先建立 cruiseSpeed）
  const vertices: Vec2[] = [];
  let x = 0, y = 0;
  for (let i = 0; i <= RUN_UP; i++) vertices.push({ x: i * segW, y: 0 });
  x = RUN_UP * segW;
  for (let i = 1; i <= slopeSegs; i++) {
    x += segW;
    y += dyPerSeg;
    vertices.push({ x, y });
  }
  for (let i = 1; i <= flatSegsAfter; i++) {
    x += segW;
    vertices.push({ x, y });
  }
  const ys = vertices.map((v) => v.y);
  return {
    vertices,
    colors: Array(vertices.length - 1).fill("#2de2e6"),
    startX: segW,
    finishX: vertices[vertices.length - 1].x,
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

interface RunResult {
  angleDeg: number; slopeSegs: number;
  maxImpactSpeed: number;   // 下衝到平地瞬間合速度 (px/step)
  stuckDetected: boolean;
  stuckAtX: number;
  stuckSegIndex: number;    // 平地段落 index（0=坡轉平地的角落，1+=後續純平地-平地接縫）
  stuckDurationSteps: number;
  maxSinkDepth: number;     // 落地後任一時刻輪心相對正常貼地位置的最大下沉深度
  everExceeded50: boolean;  // 是否曾深陷 >50px（比正常落地 settle ~12px 明顯異常）
  watchdogRecovered: boolean;
  trace: string[];
}

function runOne(angleDeg: number, slopeSegs: number): RunResult {
  const track = makeTrack(angleDeg, slopeSegs, 30);
  const engine = Engine.create();
  engine.gravity.y = 0.5;
  const world = engine.world;
  Composite.add(world, FIX === "merge" ? buildTerrainBodiesMerged(track, TOP_EXTRA) : buildTerrainBodiesParam(track, TOP_EXTRA));

  const wheelRestY0 = 0 - BIKE.wheelRadius; // 起跑平地 y=0
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

  // watchdog 狀態（複製 GameCanvas.tsx step()）
  let assistLeft = 0;
  const jamHist: number[] = [];
  let watchdogRecovered = false;

  const applyControls = (grounded: boolean, thr: boolean) => {
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
        if (thr) {
          const vt = c.velocity.x * tx + c.velocity.y * ty;
          const delta = (DRIVE.cruiseSpeed - vt) * DRIVE.groundLockEase;
          Body.setVelocity(c, { x: c.velocity.x + delta * tx, y: c.velocity.y + delta * ty });
          Body.setVelocity(bike.rearWheel, { x: bike.rearWheel.velocity.x + delta * tx, y: bike.rearWheel.velocity.y + delta * ty });
          Body.setVelocity(bike.frontWheel, { x: bike.frontWheel.velocity.x + delta * tx, y: bike.frontWheel.velocity.y + delta * ty });
        }
      }
      const slope = slopeAt(track, bike.frontWheel.position.x);
      const da = angleDelta(c.angle, slope);
      let av = da * DRIVE.groundAlignGain;
      if (Math.abs(av) > DRIVE.groundedAvMax) av = Math.sign(av) * DRIVE.groundedAvMax;
      Body.setAngularVelocity(c, av);
    } else if (thr) {
      const nv = Math.max(-DRIVE.airSpinMax, c.angularVelocity - DRIVE.airSpinAccel);
      Body.setAngularVelocity(c, nv);
    } else {
      let av = c.angularVelocity;
      if (av < 0) av = Math.min(0, av + DRIVE.airSpinBrakeAccel);
      Body.setAngularVelocity(c, Math.min(DRIVE.airNoseForwardMax, av + DRIVE.airNoseForwardAccel));
    }
  };

  const flatStartX = track.vertices[6 + slopeSegs].x; // 平地開始 x
  let maxImpactSpeed = 0;
  let hasHitFlat = false;
  let flatEnterSpeedLogged = false;

  let stuckDetected = false, stuckAtX = 0, stuckSegIndex = -1, stuckDurationSteps = 0, maxSinkDepth = 0;
  let stuckWindowStartX = 0, stuckWindowStartStep = -1;
  let everExceeded50 = false;
  const trace: string[] = [];

  const MAX_STEPS = 900;
  for (let step = 0; step < MAX_STEPS; step++) {
    const grounded = rearContacts > 0 || frontContacts > 0;
    if (WATCHDOG) {
      if (assistLeft > 0) {
        assistLeft--;
        jamHist.length = 0;
      } else if (grounded && !watchdogRecovered) {
        jamHist.push(bike.chassis.position.x);
        if (jamHist.length > 40) jamHist.shift();
        if (jamHist.length === 40 && Math.abs(bike.chassis.position.x - jamHist[0]) < 3) {
          assistLeft = 60;
          jamHist.length = 0;
          if (stuckDetected) watchdogRecovered = true;
        }
      } else {
        jamHist.length = 0;
      }
    }
    const thr = WATCHDOG ? assistLeft <= 0 : true;
    applyControls(grounded, thr);
    Engine.update(engine, STEP);

    const c = bike.chassis;
    const x = c.position.x;

    if (!hasHitFlat && x >= flatStartX) {
      hasHitFlat = true;
    }
    if (hasHitFlat && !flatEnterSpeedLogged) {
      const spd = Math.hypot(c.velocity.x, c.velocity.y);
      maxImpactSpeed = spd;
      flatEnterSpeedLogged = true;
      trace.push(`flat 進入點 x=${x.toFixed(0)} speed=${spd.toFixed(2)}px/step chassisAng=${(c.angle * 180 / Math.PI).toFixed(1)}°`);
    }

    if (hasHitFlat) {
      const expectedY = terrainYAt(track, x) - BIKE.wheelRadius;
      const rearSink = bike.rearWheel.position.y - (terrainYAt(track, bike.rearWheel.position.x) - BIKE.wheelRadius);
      const frontSink = bike.frontWheel.position.y - (terrainYAt(track, bike.frontWheel.position.x) - BIKE.wheelRadius);
      const sink = Math.max(rearSink, frontSink);
      if (sink > maxSinkDepth) maxSinkDepth = sink;
      if (sink > 50) everExceeded50 = true;

      // 卡住偵測：40 步窗口內淨位移 < 3px（跟 watchdog 判準一致，但獨立記錄診斷用）
      if (stuckWindowStartStep < 0) {
        stuckWindowStartStep = step;
        stuckWindowStartX = x;
      } else if (step - stuckWindowStartStep >= 40) {
        const disp = Math.abs(x - stuckWindowStartX);
        if (disp < 3 && sink > 4) {
          if (!stuckDetected) {
            stuckDetected = true;
            stuckAtX = x;
            stuckSegIndex = Math.floor((x - flatStartX) / TRACK.segmentWidth);
            trace.push(`卡住偵測 @step ${step} x=${x.toFixed(1)} segIdx=${stuckSegIndex}(0=坡轉平地角落) sink=${sink.toFixed(1)} rearSink=${rearSink.toFixed(1)} frontSink=${frontSink.toFixed(1)} ang=${(c.angle * 180 / Math.PI).toFixed(1)}°`);
          }
          stuckDurationSteps++;
        }
        stuckWindowStartStep = step;
        stuckWindowStartX = x;
      }
    }

    if (hasHitFlat && step - (flatEnterSpeedLogged ? 0 : 0) > 0 && x > flatStartX + TRACK.segmentWidth * 20) break; // 平地跑夠遠就停
  }

  return {
    angleDeg, slopeSegs, maxImpactSpeed, stuckDetected, stuckAtX, stuckSegIndex, stuckDurationSteps,
    maxSinkDepth: Math.round(maxSinkDepth * 10) / 10, everExceeded50, watchdogRecovered, trace,
  };
}

function main() {
  // 第一輪已知危險區在 55~75°、坡長 1~2 段附近，這次拉細解析度 + 補 4/6 段當邊界對照
  const ANGLES = [40, 45, 50, 52, 55, 57, 60, 62, 65, 67, 70, 72, 75];
  const SLOPE_SEGS = [1, 2, 3, 4, 6];
  const results: RunResult[] = [];
  for (const a of ANGLES) {
    for (const s of SLOPE_SEGS) {
      results.push(runOne(a, s));
    }
  }

  console.log(`watchdog=${WATCHDOG ? "on" : "off"}  fix=${FIX}(topExtra=${TOP_EXTRA}px)\n`);
  console.log("angle segs impactSpeed(px/step) deepSink(>50px) maxSink stuckWindowFired segIdx");
  for (const r of results) {
    const flag = r.everExceeded50 ? "⚠️ DEEP" : "ok";
    console.log(
      `${String(r.angleDeg).padStart(2)}° ${r.slopeSegs}seg  v=${r.maxImpactSpeed.toFixed(2).padStart(5)}  ${flag.padEnd(7)}  sink=${String(r.maxSinkDepth).padStart(6)}  stuckWin=${r.stuckDetected ? "YES" : "no "}  segIdx=${r.stuckSegIndex}`,
    );
    if (r.stuckDetected) for (const t of r.trace) console.log(`    ${t}`);
  }

  const deepCount = results.filter((r) => r.everExceeded50).length;
  const stuckCount = results.filter((r) => r.stuckDetected).length;
  console.log(`\n===== ${deepCount}/${results.length} 組合出現 sink>50px 深陷；${stuckCount} 組合觸發 40 步卡住視窗 =====`);

  // 危險區邊界摘要：對每個角度，列出哪些坡長會深陷
  console.log("\n危險區邊界（角度 → 會深陷的坡長列表）:");
  for (const a of ANGLES) {
    const bad = results.filter((r) => r.angleDeg === a && r.everExceeded50).map((r) => r.slopeSegs);
    if (bad.length > 0) console.log(`  ${a}°: segs=[${bad.join(",")}]`);
  }
}

main();
