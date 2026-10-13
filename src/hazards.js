import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { LANE_WIDTH, sampleAt } from './track.js';
import { buildCarMesh, addStaticWheels, CAR_SIZE } from './car.js';
import { LEFT_SHOULDER, RIGHT_SHOULDER, groundLayer, LAYER } from './world.js';
import { buildWorkZone, removeWorkZone, animateWorkZone, buildDiamondSign } from './construction.js';

// Everything that makes the Henday the Henday: traffic, wrong-way drivers,
// potholes, lane closures that move every lap, and grass that slows you down.

const POTHOLES = 14;
const FROST_HEAVES = 5;
const HEAVE_HEIGHT = 0.22; // metres
const HEAVE_LENGTH = 7; // metres along the road
const CLOSURES_PER_LAP = 2;
const TRAFFIC = 10; // our direction
const SEMIS = 2; // of the traffic above
const ONCOMING = 8; // other side of the median
const START_ZONE = [-120, 250]; // metres around the start line kept clear
const LANE_CHANGE_TIME = 1.4; // seconds to move one lane over
const WRONG_WAY_LANE_CHANGE_TIME = 0.8;
// Wrong-way drivers line up on your lane between these distances (metres),
// then hold their line, so you get ~1.2 s to dodge at a combined ~320 km/h.
const AIM_RANGE = 380;
const AIM_COMMIT = 110;
// Lane positions just onto each shoulder, for bailing out of a head-on.
const SHOULDER_LANES = { 0: -0.75, 2: 2.75 };
const AI_THINK = 0.12; // seconds between traffic decisions
const HARD_BRAKE = 7; // m/s², for the stopping-distance speed cap
const SAFE_GAP = 2; // metres kept between bumpers

const POTHOLE_LINES = [
  "That's a $900 alignment.",
  'Your hubcap lives here now.',
  'Filed under "spring maintenance".',
  "Edmonton's official speed bump.",
  "It's been there since 2016.",
  'The city has been notified. Again.',
];

const FROST_HEAVE_LINES = [
  "FROST HEAVE! Edmonton's natural ski jump.",
  'FROST HEAVE! Free airtime, courtesy of winter.',
  'FROST HEAVE! Your coffee is now on the ceiling.',
  'FROST HEAVE! The road is doing the wave.',
];

const CONSTRUCTION_LINES = [
  'ROAD WORK: 1 worker digging, 4 supervising.',
  'CONSTRUCTION SEASON: month 11 of 12.',
  'Fines double in work zones. So does your commute.',
  'Lane closed since 2019. Estimated completion: 2031.',
  'Detour ahead! (There is no detour.)',
  'Crew on coffee break. Lane still closed.',
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
    this.heaves = [];
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
    this.placeFrostHeaves();
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
    for (const h of this.heaves) {
      this.world.removeRigidBody(h.body);
      for (const object of h.objects) this.scene.remove(object);
    }
    this.removeClosures();
    this.vehicles = [];
    this.potholes = [];
    this.heaves = [];
  }

  removeBody(item) {
    this.world.removeRigidBody(item.body);
    this.scene.remove(item.mesh);
  }

  // ---------------------------------------------------------------- potholes

  placePotholes() {
    const rim = new THREE.MeshStandardMaterial({ color: 0x55534f, roughness: 1 });
    const hole = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 1 });
    for (let k = 0; k < POTHOLES; k++) {
      const s = this.randomS();
      const lane = randInt(0, 2);
      const pose = sampleAt(this.ours, s, laneCentre(this.ours, lane) + rand(-0.7, 0.7));
      const r = rand(0.55, 0.9);
      const mesh = new THREE.Group();
      const outer = new THREE.Mesh(blobGeometry(r * 1.25), rim);
      const inner = new THREE.Mesh(blobGeometry(r), hole);
      // Drawn over the asphalt, rim first (see groundLayer in world.js).
      groundLayer(outer, LAYER.paint);
      groundLayer(inner, LAYER.decal);
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

  // ------------------------------------------------------------ frost heaves

  // Humps across our carriageway: the top of a huge cylinder buried under the
  // road, so wheels roll over a smooth curve. Hit one fast and you get air.
  placeFrostHeaves() {
    const c = this.ours;
    const radius = (HEAVE_LENGTH ** 2 / 4 + HEAVE_HEIGHT ** 2) / (2 * HEAVE_HEIGHT);
    const patch = new THREE.MeshStandardMaterial({ color: 0x47484b, roughness: 0.95 });
    const crack = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 1 });
    for (let k = 0; k < FROST_HEAVES; k++) {
      let s;
      for (let tries = 0; tries < 100; tries++) {
        s = this.randomS();
        const nearBridge = [-30, 0, 30].some((d) => c.points[sampleAt(c, s + d).index][3] === 1);
        const crowded = this.heaves.some((h) => Math.min(gap(this.length, h.s, s), gap(this.length, s, h.s)) < 300);
        if (!nearBridge && !crowded) break;
      }
      const centreOffset = (RIGHT_SHOULDER - LEFT_SHOULDER) / 2;
      const halfAcross = (c.width(0) + LEFT_SHOULDER + RIGHT_SHOULDER) / 2;
      const pose = sampleAt(c, s, centreOffset);
      const heading = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, pose.heading);

      // Physics: cylinder axis (local y) turned to run across the road.
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(pose.x, HEAVE_HEIGHT - radius, pose.z)
          .setRotation(heading.clone().multiply(ACROSS_ROAD)),
      );
      this.world.createCollider(RAPIER.ColliderDesc.cylinder(halfAcross, radius).setFriction(1), body);

      // Visible hump: a strip following the same curve, in road-local axes.
      const positions = [];
      const steps = 28;
      for (let j = 0; j <= steps; j++) {
        const d = -HEAVE_LENGTH / 2 + (HEAVE_LENGTH * j) / steps;
        const y = Math.max(0, Math.sqrt(radius * radius - d * d) - (radius - HEAVE_HEIGHT)) + 0.03;
        positions.push(d, y, -halfAcross, d, y, halfAcross);
      }
      const indices = [];
      for (let j = 0; j < steps; j++) {
        const a = j * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const hump = groundLayer(new THREE.Mesh(geo, patch), LAYER.paint);
      hump.material.depthWrite = true;
      hump.receiveShadow = true;
      const split = groundLayer(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.01, halfAcross * 1.6), crack), LAYER.decal);
      split.position.set(0.2, HEAVE_HEIGHT + 0.035, 0);
      split.rotation.y = 0.08;
      const group = new THREE.Group();
      group.add(hump, split);
      group.position.set(pose.x, 0, pose.z);
      group.quaternion.copy(heading);
      this.scene.add(group);

      // Yellow BUMP sign on the right shoulder, 120 m before.
      const signPose = sampleAt(c, s - 120, c.width(0) / 2 + RIGHT_SHOULDER + 1);
      const sign = buildDiamondSign(['BUMP'], '#f2c200');
      sign.position.set(signPose.x, 0, signPose.z);
      sign.quaternion.setFromAxisAngle(Y_AXIS, signPose.heading);
      this.scene.add(sign);

      this.heaves.push({ s, body, objects: [group, sign], announced: false });
    }
  }

  // ---------------------------------------------------------------- closures

  // Work zones closing an outside lane, away from the player and each other.
  placeClosures(avoidS) {
    for (let k = 0; k < CLOSURES_PER_LAP; k++) {
      let s;
      do s = this.randomS();
      while (gap(this.length, avoidS, s) < 250 || this.closures.some((c) => Math.abs(c.s - s) < 400));
      const lane = Math.random() < 0.5 ? 0 : 2;
      this.closures.push(buildWorkZone(this.scene, this.world, this.ours, s, lane));
    }
  }

  removeClosures() {
    for (const zone of this.closures) removeWorkZone(this.scene, this.world, zone);
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
      // Somewhere well up the road from the player, heading straight at them,
      // with nobody else in that lane nearby.
      let s;
      let lane;
      for (let tries = 0; tries < 50; tries++) {
        s = this.playerS + rand(700, this.length - 500);
        lane = randInt(0, 2);
        const L = this.length;
        if (this.vehicles.every((o) => o.c !== this.ours || !inLane(o, lane, 0.9) || Math.min(gap(L, s, o.s), gap(L, o.s, s)) > 120)) break;
      }
      this.addVehicle({ c: this.ours, kind: 'car', lane, cruise: kmh(rand(115, 135)), dir: -1, wrongWay: true, s });
    }
  }

  // A wrong-way driver stuck nose-to-nose for a while gets pulled over and
  // replaced by a fresh one further up the road.
  pullOverStuck(dt) {
    for (const v of [...this.vehicles]) {
      if (!v.wrongWay) continue;
      v.stuck = v.speed < 2 ? (v.stuck ?? 0) + dt : 0;
      if (v.stuck < 3) continue;
      this.removeBody(v);
      this.vehicles.splice(this.vehicles.indexOf(v), 1);
      if (gap(this.length, v.s, this.playerS) < 300 || gap(this.length, this.playerS, v.s) < 300) {
        this.toast('Police have pulled over a wrong-way driver. Another one is out there.', 3);
      }
      this.spawnWrongWay(this.vehicles.filter((o) => o.wrongWay).length + 1);
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
    this.pullOverStuck(dt);
    for (const v of this.vehicles) {
      v.think -= dt;
      if (v.think <= 0) {
        v.think = AI_THINK;
        this.decide(v);
      }
      v.speed += THREE.MathUtils.clamp(v.target - v.speed, -8 * dt, 3 * dt);
      v.speed = Math.max(0, Math.min(v.speed, this.safeSpeed(v)));
      v.s += v.speed * v.dir * dt;
      const laneStep = dt / (v.wrongWay ? WRONG_WAY_LANE_CHANGE_TIME : LANE_CHANGE_TIME);
      v.laneNow += THREE.MathUtils.clamp(v.lane - v.laneNow, -laneStep, laneStep);
      this.placeVehicle(v);
    }
  }

  // The fastest v can go and still stop in time for whatever is in its lane:
  // behind a slower car, or (sharing the gap) for something coming head-on.
  // Checked every physics step, so AI vehicles never drive through each other.
  safeSpeed(v) {
    let cap = Infinity;
    const L = this.lengthOf(v.c);
    for (const o of this.vehicles) {
      if (o === v || o.c !== v.c) continue;
      if (Math.abs(o.laneNow - v.laneNow) > 0.7 && o.lane !== v.lane) continue;
      const g = gap(L, v.s * v.dir, o.s * v.dir) - v.size.halfLength - o.size.halfLength - SAFE_GAP;
      if (g > 160) continue;
      const room = Math.max(0, o.dir === v.dir ? g : g / 2);
      const stop = Math.sqrt(2 * HARD_BRAKE * room);
      cap = Math.min(cap, o.dir === v.dir ? o.speed + stop : stop);
    }
    return cap;
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
  // there's room, otherwise slow down behind it. Campers never change lanes
  // (unless something is coming at them head-on).
  decide(v) {
    v.target = v.cruise;
    if (v.wrongWay) this.aimAtPlayer(v);
    // Watch both the lane we're in and the one we're moving into.
    const lanes = [...new Set([v.lane, Math.round(v.laneNow)])];
    let ahead = lanes.map((l) => this.blocker(v, l)).reduce((a, b) => (!a || (b && b.gap < a.gap) ? b : a), null);
    // A wrong-way driver lined up on the player holds their line and leaves the
    // dodging to everyone else, swerving only at the last moment.
    if (ahead && v.wrongWay && this.hunting(v) && ahead.gap > 90) ahead = null;
    if (ahead) {
      // Campers won't move over for anyone... except a head-on collision.
      const stubborn = v.camper && !ahead.closing;
      const settled = v.lane === v.laneNow || ahead.closing;
      const here = Math.round(v.laneNow);
      const options = stubborn ? [] : [here - 1, here + 1].filter((l) => l >= 0 && l <= 2);
      // Pass on the left when we can, like the signs say.
      options.sort((a, b) => a - b);
      const free = options.find((l) => this.laneClear(v, l));
      if (free !== undefined && settled) v.lane = free;
      else if (ahead.closing && ahead.gap < 90 && !v.wrongWay && SHOULDER_LANES[here] !== undefined) {
        // Nowhere to go and something's coming head-on: bail onto the shoulder.
        v.lane = SHOULDER_LANES[here];
        v.target = Math.min(v.cruise, kmh(60));
      } else v.target = Math.min(v.cruise, ahead.speed ?? 0, ahead.gap < 12 ? 0 : Infinity);
    } else if (v.lane % 1 !== 0) {
      // Back off the shoulder once the danger has passed.
      v.lane = Math.round(Math.min(Math.max(v.lane, 0), 2));
    } else if (!v.camper && !v.wrongWay && v.lane < 2 && v.lane === v.laneNow && Math.random() < 0.06) {
      // Keep right except to pass.
      if (this.laneClear(v, v.lane + 1, 70)) v.lane += 1;
    }
  }

  // Wrong-way drivers drift into the player's lane as they close in, one lane
  // at a time, then commit. They still dodge other traffic (see decide).
  hunting(v) {
    return v.c === this.ours && gap(this.length, v.s * v.dir, this.playerS * v.dir) < AIM_RANGE;
  }

  aimAtPlayer(v) {
    if (v.c !== this.ours) return;
    const g = gap(this.length, v.s * v.dir, this.playerS * v.dir);
    if (g < AIM_COMMIT || g > AIM_RANGE || v.lane !== v.laneNow) return;
    const want = THREE.MathUtils.clamp(Math.round(this.playerLane()), 0, 2);
    if (want === v.lane) return;
    const next = v.lane + Math.sign(want - v.lane);
    if (this.laneClear(v, next, 45, 60)) v.lane = next;
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
      if (!best || g < best.gap) best = { gap: g, speed: closing ? 0 : o.speed, closing };
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

  laneClear(v, lane, ahead = 45, oncoming = 200) {
    const L = this.lengthOf(v.c);
    for (const o of this.vehicles) {
      if (o === v || o.c !== v.c || !inLane(o, lane, 0.9)) continue;
      const g = gap(L, v.s * v.dir, o.s * v.dir);
      const behind = L - g;
      const reach = o.dir !== v.dir ? oncoming : ahead;
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
    this.checkFrostHeaves(speed);
    this.radioChatter();

    const time = performance.now() / 1000;
    for (const zone of this.closures) {
      animateWorkZone(zone, time);
      if (!zone.announced && gap(this.length, this.playerS, zone.s) < 280) {
        zone.announced = true;
        this.toast(pick(CONSTRUCTION_LINES), 3);
      }
    }
    // Wrong-way drivers flash their high beams.
    const flash = Math.floor(performance.now() / 200) % 2 === 0;
    for (const v of this.vehicles) if (v.wrongWay) v.mesh.userData.headlights.emissiveIntensity = flash ? 3 : 0.2;

    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toastEl.textContent = '';
  }

  checkFrostHeaves(speed) {
    for (const h of this.heaves) {
      const past = gap(this.length, h.s, this.playerS);
      if (!h.announced && past < 6 && speed > 20 && !this.car.onGrass) {
        h.announced = true;
        this.shake = Math.max(this.shake, 0.6);
        this.toast(pick(FROST_HEAVE_LINES), 2.5);
      } else if (past > 300 && past < this.length - 300) {
        h.announced = false;
      }
    }
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
// Turns a cylinder (which stands along y) to run across the road (z).
const ACROSS_ROAD = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

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
