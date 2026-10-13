import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// Rapier's ray-cast vehicle: a box chassis plus four wheels that are rays
// with springs. Local axes: +x forward, +y up, +z across the axle.
const CHASSIS = { halfLength: 2.2, halfHeight: 0.35, halfWidth: 0.9 };
const WHEEL = { radius: 0.38, width: 0.28, restLength: 0.35 };
const WHEEL_POSITIONS = [
  // [x, z]: front-left, front-right, rear-left, rear-right
  [1.35, -0.85],
  [1.35, 0.85],
  [-1.35, -0.85],
  [-1.35, 0.85],
];
const FRONT = [0, 1];
const REAR = [2, 3];

const ENGINE_FORCE = 3800;
// Air drag (N per (m/s)^2) and rolling resistance; tops out near 180 km/h.
const DRAG = 1.5;
const ROLLING = 30;
const REVERSE_FORCE = 2000;
const BRAKE_FORCE = 60;
const HANDBRAKE_FORCE = 120;
const MAX_STEER = 0.55;
const STEER_SPEED = 3.0;

const SPAWN_HEIGHT = 1.2;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class Car {
  // spawn: { x, z, heading } where heading turns local +x toward the direction of travel.
  constructor(scene, world, spawn) {
    this.steer = 0;

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, SPAWN_HEIGHT, spawn.z)
        .setRotation(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, spawn.heading))
        .setCanSleep(false)
        .setLinearDamping(0.05)
        .setAngularDamping(0.5),
    );
    // ~1300 kg: 4.4 m x 0.7 m x 1.8 m box at density 235.
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(CHASSIS.halfLength, CHASSIS.halfHeight, CHASSIS.halfWidth)
        .setDensity(235)
        .setFriction(0.5),
      this.body,
    );

    this.vehicle = world.createVehicleController(this.body);
    for (const [x, z] of WHEEL_POSITIONS) {
      this.vehicle.addWheel(
        { x, y: -CHASSIS.halfHeight + 0.1, z },
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 1 },
        WHEEL.restLength,
        WHEEL.radius,
      );
    }
    for (let i = 0; i < 4; i++) {
      this.vehicle.setWheelSuspensionStiffness(i, 35);
      this.vehicle.setWheelSuspensionCompression(i, 2.5);
      this.vehicle.setWheelSuspensionRelaxation(i, 3.0);
      this.vehicle.setWheelMaxSuspensionForce(i, 100000);
      this.vehicle.setWheelMaxSuspensionTravel(i, 0.3);
      this.vehicle.setWheelFrictionSlip(i, 3.0);
      this.vehicle.setWheelSideFrictionStiffness(i, 1.0);
    }

    this.mesh = buildCarMesh();
    scene.add(this.mesh);
    this.wheelMeshes = WHEEL_POSITIONS.map(() => {
      const w = buildWheelMesh();
      scene.add(w);
      return w;
    });
  }

  // Signed speed in m/s along the car's forward axis.
  get speed() {
    return this.vehicle.currentVehicleSpeed();
  }

  // input: { throttle, brake, handbrake: bool, steer: -1 (right) .. 1 (left) }
  update(input, dt) {
    const speed = this.speed;

    // Ease the steering toward the target, and steer less at highway speed.
    const speedFactor = 1 / (1 + Math.abs(speed) / 25);
    const targetSteer = input.steer * MAX_STEER * speedFactor;
    this.steer += THREE.MathUtils.clamp(targetSteer - this.steer, -STEER_SPEED * dt, STEER_SPEED * dt);

    // S brakes while moving forward and reverses once (nearly) stopped.
    let engine = 0;
    let brake = 0;
    if (input.throttle) engine = speed < -1 ? 0 : ENGINE_FORCE;
    if (input.throttle && speed < -1) brake = BRAKE_FORCE;
    if (input.brake) {
      if (speed > 1) brake = BRAKE_FORCE;
      else engine = -REVERSE_FORCE;
    }

    for (const i of FRONT) {
      this.vehicle.setWheelSteering(i, this.steer);
      this.vehicle.setWheelBrake(i, brake);
    }
    for (const i of REAR) {
      this.vehicle.setWheelEngineForce(i, engine);
      this.vehicle.setWheelBrake(i, input.handbrake ? HANDBRAKE_FORCE : brake);
      // Less rear grip on the handbrake so the back end steps out.
      this.vehicle.setWheelSideFrictionStiffness(i, input.handbrake ? 0.35 : 1.0);
    }

    this.applyDrag(dt);
    this.vehicle.updateVehicle(dt);
  }

  applyDrag(dt) {
    const v = this.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed < 0.01) return;
    const k = ((DRAG * speed * speed + ROLLING * speed) * dt) / speed;
    this.body.applyImpulse({ x: -v.x * k, y: -v.y * k, z: -v.z * k }, true);
  }

  // Puts the car back on its wheels at the given pose, stopped.
  reset(pose) {
    this.body.setTranslation({ x: pose.x, y: SPAWN_HEIGHT, z: pose.z }, true);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, pose.heading), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
  }

  syncMeshes() {
    const pos = this.body.translation();
    const rot = this.body.rotation();
    this.mesh.position.set(pos.x, pos.y, pos.z);
    this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);

    const steerQ = new THREE.Quaternion();
    const spinQ = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const axle = new THREE.Vector3(0, 0, 1);
    this.wheelMeshes.forEach((wheel, i) => {
      const [x, z] = WHEEL_POSITIONS[i];
      const suspension = this.vehicle.wheelSuspensionLength(i) ?? WHEEL.restLength;
      wheel.position.set(x, -CHASSIS.halfHeight + 0.1 - suspension, z);
      wheel.position.applyQuaternion(this.mesh.quaternion).add(this.mesh.position);
      steerQ.setFromAxisAngle(up, this.vehicle.wheelSteering(i) ?? 0);
      spinQ.setFromAxisAngle(axle, this.vehicle.wheelRotation(i) ?? 0);
      wheel.quaternion.copy(this.mesh.quaternion).multiply(steerQ).multiply(spinQ);
    });
  }
}

function buildCarMesh() {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0xc8102e, metalness: 0.3, roughness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2733, metalness: 0.8, roughness: 0.1 });
  const light = new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xfff2b0, emissiveIntensity: 0.6 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x990000, emissive: 0xff0000, emissiveIntensity: 0.4 });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(CHASSIS.halfLength * 2, CHASSIS.halfHeight * 2, CHASSIS.halfWidth * 2),
    paint,
  );
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 1.6), glass);
  cabin.position.set(-0.3, CHASSIS.halfHeight + 0.27, 0);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 1.62), paint);
  roof.position.set(-0.4, CHASSIS.halfHeight + 0.56, 0);

  car.add(body, cabin, roof);
  for (const z of [-0.6, 0.6]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.35), light);
    head.position.set(CHASSIS.halfLength, 0.1, z);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.35), tail);
    back.position.set(-CHASSIS.halfLength, 0.1, z);
    car.add(head, back);
  }
  car.traverse((o) => (o.castShadow = true));
  return car;
}

function buildWheelMesh() {
  const wheel = new THREE.Group();
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(WHEEL.radius, WHEEL.radius, WHEEL.width, 20),
    new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 }),
  );
  // Cylinders stand along y; lay it on its side so the axle is z.
  tire.rotation.x = Math.PI / 2;
  const hub = new THREE.Mesh(
    new THREE.BoxGeometry(WHEEL.radius * 1.2, WHEEL.radius * 0.25, WHEEL.width + 0.02),
    new THREE.MeshStandardMaterial({ color: 0xb0b4b8, metalness: 0.7 }),
  );
  wheel.add(tire, hub);
  tire.castShadow = true;
  return wheel;
}
