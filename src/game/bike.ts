import { Bodies, Body, Constraint, Composite, type World } from "matter-js";
import { BIKE } from "./constants";

// ⚠️ frictionAir 不需要為子步做任何換算：Matter 0.20 的 Body.update() 內部已經是
//    `frictionAir = 1 - fa * (deltaTime / _baseDelta)`，delta 變小就自動按比例縮小
//    衰減量，n 個子步累積起來 (1 - fa/n)^n ≈ (1 - fa)，與單步一致。自己再開 n 次方根
//    會變成重複校正。（2026-07-10 實作子步時踩過，見 constants.ts PHYSICS 說明）

export interface Bike {
  chassis: Body;
  rearWheel: Body; // 後輪（左）＝驅動輪
  frontWheel: Body; // 前輪（右）
  composite: Composite;
  spawn: { x: number; y: number };
}

// 建一台機車：車身 + 前後輪 + 兩根軸約束。bike 各部件互不碰撞（同 group）
export function createBike(world: World, x: number, y: number): Bike {
  const group = Body.nextGroup(true);
  const filter = { group };
  const {
    chassisRadius,
    wheelRadius,
    wheelBaseHalf,
    wheelDropY,
    chassisDensity,
    rearWheelDensity,
    frontWheelDensity,
    wheelFriction,
    wheelFrictionStatic,
    chassisFrictionAir,
    wheelFrictionAir,
    axleStiffness,
    restitution,
  } = BIKE;

  // 圓形 chassis + mask:0（只有輪子碰地形，車身完全不碰地）：
  //   ① 圓形：接觸力永遠過圓心 → 不產生旋轉力矩
  //   ② mask:0：車身不參與地形碰撞 → 不會在 K 棒接縫頂點被夾住（root fix，Hill Climb 標準做法）
  //   填滿梯形地形無縫隙，故車身不碰地不會穿落；輪子靠軸約束撐住車身。
  const chassis = Bodies.circle(x, y, chassisRadius, {
    collisionFilter: { group, mask: 0 },
    density: chassisDensity,
    frictionAir: chassisFrictionAir,
    friction: 0,
    frictionStatic: 0,
    restitution: 0,
    label: "chassis",
  });

  const makeWheel = (ox: number, label: string, density: number) =>
    Bodies.circle(x + ox, y + wheelDropY, wheelRadius, {
      collisionFilter: filter,
      density,
      frictionAir: wheelFrictionAir,
      friction: wheelFriction,
      frictionStatic: wheelFrictionStatic,
      restitution,
      label,
    });

  // 後輪＝驅動輪（輕）；前輪加重→重心前移，車頭自然下壓（治本翹頭後翻）
  const rearWheel = makeWheel(-wheelBaseHalf, "rearWheel", rearWheelDensity);
  const frontWheel = makeWheel(wheelBaseHalf, "frontWheel", frontWheelDensity);

  // 軸約束：把輪心釘在車身的軸點（length 0 → 只能轉動的轉軸）
  const axle = (wheel: Body, ox: number) =>
    Constraint.create({
      bodyA: chassis,
      pointA: { x: ox, y: wheelDropY },
      bodyB: wheel,
      length: 0,
      stiffness: axleStiffness,
      render: { visible: false },
    });

  const composite = Composite.create({ label: "bike" });
  Composite.add(composite, [
    chassis,
    rearWheel,
    frontWheel,
    axle(rearWheel, -wheelBaseHalf),
    axle(frontWheel, wheelBaseHalf),
  ]);
  Composite.add(world, composite);

  return { chassis, rearWheel, frontWheel, composite, spawn: { x, y } };
}

// 重置機車到生成點（R 鍵 / 復活用）
export function resetBike(bike: Bike) {
  const { chassis, rearWheel, frontWheel, spawn } = bike;
  const { wheelBaseHalf, wheelDropY } = BIKE;
  const place = (b: Body, ox: number, oy: number) => {
    Body.setPosition(b, { x: spawn.x + ox, y: spawn.y + oy });
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
    Body.setAngle(b, 0);
  };
  place(chassis, 0, 0);
  place(rearWheel, -wheelBaseHalf, wheelDropY);
  place(frontWheel, wheelBaseHalf, wheelDropY);
}
