import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { LANE_WIDTH, sampleAt } from './track.js';
import { buildCarMesh, addStaticWheels, CAR_SIZE } from './car.js';
import { LEFT_SHOULDER, RIGHT_SHOULDER } from './world.js';

// Everything that makes the Henday the Henday: traffic, wrong-way drivers,
// potholes, lane closures that move every lap, and grass that slows you down.

const POTHOLES = 14;
const CLOSURES_PER_LAP = 2;
const TRAFFIC = 10; // our direction
const SEMIS = 2; // of the traffic above
const ONCOMING = 8; // other side of the median
const START_ZONE = [-120, 250]; // metres around the start line kept clear
const LANE_CHANGE_TIME = 1.4; // seconds to move one lane over
const AI_THINK = 0.25; // seconds between traffic decisions

const POTHOLE_LINES = [
  "That's a $900 alignment.",
  'Your hubcap lives here now.',
  'Filed under "spring maintenance".',
  "Edmonton's official speed bump.",
  "It's been there since 2016.",
  'The city has been notified. Again.',
];

const VEHICLE_KINDS = {
  car: { halfLength: CAR_SIZE.halfLength, halfWidth: CAR_SIZE.halfWidth, halfHeight: 0.75 },
  semi: { halfLength: 8, halfWidth: 1.3, halfHeight: 2 },
};
const CAR_COLOURS = [0xf2f2f2, 0x1d1d1f, 0x8a9199, 0x1f4e8c, 0x2e6b3a, 0xd9c48a, 0x5b2333, 0x3d6f8f];

export class Hazards {
  constructor(scene, world, track, car) {
    this.scene = scene;
    this.world = world;
    this.track = track;
    this.car = car;
    this.ours = track.carriageways[0];
    this.theirs = track.carriageways[1];
    this.length = this.ours.totalLength;

    this.vehicles = [];
    this.potholes = [];
    this.closures = [];
    this.lap = 1;
    this.shake = 0;
    this.toastTimer = 0;
    this.toastEl = document.getElementById('toast');
    this.theirIndex = -1;
    this.playerS = 0;
  }

  // Fresh hazards for a new race.
  newRace() {
    this.clear();
    this.lap = 1;
    this.placePotholes();
    this.placeClosures(0);
    this.spawnTraffic();
    this.spawnWrongWay(1);
  }

  // Each new lap the closures move, and another wrong-way driver turns up.
  newLap(lap) {
    this.lap = lap;
    this.removeClosures();
    this.placeClosures(this.playerS);
    this.spawnWrongWay(Math.min(lap, 3));
    this.toast('CONSTRUCTION SEASON: the lane closures have moved.', 3);
  }

  clear() {
    for (const v of this.vehicles) this.removeBody(v);
    for (const p of this.potholes) this.scene.remove(p.mesh);
    this.removeClosures();
    this.vehicles = [];
    this.potholes = [];
  }

  removeBody(item) {
    this.world.removeRigidBody(item.body);
    this.scene.remove(item.mesh);
  }

  // ---------------------------------------------------------------- potholes

  placePotholes() {
    const rim = new THREE.MeshStandardMaterial({ color: 0x55534f, roughness: 1, depthWrite: false });
    const hole = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 1, depthWrite: false });
    for (let k = 0; k < POTHOLES; k++) {
      const s = this.randomS();
      const lane = randInt(0, 2);
      const pose = sampleAt(this.ours, s, laneCentre(this.ours, lane) + rand(-0.7, 0.7));
      const r = rand(0.55, 0.9);
      const mesh = new THREE.Group();
      const outer = new THREE.Mesh(blobGeometry(r * 1.25), rim);
      const inner = new THREE.Mesh(blobGeometry(r), hole);
      // Paint layer order (see world.js): drawn over the asphalt, rim first.
      outer.renderOrder = -1;
      inner.renderOrder = -0.5;
      outer.receiveShadow = inner.receiveShadow = true;
      mesh.add(outer, inner);
      mesh.position.set(pose.x, 0.05, pose.z);
      mesh.rotation.y = rand(0, Math.PI);
      this.scene.add(mesh);
      this.potholes.push({ x: pose.x, z: pose.z, r, mesh, cooldown: 0 });
    }
  }

  checkPotholes(dt) {
    for (const p of this.potholes) {
      p.cooldown -= dt;
      if (p.cooldown > 0) continue;
      for (const wheel of this.car.wheelMeshes) {
        const { x, z } = wheel.position;
        // Count the tyre's half-width so clipping the edge counts too.
        const reach = p.r + 0.2;
        if ((x - p.x) ** 2 + (z - p.z) ** 2 > reach * reach) continue;
        this.hitPothole(wheel.position);
        p.cooldown = 1;
        break;
      }
    }
  }

  hitPothole(at) {
    const body = this.car.body;
    body.applyImpulseAtPoint({ x: 0, y: 900, z: 0 }, { x: at.x, y: at.y, z: at.z }, true);
    const v = body.linvel();
    body.setLinvel({ x: v.x * 0.88, y: v.y, z: v.z * 0.88 }, true);
    this.shake = 1;
    this.toast(`POTHOLE! ${pick(POTHOLE_LINES)}`, 2.2);
  }

  // ---------------------------------------------------------------- closures

  // Cones taper across one outside lane, then run along it.
  placeClosures(avoidS) {
    const coneGeo = new THREE.ConeGeometry(0.2, 0.7, 12);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6a00 });
    for (let k = 0; k < CLOSURES_PER_LAP; k++) {
      let s;
      do s = this.randomS();
      while (gap(this.length, avoidS, s) < 200 || this.closures.some((c) => Math.abs(c.s - s) < 300));
      const lane = Math.random() < 0.5 ? 0 : 2;
      const closure = { s, lane, length: 140, cones: [] };
      const taper = 50;
      for (let d = 0; d <= closure.length; d += 7) {
        // 0 at the lane's outer edge, 1 at the lane line we're closing off.
        const f = Math.min(d / taper, 1);
        const edge = lane === 0 ? -1 : 1;
        const width = this.ours.width(sampleAt(this.ours, s + d).index);
        const offset = edge * (width / 2 - 0.3 - f * (LANE_WIDTH - 0.6));
        const pose = sampleAt(this.ours, s + d, offset);
        const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pose.x, 0.35, pose.z));
        this.world.createCollider(RAPIER.ColliderDesc.cone(0.35, 0.2).setDensity(40), body);
        const mesh = new THREE.Mesh(coneGeo, coneMat);
        mesh.castShadow = true;
        this.scene.add(mesh);
        closure.cones.push({ body, mesh });
      }
      this.closures.push(closure);
    }
  }

  removeClosures() {
    for (const c of this.closures) for (const cone of c.cones) this.removeBody(cone);
    this.closures = [];
  }

  // ----------------------------------------------------------------- traffic

  spawnTraffic() {
    for (let k = 0; k < TRAFFIC; k++) {
      const semi = k < SEMIS;
      // One left-lane camper who will never, ever move over.
      const camper = k === SEMIS;
      this.addVehicle({
        c: this.ours,
        kind: semi ? 'semi' : 'car',
        lane: semi ? 2 : camper ? 0 : randInt(0, 2),
        cruise: kmh(semi ? rand(85, 95) : camper ? 88 : rand(95, 125)),
        camper,
      });
    }
    for (let k = 0; k < ONCOMING; k++) {
      this.addVehicle({ c: this.theirs, kind: k === 0 ? 'semi' : 'car', lane: randInt(0, 2), cruise: kmh(rand(95, 125)) });
    }
  }

  spawnWrongWay(count) {
    let have = this.vehicles.filter((v) => v.wrongWay).length;
    while (have++ < count) {
      // Somewhere well up the road from the player, heading straight at them.
      this.addVehicle({
        c: this.ours,
        kind: 'car',
        lane: randInt(0, 2),
        cruise: kmh(rand(95, 110)),
        dir: -1,
        wrongWay: true,
        s: this.playerS + rand(700, this.length - 500),
      });
    }
  }

  addVehicle({ c, kind, lane, cruise, dir = 1, camper = false, wrongWay = false, s }) {
    const size = VEHICLE_KINDS[kind];
    if (s === undefined) {
      // Find a spot clear of the start and of other vehicles in that lane.
      for (let tries = 0; tries < 50; tries++) {
        s = this.randomS();
        const clear = this.vehicles.every((o) => o.c !== c || o.lane !== lane || Math.abs(o.s - s) > 40);
        if (clear) break;
      }
    }
    const mesh = kind === 'semi' ? buildSemi() : addStaticWheels(buildCarMesh(pick(CAR_COLOURS)));
    if (wrongWay) {
      // Each wrong-way driver gets their own headlights so they can flash them.
      const lights = mesh.userData.headlights.clone();
      lights.emissive.set(0xffffff);
      mesh.traverse((o) => {
        if (o.material === mesh.userData.headlights) o.material = lights;
      });
      mesh.userData.headlights = lights;
    }
    this.scene.add(mesh);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(size.halfLength, size.halfHeight, size.halfWidth), body);
    const v = {
      c, kind, size, mesh, body, dir, camper, wrongWay,
      s, lane, laneNow: lane, cruise, speed: cruise, target: cruise,
      think: Math.random() * AI_THINK, warned: false, rockChipped: false,
      quaternion: new THREE.Quaternion(),
    };
    this.vehicles.push(v);
    this.placeVehicle(v);
  }

  // Fixed-step update: move every vehicle along its lane.
  step(dt) {
    for (const v of this.vehicles) {
      v.think -= dt;
      if (v.think <= 0) {
        v.think = AI_THINK;
        this.decide(v);
      }
      v.speed += THREE.MathUtils.clamp(v.target - v.speed, -8 * dt, 3 * dt);
      v.s += v.speed * v.dir * dt;
      v.laneNow += THREE.MathUtils.clamp(v.lane - v.laneNow, -dt / LANE_CHANGE_TIME, dt / LANE_CHANGE_TIME);
      this.placeVehicle(v);
    }
  }

  placeVehicle(v) {
    const pose = sampleAt(v.c, v.s, laneCentre(v.c, v.laneNow));
    const heading = pose.heading + (v.dir < 0 ? Math.PI : 0);
    v.quaternion.setFromAxisAngle(Y_AXIS, heading);
    const y = v.kind === 'semi' ? v.size.halfHeight + 0.1 : CAR_SIZE.rideHeight;
    v.body.setNextKinematicTranslation({ x: pose.x, y, z: pose.z });
    v.body.setNextKinematicRotation(v.quaternion);
    v.mesh.position.set(pose.x, y, pose.z);
    v.mesh.quaternion.copy(v.quaternion);
  }

  // Simple driver: keep cruising; if something's in the way, pass it if
  // there's room, otherwise slow down behind it. Campers never change lanes.
  decide(v) {
    v.target = v.cruise;
    const ahead = this.blocker(v, v.lane);
    if (ahead) {
      const options = v.camper ? [] : [v.lane - 1, v.lane + 1].filter((l) => l >= 0 && l <= 2);
      // Pass on the left when we can, like the signs say.
      options.sort((a, b) => a - b);
      const free = options.find((l) => this.laneClear(v, l));
      if (free !== undefined && v.lane === v.laneNow) v.lane = free;
      else v.target = Math.min(v.cruise, ahead.speed ?? 0, ahead.gap < 12 ? 0 : Infinity);
    } else if (!v.camper && !v.wrongWay && v.lane < 2 && v.lane === v.laneNow && Math.random() < 0.15) {
      // Keep right except to pass.
      if (this.laneClear(v, v.lane + 1, 70)) v.lane += 1;
    }
  }

  // Nearest thing ahead in `lane` worth reacting to: { gap, speed } or null.
  blocker(v, lane) {
    let best = null;
    for (const o of this.vehicles) {
      if (o === v || o.c !== v.c || !inLane(o, lane, 0.8)) continue;
      const g = gap(this.lengthOf(v.c), v.s * v.dir, o.s * v.dir) - v.size.halfLength - o.size.halfLength;
      const closing = o.dir !== v.dir;
      const look = closing ? 160 : 45;
      if (g > look || (!closing && o.speed >= v.speed && g > 15)) continue;
      if (!best || g < best.gap) best = { gap: g, speed: closing ? 0 : o.speed };
    }
    if (v.c === this.ours) {
      for (const c of this.closures) {
        if (c.lane !== lane) continue;
        const start = v.dir > 0 ? c.s : c.s + c.length;
        const g = gap(this.length, v.s * v.dir, start * v.dir);
        if (g < 60 && (!best || g < best.gap)) best = { gap: g, speed: 0 };
      }
    }
    return best;
  }

  laneClear(v, lane, ahead = 45) {
    const L = this.lengthOf(v.c);
    for (const o of this.vehicles) {
      if (o === v || o.c !== v.c || !inLane(o, lane, 0.9)) continue;
      const g = gap(L, v.s * v.dir, o.s * v.dir);
      const behind = L - g;
      const reach = o.dir !== v.dir ? 200 : ahead;
      if (g < reach + o.size.halfLength || behind < 20 + o.size.halfLength) return false;
    }
    if (v.c === this.ours) {
      for (const c of this.closures) {
        if (c.lane === lane && gap(this.length, v.s * v.dir, (v.dir > 0 ? c.s : c.s + c.length) * v.dir) < c.length + 80) {
          return false;
        }
      }
    }
    return true;
  }

  lengthOf(c) {
    return c.totalLength;
  }

  // -------------------------------------------------------- per-frame checks

  // playerIndex: the race's tracked point on our carriageway.
  frame(dt, playerIndex) {
    const c = this.ours;
    this.playerS = c.distance[playerIndex];
    const pos = this.car.mesh.position;

    this.car.onGrass = !this.onRoad(c, playerIndex, pos) && !this.onOtherSide(pos);
    const speed = Math.abs(this.car.speed);
    if (this.car.onGrass) this.shake = Math.max(this.shake, Math.min(speed / 40, 0.5));

    this.checkPotholes(dt);
    this.radioChatter();

    for (const closure of this.closures) {
      for (const cone of closure.cones) {
        cone.mesh.position.copy(cone.body.translation());
        cone.mesh.quaternion.copy(cone.body.rotation());
      }
    }
    // Wrong-way drivers flash their high beams.
    const flash = Math.floor(performance.now() / 200) % 2 === 0;
    for (const v of this.vehicles) if (v.wrongWay) v.mesh.userData.headlights.emissiveIntensity = flash ? 3 : 0.2;

    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toastEl.textContent = '';
  }

  onRoad(c, i, pos) {
    const [x, z] = c.points[i];
    const lateral = (pos.x - x) * -c.tangents[i * 2 + 1] + (pos.z - z) * c.tangents[i * 2];
    const half = c.width(i) / 2;
    return lateral > -half - LEFT_SHOULDER && lateral < half + RIGHT_SHOULDER;
  }

  onOtherSide(pos) {
    const c = this.theirs;
    const n = c.points.length;
    const full = this.theirIndex < 0;
    let best = 0;
    let bestD = Infinity;
    for (let k = full ? 0 : -60; k < (full ? n : 60); k++) {
      const i = full ? k : (((this.theirIndex + k) % n) + n) % n;
      const d = (c.points[i][0] - pos.x) ** 2 + (c.points[i][1] - pos.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    // Only trust the local search while we're near that road.
    this.theirIndex = bestD < 60 * 60 ? best : -1;
    return this.onRoad(c, best, pos);
  }

  // Traffic-radio style warnings.
  radioChatter() {
    for (const v of this.vehicles) {
      if (v.c !== this.ours) continue;
      const ahead = gap(this.length, this.playerS, v.s);
      if (v.wrongWay) {
        if (!v.warned && ahead < 450) {
          v.warned = true;
          this.toast('HENDAY TRAFFIC RADIO: wrong-way driver reported in your lanes!', 3.5);
        } else if (ahead > this.length - 50) {
          v.warned = false; // it's behind us now; warn again next time round
        }
      } else if (v.kind === 'semi') {
        const behindTruck = this.length - ahead;
        if (!v.rockChipped && behindTruck < 25 && Math.abs(v.laneNow - this.playerLane()) < 0.7) {
          v.rockChipped = true;
          this.shake = Math.max(this.shake, 0.3);
          this.toast('ROCK CHIP! Thanks, gravel truck.', 2.5);
        } else if (behindTruck > 200 && ahead > 200) {
          v.rockChipped = false;
        }
      }
    }
  }

  playerLane() {
    const c = this.ours;
    const i = sampleAt(c, this.playerS).index;
    const [x, z] = c.points[i];
    const pos = this.car.mesh.position;
    const lateral = (pos.x - x) * -c.tangents[i * 2 + 1] + (pos.z - z) * c.tangents[i * 2];
    return (lateral + c.width(i) / 2) / LANE_WIDTH - 0.5;
  }

  toast(text, seconds) {
    this.toastEl.textContent = text;
    this.toastTimer = seconds;
  }

  // A random distance along our carriageway, away from the start line.
  randomS() {
    const [before, after] = START_ZONE;
    return rand(after, this.length + before);
  }
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

// Whether vehicle o is in, or moving into, `lane`.
function inLane(o, lane, tolerance) {
  return Math.abs(o.laneNow - lane) <= tolerance || o.lane === lane;
}

function laneCentre(c, lane) {
  // All race lanes are the same width, so point 0's width will do.
  return -c.width(0) / 2 + (lane + 0.5) * LANE_WIDTH;
}

// How far ahead `to` is from `from` going forward around a loop of length L.
function gap(L, from, to) {
  return (((to - from) % L) + L) % L;
}

function blobGeometry(r) {
  const shape = new THREE.Shape();
  const points = 12;
  for (let k = 0; k < points; k++) {
    const a = (k / points) * Math.PI * 2;
    const rr = r * rand(0.75, 1.15);
    const x = Math.cos(a) * rr * 1.3;
    const y = Math.sin(a) * rr;
    if (k === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function buildSemi() {
  const { halfLength, halfWidth, halfHeight } = VEHICLE_KINDS.semi;
  const truck = new THREE.Group();
  const trailer = new THREE.Mesh(
    new THREE.BoxGeometry(halfLength * 2 - 3.2, halfHeight * 2 - 0.9, halfWidth * 2),
    new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.8 }),
  );
  trailer.position.set(-1.6, 0.45, 0);
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, halfHeight * 2 - 0.6, halfWidth * 2),
    new THREE.MeshStandardMaterial({ color: pick([0x9b1c1c, 0x1c3f9b, 0x2b2b2b]), metalness: 0.3, roughness: 0.5 }),
  );
  cab.position.set(halfLength - 1.4, -0.3, 0);
  const windshield = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.9, halfWidth * 1.7),
    new THREE.MeshStandardMaterial({ color: 0x1a2733, metalness: 0.8, roughness: 0.1 }),
  );
  windshield.position.set(halfLength + 0.01, 0.6, 0);
  const tyres = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 });
  truck.add(trailer, cab, windshield);
  for (const x of [halfLength - 1.5, -halfLength + 2.5, -halfLength + 1.2]) {
    for (const z of [-halfWidth + 0.2, halfWidth - 0.2]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 16), tyres);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, -halfHeight + 0.5 - 0.1, z);
      truck.add(wheel);
    }
  }
  truck.traverse((o) => (o.castShadow = true));
  truck.userData.headlights = null;
  return truck;
}

const kmh = (v) => v / 3.6;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
