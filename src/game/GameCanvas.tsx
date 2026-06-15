import { useEffect, useRef, useState } from "react";
import { Engine, Events, Composite, Body, type IEventCollision } from "matter-js";
import "./GameCanvas.css";
import { pricesToTrack, buildTerrainBodies, type Track } from "./terrain";
import { createBike, resetBike, type Bike } from "./bike";
import { CAMERA, COLOR, DRIVE, RULES } from "./constants";

interface GameCanvasProps {
  prices: number[];
  label: string;
  onExit: () => void;
}

interface Hud {
  distance: number;
  points: number;
  airborne: boolean;
  airFlips: number;
  throttle: boolean;
  timer: string;
}

const fmtTime = (ms: number): string => {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = (totalSec % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
};

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

export default function GameCanvas({ prices, label, onExit }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<Hud>({
    distance: 0,
    points: 0,
    airborne: false,
    airFlips: 0,
    throttle: false,
    timer: "0:00.0",
  });
  const [crashed, setCrashed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
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

    const track: Track = pricesToTrack(prices);
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
    let scale = 1;
    let targetScale = 1;
    let overviewCamX = 0;
    let overviewCamY = 0;
    let overviewComputed = false;
    let prevAngle = bike.chassis.angle;
    let airRotation = 0;
    let airTime = 0; // 連續騰空時間（雙輪皆離地）
    let airborneSteps = 0; // 連續離地 step 數（後翻寬限用）
    let crashTimer = 0;
    let points = 0;
    let wasGrounded = false;
    let hudTick = 0;
    let raceTimeMs = 0;
    // 完美落地雙輪特效（剩餘幀數 + 觸發時兩輪世界座標）
    let perfectFxFrames = 0;
    let perfectFxPts: { x: number; y: number }[] = [];
    let toastId = 0;
    const showToast = (text: string) => setToast({ text, id: ++toastId });

    const doReset = () => {
      resetBike(bike);
      rearContacts = 0;
      frontContacts = 0;
      throttle = false;
      prevAngle = bike.chassis.angle;
      airRotation = 0;
      airTime = 0;
      airborneSteps = 0;
      crashTimer = 0;
      points = 0;
      raceTimeMs = 0;
      wasGrounded = false;
      perfectFxFrames = 0;
      perfectFxPts = [];
      scale = 1;
      targetScale = 1;
      overviewComputed = false;
      setCrashed(false);
      setFinished(false);
      setToast(null);
    };

    // ---- 物理步進 ----
    const STEP = 1000 / 60;
    // 定速模型（Rider 風格）：
    //  著地 → 把水平速度鎖定為 cruiseSpeed（恆速，任何坡都爬得上、不卡頓、不 wheelie）
    //  空中按住 → 唯一作用：後空翻
    const applyControls = (grounded: boolean, upright: boolean) => {
      if (overRef.current) return;
      const c = bike.chassis;

      if (grounded) {
        // 著地恆速：平滑趨近 cruiseSpeed（落地不硬切）
        if (upright) {
          const target = DRIVE.cruiseSpeed;
          const vx = c.velocity.x + (target - c.velocity.x) * DRIVE.groundLockEase;
          Body.setVelocity(c, { x: vx, y: c.velocity.y });
          // 著地壓制角速度，防止撞坡/開場瞬間翻滾
          Body.setAngularVelocity(c, c.angularVelocity * 0.78);
        }
      } else if (throttle && Math.cos(c.angle) > 0) {
        // 雙輪離地 + 按住 + 未翻過頭 → 後空翻
        const nv = Math.max(-DRIVE.airSpinMax, c.angularVelocity - DRIVE.airSpinAccel);
        Body.setAngularVelocity(c, nv);
      }
    };

    const step = (dtMs: number) => {
      const rearGrounded = rearContacts > 0;
      const frontGrounded = frontContacts > 0;
      const grounded = rearGrounded || frontGrounded;
      const uprightNow = Math.cos(bike.chassis.angle) > RULES.uprightCosThreshold;
      airborneSteps = grounded ? 0 : airborneSteps + 1;
      applyControls(grounded, uprightNow);
      Engine.update(engine, STEP);

      const c = bike.chassis;
      const groundedNow = rearContacts > 0 || frontContacts > 0;
      const airborneFully = rearContacts === 0 && frontContacts === 0;

      // 空中累積旋轉 / 滯空時間
      if (!groundedNow) {
        airRotation += angleDelta(prevAngle, c.angle);
      }
      if (airborneFully) airTime += dtMs / 1000;
      prevAngle = c.angle;

      // 正立判定：車身上向量 = (sin a, -cos a)，朝上 ⇔ cos a > threshold
      const upright = Math.cos(c.angle) > RULES.uprightCosThreshold;

      // 落地瞬間結算後空翻 + 完美落地
      if (groundedNow && !wasGrounded) {
        const flips = Math.floor(Math.abs(airRotation) / (2 * Math.PI));
        const realAir = airTime > RULES.minAirSec;
        if (upright && flips > 0) {
          const gained = flipScore(flips);
          points += gained;
          showToast(`${flips} 圈 +${gained}`);
        }
        // 完美落地：真實跳躍後車身接近水平著地（≈雙輪同時觸地）
        const levelRad = Math.abs(Math.atan2(Math.sin(c.angle), Math.cos(c.angle)));
        if (realAir && levelRad < RULES.perfectLevelRad) {
          points += RULES.perfectBonus;
          showToast(`完美落地 +${RULES.perfectBonus}`);
          perfectFxFrames = 30;
          perfectFxPts = [
            { x: bike.rearWheel.position.x, y: bike.rearWheel.position.y },
            { x: bike.frontWheel.position.x, y: bike.frontWheel.position.y },
          ];
        }
        airRotation = 0;
        airTime = 0;
      }
      if (groundedNow) airRotation = 0;
      wasGrounded = groundedNow;

      // 摔車：倒地 0.5s 立判、空中倒置 2s 判（倒地不可按壓翻回）
      if (Math.cos(c.angle) < 0) {
        crashTimer += dtMs / 1000;
        const crashTimeout = groundedNow ? 0.5 : RULES.crashUpsideDownSec;
        if (crashTimer >= crashTimeout && !overRef.current) {
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

    // [DEV] 手動步進測試鉤子（隱藏分頁 rAF 被暫停時用來驗證物理/計分）
    if (import.meta.env.DEV) {
      (window as unknown as { __test: unknown }).__test = {
        step: (n = 1) => {
          for (let i = 0; i < n; i++) step(STEP);
        },
        press: () => {
          throttle = true;
        },
        release: () => {
          throttle = false;
        },
        reset: () => doReset(),
        state: () => ({
          x: Math.round(bike.chassis.position.x),
          vx: +bike.chassis.velocity.x.toFixed(2),
          ang: Math.round((bike.chassis.angle * 180) / Math.PI),
          grounded: rearContacts > 0 || frontContacts > 0,
          rc: rearContacts,
          fc: frontContacts,
          points,
          perfectFx: perfectFxFrames,
        }),
      };
    }

    // ---- 渲染（neon）----
    const wx = (x: number) => (x - camX) * scale;
    const wy = (y: number) => (y - camY) * scale;

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
      // 霓虹折線（漲=紅/跌=綠，連續同色段合為一條 path 減少 draw call）
      let si = 0;
      while (si < v.length - 1) {
        const col = track.colors[si];
        const glow = col === COLOR.trackUp ? COLOR.trackUpGlow
          : col === COLOR.trackDown ? COLOR.trackDownGlow
          : COLOR.trackGlow;
        ctx.beginPath();
        ctx.moveTo(wx(v[si].x), wy(v[si].y));
        while (si < v.length - 1 && track.colors[si] === col) {
          ctx.lineTo(wx(v[si + 1].x), wy(v[si + 1].y));
          si++;
        }
        ctx.lineWidth = 3;
        ctx.strokeStyle = col;
        ctx.shadowColor = glow;
        ctx.shadowBlur = 16;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
      }
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

    const drawWheel = (px: number, py: number, angle: number, r: number) => {
      ctx.save();
      ctx.translate(wx(px), wy(py));
      ctx.rotate(angle);
      // 輪胎（深色實心）
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = "#0a0f18";
      ctx.fill();
      // 霓虹輪框
      ctx.strokeStyle = COLOR.wheel;
      ctx.shadowColor = COLOR.bikeGlow;
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // 輪轂 + 輪輻（顯示轉動）
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2);
      ctx.moveTo(0, 0);
      ctx.lineTo(r, 0);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    };

    // 敞篷跑車側面輪廓（local：+x 為車頭朝右，y 負為上）
    const drawBike = () => {
      const c = bike.chassis;
      ctx.save();
      ctx.translate(wx(c.position.x), wy(c.position.y));
      ctx.rotate(c.angle);

      ctx.strokeStyle = COLOR.bike;
      ctx.shadowColor = COLOR.bikeGlow;
      ctx.shadowBlur = 12;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.lineWidth = 3;

      // 車體：低扁楔形 + 中段敞篷凹陷
      ctx.beginPath();
      ctx.moveTo(-46, 7); // 車尾下緣
      ctx.lineTo(-44, -6); // 車尾
      ctx.lineTo(-30, -11); // 後甲板
      ctx.lineTo(-16, -11); // 座艙後緣
      ctx.lineTo(-9, -1); // ↓ 凹入敞篷座艙
      ctx.lineTo(7, -1); // 座艙底
      ctx.lineTo(15, -13); // ↑ 擋風玻璃
      ctx.lineTo(34, -8); // 引擎蓋
      ctx.lineTo(46, -1); // 車頭上緣
      ctx.lineTo(47, 7); // 車頭下緣
      ctx.closePath();
      // 車身淡填色
      ctx.fillStyle = "rgba(255, 179, 0, 0.10)";
      ctx.fill();
      ctx.stroke();

      // 擋風玻璃斜柱
      ctx.beginPath();
      ctx.moveTo(7, -1);
      ctx.lineTo(15, -13);
      ctx.lineWidth = 2;
      ctx.stroke();

      // 駕駛：頭露出敞篷外 + 肩
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-6, -1); // 身體
      ctx.lineTo(-3, -16);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-3, -22, 6, 0, Math.PI * 2); // 頭
      ctx.fillStyle = "#05080f";
      ctx.fill();
      ctx.stroke();

      ctx.restore();

      // 輪子（小輪）
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

    // 完美落地雙輪特效：兩輪各冒一圈擴散光環 + 放射火花
    const drawPerfectFx = () => {
      if (perfectFxFrames <= 0) return;
      const p = 1 - perfectFxFrames / 30; // 0→1 進度
      ctx.save();
      for (const pt of perfectFxPts) {
        const sx = wx(pt.x);
        const sy = wy(pt.y);
        const r = 6 + p * 28;
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = COLOR.start; // cyan，與琥珀色車身對比
        ctx.shadowColor = COLOR.start;
        ctx.shadowBlur = 16;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.stroke();
        // 放射火花
        ctx.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
          ctx.beginPath();
          ctx.moveTo(sx + Math.cos(a) * r * 0.6, sy + Math.sin(a) * r * 0.6);
          ctx.lineTo(sx + Math.cos(a) * r * 1.2, sy + Math.sin(a) * r * 1.2);
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    const render = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawTrack();
      drawFlag(track.vertices[0].x, track.vertices[0].y, COLOR.start, "START");
      drawFlag(track.finishX, track.vertices[track.vertices.length - 1].y, COLOR.finish, "FIN");
      drawBike();
      drawPerfectFx();
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
      if (!overRef.current) raceTimeMs += dt;
      acc += dt;

      let grounded = false;
      while (acc >= STEP) {
        const r = step(STEP);
        grounded = r.grounded;
        acc -= STEP;
      }

      // 鏡頭跟隨 / 終點全覽
      const c = bike.chassis;
      if (overRef.current) {
        if (!overviewComputed) {
          const trackW = track.finishX;
          const trackH = track.maxY - track.minY + 60; // +60 for flags
          targetScale = Math.min((W - 80) / trackW, (H - 100) / trackH);
          overviewCamX = trackW / 2 - W / (2 * targetScale);
          overviewCamY = (track.minY - 60 + track.maxY) / 2 - H / (2 * targetScale);
          overviewComputed = true;
        }
        scale += (targetScale - scale) * 0.04;
        camX += (overviewCamX - camX) * 0.04;
        camY += (overviewCamY - camY) * 0.04;
      } else {
        const tx = c.position.x - W * CAMERA.offsetXRatio;
        const ty = c.position.y - H * CAMERA.offsetYRatio;
        camX += (Math.max(0, tx) - camX) * CAMERA.ease;
        camY += (ty - camY) * CAMERA.ease;
      }

      render();
      if (perfectFxFrames > 0) perfectFxFrames--;

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
          timer: fmtTime(raceTimeMs),
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
  }, [prices]);

  return (
    <div className="game-root">
      <canvas ref={canvasRef} className="game-canvas" />

      {/* 分數：螢幕正中央偏上 */}
      <div className="score-center">
        <div className="score-num">{hud.points}</div>
        {hud.airborne && hud.airFlips > 0 && (
          <div className="score-air">空中 {hud.airFlips} 圈</div>
        )}
        <div className="score-timer">{hud.timer}</div>
      </div>

      {/* 角落小資訊 */}
      <div className="hud-corner">
        {label}　距離 {hud.distance}m
      </div>

      <button className="exit-btn" onClick={onExit}>
        選賽道
      </button>

      {/* 得分提示（後空翻 / 完美落地）*/}
      {toast && (
        <div key={toast.id} className="toast">
          {toast.text}
        </div>
      )}

      <div className={`throttle-dot ${hud.throttle ? "on" : ""}`} />

      <div className="ctrl-hint">按住畫面任一處 = 油門 ・ 空中按住 = 後空翻 ・ R 重來</div>

      {(crashed || finished) && (
        <div className="overlay">
          <div className="overlay-title">{finished ? "完賽！" : "摔車"}</div>
          <div className="overlay-score">{hud.points} 分</div>
          <div className="overlay-time">{hud.timer}</div>
          <button className="overlay-btn" onClick={requestReset}>
            再玩一次 (R)
          </button>
          <button className="overlay-btn ghost" onClick={onExit}>
            換賽道
          </button>
        </div>
      )}
    </div>
  );
}
