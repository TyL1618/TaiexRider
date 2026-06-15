import { useEffect, useRef, useState } from "react";
import { Engine, Events, Composite, Body, type IEventCollision } from "matter-js";
import "./GameCanvas.css";
import { pricesToTrack, buildTerrainBodies, slopeAt, terrainYAt, type Track } from "./terrain";
import { createBike, resetBike, type Bike } from "./bike";
import { BIKE, CAMERA, COLOR, DRIVE, RULES } from "./constants";

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

export const APP_VERSION = "0.2.0";

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
  const [showSettings, setShowSettings] = useState(false);
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

    // ---- 車體貼圖（決定①：整張含輪去背 PNG，輪子不轉）----
    // 放 public/bike.png；缺檔時 onload 不觸發 → drawBike 自動退回向量備援，不會壞 build
    const bikeImg = new Image();
    let bikeImgReady = false;
    bikeImg.onload = () => {
      bikeImgReady = true;
    };
    bikeImg.src = `${import.meta.env.BASE_URL}bike.png`;

    // ---- 建立世界 ----
    const engine = Engine.create();
    engine.gravity.y = 1;
    const world = engine.world;

    const track: Track = pricesToTrack(prices);
    Composite.add(world, buildTerrainBodies(track));

    const spawnX = track.startX;
    // 輪底剛好貼地：車身中心 = 地面 - 輪軸偏移 - 輪半徑（直接落在路面，不從空中掉）
    const spawnY = track.vertices[0].y - BIKE.wheelDropY - BIKE.wheelRadius - 1;
    const bike: Bike = createBike(world, spawnX, spawnY);

    // ---- 插值用：記錄上一物理步的位置/角度，渲染時平滑消除步進鋸齒 ----
    let prevChassisPos = { x: bike.chassis.position.x, y: bike.chassis.position.y };
    let prevChassisAngle = bike.chassis.angle;
    let prevRearPos = { x: bike.rearWheel.position.x, y: bike.rearWheel.position.y };
    let prevRearAngle = bike.rearWheel.angle;
    let prevFrontPos = { x: bike.frontWheel.position.x, y: bike.frontWheel.position.y };
    let prevFrontAngle = bike.frontWheel.angle;

    // ---- 著地偵測（輪子 vs terrain 計數）----
    let rearContacts = 0;
    let frontContacts = 0;
    let chassisContacts = 0;
    const onCollision = (delta: number) => (e: IEventCollision<Engine>) => {
      for (const pair of e.pairs) {
        const labels = [pair.bodyA.label, pair.bodyB.label];
        if (!labels.includes("terrain")) continue;
        if (labels.includes("rearWheel")) rearContacts = Math.max(0, rearContacts + delta);
        if (labels.includes("frontWheel")) frontContacts = Math.max(0, frontContacts + delta);
        if (labels.includes("chassis")) chassisContacts = Math.max(0, chassisContacts + delta);
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
    let groundedStreak = 0; // 連續著地 step 數（離地 boost 的 gate，擋微彈疊乘）
    let crashTimer = 0;
    let points = 0;
    let bonusPoints = 0; // 特技分（後翻＋完美落地），行進分另算疊加
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
      prevChassisPos = { x: bike.chassis.position.x, y: bike.chassis.position.y };
      prevChassisAngle = bike.chassis.angle;
      prevRearPos = { x: bike.rearWheel.position.x, y: bike.rearWheel.position.y };
      prevRearAngle = bike.rearWheel.angle;
      prevFrontPos = { x: bike.frontWheel.position.x, y: bike.frontWheel.position.y };
      prevFrontAngle = bike.frontWheel.angle;
      rearContacts = 0;
      frontContacts = 0;
      chassisContacts = 0;
      throttle = false;
      prevAngle = bike.chassis.angle;
      airRotation = 0;
      airTime = 0;
      airborneSteps = 0;
      groundedStreak = 0;
      crashTimer = 0;
      points = 0;
      bonusPoints = 0;
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
    // 定速引擎（Rider 風格街機手感）：
    //  著地按住 → 強制「水平速度永遠朝前(+x)」ease 到 cruiseSpeed，垂直分量交給物理：
    //    水平鎖朝前 → 絕不倒退（賽道恆 +x 為前進方向）；起步/被重力往後滑也立刻轉正。
    //    垂直自由 → 上坡靠地面頂著爬、過凸坡頂保留往上動量→自然飛出去(往右上就飛)、凹谷貼地不亂飛。
    //  著地恆時 → 車身角速度朝前輪坡段平滑修正（貼坡、不翹頭）
    //  離地：按住＝後空翻、放開＝車頭緩緩往前壓（準備落地）
    const applyControls = (grounded: boolean, _upright: boolean) => {
      if (overRef.current) return;
      const c = bike.chassis;

      if (grounded) {
        if (throttle) {
          // 水平 ease 到 +cruiseSpeed（永遠朝前），垂直 (y) 不碰→交給物理(爬坡/起跳/貼地)
          const newVx = c.velocity.x + (DRIVE.cruiseSpeed - c.velocity.x) * DRIVE.groundLockEase;
          Body.setVelocity(c, { x: newVx, y: c.velocity.y });
          Body.setVelocity(bike.rearWheel, { x: newVx, y: bike.rearWheel.velocity.y });
          Body.setVelocity(bike.frontWheel, { x: newVx, y: bike.frontWheel.velocity.y });
        }
        // 對齊前輪坡段：以比例修正車身角速度（gain），並夾在 groundedAvMax 內
        const slope = slopeAt(track, bike.frontWheel.position.x);
        const da = angleDelta(c.angle, slope);
        let av = da * DRIVE.groundAlignGain;
        if (Math.abs(av) > DRIVE.groundedAvMax) av = Math.sign(av) * DRIVE.groundedAvMax;
        Body.setAngularVelocity(c, av);
      } else if (throttle && Math.cos(c.angle) > 0) {
        // 空中按住 + 未翻過頭 → 後空翻（負向＝車頭往上後翻）
        const nv = Math.max(-DRIVE.airSpinMax, c.angularVelocity - DRIVE.airSpinAccel);
        Body.setAngularVelocity(c, nv);
      } else if (!throttle) {
        // 空中放開 → 車頭緩緩往前壓（正向＝nose-down），設上限不自己翻整圈
        const nv = Math.min(DRIVE.airNoseForwardMax, c.angularVelocity + DRIVE.airNoseForwardAccel);
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
      // 存下本步物理狀態，供渲染插值（frame 裡用 alpha=acc/STEP 取中間位置）
      prevChassisPos = { x: bike.chassis.position.x, y: bike.chassis.position.y };
      prevChassisAngle = bike.chassis.angle;
      prevRearPos = { x: bike.rearWheel.position.x, y: bike.rearWheel.position.y };
      prevRearAngle = bike.rearWheel.angle;
      prevFrontPos = { x: bike.frontWheel.position.x, y: bike.frontWheel.position.y };
      prevFrontAngle = bike.frontWheel.angle;
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
          bonusPoints += gained;
          showToast(`${flips} 圈 +${gained}`);
        }
        // 完美落地：先在空中做過翻滾(flips>0) + 真實跳躍 + 正立 + 車身與坡面平行
        // 用「車身角≈坡面角」取代「同 step 雙輪觸地」→ 不受兩輪觸地那幾毫秒時間差影響
        const landSlope = Math.atan2(
          terrainYAt(track, bike.frontWheel.position.x) - terrainYAt(track, bike.rearWheel.position.x),
          bike.frontWheel.position.x - bike.rearWheel.position.x,
        );
        const levelOk = Math.abs(angleDelta(c.angle, landSlope)) < RULES.perfectLevelRad;
        if (realAir && upright && flips > 0 && levelOk) {
          bonusPoints += RULES.perfectBonus;
          showToast(`完美落地 +${RULES.perfectBonus}`);
          perfectFxFrames = 30;
          perfectFxPts = [
            { x: bike.rearWheel.position.x, y: bike.rearWheel.position.y },
            { x: bike.frontWheel.position.x, y: bike.frontWheel.position.y },
          ];
        }
        airRotation = 0;
        airTime = 0;
      } else if (!groundedNow && wasGrounded) {
        // 離地瞬間：
        //  ① boost：只有「有按油門 + 朝前(vx>0) + 在地面待夠」才給，拉到目標速且永不超過
        //     → 沒按/往後/轉折點微彈一律不加速，杜絕自己亂飛/往後甩
        //  ② 歸零殘留角速度（消除爬坡貼坡帶上來的「莫名往後翻」）
        if (throttle && c.velocity.x > 0 && groundedStreak >= DRIVE.minGroundedStepsForBoost) {
          const sp = Math.hypot(c.velocity.x, c.velocity.y);
          const target = DRIVE.cruiseSpeed * DRIVE.launchBoost;
          if (sp > 0.001 && sp < target) {
            const k = target / sp;
            Body.setVelocity(c, { x: c.velocity.x * k, y: c.velocity.y * k });
          }
        }
        Body.setAngularVelocity(c, 0);
      }
      groundedStreak = groundedNow ? groundedStreak + 1 : 0;
      if (groundedNow) airRotation = 0;
      wasGrounded = groundedNow;

      // 行進分：到終點剛好 1000，即時疊加在特技分上
      const traveled = Math.max(0, c.position.x - track.startX);
      const distScore = Math.min(1000, Math.round((traveled / (track.finishX - track.startX)) * 1000));
      points = bonusPoints + distScore;

      // 死亡判定（不管有無按油門）：兩輪都沒碰地板 && 整體幾乎不動 && 持續 2 秒
      // → 收掉「卡 V 尖點兩輪懸空不動」「翻車貼地不動」等死局；飛行中有移動→不誤判
      const bothWheelsOff = rearContacts === 0 && frontContacts === 0;
      const notMoving = Math.hypot(c.velocity.x, c.velocity.y) < 0.5;
      if (bothWheelsOff && notMoving && !overRef.current) {
        crashTimer += dtMs / 1000;
        if (crashTimer >= RULES.crashUpsideDownSec) {
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
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowBlur = 0;
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
        // 光暈層（寬半透明線，取代 shadowBlur）
        ctx.strokeStyle = glow;
        ctx.lineWidth = 10;
        ctx.globalAlpha = 0.35;
        ctx.stroke();
        // 實線層
        ctx.strokeStyle = col;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 1;
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawFlag = (x: number, y: number, color: string, label: string) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wx(x), wy(y));
      ctx.lineTo(wx(x), wy(y) - 60);
      ctx.stroke();
      ctx.fillRect(wx(x), wy(y) - 60, 34, 18);
      ctx.fillStyle = "#05080f";
      ctx.font = "bold 11px system-ui";
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
      // 霓虹輪框（雙描邊取代 shadowBlur）
      ctx.strokeStyle = COLOR.bikeGlow;
      ctx.lineWidth = 7;
      ctx.globalAlpha = 0.4;
      ctx.stroke();
      ctx.strokeStyle = COLOR.wheel;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 1;
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

    // 霓虹賽車側面輪廓（Rider 風格，無人，前低後高扁平跑車）
    // local space：+x 朝前，y 負朝上。物理輪心 ≈ (±35, +13) — 輪子另畫於 ctx.restore() 後
    const drawBike = (alpha: number) => {
      const c = bike.chassis;
      const cx = prevChassisPos.x + (c.position.x - prevChassisPos.x) * alpha;
      const cy = prevChassisPos.y + (c.position.y - prevChassisPos.y) * alpha;
      const cAngle = prevChassisAngle + (c.angle - prevChassisAngle) * alpha;

      // 有貼圖：整張圖（含輪）貼到車身，不另畫向量輪（決定①：輪子不轉）
      if (bikeImgReady) {
        const w = BIKE.spriteW;
        const h = w * (bikeImg.naturalHeight / bikeImg.naturalWidth);
        ctx.save();
        ctx.translate(wx(cx), wy(cy));
        ctx.rotate(cAngle);
        ctx.drawImage(bikeImg, -w / 2 + BIKE.spriteOffsetX, -h / 2 + BIKE.spriteOffsetY, w, h);
        ctx.restore();
        return;
      }

      ctx.save();
      ctx.translate(wx(cx), wy(cy));
      ctx.rotate(cAngle);
      ctx.scale(0.52, 0.52);

      ctx.shadowBlur = 0;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // ── 車體主輪廓（後高前低楔形）───────────────────────────
      // 物理輪心在 (±35, +13)，輪頂在 y=+2，車底在 y=+6 略高於輪頂 → 車身低伏壓輪
      ctx.beginPath();
      ctx.moveTo(-44, 6);    // 後底
      ctx.lineTo(-44, -8);   // 後壁直立
      ctx.lineTo(-34, -24);  // 後頂斜
      ctx.lineTo(-8, -28);   // 頂部後段（最高點）
      ctx.lineTo(16, -26);   // 頂部前段
      ctx.lineTo(38, -14);   // 車鼻斜面
      ctx.lineTo(44, -2);    // 車鼻尖
      ctx.lineTo(38, 6);     // 車鼻底
      ctx.lineTo(26, 6);     // 前底板
      ctx.lineTo(-26, 6);    // 後底板
      ctx.closePath();
      ctx.fillStyle = "rgba(255, 179, 0, 0.14)";
      ctx.fill();
      // 光暈層
      ctx.strokeStyle = COLOR.bikeGlow;
      ctx.lineWidth = 10;
      ctx.globalAlpha = 0.45;
      ctx.stroke();
      // 實線層
      ctx.strokeStyle = COLOR.bike;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 1;
      ctx.stroke();

      // ── 座艙暗玻璃（無人，純造型）──────────────────────────
      ctx.beginPath();
      ctx.moveTo(-28, -24);  // 艙後底（接後頂斜面）
      ctx.lineTo(-20, -32);  // 艙後頂
      ctx.lineTo(10, -28);   // 艙前頂
      ctx.lineTo(16, -24);   // 艙前底（接頂部前段）
      ctx.closePath();
      ctx.fillStyle = "rgba(5, 10, 20, 0.82)";
      ctx.fill();
      ctx.strokeStyle = COLOR.bike;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // ── 前頭燈（車鼻 LED 亮點）──────────────────────────────
      ctx.beginPath();
      ctx.moveTo(40, -10);
      ctx.lineTo(44, -2);
      ctx.lineTo(40, -2);
      ctx.strokeStyle = COLOR.bikeGlow;
      ctx.lineWidth = 5;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.strokeStyle = COLOR.bike;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 1;
      ctx.stroke();

      ctx.restore();

      // 輪子（插值位置，在主 transform 外畫）
      drawWheel(
        prevRearPos.x + (bike.rearWheel.position.x - prevRearPos.x) * alpha,
        prevRearPos.y + (bike.rearWheel.position.y - prevRearPos.y) * alpha,
        prevRearAngle + (bike.rearWheel.angle - prevRearAngle) * alpha,
        bike.rearWheel.circleRadius!,
      );
      drawWheel(
        prevFrontPos.x + (bike.frontWheel.position.x - prevFrontPos.x) * alpha,
        prevFrontPos.y + (bike.frontWheel.position.y - prevFrontPos.y) * alpha,
        prevFrontAngle + (bike.frontWheel.angle - prevFrontAngle) * alpha,
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
        ctx.strokeStyle = COLOR.start; // cyan
        ctx.shadowBlur = 0;
        // 光環（光暈 + 實線）
        ctx.lineWidth = 8;
        ctx.globalAlpha = (1 - p) * 0.3;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1 - p;
        ctx.stroke();
        // 放射火花
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

    const render = (alpha: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawTrack();
      drawFlag(track.vertices[0].x, track.vertices[0].y, COLOR.start, "START");
      drawFlag(track.finishX, track.vertices[track.vertices.length - 1].y, COLOR.finish, "FIN");
      drawBike(alpha);
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

      const alpha = Math.min(acc / STEP, 1);
      render(alpha);
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

      {/* 左上：設定 */}
      <button className="icon-btn settings-btn" onClick={() => setShowSettings(true)} aria-label="設定">
        ⚙
      </button>

      {/* 右上：返回主選單 */}
      <button className="exit-btn" onClick={onExit}>
        返回主選單
      </button>

      {/* 得分提示（後空翻 / 完美落地）*/}
      {toast && (
        <div key={toast.id} className="toast">
          {toast.text}
        </div>
      )}

      <div className={`throttle-dot ${hud.throttle ? "on" : ""}`} />

      <div className="ctrl-hint">按住畫面 = 前進 ・ 空中按住 = 後空翻</div>

      {showSettings && (
        <div className="overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <div className="overlay-title">設定</div>
            <div className="settings-row">音量（待實作）</div>
            <div className="settings-row dim">版本 v{APP_VERSION}</div>
            <button className="overlay-btn ghost" onClick={() => setShowSettings(false)}>
              關閉
            </button>
          </div>
        </div>
      )}

      {(crashed || finished) && (
        <div className="overlay">
          <div className="overlay-title">{finished ? "完賽！" : "摔車"}</div>
          <div className="overlay-score">{hud.points} 分</div>
          <div className="overlay-time">{hud.timer}</div>
          <button className="overlay-btn" onClick={requestReset}>
            再玩一次
          </button>
          <button className="overlay-btn ghost" onClick={onExit}>
            返回主選單
          </button>
        </div>
      )}
    </div>
  );
}
