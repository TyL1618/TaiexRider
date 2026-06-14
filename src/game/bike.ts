import { Bodies, Body, Constraint, Composite, type World } from "matter-js";
import { BIKE } from "./constants";

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
    chassisW,
    chassisH,
    wheelRadius,
    wheelBaseHalf,
    wheelDropY,
    chassisDensity,
    wheelDensity,
    wheelFriction,
    wheelFrictionStatic,
    chassisFrictionAir,
    wheelFrictionAir,
    axleStiffness,
  } = BIKE;

  const chassis = Bodies.rectangle(x, y, chassisW, chassisH, {
    collisionFilter: filter,
    density: chassisDensity,
    frictionAir: chassisFrictionAir,
    friction: 0.4,
    label: "chassis",
    chamfer: { radius: 6 },
  });

  const makeWheel = (ox: number, label: string) =>
    Bodies.circle(x + ox, y + wheelDropY, wheelRadius, {
      collisionFilter: filter,
      density: wheelDensity,
      frictionAir: wheelFrictionAir,
      friction: wheelFriction,
      frictionStatic: wheelFrictionStatic,
      label,
    });

  const rearWheel = makeWheel(-wheelBaseHalf, "rearWheel");
  const frontWheel = makeWheel(wheelBaseHalf, "frontWheel");

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
