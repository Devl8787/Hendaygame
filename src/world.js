import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { LANE_WIDTH, poseAt } from './track.js';
import { Terrain } from './terrain.js';

export const LEFT_SHOULDER = 1;
export const RIGHT_SHOULDER = 2.5;
const LINE_WIDTH = 0.15;
const POLE_EVERY = 60; // metres

// Asphalt, paint and potholes lie only centimetres above the ground, closer
// than some GPUs can tell apart by depth. Polygon offset nudges each layer
// toward the camera by whole depth-buffer steps instead, so ground < asphalt
// < paint < decals holds at any depth precision (and on hills and bridges).
export const LAYER = { asphalt: 1, paint: 2, decal: 3 };
export function groundLayer(mesh, level) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of materials) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -level;
    m.polygonOffsetUnits = -level * 2;
    m.depthWrite = level === LAYER.asphalt;
  }
  mesh.renderOrder = level - 4;
  return mesh;
}

// Returns the terrain (with the river line) when the track has a river valley.
export function createWorld(scene, world, track) {
  addLights(scene);
  const terrain = addGround(scene, world, track);
  if (terrain) markBridges(track, terrain);
  track.carriageways.forEach((c) => addCarriageway(scene, c));
  if (terrain) track.carriageways.forEach((c) => addBridgeStructures(scene, world, c, terrain));
  addLightPoles(scene, track);
  if (track.carriageways[0].closed) addStartFinish(scene, track.carriageways[0]);
  return { terrain };
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
  let extent = 0;
  for (const c of track.carriageways) {
    for (const [x, z] of c.points) extent = Math.max(extent, Math.abs(x), Math.abs(z));
  }
  if (track.river) {
    // Roads passing under the Henday get a cutting; the crossing road runs
    // across the Henday (along its right-hand normal).
    const cuttings = (track.interchanges ?? []).filter((i) => !i.over).map((i) => ({ x: i.x, z: i.z, ux: -i.tz, uz: i.tx }));
    // Where the road dips toward the river, the ground is cut down to it.
    const dips = [];
    for (const c of track.carriageways) {
      c.points.forEach(([x, z], i) => {
        if (c.elevation[i] < -0.01) dips.push([x, z, c.elevation[i]]);
      });
    }
    const terrain = new Terrain(track.river, extent, cuttings, dips);
    terrain.build(scene, world);
    return terrain;
  }

  // No river (test strip, or the full-length loop): flat ground with a couple
  // of km to spare.
  const half = extent + 2000;
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2, half * 2),
    new THREE.MeshStandardMaterial({ color: 0x6f8f45, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);
  world.createCollider(RAPIER.ColliderDesc.cuboid(half, 0.5, half).setTranslation(0, -0.5, 0).setFriction(1.0));
  return null;
}

// Flags every road point that crosses the valley as bridge (point[3] = 1),
// plus a run-on at each end so the guardrails start well before the drop.
// (Ground cut just below a dipping road doesn't count; a real drop does.)
function markBridges(track, terrain) {
  const RUN_ON = 20; // points (~60 m)
  for (const c of track.carriageways) {
    const n = c.points.length;
    const over = c.points.map((_, i) => {
      const reach = c.width(i) / 2 + RIGHT_SHOULDER;
      return [-reach, 0, reach].some((offset) => {
        const p = poseAt(c, i, offset);
        return terrain.heightAt(p.x, p.z) < p.y - 1;
      });
    });
    for (let i = 0; i < n; i++) {
      let bridge = false;
      for (let k = -RUN_ON; k <= RUN_ON && !bridge; k++) bridge = over[(i + k + n) % n];
      c.points[i][3] = bridge ? 1 : 0;
    }
  }
}

// Solid road wherever it leaves the ground: on bridges, and along the dip
// down to the river where the ground is cut away beneath it. Bridges also
// get a concrete deck, piers and guardrails you can't drive through.
const DECK_SEGMENT = 3; // points per deck piece (~9 m): short, so straight pieces follow the dip's curve
const PIER_EVERY = 10; // points (~30 m)
const DECK_DEPTH = 1.2;
const DIP_MARGIN = 10; // points (~30 m) the slab runs on past the dip
function addBridgeStructures(scene, world, c, terrain) {
  const n = c.points.length;
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb9b6ad, roughness: 0.9 });
  const left = (i) => -c.width(i) / 2 - LEFT_SHOULDER;
  const right = (i) => c.width(i) / 2 + RIGHT_SHOULDER;
  const fixed = (position, rotation, desc) => {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z).setRotation(rotation),
    );
    world.createCollider(desc, body);
  };

  for (let i = 0; i < n; i += DECK_SEGMENT) {
    const j = Math.min(i + DECK_SEGMENT, c.closed ? n : n - 1) % n;
    const bridge = c.points[i][3] === 1 || c.points[j][3] === 1;
    // The ground is cut a little beyond the last dipping point, so the slab
    // carries on past it too.
    let dipping = false;
    for (let k = i - DIP_MARGIN; k <= i + DECK_SEGMENT + DIP_MARGIN && !dipping; k++) {
      dipping = c.elevation[((k % n) + n) % n] < -0.01;
    }
    if (!bridge && !dipping) continue;
    // A slab from point i to point j, as wide as the road and shoulders,
    // tilted to follow the road up or down.
    const a = poseAt(c, i, (left(i) + right(i)) / 2);
    const b = poseAt(c, j, (left(j) + right(j)) / 2);
    const flat = Math.hypot(b.x - a.x, b.z - a.z);
    const length = Math.hypot(flat, b.y - a.y) + 0.6;
    const rotation = new THREE.Quaternion()
      .setFromAxisAngle(Y_AXIS, Math.atan2(-(b.z - a.z), b.x - a.x))
      .multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, Math.atan2(b.y - a.y, flat)));
    const up = Y_AXIS.clone().applyQuaternion(rotation);
    const across = Z_AXIS.clone().applyQuaternion(rotation);
    const top = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    const centre = top.clone().addScaledVector(up, -DECK_DEPTH / 2);
    const halfWidth = (right(i) - left(i)) / 2;
    fixed(centre, rotation, RAPIER.ColliderDesc.cuboid(length / 2, DECK_DEPTH / 2, halfWidth));
    if (!bridge) continue;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(length, DECK_DEPTH, halfWidth * 2), concrete);
    // Tucked a touch under the asphalt so its top never shows through.
    deck.position.copy(centre).addScaledVector(up, -0.06);
    deck.quaternion.copy(rotation);
    deck.castShadow = deck.receiveShadow = true;
    scene.add(deck);
    // Guardrails along both edges (the visible walls come from addBridgeBarriers).
    // Rounded and overlapping at the joints so a car glances off instead of
    // snagging on a corner where two straight pieces meet on a curve.
    for (const side of [-1, 1]) {
      const rail = top.clone().addScaledVector(across, side * (halfWidth - 0.15)).addScaledVector(up, 0.75);
      fixed(rail, rotation.clone().multiply(LYING_DOWN), RAPIER.ColliderDesc.capsule(length / 2, 0.3));
    }
  }

  // Piers down to the valley floor, wherever the ground has dropped away.
  const pierGeo = new THREE.CylinderGeometry(0.7, 0.8, 1, 12);
  for (let i = 0; i < n; i += PIER_EVERY) {
    if (c.points[i][3] !== 1) continue;
    for (const offset of [left(i) + 2, right(i) - 2]) {
      const p = poseAt(c, i, offset);
      const ground = terrain.heightAt(p.x, p.z);
      const height = p.y - DECK_DEPTH - ground;
      if (height < 2) continue;
      const pier = new THREE.Mesh(pierGeo, concrete);
      pier.scale.y = height;
      pier.position.set(p.x, ground + height / 2, p.z);
      pier.castShadow = true;
      scene.add(pier);
      fixed(pier.position, new THREE.Quaternion(), RAPIER.ColliderDesc.cylinder(height / 2, 0.8));
    }
  }
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
// Turns a capsule (which stands along y) to lie along the road (x).
const LYING_DOWN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);

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
    const h = y + (c.elevation?.[i] ?? 0);
    out.push(x + rx * l, h, z + rz * l, x + rx * r, h, z + rz * r);
  });
}

// A vertical strip (barrier) at one sideways offset.
function wallRibbon(c, offset, height, include) {
  return stripGeometry(c, include, (i, out) => {
    const [x, z] = c.points[i];
    const o = offset(i);
    const px = x - c.tangents[i * 2 + 1] * o;
    const pz = z + c.tangents[i * 2] * o;
    const base = c.elevation?.[i] ?? 0;
    out.push(px, base, pz, px, base + height, pz);
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

// Light poles, kept clear of the interchanges (ramps and embankments).
function addLightPoles(scene, track) {
  const nearInterchange = (p) => (track.interchanges ?? []).some((i) => Math.hypot(i.x - p.x, i.z - p.z) < 230);
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.15, 10, 8);
  poleGeo.translate(0, 5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.6, roughness: 0.4 });
  const spots = [];
  for (const c of track.carriageways) {
    let next = 0;
    for (let i = 0; i < c.points.length; i++) {
      if (c.distance[i] < next) continue;
      const spot = poseAt(c, i, c.width(i) / 2 + RIGHT_SHOULDER + 2);
      // Not out over a bridge's edge (they'd float), nor among the ramps.
      if (c.points[i][3] !== 1 && !nearInterchange(spot)) spots.push(spot);
      next = c.distance[i] + POLE_EVERY;
    }
  }
  const poles = new THREE.InstancedMesh(poleGeo, mat, spots.length);
  poles.castShadow = true;
  const m = new THREE.Matrix4();
  spots.forEach((p, i) => poles.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
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

