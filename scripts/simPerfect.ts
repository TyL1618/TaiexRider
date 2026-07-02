// ============================================================
// 完美落地判定驗證（FABLE5_HANDOFF Debug #1）
//
// 假說（交接 + code 閱讀）：
//   GameCanvas.tsx 落地判定是單 step 邊緣觸發（groundedNow && !wasGrounded），
//   且「任何 grounded step」都會清空 airRotation（562 行 if (groundedNow) airRotation = 0）。
//   落地微彈跳（restitution=0.05）若造成「觸地 1~2 步 → 短暫離地 → 再觸地」，
//   第一次觸地就把 airRotation 清零 → 真正穩定落地時量到的旋轉 ≈ 0 → 過不了 1.7π。
//   另外翻轉途中輪子「擦過」山頂一幀也會整輪清零。
//
// 驗證方式：flip bot（地面按住、空中按住翻滿一圈後放開）跑大量隨機賽道，
// 對每次「空中旋轉 ≥ 1.7π 的落地」記錄：
//   - 第一次觸地瞬間的 airRotation / levelOk（理想判定＝玩家看到的）
//   - 遊戲現行邏輯實際會不會給完美落地（逐步重演 wasGrounded/airRotation 清零）
//   - 落地後 5 步內的 grounded 序列（觀察彈跳 pattern）
// 產出：漏判率 + 彈跳 pattern 統計。
//
// 打包執行（同 simStuck）：
//   ./node_modules/.bin/esbuild scripts/simPerfect.ts --bundle --platform=node \
//     --format=cjs --outfile=sim-build/simPerfect.cjs && node sim-build/simPerfect.cjs [runs=500]
// ============================================================

import { Engine, Events, Composite, Body, type IEventCollision } from "matter-js";
import { pricesToTrack, buildTerrainBodies, slopeAt, terrainYAt, type Track } from "../src/game/terrain";
import { createBike, type Bike } from "../src/game/bike";
import { BIKE, DRIVE, RULES } from "../src/game/constants";

const RUNS = parseInt(process.argv[2] || "500", 10);
const SEED0 = parseInt(process.argv[3] || "1", 10);
const MAX_STEPS = 6000;
const STEP = 1000 / 60;

function seededRand(seed: number) {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = (s ^ (s >>> 16)) >>> 0;
    return s / 0xffffffff;
  };
}

function genPrices(seed: number): number[] {
  const rand = seededRand(seed * 7919 + 13);
  const n = 90 + Math.floor(rand() * 60);
  const vol = 0.005 + rand() * 0.055; // 偏波動大 → 跳台多 → 翻轉機會多
  const prices: number[] = [100];
  for (let i = 1; i < n; i++) {
    let stepPct = (rand() * 2 - 1) * vol;
    if (rand() < 0.03) stepPct = (rand() > 0.5 ? 1 : -1) * (0.06 + rand() * 0.04);
    prices.push(Math.max(1, prices[i - 1] * (1 + stepPct)));
  }
  return prices;
}

function angleDelta(prev: number, next: number): number {
  let d = next - prev;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

interface LandingCase {
  seed: number;
  step: number;
  x: number;
  // 「理想判定」＝玩家眼中：整段跳躍累積的旋轉（不被微觸地清零）
  idealAirRotation: number;
  idealAirTime: number;
  levelOk: boolean;
  upright: boolean;
  // 遊戲現行邏輯在這次跳躍結束時是否給了完美落地
  gameAwarded: boolean;
  // 修法（settle-after-N）是否給了完美落地
  fixAwarded: boolean;
  // 落地後 10 步 grounded 序列（1=觸地 0=離地），觀察彈跳
  groundedSeq: string;
  // 擦地：跳躍途中出現過的短暫觸地叢集數（每叢 ≤3 步）
  microContacts: number;
}

function simulateRun(seed: number) {
  const prices = genPrices(seed);
  const engine = Engine.create();
  engine.gravity.y = 0.5;
  const world = engine.world;
  const track: Track = pricesToTrack(prices);
  Composite.add(world, buildTerrainBodies(track));

  const spawnX = track.startX;
  const spawnY = track.vertices[0].y - BIKE.wheelDropY - BIKE.wheelRadius - 1 - 67;
  const bike: Bike = createBike(world, spawnX, spawnY);

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

  // ---- flip bot：地面按住；空中翻到 ≥ 2.05π 就放開（留餘裕讓制動+前壓穩住）----
  let throttle = false;
  let hasEverGrounded = false;

  // ---- 遊戲現行邏輯的狀態（逐行對照 GameCanvas step()）----
  let gAirRotation = 0;
  let gAirTime = 0;
  let gWasGrounded = false;
  let prevAngle = bike.chassis.angle;

  // ---- 理想判定的狀態（整段跳躍不被微觸地清零；跳躍=從「穩定觸地」到「下一次穩定觸地」）----
  // 穩定觸地定義：連續 ≥ STABLE_N 步 grounded
  const STABLE_N = 4;
  let iAirRotation = 0;
  let iAirTime = 0;
  let stableGroundedRun = 0;
  let inJump = false;
  let microContactClusters = 0;
  let curContactRun = 0;

  // 落地觀察窗
  const cases: LandingCase[] = [];
  let pendingCase: LandingCase | null = null;
  let seqLeft = 0;
  let seq = "";
  // 本次跳躍中遊戲邏輯是否給過完美落地（第一次邊緣觸發時判的）
  let gameAwardedThisJump = false;

  // ---- 修法（延遲結算 settle-after-N）的狀態 ----
  // 首次觸地快照 rotation/angle → 連續 SETTLE_N 步著地才結算；
  // 擦地（<SETTLE_N 步就離地）不結算、不清 rotation、不歸零角速度。
  const SETTLE_N = 4;
  let fAirRotation = 0;
  let fAirTime = 0;
  let fGroundedRun = 0;
  let fSettled = true; // 開局視為已結算（站在地上）
  let fSnap: { rot: number; air: number; angle: number; x: number } | null = null;
  let fixAwardedThisJump = false;

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
      const slope = slopeAt(track, bike.frontWheel.position.x);
      const da = angleDelta(c.angle, slope);
      let av = da * DRIVE.groundAlignGain;
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

  for (let step = 0; step < MAX_STEPS; step++) {
    const grounded = rearContacts > 0 || frontContacts > 0;
    // flip bot 決策
    if (grounded) throttle = true;
    else throttle = Math.abs(iAirRotation) < Math.PI * 2.05; // 翻滿一圈多一點就放開
    applyControls(grounded);
    Engine.update(engine, STEP);

    const c = bike.chassis;
    const groundedNow = rearContacts > 0 || frontContacts > 0;
    const airborneFully = rearContacts === 0 && frontContacts === 0;
    if (groundedNow && !hasEverGrounded) hasEverGrounded = true;

    // ---- 遊戲現行邏輯（原汁重演）----
    if (!groundedNow) gAirRotation += angleDelta(prevAngle, c.angle);
    if (airborneFully) gAirTime += STEP / 1000;
    const upright = Math.cos(c.angle) > RULES.uprightCosThreshold;
    if (groundedNow && !gWasGrounded) {
      const realAir = gAirTime > RULES.minAirSec;
      const landSlope = slopeAt(track, c.position.x);
      const levelOk = Math.abs(angleDelta(c.angle, landSlope)) < RULES.perfectLevelRad;
      if (realAir && Math.abs(gAirRotation) > Math.PI * 1.7 && levelOk) {
        gameAwardedThisJump = true;
      }
      gAirRotation = 0;
      gAirTime = 0;
    } else if (!groundedNow && gWasGrounded) {
      Body.setAngularVelocity(c, 0); // 離地瞬間歸零角速度（GameCanvas 558-560）
    }
    if (groundedNow) gAirRotation = 0;
    gWasGrounded = groundedNow;

    // ---- 修法邏輯（settle-after-N，平行重演）----
    if (groundedNow) {
      fGroundedRun++;
      if (fGroundedRun === 1 && !fSettled) {
        // 首次觸地：快照（玩家看到的落地瞬間）
        fSnap = { rot: fAirRotation, air: fAirTime, angle: c.angle, x: c.position.x };
      }
      if (fGroundedRun >= SETTLE_N && !fSettled && fSnap) {
        const landSlope = slopeAt(track, fSnap.x);
        const levelOk = Math.abs(angleDelta(fSnap.angle, landSlope)) < RULES.perfectLevelRad;
        if (fSnap.air > RULES.minAirSec && Math.abs(fSnap.rot) > Math.PI * 1.7 && levelOk) {
          fixAwardedThisJump = true;
        }
        fSettled = true;
        fAirRotation = 0;
        fAirTime = 0;
        fSnap = null;
      }
    } else {
      // 空中（含擦地後回到空中）：持續累積，不因短暫觸地清零
      fAirRotation += angleDelta(prevAngle, c.angle);
      if (airborneFully) fAirTime += STEP / 1000;
      fGroundedRun = 0;
      fSettled = false;
    }

    // ---- 理想判定（穩定觸地才算落地；微觸地不清旋轉）----
    if (!groundedNow) {
      iAirRotation += angleDelta(prevAngle, c.angle);
      iAirTime += STEP / 1000;
      if (curContactRun > 0 && curContactRun <= 3) microContactClusters++;
      curContactRun = 0;
      stableGroundedRun = 0;
      if (iAirTime > 0.05) inJump = true;
    } else {
      curContactRun++;
      stableGroundedRun++;
      if (stableGroundedRun >= STABLE_N && inJump) {
        // 穩定落地 → 結算這次跳躍
        if (iAirTime > RULES.minAirSec && Math.abs(iAirRotation) > Math.PI * 1.7) {
          const landSlope = slopeAt(track, c.position.x);
          const levelOk = Math.abs(angleDelta(c.angle, landSlope)) < RULES.perfectLevelRad;
          pendingCase = {
            seed: seed,
            step,
            x: Math.round(c.position.x),
            idealAirRotation: Math.round((iAirRotation / Math.PI) * 100) / 100, // 單位 π
            idealAirTime: Math.round(iAirTime * 100) / 100,
            levelOk,
            upright,
            gameAwarded: gameAwardedThisJump,
            fixAwarded: fixAwardedThisJump,
            groundedSeq: "",
            microContacts: microContactClusters,
          };
          seqLeft = 10;
          seq = "";
        }
        inJump = false;
        iAirRotation = 0;
        iAirTime = 0;
        microContactClusters = 0;
        gameAwardedThisJump = false;
        fixAwardedThisJump = false;
      }
    }
    prevAngle = c.angle;

    // 落地後 grounded 序列記錄
    if (pendingCase && seqLeft > 0) {
      seq += groundedNow ? "1" : "0";
      seqLeft--;
      if (seqLeft === 0) {
        pendingCase.groundedSeq = seq;
        cases.push(pendingCase);
        pendingCase = null;
      }
    }

    // 完賽/死亡就結束（死亡簡化：翻過頭撞地）
    if (c.position.x >= track.finishX) break;
    const tippedOver = Math.cos(c.angle) < RULES.crashTipCos;
    const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
    const topHit = tippedOver && BIKE.crashZone.some(({ x: lx, y: ly }) => {
      const wx = ca * lx - sa * ly + c.position.x;
      const wy = sa * lx + ca * ly + c.position.y;
      return wy > terrainYAt(track, wx);
    });
    if (topHit) break;
  }

  Events.off(engine, "collisionStart");
  Events.off(engine, "collisionEnd");
  Engine.clear(engine);
  if (pendingCase) cases.push(pendingCase); // 沒收滿 10 步的殘案也收
  return cases;
}

function main() {
  const t0 = Date.now();
  const all: LandingCase[] = [];
  for (let i = 0; i < RUNS; i++) {
    all.push(...simulateRun(SEED0 + i));
    if ((i + 1) % 100 === 0) console.log(`[${i + 1}/${RUNS}] cases=${all.length}`);
  }

  // 理想上該給完美落地的案例（旋轉夠 + 水平 + 正立）
  const shouldAward = all.filter((c) => c.levelOk && c.upright);
  const missed = shouldAward.filter((c) => !c.gameAwarded);
  const missedFix = shouldAward.filter((c) => !c.fixAwarded);
  const withMicro = shouldAward.filter((c) => c.microContacts > 0);
  const missedWithMicro = missed.filter((c) => c.microContacts > 0);
  // 修法誤發（現行沒給、理想也不該給，但修法給了）：檢查有沒有過度放寬
  const overAward = all.filter((c) => c.fixAwarded && !(c.levelOk && c.upright));

  console.log("\n===== SUMMARY =====");
  console.log(`跳躍落地（旋轉 ≥1.7π）總數: ${all.length}`);
  console.log(`理想判定該給完美落地: ${shouldAward.length}`);
  console.log(`遊戲現行邏輯漏判: ${missed.length} (${shouldAward.length ? ((missed.length / shouldAward.length) * 100).toFixed(1) : 0}%)`);
  console.log(`修法(settle-after-${4})漏判: ${missedFix.length} (${shouldAward.length ? ((missedFix.length / shouldAward.length) * 100).toFixed(1) : 0}%)`);
  console.log(`修法誤發（理想不該給但給了）: ${overAward.length} / ${all.length}`);
  console.log(`該給的案例中跳躍途中有微觸地(擦地): ${withMicro.length}`);
  console.log(`漏判案例中有微觸地: ${missedWithMicro.length} / ${missed.length}`);
  console.log(`\n漏判樣本（最多 15 筆）:`);
  for (const c of missed.slice(0, 15)) {
    console.log(`  seed=${c.seed} step=${c.step} x=${c.x} rot=${c.idealAirRotation}π air=${c.idealAirTime}s micro=${c.microContacts} seq=${c.groundedSeq}`);
  }
  // 彈跳 pattern：落地後 10 步序列中出現 0（再離地）的比例
  const bouncy = all.filter((c) => c.groundedSeq.includes("0"));
  console.log(`\n落地後 10 步內出現再離地(彈跳)的比例: ${all.length ? ((bouncy.length / all.length) * 100).toFixed(1) : 0}%`);
  console.log(`耗時 ${(Date.now() - t0) / 1000}s`);
}

main();
