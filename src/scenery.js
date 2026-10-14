import * as THREE from 'three';
import { windowsTexture } from './textures.js';

// Things to look at off the road: trees (thick in the river valley, as in
// real Edmonton), downtown's towers on the north bank in the middle of the
// loop, and the Muttart Conservatory's glass pyramids across the river.
// Purely visual: no collisions, and kept clear of the road.

const TREE_ATTEMPTS = 9000;
const ROAD_CLEARANCE = 38; // metres from any carriageway
const INTERCHANGE_CLEARANCE = 280;

export function buildScenery(scene, track, terrain) {
  if (!terrain) return;
  const road = roadIndex(track);
  addTrees(scene, track, terrain, road);
  const downtown = downtownSpot(terrain);
  addDowntown(scene, terrain, downtown);
  addPyramids(scene, terrain, downtown);
}

// Buckets of road points for quick "how close is the road" checks.
function roadIndex(track) {
  const size = 60;
  const buckets = new Map();
  for (const c of track.carriageways) {
    for (const [x, z] of c.points) {
      const key = `${Math.floor(x / size)},${Math.floor(z / size)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push([x, z]);
    }
  }
  return {
    near(x, z, radius) {
      const bx = Math.floor(x / size);
      const bz = Math.floor(z / size);
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          for (const [px, pz] of buckets.get(`${bx + i},${bz + j}`) ?? []) {
            if ((px - x) ** 2 + (pz - z) ** 2 < radius * radius) return true;
          }
        }
      }
      return false;
    },
  };
}

function addTrees(scene, track, terrain, road) {
  const spots = [];
  const half = terrain.half - 40;
  const nearInterchange = (x, z) =>
    (track.interchanges ?? []).some((i) => Math.hypot(i.x - x, i.z - z) < INTERCHANGE_CLEARANCE);
  for (let k = 0; k < TREE_ATTEMPTS; k++) {
    const x = (Math.random() * 2 - 1) * half;
    const z = (Math.random() * 2 - 1) * half;
    const h = terrain.heightAt(x, z);
    const valley = terrain.valleyHeight(x, z);
    let chance;
    if (valley < -21) chance = 0; // river and its flat floor
    else if (valley < -1) chance = 0.95; // wooded valley slopes
    else if (terrain.loop && insideLoop(terrain, x, z)) chance = 0.06; // city parks
    else chance = Math.abs(((x + 37) % 150) + 150) % 150 < 10 ? 0.5 : 0.015; // shelterbelts
    if (Math.random() > chance) continue;
    if (road.near(x, z, ROAD_CLEARANCE) || nearInterchange(x, z)) continue;
    if (h < valley - 0.5) continue; // in a cutting or the dip by the road
    spots.push({ x, y: h, z, scale: 0.75 + Math.random() * 0.8, spruce: Math.random() < 0.45 });
  }

  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 6);
  trunkGeo.translate(0, 1.5, 0);
  const spruceGeo = new THREE.ConeGeometry(2.4, 9, 7);
  spruceGeo.translate(0, 7, 0);
  const leafyGeo = new THREE.IcosahedronGeometry(3.4, 0);
  leafyGeo.translate(0, 5.8, 0);
  const trunk = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 1 });
  const spruce = new THREE.MeshStandardMaterial({ color: 0x2f5232, roughness: 0.95, flatShading: true });
  const leafy = new THREE.MeshStandardMaterial({ color: 0x55803a, roughness: 0.95, flatShading: true });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunk, spots.length);
  const spruces = new THREE.InstancedMesh(spruceGeo, spruce, spots.filter((s) => s.spruce).length);
  const leafies = new THREE.InstancedMesh(leafyGeo, leafy, spots.filter((s) => !s.spruce).length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const tint = new THREE.Color();
  let ns = 0;
  let nl = 0;
  spots.forEach((s, i) => {
    q.setFromAxisAngle(Y, Math.random() * Math.PI * 2);
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.scale, s.scale, s.scale));
    trunks.setMatrixAt(i, m);
    const crowns = s.spruce ? spruces : leafies;
    const k = s.spruce ? ns++ : nl++;
    crowns.setMatrixAt(k, m);
    // A little colour variation between trees.
    crowns.setColorAt(k, tint.setHSL(s.spruce ? 0.33 : 0.25 + Math.random() * 0.06, 0.35, 0.75 + Math.random() * 0.3));
  });
  for (const mesh of [trunks, spruces, leafies]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

// Downtown sits on the river's north bank near the middle of the loop.
function downtownSpot(terrain) {
  let best = terrain.river[0];
  for (const p of terrain.river) if (Math.hypot(p[0], p[1]) < Math.hypot(best[0], best[1])) best = p;
  const i = terrain.river.indexOf(best);
  const a = terrain.river[Math.max(0, i - 1)];
  const b = terrain.river[Math.min(terrain.river.length - 1, i + 1)];
  let nx = -(b[1] - a[1]);
  let nz = b[0] - a[0];
  const len = Math.hypot(nx, nz) || 1;
  nx /= len;
  nz /= len;
  if (nz > 0) {
    // North is -z.
    nx = -nx;
    nz = -nz;
  }
  return { river: best, north: [nx, nz], centre: [best[0] + nx * 190, best[1] + nz * 190] };
}

function addDowntown(scene, terrain, spot) {
  const windows = windowsTexture();
  // Lit windows glow brighter as the light goes (see Graphics.setTime).
  scene.userData.glowing ??= [];
  const glass = (repeatX, repeatY) => {
    const map = windows?.clone();
    if (map) {
      map.repeat.set(repeatX, repeatY);
      map.needsUpdate = true;
    }
    const material = new THREE.MeshStandardMaterial({
      color: 0xb8c6d4,
      map,
      emissive: 0xffffff,
      emissiveMap: map,
      emissiveIntensity: map ? 0.35 : 0,
      metalness: 0.4,
      roughness: 0.35,
    });
    if (map) scene.userData.glowing.push({ material, day: 0.35, sunset: 0.9 });
    return material;
  };
  const roof = new THREE.MeshStandardMaterial({ color: 0x6d7378, roughness: 0.8 });
  const [cx, cz] = spot.centre;
  const towers = [];
  for (let k = 0; k < 26; k++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 140;
    const x = cx + Math.cos(angle) * r;
    const z = cz + Math.sin(angle) * r;
    if (terrain.valleyHeight(x, z) < -0.5) continue;
    if (towers.some((t) => Math.hypot(t.x - x, t.z - z) < 30)) continue;
    // Taller toward the middle.
    const height = 25 + (1 - r / 140) * 70 + Math.random() * 30;
    towers.push({ x, z, height, w: 16 + Math.random() * 14, d: 16 + Math.random() * 14 });
  }
  // The tallest gets a spire, like the city's newest tower.
  towers.sort((a, b) => b.height - a.height);
  if (towers[0]) towers[0].height += 25;
  towers.forEach((t, i) => {
    const y = terrain.heightAt(t.x, t.z);
    const sides = glass(t.w / 4, t.height / 4);
    const box = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.height, t.d), [sides, sides, roof, roof, sides, sides]);
    box.position.set(t.x, y + t.height / 2, t.z);
    box.rotation.y = 0.12; // Edmonton's downtown grid is a touch off north
    box.castShadow = true;
    scene.add(box);
    if (i === 0) {
      const spire = new THREE.Mesh(new THREE.ConeGeometry(t.w * 0.28, 30, 4), sides);
      spire.position.set(t.x, y + t.height + 15, t.z);
      spire.rotation.y = 0.12 + Math.PI / 4;
      scene.add(spire);
    }
  });
}

// Four glass pyramids on the south bank, across from downtown.
function addPyramids(scene, terrain, spot) {
  const material = new THREE.MeshStandardMaterial({ color: 0x9fc6d8, metalness: 0.5, roughness: 0.12, flatShading: true });
  const [rx, rz] = spot.river;
  const [nx, nz] = spot.north;
  const base = [rx - nx * 150, rz - nz * 150]; // south of the river
  const along = [-nz, nx];
  [
    [-30, 0, 22],
    [0, -26, 22],
    [26, 4, 17],
    [-4, 30, 17],
  ].forEach(([a, b, size]) => {
    const x = base[0] + along[0] * a - nx * b;
    const z = base[1] + along[1] * a - nz * b;
    if (terrain.valleyHeight(x, z) < -0.5) return;
    const pyramid = new THREE.Mesh(new THREE.ConeGeometry(size * 0.75, size, 4), material);
    pyramid.position.set(x, terrain.heightAt(x, z) + size / 2, z);
    pyramid.rotation.y = Math.PI / 4;
    pyramid.castShadow = true;
    scene.add(pyramid);
  });
}

function insideLoop(terrain, x, z) {
  const poly = terrain.loop;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

const Y = new THREE.Vector3(0, 1, 0);
