// ============================================================
// 卡地形 headless 批次模擬（FABLE5_HANDOFF Debug #2）
//
// 直接 import 遊戲本體的 terrain.ts / bike.ts / constants.ts，
// 忠實重現 GameCanvas.tsx 的物理步進（applyControls + step 死亡判定），
// 對大量隨機股價種子 × 輸入策略跑模擬，記錄：
//   - stuckMidAir：雙輪離地 + 速度 < 0.5 持續 ≥ crashUpsideDownSec（現有死亡判定）
//   - stall：前進停滯（2 秒內 x 前進 < 4px 且未完賽、未死亡）——
//     這涵蓋「輪子卡在接縫但仍有接觸」的情況（使用者回報：卡住放開會彈出）
// 每次事件記下當下地形局部幾何（鄰近頂點、坡角、轉折角）供特徵歸納。
//
// 執行（需先用 esbuild 打包，因 raw Node 吃不了 matter-js UMD named import）：
//   node node_modules/vite/node_modules/esbuild/bin/esbuild --version  # 或 .bin/esbuild
//   ./node_modules/.bin/esbuild scripts/simStuck.ts --bundle --platform=node \
//     --format=cjs --outfile=sim-build/simStuck.cjs
//   node sim-build/simStuck.cjs [runs=500] [bot=safe|hold|random|all] [seed0=1]
// 報告輸出：sim-build/sim-stuck-report.json（已 gitignore）
// ============================================================

import { Engine, Events, Composite, Body, Bodies, Vertices, type IEventCollision } from "matter-js";
import { pricesToTrack, buildTerrainBodies, terrainYAt, type Track } from "../src/game/terrain";
import { createBike, type Bike } from "../src/game/bike";
import { BIKE, DRIVE, RULES } from "../src/game/constants";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------- 參數 ----------
const args = process.argv.slice(2);
const RUNS = parseInt(args[0] || "500", 10);
const BOT_ARG = (args[1] || "all") as BotKind | "all";
const SEED0 = parseInt(args[2] || "1", 10);
const MAX_STEPS = 6000; // 單 run 上限（正常完賽 ~1500-2500 步）
const STEP = 1000 / 60;
const STALL_WINDOW_STEPS = 120; // 2 秒
const STALL_DX = 4; // 2 秒內前進 < 4px 即視為停滯

type BotKind = "safe" | "hold" | "random";
const BOTS: BotKind[] = BOT_ARG === "all" ? ["safe", "hold", "random"] : [BOT_ARG];

// 修法原型（arg4）：none=現況 / flat=淺尖谷插小平底(改地形) / circle=尖谷內切圓(不改視覺)
// ⚠️ v0.12.1 起「flat 修法」已正式落地進 src/game/terrain.ts（pricesToTrack 內建），
//    fix=none 即含修法後的現況；fix=flat 變成 no-op（terrain 已無淺尖谷）。保留供回歸驗證。
// v0.12.13 候選（平地縫隙卡輪 / 殘餘 stall 13 件：寬角凹角 + 峰頂）：
//   lip    = 共線接縫 lip（凹角側延伸 12px 埋入鄰段，頂面零誤差）
//   lipcap = lip + 尖凸角（轉折>20°）插 12px 平台（實測反而更糟，棄用）
//   assist = 遊戲側自動脫困 watchdog（不改地形）：著地+油門+~0.33s 零前進 →
//            內部暫停 ground-lock 驅動 30 步（等效「自動放開」，正是使用者手動脫困法），
//            然後恢復。地形/難度/分數完全不變。
type FixKind = "none" | "flat" | "circle" | "lip" | "lipcap" | "assist";
const FIX = (args[3] || "none") as FixKind;
// 尖谷判定（依 2000×3 baseline 統計）：爬出高度 4 < h2 ≤ 80（>80 既有平底已處理）、V 夾角 < 120°
const SHARP_H2_MAX = 80;
const SHARP_H2_MIN = 4;
const SHARP_INCLUDED_MAX = 120;

function sharpValleys(track: Track): { i: number; incRad: number }[] {
  const v = track.vertices;
  const out: { i: number; incRad: number }[] = [];
  for (let i = 1; i < v.length - 1; i++) {
    const p = v[i - 1], q = v[i], r = v[i + 1];
    if (!(q.y > p.y && q.y > r.y)) continue; // 非 V 谷
    const h2 = q.y - r.y;
    if (h2 <= SHARP_H2_MIN || h2 > SHARP_H2_MAX) continue;
    // 兩壁方向向量（谷底 → 壁上方）夾角
    const l1 = Math.hypot(p.x - q.x, p.y - q.y), l2 = Math.hypot(r.x - q.x, r.y - q.y);
    const u1 = { x: (p.x - q.x) / l1, y: (p.y - q.y) / l1 };
    const u2 = { x: (r.x - q.x) / l2, y: (r.y - q.y) / l2 };
    const incRad = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
    if ((incRad * 180) / Math.PI >= SHARP_INCLUDED_MAX) continue;
    out.push({ i, incRad });
  }
  return out;
}

// 修法 A：淺尖谷也插小平底（40px，比深谷的 80px 窄），會改地形形狀
function applyFixFlat(track: Track): Track {
  const marks = new Set(sharpValleys(track).map((s) => s.i));
  const v = track.vertices;
  const W = 40;
  const out: { x: number; y: number }[] = [];
  let xOff = 0;
  for (let i = 0; i < v.length; i++) {
    out.push({ x: v[i].x + xOff, y: v[i].y });
    if (marks.has(i)) {
      xOff += W;
      out.push({ x: v[i].x + xOff, y: v[i].y });
    }
  }
  return { ...track, vertices: out, finishX: out[out.length - 1].x };
}

// 修法 B：尖谷頂點放「內切圓」靜態體（tangent 兩壁、填滿輪子會楔入的口袋），
// 不動折線 → 視覺/地形資料零改變。圓半徑 > 輪半徑(6) 才能讓輪子滾過不陷入。
function valleyCircleBodies(track: Track): Body[] {
  const v = track.vertices;
  const rc = 13;
  const bodies: Body[] = [];
  for (const { i, incRad } of sharpValleys(track)) {
    const p = v[i - 1], q = v[i], r = v[i + 1];
    const l1 = Math.hypot(p.x - q.x, p.y - q.y), l2 = Math.hypot(r.x - q.x, r.y - q.y);
    const u1 = { x: (p.x - q.x) / l1, y: (p.y - q.y) / l1 };
    const u2 = { x: (r.x - q.x) / l2, y: (r.y - q.y) / l2 };
    // 角平分線（指向 V 開口）；圓心距谷頂 d = rc / sin(夾角/2) → 圓 tangent 兩壁
    let bx = u1.x + u2.x, by = u1.y + u2.y;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-6) continue;
    bx /= bl; by /= bl;
    const d = rc / Math.sin(incRad / 2);
    bodies.push(
      Bodies.circle(q.x + bx * d, q.y + by * d, rc, {
        isStatic: true, friction: 1, frictionStatic: 1, label: "terrain",
      }),
    );
  }
  return bodies;
}

// 轉折方向（y 向下為正）：cross < 0 = 凹角（往上折，如平地→上坡）；> 0 = 凸角（峰頂/下坡變陡）
function crossAt(p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }): number {
  return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
}

// 修法 C（lipcap 的 cap 部分）：「夠尖的凸角」（含峰頂、下坡變陡、上坡趨緩，
// 轉折角 > turnMinDeg）插 capW 小平台，把裸凸角變成兩個可被 lip 覆蓋/無害的轉折。
// v1 只削峰頂不夠——上坡趨緩凸角（如 -44°→-13°）一樣會卡（baseline 13 件中 3 件）。
function applyConvexCap(track: Track, capW = 12, turnMinDeg = 20): Track {
  const v = track.vertices;
  const out: { x: number; y: number }[] = [];
  let xOff = 0;
  for (let i = 0; i < v.length; i++) {
    let sharpConvex = false;
    if (i > 0 && i < v.length - 1) {
      const p = v[i - 1], q = v[i], r = v[i + 1];
      if (crossAt(p, q, r) > 0) {
        const a1 = Math.atan2(q.y - p.y, q.x - p.x);
        const a2 = Math.atan2(r.y - q.y, r.x - q.x);
        let turn = Math.abs(a2 - a1);
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        sharpConvex = (turn * 180) / Math.PI > turnMinDeg;
      }
    }
    out.push({ x: v[i].x + xOff, y: v[i].y });
    if (sharpConvex) {
      xOff += capW;
      out.push({ x: v[i].x + xOff, y: v[i].y });
    }
  }
  return { ...track, vertices: out, finishX: out[out.length - 1].x };
}

// 修法 B v2（lip）：共線接縫 lip —— 頂緣端點「沿本段方向」延長 lip px（頂面直線不變！），
// 只在凹角/平接（cross ≤ 0）側做：此時延長線位於鄰段坡面之下 → lip 完全埋進鄰段
// 梯形內，蓋住內部垂直邊（internal edge ghost collision），表面零誤差。
// ⚠️ v1 教訓：水平延伸（x±lip、y 不動）會「旋轉」斜坡段的頂邊直線（頂邊=兩端點連線），
// 12px 時頂面偏離折線最多 ~10px → 2000 局 stall 26%。共線延伸才是不動頂面的做法。
// 凸角側（cross > 0）任何直線延伸幾何上必凸出表面 → 不延伸，交給 applyConvexCap。
function buildLipBodies(track: Track, lip = 12): Body[] {
  const bodies: Body[] = [];
  const v = track.vertices;
  const baseY = track.maxY + 800;
  const overlap = 80; // 同 terrain.ts：底部外擴 = segmentWidth
  for (let i = 0; i < v.length - 1; i++) {
    const a = v[i];
    const b = v[i + 1];
    const prev = i > 0 ? v[i - 1] : null;
    const next = i < v.length - 2 ? v[i + 2] : null;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const extendL = !prev || crossAt(prev, a, b) <= 0;
    const extendR = !next || crossAt(a, b, next) <= 0;
    const verts = [
      extendL ? { x: a.x - ux * lip, y: a.y - uy * lip } : { x: a.x, y: a.y },
      extendR ? { x: b.x + ux * lip, y: b.y + uy * lip } : { x: b.x, y: b.y },
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

// ---------- 種子隨機（可重現）----------
function seededRand(seed: number) {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = (s ^ (s >>> 16)) >>> 0;
    return s / 0xffffffff;
  };
}

// 合成股價序列：隨機波動率的 random walk（涵蓋平緩大盤～漲跌停投機股性格）
function genPrices(seed: number): { prices: number[]; vol: number } {
  const rand = seededRand(seed * 7919 + 13);
  const n = 90 + Math.floor(rand() * 60); // 90~150 點（≈盤中降採樣長度）
  // 每步波動幅度：0.1%（大盤級）～ 6%（飆股級），偶發單步跳空 ±10%
  const vol = 0.001 + rand() * 0.059;
  const prices: number[] = [100];
  for (let i = 1; i < n; i++) {
    let stepPct = (rand() * 2 - 1) * vol;
    if (rand() < 0.02) stepPct = (rand() > 0.5 ? 1 : -1) * (0.06 + rand() * 0.04); // 跳空
    prices.push(Math.max(1, prices[i - 1] * (1 + stepPct)));
  }
  return { prices, vol };
}

// ---------- 幾何特徵擷取 ----------
function segIdxOf(track: Track, x: number): number {
  const v = track.vertices;
  let lo = 0, hi = v.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (v[mid + 1].x < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface GeoFeature {
  segIdx: number;
  verts: { x: number; y: number }[]; // [i-2 .. i+3]
  slopeInDeg: number;   // 事發 segment 坡角（+ = 下坡，y 向下為正）
  slopeOutDeg: number;  // 下一 segment 坡角
  turnDeg: number;      // 兩段轉折角（外角，越大越尖）
  atValley: boolean;    // 事發點是否 V 谷頂點附近
  atPeak: boolean;
  // 最近 V 谷特徵（±2 頂點內）：h1=下降高度、h2=爬出高度、included=夾角(°)
  valley?: { dxFromX: number; h1: number; h2: number; includedDeg: number };
}

function geoAt(track: Track, x: number): GeoFeature {
  const v = track.vertices;
  const i = segIdxOf(track, x);
  const pick = (k: number) => v[Math.max(0, Math.min(v.length - 1, k))];
  const slope = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const sIn = slope(pick(i), pick(i + 1));
  const sOut = slope(pick(i + 1), pick(i + 2));
  const a = pick(i), b = pick(i + 1), c = pick(i + 2);
  // 找 x 附近（±2 頂點）最近的 V 谷頂點並量測幾何
  let valley: GeoFeature["valley"];
  for (let k = i - 1; k <= i + 2; k++) {
    if (k <= 0 || k >= v.length - 1) continue;
    const p = v[k - 1], q = v[k], r = v[k + 1];
    if (q.y > p.y && q.y > r.y) { // V 谷（y 向下為正）
      const inDeg = slope(p, q);   // 下坡角（正）
      const outDeg = slope(q, r);  // 爬出角（負）
      const cand = {
        dxFromX: Math.round(q.x - x),
        h1: Math.round(q.y - p.y),
        h2: Math.round(q.y - r.y),
        includedDeg: Math.round((180 - inDeg + outDeg) * 10) / 10, // 兩壁夾角，越小越尖
      };
      if (!valley || Math.abs(cand.dxFromX) < Math.abs(valley.dxFromX)) valley = cand;
    }
  }
  return {
    segIdx: i,
    verts: [pick(i - 2), pick(i - 1), a, b, c, pick(i + 3)].map((p) => ({ x: Math.round(p.x), y: Math.round(p.y * 10) / 10 })),
    slopeInDeg: Math.round(sIn * 10) / 10,
    slopeOutDeg: Math.round(sOut * 10) / 10,
    turnDeg: Math.round((sOut - sIn) * 10) / 10,
    atValley: b.y > a.y && b.y > c.y,
    atPeak: b.y < a.y && b.y < c.y,
    valley,
  };
}

// ---------- 單次模擬 ----------
interface StuckEvent {
  kind: "stuckMidAir" | "stall";
  runSeed: number;
  bot: BotKind;
  step: number;
  x: number;
  y: number;
  speed: number;
  rearContacts: number;
  frontContacts: number;
  throttle: boolean;
  geo: GeoFeature;
  // stall 專用：偵測到後強制放開油門 1s → 恢復 bot，3s 內前進 > 40px 即算脫困
  // （對應使用者回報「卡住後放開手指會被彈出來」）
  recoveredByRelease?: boolean;
}

interface RunResult {
  seed: number;
  bot: BotKind;
  vol: number;
  outcome: "finished" | "crash" | "stuckMidAir" | "stall" | "timeout";
  steps: number;
  events: StuckEvent[];
}

function simulateRun(seed: number, bot: BotKind): RunResult {
  const { prices, vol } = genPrices(seed);
  const engine = Engine.create();
  engine.gravity.y = 0.5;
  const world = engine.world;
  let track = pricesToTrack(prices);
  if (FIX === "flat") track = applyFixFlat(track);
  if (FIX === "lipcap") track = applyConvexCap(track);
  Composite.add(world, FIX === "lip" || FIX === "lipcap" ? buildLipBodies(track) : buildTerrainBodies(track));
  if (FIX === "circle") Composite.add(world, valleyCircleBodies(track));

  const spawnX = track.startX;
  const HOVER_HEIGHT = 67;
  const spawnY = track.vertices[0].y - BIKE.wheelDropY - BIKE.wheelRadius - 1 - HOVER_HEIGHT;
  const bike: Bike = createBike(world, spawnX, spawnY);

  // 接觸計數（同 GameCanvas onCollision）
  let rearContacts = 0;
  let frontContacts = 0;
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

  // 輸入 bot
  const rand = seededRand(seed * 31 + (bot === "safe" ? 1 : bot === "hold" ? 2 : 3));
  let randHoldLeft = 0;
  let randReleaseLeft = 0;
  const decideThrottle = (grounded: boolean): boolean => {
    if (bot === "hold") return true;
    if (bot === "safe") return grounded; // 地面按住、空中放開（不翻滾的安全騎法）
    // random：按住/放開隨機交替
    if (randHoldLeft > 0) { randHoldLeft--; return true; }
    if (randReleaseLeft > 0) { randReleaseLeft--; return false; }
    if (rand() < 0.7) randHoldLeft = 20 + Math.floor(rand() * 160);
    else randReleaseLeft = 5 + Math.floor(rand() * 55);
    return decideThrottle(grounded);
  };

  // ---- 狀態（對照 GameCanvas step()）----
  let throttle = false;
  let hasEverGrounded = false;
  let crashTimer = 0;
  const events: StuckEvent[] = [];
  let outcome: RunResult["outcome"] = "timeout";

  // stall 偵測：滑動窗記錄 x
  const xHist: number[] = [];
  let lastStallReportStep = -99999;
  // 脫困探測狀態：>0 表示強制放開油門剩餘步數；探測中的事件與起點
  let releaseProbeLeft = 0;
  let probeEvent: StuckEvent | null = null;
  let probeStartX = 0;
  let probeDeadline = 0;
  // assist watchdog（FIX === "assist"）：jam 偵測（滑動窗淨位移）/ 自動放開剩餘步數
  const jamHist: number[] = [];
  let assistLeft = 0;

  // applyControls — 逐行對照 GameCanvas.tsx（定速引擎 + 空中翻滾/制動）
  const applyControls = (grounded: boolean) => {
    const c = bike.chassis;
    if (grounded) {
      const dx = bike.frontWheel.position.x - bike.rearWheel.position.x;
      const dy = bike.frontWheel.position.y - bike.rearWheel.position.y;
      const len = Math.hypot(dx, dy);
      if (len > 0.001) {
        const tx = dx / len;
        const ty = dy / len;
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
      // 對齊前輪坡段（slopeAt 的二分搜尋直接內含在 geoAt，這裡照抄遊戲用法）
      const v = track.vertices;
      const i = segIdxOf(track, bike.frontWheel.position.x);
      const slope = Math.atan2(v[i + 1].y - v[i].y, v[i + 1].x - v[i].x);
      let d = slope - c.angle;
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
  let step = 0;
  for (step = 0; step < MAX_STEPS; step++) {
    const grounded = rearContacts > 0 || frontContacts > 0;
    throttle = decideThrottle(grounded);
    if (releaseProbeLeft > 0) { throttle = false; releaseProbeLeft--; } // 脫困探測：強制放開
    // assist watchdog：著地+油門+40 步（0.67s）滑動窗「淨位移 < 3px」→ 判定 jam
    //（逐步判會被牆角 ±1px 振盪重置，必須用窗內淨位移；窗太短（15 步）會誤傷
    // 正常騎乘的短暫減速——實測 safe bot 完賽率 1711→1833 難度跑掉，40 步才安全），
    // 暫停驅動 60 步＝1s（照抄「放開油門」效果——suction/貼坡對齊照常，只停驅動；
    // 1s 接近使用者手動脫困的節奏，回彈距離才夠重新起步爬牆）
    if (FIX === "assist") {
      if (assistLeft > 0) { throttle = false; assistLeft--; jamHist.length = 0; }
      else if (grounded && throttle) {
        jamHist.push(bike.chassis.position.x);
        if (jamHist.length > 40) jamHist.shift();
        if (jamHist.length === 40 && Math.abs(bike.chassis.position.x - jamHist[0]) < 3) {
          assistLeft = 60;
          jamHist.length = 0;
        }
      } else jamHist.length = 0;
    }
    applyControls(grounded);
    Engine.update(engine, STEP);

    const c = bike.chassis;
    const groundedNow = rearContacts > 0 || frontContacts > 0;
    if (groundedNow && !hasEverGrounded) hasEverGrounded = true;
    // 離地瞬間歸零角速度（同 GameCanvas 558-560）
    if (!groundedNow && wasGrounded) Body.setAngularVelocity(c, 0);
    wasGrounded = groundedNow;

    // 完賽
    if (c.position.x >= track.finishX) { outcome = "finished"; break; }

    // 死亡判定（對照 GameCanvas）
    const bothWheelsOff = rearContacts === 0 && frontContacts === 0;
    const speed = Math.hypot(c.velocity.x, c.velocity.y);
    const tippedOver = Math.cos(c.angle) < RULES.crashTipCos;
    const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
    const topHit = tippedOver && BIKE.crashZone.some(({ x: lx, y: ly }) => {
      const wx = ca * lx - sa * ly + c.position.x;
      const wy = sa * lx + ca * ly + c.position.y;
      return wy > terrainYAt(track, wx);
    });
    if (topHit) { outcome = "crash"; break; }

    const stuckMidAir = bothWheelsOff && speed < 0.5 && hasEverGrounded;
    if (stuckMidAir) {
      crashTimer += STEP / 1000;
      if (crashTimer >= RULES.crashUpsideDownSec) {
        events.push({
          kind: "stuckMidAir", runSeed: seed, bot, step,
          x: Math.round(c.position.x), y: Math.round(c.position.y),
          speed: Math.round(speed * 100) / 100,
          rearContacts, frontContacts, throttle,
          geo: geoAt(track, c.position.x),
        });
        outcome = "stuckMidAir";
        break;
      }
    } else {
      crashTimer = 0;
    }

    // 脫困探測結算
    if (probeEvent && step >= probeDeadline) {
      probeEvent.recoveredByRelease = Math.abs(c.position.x - probeStartX) > 40;
      if (!probeEvent.recoveredByRelease) { outcome = "stall"; break; } // 真死局
      probeEvent = null;
      xHist.length = 0;
    }

    // stall 偵測（模擬專用，遊戲內不存在）：x 前進停滯但沒死、沒完賽
    xHist.push(c.position.x);
    if (xHist.length > STALL_WINDOW_STEPS) xHist.shift();
    if (
      !probeEvent &&
      hasEverGrounded &&
      xHist.length === STALL_WINDOW_STEPS &&
      Math.abs(c.position.x - xHist[0]) < STALL_DX &&
      step - lastStallReportStep > STALL_WINDOW_STEPS * 2
    ) {
      lastStallReportStep = step;
      probeEvent = {
        kind: "stall", runSeed: seed, bot, step,
        x: Math.round(c.position.x), y: Math.round(c.position.y),
        speed: Math.round(speed * 100) / 100,
        rearContacts, frontContacts, throttle,
        geo: geoAt(track, c.position.x),
      };
      events.push(probeEvent);
      // 啟動脫困探測：放開 1s，3s 內看是否前進
      releaseProbeLeft = 60;
      probeStartX = c.position.x;
      probeDeadline = step + 180;
      if (events.length >= 3) { outcome = "stall"; break; } // 單 run 上限
    }
  }

  Events.off(engine, "collisionStart");
  Events.off(engine, "collisionEnd");
  Engine.clear(engine);
  return { seed, bot, vol, outcome, steps: step, events };
}

// ---------- 主程式 ----------
function main() {
  const t0 = Date.now();
  const results: RunResult[] = [];
  const allEvents: StuckEvent[] = [];
  const outcomes: Record<string, number> = {};

  let done = 0;
  const total = RUNS * BOTS.length;
  for (const bot of BOTS) {
    for (let i = 0; i < RUNS; i++) {
      const r = simulateRun(SEED0 + i, bot);
      results.push(r);
      allEvents.push(...r.events);
      outcomes[`${bot}:${r.outcome}`] = (outcomes[`${bot}:${r.outcome}`] || 0) + 1;
      done++;
      if (done % 100 === 0) {
        console.log(`[${done}/${total}] ${(Date.now() - t0) / 1000}s elapsed, events so far: ${allEvents.length}`);
      }
    }
  }

  // ---- 彙總 ----
  const stuckEvents = allEvents.filter((e) => e.kind === "stuckMidAir");
  const stallEvents = allEvents.filter((e) => e.kind === "stall");
  const byBot: Record<string, { runs: number; stuckDeaths: number; stallEvents: number; affectedRuns: number; affectedPct: string }> = {};
  for (const bot of BOTS) {
    const botEvents = allEvents.filter((e) => e.bot === bot);
    const affected = new Set(botEvents.map((e) => e.runSeed)).size;
    byBot[bot] = {
      runs: RUNS,
      stuckDeaths: botEvents.filter((e) => e.kind === "stuckMidAir").length,
      stallEvents: botEvents.filter((e) => e.kind === "stall").length,
      affectedRuns: affected,
      affectedPct: ((affected / RUNS) * 100).toFixed(1) + "%",
    };
  }

  // 地形特徵統計：轉折角/坡角分佈
  const summarizeGeo = (evts: StuckEvent[]) => {
    if (!evts.length) return null;
    const turns = evts.map((e) => e.geo.turnDeg);
    const slopeIns = evts.map((e) => e.geo.slopeInDeg);
    const valleys = evts.filter((e) => e.geo.atValley).length;
    const peaks = evts.filter((e) => e.geo.atPeak).length;
    const avg = (a: number[]) => Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 10) / 10;
    const nearValley = evts.filter((e) => e.geo.valley);
    const vh2 = nearValley.map((e) => e.geo.valley!.h2);
    const vInc = nearValley.map((e) => e.geo.valley!.includedDeg);
    const recovered = evts.filter((e) => e.recoveredByRelease === true).length;
    const notRecovered = evts.filter((e) => e.recoveredByRelease === false).length;
    return {
      n: evts.length,
      avgTurnDeg: avg(turns),
      avgSlopeInDeg: avg(slopeIns),
      atValleyPct: Math.round((valleys / evts.length) * 100),
      atPeakPct: Math.round((peaks / evts.length) * 100),
      nearValleyPct: Math.round((nearValley.length / evts.length) * 100),
      valleyH2Avg: vh2.length ? avg(vh2) : null,          // 爬出高度（<80 = 沒被插平底）
      valleyH2Below80Pct: vh2.length ? Math.round((vh2.filter((h) => h > 0 && h < 80).length / vh2.length) * 100) : null,
      valleyIncludedDegAvg: vInc.length ? avg(vInc) : null, // V 谷夾角
      recoveredByRelease: recovered,
      stuckPermanently: notRecovered,
    };
  };

  const summary = {
    config: { RUNS, BOTS, SEED0, MAX_STEPS, FIX },
    elapsedSec: Math.round((Date.now() - t0) / 100) / 10,
    outcomes,
    byBot,
    stuckGeoSummary: summarizeGeo(stuckEvents),
    stallGeoSummary: summarizeGeo(stallEvents),
    reproduceHint: "node sim-build/simStuck.cjs 1 <bot> <seed> 可重跑單一案例",
  };

  console.log("\n===== SUMMARY =====");
  console.log(JSON.stringify(summary, null, 2));

  const outDir = path.resolve("sim-build");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = `sim-stuck-report-${FIX}.json`;
  fs.writeFileSync(
    path.join(outDir, outFile),
    JSON.stringify({ summary, events: allEvents }, null, 1),
  );
  console.log(`\n詳細事件已寫入 sim-build/${outFile}（${allEvents.length} 筆）`);
}

main();
