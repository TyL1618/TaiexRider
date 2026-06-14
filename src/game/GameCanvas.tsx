import { useEffect, useRef, useState } from "react";
import { Engine, Events, Composite, Body, type IEventCollision } from "matter-js";
import "./GameCanvas.css";
import { pricesToTrack, buildTerrainBodies, type Track } from "./terrain";
import { createBike, resetBike, type Bike } from "./bike";
import { CAMERA, COLOR, DRIVE, RULES } from "./constants";
import { SAMPLE_PRICES } from "../data/fakeData";

interface Hud {
  distance: number;
  points: number;
  airborne: boolean;
  airFlips: number;
  throttle: boolean;
}

// 兩角差取最短路徑 (-π, π]
function angleDelta(prev: number, next: number): number {
  let d = next - prev;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// 累積 flips 的遞增總分：1圈100 / 2圈250 / 3圈450 ...
function flipScore(flips: number): number {
  let total = 0;
  for (let k = 1; k <= flips; k++) {
    total += RULES.flipBaseScore + (k - 1) * RULES.flipScoreStep;
  }
  return total;
}

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<Hud>({
    distance: 0,
    points: 0,
    airborne: false,
    airFlips: 0,
    throttle: false,
  });
  const [crashed, setCrashed] = useState(false);
  const [finished, setFinished] = useState(false);
  // 讓事件處理可讀到最新的結束狀態
  const overRef = useRef(false);
  overRef.current = crashed || finished;

  // 外部觸發重置（R 鍵 / 按鈕）
  const resetSignal = useRef(0);
  const requestReset = () => {
    resetSignal.current++;
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    // ---- 建立世界 ----
    const engine = Engine.create();
    engine.gravity.y = 1;
    const world = engine.world;

    const track: Track = pricesToTrack(SAMPLE_PRICES);
    Composite.add(world, buildTerrainBodies(track));

    const spawnX = track.startX;
    const spawnY = track.vertices[0].y - 55; // 緊貼起點平台上方，落下即就位
    const bike: Bike = createBike(world, spawnX, spawnY);

    // ---- 著地偵測（輪子 vs terrain 計數）----
    let rearContacts = 0;
    let frontContacts = 0;
    const onCollision = (delta: number) => (e: IEventCollision<Engine>) => {
      for (const pair of e.pairs) {
        const labels = [pair.bodyA.label, pair.bodyB.label];
        if (!labels.includes("terrain")) continue;
        if (labels.includes("rearWheel")) rearContacts += delta;
        if (labels.includes("frontWheel")) frontContacts += delta;
      }
    };
    const collStart = onCollision(1);
    const collEnd = onCollision(-1);
    Events.on(engine, "collisionStart", collStart);
    Events.on(engine, "collisionEnd", collEnd);

    // ---- 輸入：單鍵（按住=油門/空中後翻，放開=滑行）----
    let throttle = false;
    const press = () => {
      if (overRef.current) return;
      throttle = true;
    };
    const release = () => {
      throttle = false;
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.code === "Space") {
        ev.preventDefault();
        press();
      } else if (ev.key === "r" || ev.key === "R") {
        requestReset();
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.code === "Space") release();
    };
    window.addEventListener("pointerdown", press);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // ---- 畫布尺寸 ----
    let W = 0;
    let H = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    // ---- 遊戲狀態 ----
    let camX = spawnX - W * CAMERA.offsetXRatio;
    let camY = spawnY - H * CAMERA.offsetYRatio;
    let prevAngle = bike.chassis.angle;
    let airRotation = 0;
    let crashTimer = 0;
    let points = 0;
    let wasGrounded = false;
    let hudTick = 0;

    const doReset = () => {
      resetBike(bike);
      rearContacts = 0;
      frontContacts = 0;
      throttle = false;
      prevAngle = bike.chassis.angle;
      airRotation = 0;
      crashTimer = 0;
      points = 0;
      wasGrounded = false;
      setCrashed(false);
      setFinished(false);
    };

    // ---- 物理步進 ----
    const STEP = 1000 / 60;
    const applyControls = (grounded: boolean) => {
      if (!throttle || overRef.current) return;
      const c = bike.chassis;
      if (grounded) {
        // 著地：沿車身朝向施前進力 + 後輪轉動（不主動翻身，確保穩定前進）
        if (c.velocity.x < DRIVE.maxSpeed) {
          const f = c.mass * DRIVE.accel;
          c.force.x += Math.cos(c.angle) * f;
          c.force.y += Math.sin(c.angle) * f;
        }
        bike.rearWheel.torque += DRIVE.rearWheelSpin;
      } else {
        // 空中：直接逼近後翻角速度（負=逆時針=後空翻）
        const nv = Math.max(-DRIVE.airSpinMax, c.angularVelocity - DRIVE.airSpinAccel);
        Body.setAngularVelocity(c, nv);
      }
    };

    const step = (dtMs: number) => {
      const grounded = rearContacts > 0 || frontContacts > 0;
      applyControls(grounded);
      Engine.update(engine, STEP);

      const c = bike.chassis;
      const groundedNow = rearContacts > 0 || frontContacts > 0;

      // 空中累積旋轉
      if (!groundedNow) {
        airRotation += angleDelta(prevAngle, c.angle);
      }
      prevAngle = c.angle;

      // 正立判定：車身上向量 = (sin a, -cos a)，朝上 ⇔ cos a > threshold
      const upright = Math.cos(c.angle) > RULES.uprightCosThreshold;

      // 落地瞬間結算後空翻
      if (groundedNow && !wasGrounded) {
        const flips = Math.floor(Math.abs(airRotation) / (2 * Math.PI));
        if (upright && flips > 0) points += flipScore(flips);
        airRotation = 0;
      }
      if (groundedNow) airRotation = 0;
      wasGrounded = groundedNow;

      // 摔車：輪朝上（傾倒超過 90°）持續一段時間（DEVDOC 5.4）
      if (Math.cos(c.angle) < 0) {
        crashTimer += dtMs / 1000;
        if (crashTimer >= RULES.crashUpsideDownSec && !overRef.current) {
          setCrashed(true);
        }
      } else {
        crashTimer = 0;
      }

      // 完賽
      if (c.position.x >= track.finishX && !overRef.current) {
        setFinished(true);
      }
      return { grounded: groundedNow, upright };
    };

    // ---- 渲染（neon）----
    const wx = (x: number) => x - camX;
    const wy = (y: number) => y - camY;

    const drawTrack = () => {
      const v = track.vertices;
      ctx.save();
      // 線下漸層填色
      ctx.beginPath();
      ctx.moveTo(wx(v[0].x), wy(v[0].y));
      for (let i = 1; i < v.length; i++) ctx.lineTo(wx(v[i].x), wy(v[i].y));
      ctx.lineTo(wx(v[v.length - 1].x), H);
      ctx.lineTo(wx(v[0].x), H);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, COLOR.fillTop);
      grad.addColorStop(1, COLOR.fillBottom);
      ctx.fillStyle = grad;
      ctx.fill();
      // 霓虹線
      ctx.beginPath();
      ctx.moveTo(wx(v[0].x), wy(v[0].y));
      for (let i = 1; i < v.length; i++) ctx.lineTo(wx(v[i].x), wy(v[i].y));
      ctx.lineWidth = 3;
      ctx.strokeStyle = COLOR.track;
      ctx.shadowColor = COLOR.trackGlow;
      ctx.shadowBlur = 16;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.restore();
    };

    const drawFlag = (x: number, y: number, color: string, label: string) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wx(x), wy(y));
      ctx.lineTo(wx(x), wy(y) - 60);
      ctx.stroke();
      ctx.fillRect(wx(x), wy(y) - 60, 34, 18);
      ctx.fillStyle = "#05080f";
      ctx.font = "bold 11px system-ui";
      ctx.shadowBlur = 0;
      ctx.fillText(label, wx(x) + 3, wy(y) - 47);
      ctx.restore();
    };

    const drawWheel = (
      px: number,
      py: number,
      angle: number,
      r: number,
    ) => {
      ctx.save();
      ctx.translate(wx(px), wy(py));
      ctx.rotate(angle);
      ctx.strokeStyle = COLOR.wheel;
      ctx.shadowColor = COLOR.bikeGlow;
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      // 輪輻（顯示轉動）
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(r, 0);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    };

    const drawBike = () => {
      const c = bike.chassis;
      // 車身
      ctx.save();
      ctx.translate(wx(c.position.x), wy(c.position.y));
      ctx.rotate(c.angle);
      ctx.strokeStyle = COLOR.bike;
      ctx.shadowColor = COLOR.bikeGlow;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-34, -8, 68, 16, 6);
      ctx.stroke();
      // 騎士（簡單線條）
      ctx.beginPath();
      ctx.moveTo(-6, -8);
      ctx.lineTo(2, -26);
      ctx.lineTo(18, -14); // 手臂往把手
      ctx.moveTo(2, -26);
      ctx.arc(2, -32, 6, 0, Math.PI * 2); // 頭
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
      // 輪子
      drawWheel(
        bike.rearWheel.position.x,
        bike.rearWheel.position.y,
        bike.rearWheel.angle,
        bike.rearWheel.circleRadius!,
      );
      drawWheel(
        bike.frontWheel.position.x,
        bike.frontWheel.position.y,
        bike.frontWheel.angle,
        bike.frontWheel.circleRadius!,
      );
    };

    const render = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawTrack();
      drawFlag(track.vertices[0].x, track.vertices[0].y, COLOR.start, "START");
      drawFlag(track.finishX, track.vertices[track.vertices.length - 1].y, COLOR.finish, "FIN");
      drawBike();
    };

    // ---- 主迴圈（固定步進累加器）----
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    let lastResetSignal = resetSignal.current;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (resetSignal.current !== lastResetSignal) {
        lastResetSignal = resetSignal.current;
        doReset();
        last = now;
        acc = 0;
      }
      let dt = now - last;
      last = now;
      if (dt > 60) dt = 60; // 防止分頁切回時爆衝
      acc += dt;

      let grounded = false;
      while (acc >= STEP) {
        const r = step(STEP);
        grounded = r.grounded;
        acc -= STEP;
      }

      // 鏡頭跟隨
      const c = bike.chassis;
      const tx = c.position.x - W * CAMERA.offsetXRatio;
      const ty = c.position.y - H * CAMERA.offsetYRatio;
      camX += (Math.max(0, tx) - camX) * CAMERA.ease;
      camY += (ty - camY) * CAMERA.ease;

      render();

      // HUD（節流更新，避免每幀 setState）
      if (++hudTick % 5 === 0) {
        const dist = Math.max(
          0,
          Math.round((c.position.x - bike.spawn.x) / 20),
        );
        const flips = Math.floor(Math.abs(airRotation) / (2 * Math.PI));
        setHud({
          distance: dist,
          points,
          airborne: !grounded,
          airFlips: flips,
          throttle,
        });
      }
    };
    raf = requestAnimationFrame(frame);

    // ---- 清理 ----
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", resize);
      Events.off(engine, "collisionStart", collStart);
      Events.off(engine, "collisionEnd", collEnd);
      Engine.clear(engine);
    };
  }, []);

  return (
    <div className="game-root">
      <canvas ref={canvasRef} className="game-canvas" />

      <div className="hud">
        <div className="hud-row hud-big">{hud.points}</div>
        <div className="hud-row hud-dim">分數 ・ 距離 {hud.distance}m</div>
        <div className="hud-row hud-dim">
          空中：
          {hud.airborne ? (
            <span className="hud-air">飛行中 {hud.airFlips > 0 ? `${hud.airFlips}圈` : ""}</span>
          ) : (
            <span>著地</span>
          )}
        </div>
      </div>

      <div className={`throttle-dot ${hud.throttle ? "on" : ""}`} />

      <div className="ctrl-hint">按住畫面任一處 = 油門 ・ 空中按住 = 後空翻 ・ R 重來</div>

      {(crashed || finished) && (
        <div className="overlay">
          <div className="overlay-title">{finished ? "完賽！" : "摔車"}</div>
          <div className="overlay-score">{hud.points} 分</div>
          <button className="overlay-btn" onClick={requestReset}>
            再玩一次 (R)
          </button>
        </div>
      )}
    </div>
  );
}
