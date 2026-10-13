import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { LANE_WIDTH, poseAt } from './track.js';

export const LEFT_SHOULDER = 1;
export const RIGHT_SHOULDER = 2.5;
const LINE_WIDTH = 0.15;
const POLE_EVERY = 60; // metres

// The ground, asphalt and paint are flat layers only centimetres apart, which
// some GPUs can't separate by depth, so the grass would flicker through the road.
// Instead they skip the depth buffer and are drawn in a fixed order, bottom up.
const LAYER = { grass: -3, asphalt: -2, paint: -1 };
function groundLayer(mesh, layer) {
  mesh.material.depthWrite = false;
  mesh.renderOrder = layer;
  return mesh;
}

export function createWorld(scene, world, track) {
  addLights(scene);
  addGround(scene, world, track);
  track.carriageways.forEach((c) => addCarriageway(scene, c));
  addLightPoles(scene, track);
  if (track.carriageways[0].closed) addStartFinish(scene, track.carriageways[0]);
}

function addLights(scene) {
  scene.background = new THREE.Color(0x9fc4e8);
  scene.fog = new THREE.Fog(0x9fc4e8, 150, 900);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x5a6b3a, 1.2));

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -60;
  s.right = 60;
  s.top = 60;
  s.bottom = -60;
  s.far = 400;
  scene.add(sun);
  scene.add(sun.target);
  // The sun follows the car so shadows stay sharp around it.
  scene.userData.sun = sun;
}

function addGround(scene, world, track) {
  // Size the ground to the track, with a couple of km to spare.
  let extent = 0;
  for (const c of track.carriageways) {
    for (const [x, z] of c.points) extent = Math.max(extent, Math.abs(x), Math.abs(z));
  }
  const half = extent + 2000;

  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2, half * 2),
    new THREE.MeshStandardMaterial({ color: 0x6f8f45 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(groundLayer(grass, LAYER.grass));

  // The road is painted onto one big flat collider. Hills and bridges come later.
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(half, 0.5, half).setTranslation(0, -0.5, 0).setFriction(1.0),
  );
}

function addCarriageway(scene, c) {
  const y = 0.02;
  const half = (i) => c.width(i) / 2;

  const asphalt = new THREE.Mesh(
    ribbon(c, (i) => -half(i) - LEFT_SHOULDER, (i) => half(i) + RIGHT_SHOULDER, y),
    new THREE.MeshStandardMaterial({ color: 0x3b3d40, roughness: 0.95 }),
  );
  asphalt.receiveShadow = true;
  scene.add(groundLayer(asphalt, LAYER.asphalt));

  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c230 });
  const line = (offset, mat, include) => {
    const geo = ribbon(c, (i) => offset(i) - LINE_WIDTH / 2, (i) => offset(i) + LINE_WIDTH / 2, y + 0.01, include);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    scene.add(groundLayer(mesh, LAYER.paint));
  };

  // Yellow on the median (left) edge, white on the outside edge.
  line((i) => -half(i), yellow);
  line((i) => half(i), white);
  // Dashed lines between lanes: 3 m dash, 9 m gap.
  const maxLanes = Math.max(...c.points.map((p) => p[2]));
  for (let k = 1; k < maxLanes; k++) {
    line((i) => -half(i) + k * LANE_WIDTH, white, (i) => k < c.points[i][2] && c.distance[i] % 12 < 3);
  }

  addBridgeBarriers(scene, c, half);
}

// Concrete barriers on both sides wherever OSM marks a bridge.
function addBridgeBarriers(scene, c, half) {
  const isBridge = (i) => c.points[i][3] === 1;
  if (!c.points.some((p) => p[3] === 1)) return;
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb9b6ad, roughness: 0.9, side: THREE.DoubleSide });
  for (const offset of [(i) => -half(i) - LEFT_SHOULDER, (i) => half(i) + RIGHT_SHOULDER]) {
    const wall = new THREE.Mesh(wallRibbon(c, offset, 0.9, isBridge), concrete);
    wall.castShadow = true;
    scene.add(wall);
  }
}

// A flat strip following the carriageway, between two sideways offsets.
// `include(i)` (optional) decides whether the piece from point i to i+1 is drawn.
function ribbon(c, leftOffset, rightOffset, y, include) {
  return stripGeometry(c, include, (i, out) => {
    const [x, z] = c.points[i];
    const rx = -c.tangents[i * 2 + 1];
    const rz = c.tangents[i * 2];
    const l = leftOffset(i);
    const r = rightOffset(i);
    out.push(x + rx * l, y, z + rz * l, x + rx * r, y, z + rz * r);
  });
}

// A vertical strip (barrier) at one sideways offset.
function wallRibbon(c, offset, height, include) {
  return stripGeometry(c, include, (i, out) => {
    const [x, z] = c.points[i];
    const o = offset(i);
    const px = x - c.tangents[i * 2 + 1] * o;
    const pz = z + c.tangents[i * 2] * o;
    out.push(px, 0, pz, px, height, pz);
  });
}

function stripGeometry(c, include, pushPair) {
  const n = c.points.length;
  const segments = c.closed ? n : n - 1;
  const positions = [];
  const indices = [];
  let pairs = 0;
  let open = false; // whether the previous pair can be joined to
  for (let s = 0; s < segments; s++) {
    if (include && !include(s)) {
      open = false;
      continue;
    }
    if (!open) {
      pushPair(s, positions);
      pairs++;
    }
    pushPair((s + 1) % n, positions);
    pairs++;
    const a = (pairs - 2) * 2;
    // Two triangles per piece, wound so flat strips face up (+y).
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    open = true;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function addLightPoles(scene, track) {
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.15, 10, 8);
  poleGeo.translate(0, 5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.6, roughness: 0.4 });
  const spots = [];
  for (const c of track.carriageways) {
    let next = 0;
    for (let i = 0; i < c.points.length; i++) {
      if (c.distance[i] < next) continue;
      spots.push(poseAt(c, i, c.width(i) / 2 + RIGHT_SHOULDER + 2));
      next = c.distance[i] + POLE_EVERY;
    }
  }
  const poles = new THREE.InstancedMesh(poleGeo, mat, spots.length);
  poles.castShadow = true;
  const m = new THREE.Matrix4();
  spots.forEach((p, i) => poles.setMatrixAt(i, m.makeTranslation(p.x, 0, p.z)));
  scene.add(poles);
}

// Checkered line across the road at point 0, with a gantry overhead.
function addStartFinish(scene, c) {
  const width = c.width(0) + LEFT_SHOULDER + RIGHT_SHOULDER;
  const centre = (RIGHT_SHOULDER - LEFT_SHOULDER) / 2;
  const square = 0.75;
  const across = Math.round(width / square);
  const pose = poseAt(c, 0, centre);
  const heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.heading);

  // Car-local frame: +x along the road, +z to the right.
  const toWorld = (along, right, y) =>
    new THREE.Vector3(along, y, right).applyQuaternion(heading).add(new THREE.Vector3(pose.x, 0, pose.z));

  const geo = new THREE.PlaneGeometry(square, square);
  geo.rotateX(-Math.PI / 2);
  const colours = [0xf4f4f4, 0x111111].map((color) => {
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color }), across * 2);
    mesh.count = 0;
    return mesh;
  });
  const m = new THREE.Matrix4();
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < across; col++) {
      const mesh = colours[(row + col) % 2];
      const at = toWorld((row - 0.5) * square, (col - (across - 1) / 2) * square, 0.04);
      mesh.setMatrixAt(mesh.count++, m.compose(at, heading, new THREE.Vector3(1, 1, 1)));
    }
  }
  for (const mesh of colours) {
    mesh.receiveShadow = true;
    scene.add(groundLayer(mesh, LAYER.paint));
  }

  // Gantry: two posts and a beam carrying the banner.
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 });
  const height = 7;
  const span = width + 2;
  const gantry = new THREE.Group();
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, height, 0.4), steel);
    post.position.set(0, height / 2, (side * span) / 2);
    gantry.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, span), steel);
  beam.position.set(0, height, 0);
  gantry.add(beam);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, span * 0.8), bannerMaterials());
  banner.position.set(0, height - 1.1, 0);
  gantry.add(banner);
  gantry.position.copy(toWorld(0, 0, 0));
  gantry.quaternion.copy(heading);
  gantry.traverse((o) => (o.castShadow = true));
  scene.add(gantry);
}

// Green highway-sign banner with text on both faces (blank when there's no DOM, e.g. in tests).
function bannerMaterials() {
  const green = new THREE.MeshStandardMaterial({ color: 0x0b6b3a });
  if (typeof document === 'undefined') return green;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b6b3a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const text = 'HENDAY 500 · START / FINISH';
  let size = 72;
  do ctx.font = `bold ${size--}px system-ui, sans-serif`;
  while (ctx.measureText(text).width > canvas.width - 80);
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const sign = new THREE.MeshStandardMaterial({ map: texture });
  // Box faces: +x, -x, +y, -y, +z, -z. The text goes on the faces looking along the road.
  return [sign, sign, green, green, green, green];
}

