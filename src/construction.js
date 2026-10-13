import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { LANE_WIDTH, sampleAt } from './track.js';
import { groundLayer, LAYER } from './world.js';

// A Henday work zone closing one outside lane (0 = median side, 2 = right):
// a sign well before it, a flashing arrow board, a cone taper, concrete
// barriers, an excavator, and a crew of workers: one digging, the rest
// supervising. Everything is laid out in road terms: `d` metres past the
// start of the closure and a sideways offset from the carriageway centre.

export const ZONE_LENGTH = 140;
const TAPER = 50;
const BARRIER_SEGMENT = 6;

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
const MATS = {
  cone: mat(0xff6a00),
  concrete: mat(0xc9c5bb, { roughness: 0.95 }),
  yellow: mat(0xf2b705, { roughness: 0.6 }),
  dark: mat(0x2b2b2b),
  glass: mat(0x1a2733, { metalness: 0.8, roughness: 0.1 }),
  vest: mat(0xff7a00, { emissive: 0xff5a00, emissiveIntensity: 0.25 }),
  jeans: mat(0x2c3e66),
  skin: mat(0xd9a77c),
  hatWhite: mat(0xf4f4f4, { roughness: 0.4 }),
  hatYellow: mat(0xf2d200, { roughness: 0.4 }),
  dirt: mat(0x6b4f33, { roughness: 1 }),
  hole: mat(0x1d1712, { roughness: 1 }),
  steel: mat(0x9aa0a6, { metalness: 0.6, roughness: 0.4 }),
  cup: mat(0xf2f2f2),
};

export function buildWorkZone(scene, world, c, s, lane) {
  const zone = { s, lane, length: ZONE_LENGTH, cones: [], bodies: [], objects: [], lights: [], digger: null };
  const edge = lane === 0 ? -1 : 1; // which side of the road the closed lane is on
  const half = c.width(0) / 2;
  const laneMid = edge * (half - LANE_WIDTH / 2);
  const laneLine = edge * (half - LANE_WIDTH); // the line we're closing off

  // Puts `object` at d metres along / `offset` sideways, turned `yaw` from the road direction.
  const place = (object, d, offset, yaw = 0) => {
    const pose = sampleAt(c, s + d, offset);
    object.position.x = pose.x;
    object.position.z = pose.z;
    object.quaternion.setFromAxisAngle(Y_AXIS, pose.heading + yaw);
    scene.add(object);
    zone.objects.push(object);
    return pose;
  };
  const solid = (pose, yaw, hx, hy, hz, y = hy) => {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(pose.x, y, pose.z)
        .setRotation(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, pose.heading + yaw)),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), body);
    zone.bodies.push(body);
  };

  // Warning sign on the shoulder, well before the work.
  place(buildDiamondSign(['ROAD', 'WORK', 'AHEAD'], '#ff8a00'), -180, edge * (half + 2.2));

  // Cone taper from the outer edge in to the lane line.
  const coneGeo = new THREE.ConeGeometry(0.2, 0.7, 12);
  for (let d = 0; d <= TAPER; d += 5) {
    const f = d / TAPER;
    const offset = edge * (half - 0.3 - f * (LANE_WIDTH - 0.6));
    const pose = sampleAt(c, s + d, offset);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pose.x, 0.35, pose.z));
    world.createCollider(RAPIER.ColliderDesc.cone(0.35, 0.2).setDensity(40), body);
    const mesh = new THREE.Mesh(coneGeo, MATS.cone);
    mesh.castShadow = true;
    scene.add(mesh);
    zone.cones.push({ body, mesh });
  }

  // Flashing arrow board just behind the start of the taper.
  const board = buildArrowBoard(edge);
  place(board.group, 6, laneMid + edge * 0.6);
  zone.lights.push(...board.lights);

  // Concrete barriers along the lane line for the rest of the zone.
  const barrierGeo = new THREE.BoxGeometry(BARRIER_SEGMENT - 0.1, 0.8, 0.6);
  for (let d = TAPER; d < ZONE_LENGTH; d += BARRIER_SEGMENT) {
    const mid = d + BARRIER_SEGMENT / 2;
    const offset = laneLine + edge * 0.35;
    const mesh = new THREE.Mesh(barrierGeo, MATS.concrete);
    mesh.position.y = 0.4;
    mesh.castShadow = true;
    const pose = place(mesh, mid, offset);
    solid(pose, 0, BARRIER_SEGMENT / 2 - 0.05, 0.4, 0.3);
  }

  // The work: an excavator, a hole, a dirt pile and the crew.
  const excavator = buildExcavator();
  const exPose = place(excavator, 78, laneMid, edge * -0.4);
  solid(exPose, edge * -0.4, 2.2, 1.4, 1.4, 1.4);

  const hole = new THREE.Mesh(new THREE.CircleGeometry(1.1, 16), MATS.hole);
  hole.geometry.rotateX(-Math.PI / 2);
  hole.scale.set(1.6, 1, 1);
  hole.position.y = 0.06;
  groundLayer(hole, LAYER.decal);
  place(hole, 96, laneMid);
  const pile = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.1, 10), MATS.dirt);
  pile.position.y = 0.55;
  pile.castShadow = true;
  place(pile, 101, laneMid + edge * 0.6);

  // One digs. Four supervise. One has a coffee.
  const crew = [
    { d: 94.5, side: -0.3, yaw: Math.PI / 2, digging: true },
    { d: 99, side: -0.9, yaw: Math.PI * 0.9 },
    { d: 99.5, side: 0.4, yaw: Math.PI * 1.1, coffee: true },
    { d: 100.5, side: -0.2, yaw: Math.PI },
    { d: 92, side: 0.9, yaw: Math.PI * 0.2 },
  ];
  for (const w of crew) {
    const worker = buildWorker(w);
    const pose = place(worker.group, w.d, laneMid + edge * w.side, w.yaw);
    solid(pose, 0, 0.35, 0.9, 0.35, 0.9);
    if (w.digging) zone.digger = worker;
  }

  return zone;
}

export function removeWorkZone(scene, world, zone) {
  for (const cone of zone.cones) {
    world.removeRigidBody(cone.body);
    scene.remove(cone.mesh);
  }
  for (const body of zone.bodies) world.removeRigidBody(body);
  for (const object of zone.objects) scene.remove(object);
}

// Per-frame: cones follow physics, the arrow board flashes, the digger digs.
export function animateWorkZone(zone, time) {
  for (const cone of zone.cones) {
    cone.mesh.position.copy(cone.body.translation());
    cone.mesh.quaternion.copy(cone.body.rotation());
  }
  const on = Math.floor(time * 1.5) % 2 === 0;
  for (const light of zone.lights) light.material = on ? light.userData.on : light.userData.off;
  if (zone.digger) zone.digger.arms.rotation.z = -0.5 + Math.sin(time * 3) * 0.35;
}

function buildWorker({ coffee, digging }) {
  const group = new THREE.Group();
  const add = (geo, material, x, y, z) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    group.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(0.28, 0.85, 0.36), MATS.jeans, 0, 0.43, 0);
  add(new THREE.BoxGeometry(0.32, 0.62, 0.48), MATS.vest, 0, 1.17, 0);
  add(new THREE.SphereGeometry(0.13, 12, 10), MATS.skin, 0, 1.62, 0);
  add(new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), digging ? MATS.hatYellow : MATS.hatWhite, 0, 1.68, 0);

  // Arms (and whatever's in them) pivot at the shoulders so the digger can dig.
  const arms = new THREE.Group();
  arms.position.set(0, 1.4, 0);
  group.add(arms);
  const armGeo = new THREE.BoxGeometry(0.12, 0.55, 0.12);
  for (const z of [-0.3, 0.3]) {
    const arm = new THREE.Mesh(armGeo, MATS.vest);
    arm.position.set(digging ? 0.2 : 0, -0.25, z);
    if (digging) arm.rotation.z = 0.8;
    arms.add(arm);
  }
  if (digging) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 6), MATS.dirt);
    shaft.position.set(0.55, -0.45, 0);
    shaft.rotation.z = 0.6;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.3, 0.03), MATS.steel);
    blade.position.set(0.95, -1.0, 0);
    blade.rotation.z = 0.6;
    arms.add(shaft, blade);
  }
  if (coffee) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.13, 10), MATS.cup);
    cup.position.set(0.18, -0.45, 0.3);
    arms.add(cup);
  }
  return { group, arms };
}

function buildExcavator() {
  const ex = new THREE.Group();
  const add = (geo, material, x, y, z, rz = 0) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.rotation.z = rz;
    m.castShadow = true;
    ex.add(m);
    return m;
  };
  for (const z of [-1.0, 1.0]) add(new THREE.BoxGeometry(3.6, 0.7, 0.6), MATS.dark, 0, 0.35, z);
  add(new THREE.BoxGeometry(2.8, 1.1, 2.3), MATS.yellow, -0.3, 1.25, 0);
  add(new THREE.BoxGeometry(1.1, 1.2, 1.0), MATS.glass, 0.5, 2.35, -0.55);
  add(new THREE.BoxGeometry(3.4, 0.35, 0.35), MATS.yellow, 2.4, 2.5, 0.5, 0.5);
  add(new THREE.BoxGeometry(2.2, 0.3, 0.3), MATS.yellow, 4.3, 1.9, 0.5, -1.1);
  add(new THREE.BoxGeometry(0.8, 0.6, 0.9), MATS.dark, 4.7, 0.6, 0.5);
  return ex;
}

// Black trailer panel with an amber arrow pointing toward the open lanes.
function buildArrowBoard(edge) {
  const group = new THREE.Group();
  const trailer = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.4), MATS.yellow);
  trailer.position.y = 0.6;
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.8, 0.12), MATS.dark);
  mast.position.y = 1.7;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 2.4), MATS.dark);
  panel.position.y = 2.9;
  group.add(trailer, mast, panel);

  const on = new THREE.MeshStandardMaterial({ color: 0xffb000, emissive: 0xffa000, emissiveIntensity: 2 });
  const off = new THREE.MeshStandardMaterial({ color: 0x3a2a00 });
  const dot = new THREE.SphereGeometry(0.07, 8, 6);
  // Arrow in the panel's plane: shaft along z, head at the open-lane end.
  const dots = [];
  for (let z = -0.8; z <= 0.8; z += 0.2) dots.push([0, z]);
  for (let k = 1; k <= 3; k++) dots.push([k * 0.15, -0.8 + k * 0.17], [-k * 0.15, -0.8 + k * 0.17]);
  const lights = dots.map(([y, z]) => {
    const light = new THREE.Mesh(dot, on);
    light.userData = { on, off };
    // Facing approaching traffic (-x side); the arrowhead points away from the closed lane.
    light.position.set(-0.07, 2.9 + y, z * edge);
    group.add(light);
    return light;
  });
  group.traverse((o) => (o.castShadow = true));
  return { group, lights };
}

// Diamond warning sign on a post, e.g. ROAD WORK AHEAD (orange) or BUMP
// (yellow). Plain coloured without a DOM.
export function buildDiamondSign(words, fill) {
  const group = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.4, 0.1), MATS.steel);
  post.position.y = 1.2;
  group.add(post);
  const size = 1.8;
  if (typeof document === 'undefined') {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.3, 1.3), mat(new THREE.Color(fill).getHex()));
    panel.position.y = 2.6;
    panel.rotation.x = Math.PI / 4;
    group.add(panel);
    return group;
  }
  // Front: the diamond and level text drawn on a transparent square.
  const face = (draw) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(128, 4);
    ctx.lineTo(252, 128);
    ctx.lineTo(128, 252);
    ctx.lineTo(4, 128);
    ctx.closePath();
    draw(ctx);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: texture, alphaTest: 0.5 });
  };
  const front = face((ctx) => {
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#111';
    ctx.stroke();
    ctx.fillStyle = '#111';
    const size = words.length === 1 ? 52 : 34;
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const top = 128 - ((words.length - 1) * 36) / 2;
    words.forEach((word, i) => ctx.fillText(word, 128, top + i * 36));
  });
  const back = face((ctx) => {
    ctx.fillStyle = '#8a8f96';
    ctx.fill();
  });
  // Planes face +z by default; turn them so the front faces drivers coming from -x.
  for (const [material, yaw, x] of [[front, -Math.PI / 2, -0.03], [back, Math.PI / 2, 0.03]]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
    panel.position.set(x, 2.6, 0);
    panel.rotation.y = yaw;
    panel.castShadow = true;
    group.add(panel);
  }
  post.castShadow = true;
  return group;
}
