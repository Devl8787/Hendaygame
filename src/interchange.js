import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { sampleAt } from './track.js';
import { groundLayer, LAYER, RIGHT_SHOULDER } from './world.js';
import { cuttingDepth, CUTTING_REACH } from './terrain.js';
import { buildCarMesh, addStaticWheels, CAR_SIZE } from './car.js';

// The Henday's interchanges, simplified to diamonds: the crossing road goes
// either over the Henday on an overpass or under it through a cutting, with
// an off-ramp and an on-ramp for each direction. It's a race, so every ramp
// is barricaded: EXIT CLOSED.
//
// Each interchange has its own frame: v metres along the Henday (clockwise
// direction), u metres along the crossing road (to the right of clockwise).

const OVER_HEIGHT = 7.5; // overpass road surface above the Henday
const DECK_HALF = 26; // overpass span either side of the Henday's centre line
const EMBANKMENT_REACH = 115; // overpass approaches back at ground level
const ROAD_HALF = 7.5; // crossing road: two lanes each way
const SIDE_SLOPE = 1.5; // embankment side slopes, horizontal per vertical
const ROAD_REACH = 450; // how far the crossing road is drawn either way
const RAMP_REACH = 150; // ramps leave/join the Henday this far from the crossing
const RAMP_END = 145; // ...and meet the crossing road this far out, at ground level
const RAMP_HALF = 2.75;
const CROSS_TRAFFIC = 4;

const CLOSED_LINES = ['EXIT CLOSED', 'EXIT CLOSED', 'EXIT CLOSED', 'CLOSED SINCE 2019', 'EXIT? NOT TODAY'];

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const mats = {
  // Strips can come out facing either way depending on direction: draw both sides.
  asphalt: () => new THREE.MeshStandardMaterial({ color: 0x3b3d40, roughness: 0.95, side: THREE.DoubleSide }),
  white: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xf2c230, side: THREE.DoubleSide }),
  concrete: new THREE.MeshStandardMaterial({ color: 0xb9b6ad, roughness: 0.9 }),
  embankment: new THREE.MeshStandardMaterial({ color: 0x6a8a42, roughness: 1, side: THREE.DoubleSide }),
  barrelOrange: new THREE.MeshStandardMaterial({ color: 0xff6a00 }),
  barrelWhite: new THREE.MeshStandardMaterial({ color: 0xf4f4f4 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 }),
};

export function buildInterchanges(scene, world, track, terrain) {
  const built = (track.interchanges ?? []).map((spec, k) => new Interchange(scene, world, track, terrain, spec, k));
  return {
    list: built,
    update(dt) {
      for (const i of built) i.update(dt);
    },
  };
}

class Interchange {
  constructor(scene, world, track, terrain, spec, index) {
    this.scene = scene;
    this.world = world;
    this.spec = spec;
    this.terrain = terrain;
    const { x, z, tx, tz } = spec;
    this.origin = new THREE.Vector3(x, 0, z);
    this.t = new THREE.Vector3(tx, 0, tz); // along the Henday (clockwise)
    this.n = new THREE.Vector3(-tz, 0, tx); // along the crossing road
    this.heading = Math.atan2(-tz, tx);
    this.closedText = CLOSED_LINES[index % CLOSED_LINES.length];

    // Crossing road reach either way: stop short of the river valley.
    this.reach = [-1, 1].map((side) => {
      for (let u = CUTTING_REACH + 10; u <= ROAD_REACH; u += 10) {
        const p = this.at(0, side * u);
        if (terrain && terrain.valleyHeight(p.x, p.z) < -0.5) return u - 30;
      }
      return ROAD_REACH;
    });

    this.buildCrossingRoad();
    if (spec.over) this.buildOverpass();
    for (const c of track.carriageways) this.buildRamps(c);
    this.spawnCrossTraffic();
  }

  // World position at v (along the Henday) and u (along the crossing road).
  at(v, u, y = 0) {
    return new THREE.Vector3(
      this.origin.x + this.t.x * v + this.n.x * u,
      y,
      this.origin.z + this.t.z * v + this.n.z * u,
    );
  }

  // Height of the crossing road's surface u metres out.
  roadY(u) {
    const a = Math.abs(u);
    if (this.spec.over) {
      if (a <= DECK_HALF) return OVER_HEIGHT;
      const t = THREE.MathUtils.clamp((a - DECK_HALF) / (EMBANKMENT_REACH - DECK_HALF), 0, 1);
      return OVER_HEIGHT * (1 - t * t * (3 - 2 * t));
    }
    return -cuttingDepth(u);
  }

  buildCrossingRoad() {
    const samples = [];
    for (let u = -this.reach[0]; u <= this.reach[1]; u += 3) samples.push(u);
    const line = (offset, halfWidth, y = 0.02) =>
      strip(
        samples.map((u) => {
          const p = this.at(offset, u, this.roadY(u) + y);
          return { p, side: this.t };
        }),
        halfWidth,
      );
    const road = groundLayer(new THREE.Mesh(line(0, ROAD_HALF + 1), mats.asphalt()), LAYER.asphalt);
    road.receiveShadow = true;
    this.add(road);
    // Double yellow centre line, white edge lines.
    for (const v of [-0.2, 0.2]) this.add(groundLayer(new THREE.Mesh(line(v, 0.08, 0.04), mats.yellow), LAYER.paint));
    for (const v of [-ROAD_HALF, ROAD_HALF]) this.add(groundLayer(new THREE.Mesh(line(v, 0.08, 0.04), mats.white), LAYER.paint));
  }

  buildOverpass() {
    // Deck over the Henday, with parapets.
    const deckDepth = 1.2;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 + 2, deckDepth, DECK_HALF * 2), mats.concrete);
    deck.position.copy(this.at(0, 0, OVER_HEIGHT - deckDepth / 2));
    deck.rotation.y = this.heading;
    deck.castShadow = deck.receiveShadow = true;
    this.add(deck);
    this.solid(deck.position, RAPIER.ColliderDesc.cuboid(ROAD_HALF + 1, deckDepth / 2, DECK_HALF));
    for (const v of [-(ROAD_HALF + 0.85), ROAD_HALF + 0.85]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, DECK_HALF * 2), mats.concrete);
      wall.position.copy(this.at(v, 0, OVER_HEIGHT + 0.5));
      wall.rotation.y = this.heading;
      wall.castShadow = true;
      this.add(wall);
    }
    // Piers in the median.
    const height = OVER_HEIGHT - deckDepth;
    for (const v of [-5, 0, 5]) {
      const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, height, 12), mats.concrete);
      pier.position.copy(this.at(v, 0, height / 2));
      pier.castShadow = true;
      this.add(pier);
      this.solid(pier.position, RAPIER.ColliderDesc.cylinder(height / 2, 0.7));
    }
    // Grass embankments carrying the road up to the deck, with concrete abutments.
    for (const side of [-1, 1]) this.buildEmbankment(side);
  }

  buildEmbankment(side) {
    const top = ROAD_HALF + 1;
    const positions = [];
    const indices = [];
    const sections = [];
    for (let a = DECK_HALF; a <= EMBANKMENT_REACH; a += 4) sections.push(a);
    for (const a of sections) {
      const u = side * a;
      const y = this.roadY(u);
      const base = top + SIDE_SLOPE * y;
      for (const [v, h] of [[-base, 0], [-top, y], [top, y], [base, 0]]) {
        const p = this.at(v, u, h);
        positions.push(p.x, p.y, p.z);
      }
    }
    for (let k = 0; k < sections.length - 1; k++) {
      const a = k * 4;
      const b = a + 4;
      // Left slope, top, right slope (outward-facing whichever side we're on).
      for (const [i, j] of [[0, 1], [1, 2], [2, 3]]) {
        if (side > 0) indices.push(a + i, b + i, a + j, a + j, b + i, b + j);
        else indices.push(a + i, a + j, b + i, a + j, b + j, b + i);
      }
    }
    // Abutment face toward the Henday.
    if (side > 0) indices.push(0, 1, 2, 0, 2, 3);
    else indices.push(0, 2, 1, 0, 3, 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mats.embankment);
    mesh.receiveShadow = mesh.castShadow = true;
    this.add(mesh);
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices)));

    // A concrete face over the abutment end so it reads as a bridge seat.
    const p0 = this.at(0, side * DECK_HALF, OVER_HEIGHT / 2);
    const face = new THREE.Mesh(new THREE.BoxGeometry(top * 2 + SIDE_SLOPE * OVER_HEIGHT, OVER_HEIGHT, 0.6), mats.concrete);
    face.position.copy(p0);
    face.rotation.y = this.heading;
    face.position.add(this.n.clone().multiplyScalar(side * 0.3));
    face.castShadow = true;
    this.add(face);
  }

  // Off-ramp before the crossing and on-ramp after it, on carriageway c's
  // right-hand side, both barricaded.
  buildRamps(c) {
    // Where c passes the crossing, which way it runs, and which side is its right.
    let best = 0;
    let bestD = Infinity;
    c.points.forEach(([x, z], i) => {
      const d = (x - this.origin.x) ** 2 + (z - this.origin.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const s0 = c.distance[best];
    const dir = Math.sign(c.tangents[best * 2] * this.t.x + c.tangents[best * 2 + 1] * this.t.z) || 1;
    const side = dir; // c's right is +u when it runs clockwise, -u when it doesn't
    const edge = c.width(best) / 2 + 1;

    const along = (pose) => new THREE.Vector3(Math.cos(pose.heading), 0, -Math.sin(pose.heading));
    const startPose = sampleAt(c, s0 - RAMP_REACH, edge);
    const endPose = sampleAt(c, s0 + RAMP_REACH, edge);
    const start = new THREE.Vector3(startPose.x, 0, startPose.z);
    const end = new THREE.Vector3(endPose.x, 0, endPose.z);
    const toCross = this.t.clone().multiplyScalar(dir);

    const offRamp = new THREE.CubicBezierCurve3(
      start,
      start.clone().add(along(startPose).multiplyScalar(70)),
      this.at(-dir * (ROAD_HALF + 3), side * RAMP_END).sub(toCross.clone().multiplyScalar(50)),
      this.at(-dir * (ROAD_HALF + 1), side * RAMP_END),
    );
    const onRamp = new THREE.CubicBezierCurve3(
      this.at(dir * (ROAD_HALF + 1), side * RAMP_END),
      this.at(dir * (ROAD_HALF + 3), side * RAMP_END).add(toCross.clone().multiplyScalar(50)),
      end.clone().sub(along(endPose).multiplyScalar(70)),
      end,
    );
    for (const [ramp, fromHenday] of [[offRamp, true], [onRamp, false]]) {
      const pts = ramp.getSpacedPoints(60);
      this.drawRamp(pts);
      // Barricade where the ramp is clear of the shoulder.
      const clear = c.width(best) / 2 + RIGHT_SHOULDER + RAMP_HALF + 1.5;
      const order = fromHenday ? pts : [...pts].reverse();
      const k = order.findIndex((p) => this.distanceFromRoad(c, p) > clear);
      if (k > 0) this.barricade(order[k], order[Math.min(k + 1, order.length - 1)].clone().sub(order[k]).normalize());
    }

    // Green exit sign on the shoulder before the off-ramp.
    const signPose = sampleAt(c, s0 - RAMP_REACH - 110, c.width(best) / 2 + RIGHT_SHOULDER + 1.5);
    const sign = buildExitSign(shortName(this.spec.name), this.closedText);
    sign.position.set(signPose.x, 0, signPose.z);
    sign.rotation.y = signPose.heading;
    this.add(sign);
  }

  distanceFromRoad(c, p) {
    let best = Infinity;
    for (const [x, z] of c.points) best = Math.min(best, (x - p.x) ** 2 + (z - p.z) ** 2);
    return Math.sqrt(best);
  }

  drawRamp(points) {
    const withSide = points.map((p, i) => {
      const a = points[Math.max(0, i - 1)];
      const b = points[Math.min(points.length - 1, i + 1)];
      const d = b.clone().sub(a).normalize();
      return { p: new THREE.Vector3(p.x, 0.025, p.z), side: new THREE.Vector3(-d.z, 0, d.x) };
    });
    const ramp = groundLayer(new THREE.Mesh(strip(withSide, RAMP_HALF + 0.6), mats.asphalt()), LAYER.asphalt);
    ramp.receiveShadow = true;
    this.add(ramp);
    for (const off of [-RAMP_HALF, RAMP_HALF]) {
      const shifted = withSide.map(({ p, side }) => ({ p: p.clone().add(side.clone().multiplyScalar(off)).setY(0.045), side }));
      this.add(groundLayer(new THREE.Mesh(strip(shifted, 0.08), mats.white), LAYER.paint));
    }
  }

  // Concrete barrier across the ramp with striped barrels in front.
  barricade(p, forward) {
    const heading = Math.atan2(-forward.z, forward.x);
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.85, RAMP_HALF * 2 + 1.5), mats.concrete);
    barrier.position.set(p.x, 0.425, p.z);
    barrier.rotation.y = heading;
    barrier.castShadow = true;
    this.add(barrier);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(p.x, 0.425, p.z)
        .setRotation(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, heading)),
    );
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.425, RAMP_HALF + 0.75), body);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    for (const off of [-2, 0, 2]) {
      const barrel = buildBarrel();
      barrel.position.copy(p).add(right.clone().multiplyScalar(off)).sub(forward.clone().multiplyScalar(1.6));
      this.add(barrel);
      this.solid(barrel.position.clone().setY(0.5), RAPIER.ColliderDesc.cylinder(0.5, 0.35));
    }
  }

  // A few cars driving across, over the overpass or through the cutting.
  spawnCrossTraffic() {
    this.cars = [];
    for (let k = 0; k < CROSS_TRAFFIC; k++) {
      const dir = k % 2 === 0 ? 1 : -1;
      const mesh = addStaticWheels(buildCarMesh([0xf2f2f2, 0x1f4e8c, 0x8a9199, 0x5b2333][k]));
      this.add(mesh);
      this.cars.push({
        mesh,
        dir,
        // Keep right: travelling +u means the -v side of the crossing road.
        v: -dir * (k < 2 ? 1.75 : 5.25),
        u: -this.reach[0] + Math.random() * (this.reach[0] + this.reach[1]),
        speed: (55 + Math.random() * 25) / 3.6,
      });
    }
    this.update(0);
  }

  update(dt) {
    for (const car of this.cars) {
      car.u += car.dir * car.speed * dt;
      if (car.u > this.reach[1]) car.u = -this.reach[0];
      if (car.u < -this.reach[0]) car.u = this.reach[1];
      const y = this.roadY(car.u);
      // Nose up or down with the road.
      const pitch = Math.atan2(this.roadY(car.u + car.dir * 2) - y, 2);
      car.mesh.position.copy(this.at(car.v, car.u, y + CAR_SIZE.rideHeight));
      car.mesh.rotation.set(0, Math.atan2(-this.n.z * car.dir, this.n.x * car.dir), pitch, 'YXZ');
    }
  }

  add(object) {
    this.scene.add(object);
  }

  solid(position, desc) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z));
    this.world.createCollider(desc, body);
  }
}

// A flat strip through points [{ p, side }] (side = unit vector across), halfWidth either way.
function strip(points, halfWidth) {
  const positions = [];
  const indices = [];
  points.forEach(({ p, side }, i) => {
    positions.push(p.x - side.x * halfWidth, p.y, p.z - side.z * halfWidth, p.x + side.x * halfWidth, p.y, p.z + side.z * halfWidth);
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function shortName(name) {
  return name
    .split(' / ')[0]
    .replace(/ Drive$/, ' Dr')
    .replace(/ Boulevard$/, ' Blvd')
    .replace(/ Road$/, ' Rd')
    .replace(/ Street$/, ' St')
    .replace(/ Highway$/, ' Hwy');
}

function buildBarrel() {
  const g = new THREE.Group();
  const stripes = [mats.barrelOrange, mats.barrelWhite, mats.barrelOrange, mats.barrelWhite, mats.barrelOrange];
  stripes.forEach((m, i) => {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.35, 0.2, 14), m);
    ring.position.y = 0.1 + i * 0.2;
    ring.castShadow = true;
    g.add(ring);
  });
  return g;
}

// Green guide sign on two posts with the road name and an orange CLOSED plate.
function buildExitSign(name, closed) {
  const group = new THREE.Group();
  for (const z of [-1.8, 1.8]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 4.2, 0.15), mats.steel);
    post.position.set(0, 2.1, z);
    group.add(post);
  }
  const width = 4.8;
  const height = 2.4;
  let face = new THREE.MeshStandardMaterial({ color: 0x0b6b3a });
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0b6b3a';
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 496, 240);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 64;
    do ctx.font = `bold ${size--}px system-ui, sans-serif`;
    while (ctx.measureText(name).width > 460);
    ctx.fillText(name, 256, 82);
    ctx.fillStyle = '#ff8a00';
    ctx.fillRect(56, 150, 400, 70);
    ctx.fillStyle = '#111';
    size = 44;
    do ctx.font = `bold ${size--}px system-ui, sans-serif`;
    while (ctx.measureText(closed).width > 380);
    ctx.fillText(closed, 256, 186);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    face = new THREE.MeshStandardMaterial({ map: texture });
  }
  const back = new THREE.MeshStandardMaterial({ color: 0x8a8f96 });
  // Box faces: +x, -x, +y, -y, +z, -z. Drivers approach from -x.
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.08, height, width), [back, face, back, back, back, back]);
  board.position.y = 4.2 + height / 2 - 0.6;
  group.add(board);
  group.traverse((o) => (o.castShadow = true));
  return group;
}
