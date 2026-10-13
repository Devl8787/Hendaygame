import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// A straight 2 km test strip shaped like a stretch of the Henday:
// two lanes each way, divided by a grass median. Cars drive on the right,
// so "our" carriageway is on +x and we head toward -z.
export const LANE_WIDTH = 3.7;
export const ROAD_START_Z = 50;
export const ROAD_END_Z = -2000;
const ROAD_LENGTH = ROAD_START_Z - ROAD_END_Z;
const ROAD_MID_Z = (ROAD_START_Z + ROAD_END_Z) / 2;
const MEDIAN_WIDTH = 14;
const SHOULDER = 2.5;

// Centre x of each carriageway.
export const NORTHBOUND_X = LANE_WIDTH;
const ONCOMING_X = -(MEDIAN_WIDTH + LANE_WIDTH);

// Spawn point: right-hand lane of our carriageway.
export const SPAWN = { x: NORTHBOUND_X + LANE_WIDTH / 2, y: 1.2, z: 0 };

export function createWorld(scene, world) {
  addLights(scene);
  addGround(scene, world);
  addCarriageway(scene, NORTHBOUND_X);
  addCarriageway(scene, ONCOMING_X);
  addLightPoles(scene);
  return { cones: addCones(scene, world) };
}

function addLights(scene) {
  scene.background = new THREE.Color(0x9fc4e8);
  scene.fog = new THREE.Fog(0x9fc4e8, 150, 900);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x5a6b3a, 1.2));

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(60, 120, 40);
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

function addGround(scene, world) {
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshStandardMaterial({ color: 0x6f8f45 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);

  // One big flat collider for everything. Real terrain comes later with the OSM import.
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0).setFriction(1.0),
  );
}

function addCarriageway(scene, centerX) {
  const width = LANE_WIDTH * 2 + SHOULDER * 2;
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(width, ROAD_LENGTH),
    new THREE.MeshStandardMaterial({ color: 0x3b3d40, roughness: 0.95 }),
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set(centerX, 0.01, ROAD_MID_Z);
  asphalt.receiveShadow = true;
  scene.add(asphalt);

  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c230 });

  // Solid edge lines: yellow on the median side, white on the outside.
  const edgeGeo = new THREE.PlaneGeometry(0.15, ROAD_LENGTH);
  const medianSide = centerX > 0 ? -1 : 1;
  for (const [side, mat] of [[medianSide, yellow], [-medianSide, white]]) {
    const line = new THREE.Mesh(edgeGeo, mat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(centerX + side * LANE_WIDTH, 0.02, ROAD_MID_Z);
    scene.add(line);
  }

  // Dashed centre line: 3 m dash, 9 m gap.
  const dashGeo = new THREE.PlaneGeometry(0.15, 3);
  dashGeo.rotateX(-Math.PI / 2);
  const count = Math.floor(ROAD_LENGTH / 12);
  const dashes = new THREE.InstancedMesh(dashGeo, white, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    m.makeTranslation(centerX, 0.02, ROAD_START_Z - i * 12);
    dashes.setMatrixAt(i, m);
  }
  scene.add(dashes);
}

function addLightPoles(scene) {
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.15, 10, 8);
  poleGeo.translate(0, 5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.6, roughness: 0.4 });
  const count = Math.floor(ROAD_LENGTH / 60);
  const poles = new THREE.InstancedMesh(poleGeo, mat, count * 2);
  poles.castShadow = true;
  const m = new THREE.Matrix4();
  const medianCentre = -MEDIAN_WIDTH / 2;
  for (let i = 0; i < count; i++) {
    const z = ROAD_START_Z - i * 60;
    m.makeTranslation(medianCentre, 0, z);
    poles.setMatrixAt(i * 2, m);
    m.makeTranslation(NORTHBOUND_X + LANE_WIDTH + SHOULDER + 2, 0, z);
    poles.setMatrixAt(i * 2 + 1, m);
  }
  scene.add(poles);
}

// Construction cones you can knock over: the first taste of Henday road work.
function addCones(scene, world) {
  const geo = new THREE.ConeGeometry(0.2, 0.7, 12);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff6a00 });
  const cones = [];
  for (let i = 0; i < 12; i++) {
    const x = NORTHBOUND_X + LANE_WIDTH / 2 - i * 0.3;
    const z = -150 - i * 6;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.35, z),
    );
    world.createCollider(RAPIER.ColliderDesc.cone(0.35, 0.2).setDensity(40), body);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    scene.add(mesh);
    cones.push({ body, mesh });
  }
  return cones;
}

export function syncBodies(items) {
  for (const { body, mesh } of items) {
    mesh.position.copy(body.translation());
    mesh.quaternion.copy(body.rotation());
  }
}
