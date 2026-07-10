// ============================================================
// 「存活中車子陷進地形」大規模掃描（2026-07-10：iOS PWA 玩家回報
// 「車子沉下去、被彈上來、有時候死掉」，附截圖車身明顯在地形線下方）
//
// 為什麼要這支：
//   - simSteepLanding.ts 量到的深陷（最深 117px）經 simSinkTrace.ts 加上真實
//     摔車判定後證實「全部發生在車子已判死之後」，不是玩家看到的東西。
//   - 合成的等角度斜坡重現不出來 → 改用真實 pricesToTrack 管線 + 隨機股價
//     random walk（同 simStuck.ts），涵蓋尖谷/接縫/雜訊頂點等真實地形特徵。
//
// 定義（sink = 輪心 y − 該 x 正常貼地輪心 y，輪半徑 6px）：
//   sink > 12px → 輪子整顆沒入地表下（視覺上開始「陷進去」）
//   sink > 20px → 明顯深陷（對應玩家截圖）
// 只統計「車子還活著」期間的 sink（死亡後的沉陷不算，玩家看不到）。
//
// 執行：
//   ./node_modules/.bin/esbuild scripts/simSinkScan.ts --bundle --platform=node \
//     --format=cjs --outfile=sim-build/simSinkScan.cjs
//   node sim-build/simSinkScan.cjs [runs=1500] [bot=safe|hold|random|all]
// ============================================================

import { Engine, Events, Composite, Body, type IEventCollision } from "matter-js";
import { pricesToTrack, buildTerrainBodies, terrainYAt, type Track } from "../src/game/terrain";
import { createBike, type Bike } from "../src/game/bike";
import { BIKE, DRIVE, PHYSICS, RULES } from "../src/game/constants";

const STEP = 1000 / 60;
const args = process.argv.slice(2);
const RUNS = parseInt((args.find((a) => a.startsWith("runs=")) || "runs=1500").split("=")[1], 10);
const BOT_ARG = (args.find((a) => a.startsWith("bot=")) || "bot=all").split("=")[1];
// sub=N：物理子步數，與 GameCanvas 的 PHYSICS.subSteps 同語意（含相同等比換算）。
const SUB = Math.max(1, parseInt((args.find((a) => a.startsWith("sub=")) || "sub=1").split("=")[1], 10));
PHYSICS.subSteps = SUB;
// wr=N：覆寫車輪半徑（不用子步、單靠加大輪徑消除穿透的替代路線）。必須在建車前設好。
const WR_ARG = args.find((a) => a.startsWith("wr="));
if (WR_ARG) (BIKE as unknown as Record<string, number>).wheelRadius = parseFloat(WR_ARG.split("=")[1]);
// depen=on：每幀 Engine.update 後偵測輪子有沒有陷進地表，有的話沿法線推回表面 +
// 消掉往內速度（穿透修正）。不加子步、不改手感/輪徑，只在真的穿透時才作用。
const DEPEN = (args.find((a) => a.startsWith("depen=")) || "depen=off").split("=")[1] === "on";

type BotKind = "safe" | "hold" | "random";
const BOTS: BotKind[] = BOT_ARG === "all" ? ["safe", "hold", "random"] : [BOT_ARG as BotKind];

// sink = r − (輪心到地表最短距離)。0=完美貼地，6=輪心正好在地表，12=輪子整顆沒入。
const SINK_SUBMERGED = 6;  // 輪心已在地表下方（明確不對）
const SINK_DEEP = 12;      // 輪子整顆沒入地表（對應玩家截圖）

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function genPrices(seed: number): { prices: number[]; vol: number } {
  const rand = seededRand(seed * 7919 + 13);
  const n = 90 + Math.floor(rand() * 60);
  const vol = 0.001 + rand() * 0.059;
  const prices: number[] = [100];
  for (let i = 1; i < n; i++) {
    let stepPct = (rand() * 2 - 1) * vol;
    if (rand() < 0.02) stepPct = (rand() > 0.5 ? 1 : -1) * (0.06 + rand() * 0.04);
    prices.push(Math.max(1, prices[i - 1] * (1 + stepPct)));
  }
  return { prices, vol };
}
function segIdxOf(track: Track, x: number): number {
  const v = track.vertices;
  let lo = 0, hi = v.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (v[mid + 1].x < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}
function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

interface SinkEvent {
  seed: number; bot: BotKind; step: number; x: number;
  sink: number; upright: boolean; angDeg: number; vy: number;
  move: number;         // 該步輪心位移（>輪半徑 = 具備 tunneling 條件）
  dSink: number;        // 該步 sink 增量
  which: "rear" | "front";
  slopeInDeg: number; slopeOutDeg: number; turnDeg: number;
  atValley: boolean; atPeak: boolean;
  ejectVy: number;      // 之後 40 步最大向上速度
  diedAfter: boolean;   // 深陷後是否最終死亡
}

interface RunResult {
  seed: number; bot: BotKind;
  outcome: "finished" | "death_topHit" | "death_stuckMidAir" | "timeout";
  maxSinkAlive: number;
  firstDeep?: SinkEvent;
  traceRows?: string[];
  finishStep?: number;
}

function simulate(seed: number, bot: BotKind, trace = false): RunResult {
  const { prices } = genPrices(seed);
  const engine = Engine.create();
  engine.gravity.y = PHYSICS.gravityY * SUB; // 重力 ×n（見 constants.ts PHYSICS 說明）
  engine.positionIterations = PHYSICS.positionIterations;
  engine.velocityIterations = PHYSICS.velocityIterations;
  const SUB_DELTA = STEP / SUB;
  const track = pricesToTrack(prices);
  Composite.add(engine.world, buildTerrainBodies(track));

  const spawnX = track.startX;
  const HOVER = 67;
  const spawnY = track.vertices[0].y - BIKE.wheelDropY - BIKE.wheelRadius - 1 - HOVER;
  const bike: Bike = createBike(engine.world, spawnX, spawnY);

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

  const rand = seededRand(seed * 31 + (bot === "safe" ? 1 : bot === "hold" ? 2 : 3));
  let holdLeft = 0, relLeft = 0;
  const decideThrottle = (grounded: boolean): boolean => {
    if (bot === "hold") return true;
    if (bot === "safe") return grounded;
    if (holdLeft > 0) { holdLeft--; return true; }
    if (relLeft > 0) { relLeft--; return false; }
    if (rand() < 0.7) holdLeft = 20 + Math.floor(rand() * 160);
    else relLeft = 5 + Math.floor(rand() * 55);
    return decideThrottle(grounded);
  };

  // 單位鐵則見 GameCanvas.tsx applyControls 上方註解：讀取一律 Body.getVelocity/
  // getAngularVelocity（per-baseDelta），寫入用原始常數；只有「每子步累加」的增量 ÷n。
  const easeSub = SUB === 1 ? DRIVE.groundLockEase : 1 - Math.pow(1 - DRIVE.groundLockEase, 1 / SUB);
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
      Body.setAngularVelocity(c, Math.max(-DRIVE.airSpinMax, Body.getAngularVelocity(c) - DRIVE.airSpinAccel / SUB));
    } else {
      let av = Body.getAngularVelocity(c);
      if (av < 0) av = Math.min(0, av + DRIVE.airSpinBrakeAccel / SUB);
      Body.setAngularVelocity(c, Math.min(DRIVE.airNoseForwardMax, av + DRIVE.airNoseForwardAccel / SUB));
    }
  };

  // ⚠️ sink 不可用「輪心y − (地表y − r)」：那只在平地成立。斜坡上輪子靜止時輪心是沿
  // 法線離地表 r，垂直距離是 r/cosθ —— 75° 坡完美貼地也會被誤算成 sink=17px。
  // 正解：算輪心到地形折線的最短距離 d（正=地表上方），sink = r − d。
  // 完美貼地 → d=r → sink=0；輪心正好在地表 → sink=r；輪子整顆沒入 → sink≥2r。
  const surfaceDist = (p: { x: number; y: number }): number => {
    const v = track.vertices;
    const i = segIdxOf(track, p.x);
    let best = Infinity;
    for (let k = Math.max(0, i - 2); k <= Math.min(v.length - 2, i + 2); k++) {
      const a = v[k], b = v[k + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
      const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      if (d < best) best = d;
    }
    return p.y < terrainYAt(track, p.x) ? best : -best;
  };
  const sinkOf = (b: Body) => BIKE.wheelRadius - surfaceDist(b.position);

  // ── 穿透修正 ──
  // 回傳最近地形段的「向外(朝上)法線」+ 到折線的帶號距離。
  // 段 a→b（x 遞增）方向 (dx,dy)，向外法線 = (dy,−dx)/len（y 向下座標系，這支的 y 分量 <0＝朝上）。
  const closestSurf = (p: { x: number; y: number }): { dist: number; nx: number; ny: number } => {
    const v = track.vertices;
    const i = segIdxOf(track, p.x);
    let best = Infinity, nx = 0, ny = -1;
    for (let k = Math.max(0, i - 2); k <= Math.min(v.length - 2, i + 2); k++) {
      const a = v[k], b = v[k + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
      const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      if (d < best) { best = d; const L = Math.sqrt(L2) || 1; nx = dy / L; ny = -dx / L; }
    }
    return { dist: p.y < terrainYAt(track, p.x) ? best : -best, nx, ny };
  };
  const DEPEN_TOL = 1.0;   // 陷入超過 1px 才修（正常貼地本來就會小小重疊，別去動它）
  const DEPEN_MAXPUSH = BIKE.wheelRadius; // 單幀最多推回一個輪半徑，避免深穿透時瞬移彈飛
  const depenetrate = (w: Body) => {
    const { dist, nx, ny } = closestSurf(w.position);
    const pen = BIKE.wheelRadius - dist; // >0 = 陷入（輪面已在地表下）
    if (pen <= DEPEN_TOL) return;
    const push = Math.min(pen, DEPEN_MAXPUSH);
    Body.setPosition(w, { x: w.position.x + nx * push, y: w.position.y + ny * push });
    // 消掉「往地表內」的速度分量（per-baseDelta），否則下一幀又鑽回去
    const v = Body.getVelocity(w);
    const vn = v.x * nx + v.y * ny;
    if (vn < 0) Body.setVelocity(w, { x: v.x - vn * nx, y: v.y - vn * ny });
  };

  // ⚠️ 只在「輪子確實位於折線 x 範圍內」時才量 sink。超出最後一個頂點之後，
  // terrainYAt/segIdxOf 都會箝制在最後一段，而梯形碰撞體的右側斜牆（隱形幾何）
  // 仍然存在 → 車子踩在看不見的牆上，sink 會被誤算成 30px+。那是終點邊界假象，
  // 不是玩家看到的「路中間陷進地形」。起點同理。
  const vFirst = track.vertices[0].x;
  const vLast = track.vertices[track.vertices.length - 1].x;
  const inRange = (b: Body) => b.position.x > vFirst + 2 && b.position.x < vLast - 2;

  // 卡縫自動脫困 watchdog（逐行對照 GameCanvas.tsx step()）：偵測「按著油門+著地卻
  // 原地不動」→ 暫停驅動 60 步讓輪子回彈。少了它，任何小卡頓都會累積成永久卡死，
  // timeout 會被嚴重高估。
  let assistLeft = 0;
  const jamHist: number[] = [];

  let hasEverGrounded = false;
  let crashTimer = 0;
  let outcome: RunResult["outcome"] = "timeout";
  let maxSinkAlive = 0;
  let firstDeep: SinkEvent | undefined;
  let prevRear = { ...bike.rearWheel.position };
  let prevFront = { ...bike.frontWheel.position };
  let prevSink = 0;
  let finishStep: number | undefined;
  const vyLog: number[] = [];
  const traceRows: string[] = [];

  const MAX_STEPS = 6000;
  for (let step = 0; step < MAX_STEPS; step++) {
    const grounded = rc > 0 || fc > 0;
    if (grounded) hasEverGrounded = true;
    const botThr = decideThrottle(grounded);

    // watchdog（同 GameCanvas）：卡住 40 步就強制放開油門 60 步
    if (assistLeft > 0) {
      assistLeft--;
      jamHist.length = 0;
    } else if (grounded && botThr) {
      jamHist.push(bike.chassis.position.x);
      if (jamHist.length > 40) jamHist.shift();
      if (jamHist.length === 40 && Math.abs(bike.chassis.position.x - jamHist[0]) < 3) {
        assistLeft = 60;
        jamHist.length = 0;
      }
    } else {
      jamHist.length = 0;
    }
    const thr = botThr && assistLeft <= 0; // 有效油門

    for (let s = 0; s < SUB; s++) {
      applyControls(rc > 0 || fc > 0, thr);
      Engine.update(engine, SUB_DELTA);
      if (DEPEN) { depenetrate(bike.rearWheel); depenetrate(bike.frontWheel); }
    }

    const c = bike.chassis;
    const rearMove = Math.hypot(bike.rearWheel.position.x - prevRear.x, bike.rearWheel.position.y - prevRear.y);
    const frontMove = Math.hypot(bike.frontWheel.position.x - prevFront.x, bike.frontWheel.position.y - prevFront.y);
    prevRear = { ...bike.rearWheel.position };
    prevFront = { ...bike.frontWheel.position };
    vyLog.push(c.velocity.y);

    // ── 真實死亡判定（複製 GameCanvas.tsx；waitingToStart 期間略過）──
    if (hasEverGrounded) {
      const bothOff = rc === 0 && fc === 0;
      const cv = Body.getVelocity(c); // per-baseDelta = 每幀位移，門檻不隨子步數變
      const speed = Math.hypot(cv.x, cv.y);
      const tipped = Math.cos(c.angle) < RULES.crashTipCos;
      const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
      const topHit = tipped && BIKE.crashZone.some(({ x: lx, y: ly }) => {
        const wx = ca * lx - sa * ly + c.position.x;
        const wy = sa * lx + ca * ly + c.position.y;
        return wy > terrainYAt(track, wx);
      });
      if (topHit) { outcome = "death_topHit"; break; }
      if (bothOff && speed < 0.5) {
        crashTimer += STEP / 1000;
        if (crashTimer >= RULES.crashUpsideDownSec) { outcome = "death_stuckMidAir"; break; }
      } else crashTimer = 0;
    }

    // ── 存活期間的 sink（排除起點/終點的折線邊界外區域，見 inRange 說明）──
    if (hasEverGrounded && inRange(bike.rearWheel) && inRange(bike.frontWheel)) {
      const rs = sinkOf(bike.rearWheel), fs = sinkOf(bike.frontWheel);
      const sink = Math.max(rs, fs);
      if (sink > maxSinkAlive) maxSinkAlive = sink;
      if (sink > SINK_DEEP && !firstDeep) {
        const v = track.vertices;
        const i = segIdxOf(track, c.position.x);
        const sl = (a: { x: number; y: number }, b: { x: number; y: number }) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        const pk = (k: number) => v[Math.max(0, Math.min(v.length - 1, k))];
        const sIn = sl(pk(i), pk(i + 1)), sOut = sl(pk(i + 1), pk(i + 2));
        const a = pk(i), b = pk(i + 1), cc = pk(i + 2);
        firstDeep = {
          seed, bot, step, x: c.position.x, sink,
          upright: Math.cos(c.angle) > RULES.uprightCosThreshold,
          angDeg: ((c.angle * 180) / Math.PI) % 360,
          vy: c.velocity.y,
          move: rs > fs ? rearMove : frontMove,
          dSink: sink - prevSink,
          which: rs > fs ? "rear" : "front",
          slopeInDeg: Math.round(sIn * 10) / 10,
          slopeOutDeg: Math.round(sOut * 10) / 10,
          turnDeg: Math.round((sOut - sIn) * 10) / 10,
          atValley: b.y > a.y && b.y > cc.y,
          atPeak: b.y < a.y && b.y < cc.y,
          ejectVy: 0, diedAfter: false,
        };
      }
      prevSink = sink;
      if (trace) {
        const w = rs > fs ? bike.rearWheel : bike.frontWheel;
        traceRows.push(
          `${String(step).padStart(5)} |${w.position.x.toFixed(0).padStart(7)} ${w.position.y.toFixed(1).padStart(9)} ` +
          `${terrainYAt(track, w.position.x).toFixed(1).padStart(8)} ${String(segIdxOf(track, w.position.x)).padStart(4)} |` +
          `${sink.toFixed(1).padStart(6)} ${surfaceDist(w.position).toFixed(1).padStart(6)} |` +
          `${rearMove.toFixed(1).padStart(6)}${frontMove.toFixed(1).padStart(6)} | r${rc}f${fc} ${(((c.angle * 180) / Math.PI) % 360).toFixed(0).padStart(5)}`,
        );
      }
    }

    if (c.position.x >= track.finishX) { outcome = "finished"; finishStep = step; break; }
  }

  if (firstDeep) {
    const after = vyLog.slice(firstDeep.step, firstDeep.step + 40);
    firstDeep.ejectVy = after.length ? -Math.min(...after) : 0;
    firstDeep.diedAfter = outcome.startsWith("death");
  }
  let rows: string[] | undefined;
  if (trace && firstDeep) {
    const center = traceRows.findIndex((t) => parseInt(t.slice(0, 5).trim(), 10) === firstDeep!.step);
    if (center >= 0) rows = traceRows.slice(Math.max(0, center - 12), Math.min(traceRows.length, center + 17));
    else rows = traceRows.slice(-20);
  }
  return { seed, bot, outcome, maxSinkAlive: Math.round(maxSinkAlive * 10) / 10, firstDeep, traceRows: rows, finishStep };
}

// 單一種子逐步追蹤（診斷用）：node ... trace seed=826 bot=safe
function doTrace() {
  const seed = parseInt((args.find((a) => a.startsWith("seed=")) || "seed=826").split("=")[1], 10);
  const bot = ((args.find((a) => a.startsWith("bot=")) || "bot=safe").split("=")[1]) as BotKind;
  const r = simulate(seed, bot, true);
  console.log(`seed=${seed} bot=${bot} outcome=${r.outcome} maxSinkAlive=${r.maxSinkAlive}px`);
  if (!r.firstDeep) { console.log("此局無深陷"); return; }
  console.log(`首次深陷 @step ${r.firstDeep.step} x=${r.firstDeep.x.toFixed(0)} sink=${r.firstDeep.sink.toFixed(1)}px\n`);
  console.log("step |    x       wheelY  surfY  segI |  sink  dist | rMove fMove | ct  ang°");
  console.log("-".repeat(92));
  for (const t of r.traceRows!) console.log(t);
}

function main() {
  if (args[0] === "trace") { doTrace(); return; }
  const all: RunResult[] = [];
  for (const bot of BOTS) {
    for (let s = 1; s <= RUNS; s++) all.push(simulate(s, bot));
  }

  console.log(
    `跑了 ${all.length} 局（${BOTS.join("/")} × ${RUNS} 種子）｜subSteps=${SUB}｜` +
    `輪半徑=${BIKE.wheelRadius}px｜單步位移=${(DRIVE.cruiseSpeed / SUB).toFixed(2)}px ` +
    `${DRIVE.cruiseSpeed / SUB >= BIKE.wheelRadius ? "⚠️ ≥輪半徑，具備穿透條件" : "✅ <輪半徑"}\n`,
  );
  const finished = all.filter((r) => r.outcome === "finished");
  if (finished.length) {
    const avgSteps = finished.reduce((s, r) => s + (r.finishStep ?? 0), 0) / finished.length;
    console.log(`完賽局平均步數=${avgSteps.toFixed(1)}（子步等比換算正確的話，此值應與 subSteps=1 幾乎相同）\n`);
  }
  for (const bot of BOTS) {
    const rows = all.filter((r) => r.bot === bot);
    const submerged = rows.filter((r) => r.maxSinkAlive > SINK_SUBMERGED).length;
    const deep = rows.filter((r) => r.maxSinkAlive > SINK_DEEP).length;
    const fin = rows.filter((r) => r.outcome === "finished").length;
    const dTop = rows.filter((r) => r.outcome === "death_topHit").length;
    const dAir = rows.filter((r) => r.outcome === "death_stuckMidAir").length;
    const to = rows.filter((r) => r.outcome === "timeout").length;
    console.log(
      `bot=${bot.padEnd(6)} 完賽=${String(fin).padStart(4)} topHit死=${String(dTop).padStart(4)} ` +
      `midAir死=${String(dAir).padStart(3)} timeout=${String(to).padStart(3)} | ` +
      `存活中沉沒(>${SINK_SUBMERGED}px)=${submerged} (${((submerged / rows.length) * 100).toFixed(1)}%)  ` +
      `深陷(>${SINK_DEEP}px)=${deep} (${((deep / rows.length) * 100).toFixed(1)}%)  ` +
      `最深=${Math.max(...rows.map((r) => r.maxSinkAlive)).toFixed(1)}px`,
    );
  }

  console.log(`\n最深 maxSinkAlive 的 6 局（用 trace 模式複驗）：`);
  for (const r of [...all].sort((a, b) => b.maxSinkAlive - a.maxSinkAlive).slice(0, 6)) {
    console.log(`  seed=${String(r.seed).padStart(4)} bot=${r.bot.padEnd(6)} maxSink=${String(r.maxSinkAlive).padStart(6)}px outcome=${r.outcome}`);
  }

  const deeps = all.map((r) => r.firstDeep).filter((e): e is SinkEvent => !!e);
  if (!deeps.length) { console.log("\n沒有任何一局在存活期間深陷 → 這條路徑重現不出玩家回報的現象"); return; }

  const upr = deeps.filter((d) => d.upright).length;
  const tunnel = deeps.filter((d) => d.move > BIKE.wheelRadius).length;
  const valley = deeps.filter((d) => d.atValley).length;
  const peak = deeps.filter((d) => d.atPeak).length;
  const ejected = deeps.filter((d) => d.ejectVy > 8).length;
  const died = deeps.filter((d) => d.diedAfter).length;
  console.log(`\n===== 存活期間首次深陷事件共 ${deeps.length} 筆 =====`);
  console.log(`深陷當下正立(cos>0.55)：${upr}/${deeps.length} (${((upr / deeps.length) * 100).toFixed(0)}%)  ← 高比例=正常騎乘時發生，不是翻車`);
  console.log(`單步輪心位移 > 輪半徑(${BIKE.wheelRadius}px)：${tunnel}/${deeps.length} (${((tunnel / deeps.length) * 100).toFixed(0)}%)  ← 高比例=離散碰撞穿透(tunneling)`);
  console.log(`發生在 V 谷頂點：${valley}  發生在峰頂：${peak}`);
  console.log(`深陷後被彈上來(向上 vy>8)：${ejected}/${deeps.length}  深陷後最終死亡：${died}/${deeps.length}`);

  console.log(`\n最深的 12 筆：`);
  console.log("seed  bot    step    x     sink  正立 ang°    vy   單步位移 谷/峰  彈飛vy 之後死亡");
  console.log("-".repeat(100));
  for (const d of [...deeps].sort((a, b) => b.sink - a.sink).slice(0, 12)) {
    console.log(
      `${String(d.seed).padStart(4)}  ${d.bot.padEnd(6)} ${String(d.step).padStart(5)} ${d.x.toFixed(0).padStart(6)} ` +
      `${d.sink.toFixed(1).padStart(6)} ${(d.upright ? "是" : "否").padEnd(3)} ${d.angDeg.toFixed(0).padStart(5)} ` +
      `${d.vy.toFixed(1).padStart(6)} ${d.move.toFixed(1).padStart(7)}px  ${d.atValley ? "谷" : d.atPeak ? "峰" : "—"}   ` +
      `${d.ejectVy.toFixed(1).padStart(5)} ${d.diedAfter ? "是" : "否"}`,
    );
  }
}

main();
