import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { grassTexture } from './textures.js';

// The North Saskatchewan river valley: one winding valley that enters the
// loop at the south-west river crossing and leaves at the north-east one,
// with flat prairie everywhere else (the Henday is a flat road). The same
// height function drives the visible ground and the physics heightfield.

const VALLEY_DEPTH = 24; // metres below the road
const VALLEY_HALF_WIDTH = 95; // centre to top of the valley wall
const FLOOR_HALF_WIDTH = 24; // flat valley floor either side of the river
const WATER_HALF_WIDTH = 16;
const RIVER_OUTSIDE = 900; // how far the river runs on past the loop
const CELL = 6; // terrain grid spacing, metres
const MARGIN = 700; // terrain detail beyond the track, metres
const EDGE_FADE = 300; // the valley flattens out over the last stretch before the edge
const GRASS_TILE = 9; // metres per repeat of the grass detail texture
const GRASS = new THREE.Color(0x6f8f45);
const LAWN = new THREE.Color(0x7a9a4a);
const PARK = new THREE.Color(0x5f8340);
const SUBURB_GREY = new THREE.Color(0x8d8f86);
const FIELDS = [0xc9b32e, 0xb9a46a, 0x7f9a4e, 0x8b7d55, 0x9fae55, 0xd2bf4a].map((c) => new THREE.Color(c));
const DIP_CUT_HALF = 10; // ground stays just under the road this far from its centre line
const DIP_CUT_BELOW = 0.4; // ...this far under it
const DIP_CUT_SLOPE = 1.5; // then slopes back up, horizontal metres per metre

export class Terrain {
  // crossings: [{ x, z, tx, tz }] where the river crosses the loop (centre
  // line point and road direction). extent: half-size of the track in metres.
  // cuttings: [{ x, z, ux, uz }] where a road dips under the Henday (centre
  // point and the crossing road's direction).
  // dips: [[x, z, y], ...] road points below ground level (the dip toward
  // the river); the ground is cut down to just under them.
  constructor(crossings, extent, cuttings = [], dips = []) {
    this.river = riverLine(crossings);
    this.cuttings = cuttings;
    this.half = Math.ceil((extent + MARGIN) / CELL) * CELL;
    this.buckets = bucketSegments(this.river, VALLEY_HALF_WIDTH + 10);
    this.dips = bucketPoints(dips, DIP_CUT_HALF + DIP_CUT_SLOPE * 8);
  }

  // Ground height at (x, z): 0 on the prairie, lower in the river valley and
  // in the cuttings that take crossing roads under the Henday.
  heightAt(x, z) {
    if (Math.abs(x) > this.half || Math.abs(z) > this.half) return 0;
    let h = this.valleyHeight(x, z);
    for (const c of this.cuttings) h = Math.min(h, cuttingHeight(c, x, z));
    return Math.min(h, this.dipCut(x, z));
  }

  // Ground under a dipping road: just below it across the road, then
  // sloping back up to the surrounding ground.
  dipCut(x, z) {
    const near = this.dips.get(bucketKey(x, z));
    if (!near) return 0;
    let cut = 0;
    for (const [px, pz, py] of near) {
      const d = Math.hypot(x - px, z - pz);
      cut = Math.min(cut, py - DIP_CUT_BELOW + Math.max(0, d - DIP_CUT_HALF) / DIP_CUT_SLOPE);
    }
    return cut;
  }

  valleyHeight(x, z) {
    const d = this.distanceToRiver(x, z);
    if (d >= VALLEY_HALF_WIDTH) return 0;
    const t = THREE.MathUtils.clamp((d - FLOOR_HALF_WIDTH) / (VALLEY_HALF_WIDTH - FLOOR_HALF_WIDTH), 0, 1);
    // Smooth valley walls with a little natural unevenness.
    const wobble = Math.sin(x * 0.031) * Math.cos(z * 0.027) * 2.5 * Math.sin(Math.PI * t);
    // Fade out toward the edge of the detailed terrain so it meets the flat
    // outskirts without a gap.
    const edge = THREE.MathUtils.clamp((this.half - Math.max(Math.abs(x), Math.abs(z))) / EDGE_FADE, 0, 1);
    return Math.min(0, (-VALLEY_DEPTH * (1 - t * t * (3 - 2 * t)) + wobble) * edge);
  }

  // Inside the Henday is the city; outside is farmland. `loop` is the road's
  // outline (a few dozen points is plenty).
  setLand(loop) {
    this.loop = loop;
  }

  landColour(x, z) {
    if (!this.loop) return GRASS;
    let nearRoad = Infinity;
    for (const [px, pz] of this.loop) nearRoad = Math.min(nearRoad, (px - x) ** 2 + (pz - z) ** 2);
    nearRoad = Math.sqrt(nearRoad);
    // Mown verges either side of the road.
    if (nearRoad < 70) return GRASS;
    const blend = Math.min(1, (nearRoad - 70) / 60);
    if (insidePolygon(this.loop, x, z)) {
      // Suburbs: lawns, parks and the odd paved block, softly varied.
      const k = hash(Math.floor(x / 70), Math.floor(z / 70));
      const target = k < 0.15 ? SUBURB_GREY : k < 0.55 ? LAWN : PARK;
      return GRASS.clone().lerp(target, blend * 0.8);
    }
    // Farm fields: a patchwork of canola, wheat, pasture and fallow.
    const fx = Math.floor((x + 37) / 150);
    const fz = Math.floor((z - 53) / 110);
    return GRASS.clone().lerp(FIELDS[Math.floor(hash(fx, fz) * FIELDS.length)], blend);
  }

  distanceToRiver(x, z) {
    const bucket = this.buckets.get(bucketKey(x, z));
    if (!bucket) return Infinity;
    let best = Infinity;
    for (const [ax, az, bx, bz] of bucket) {
      const dx = bx - ax;
      const dz = bz - az;
      const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return best;
  }

  // Visible ground, physics heightfield, and the river itself.
  build(scene, world) {
    const n = (this.half * 2) / CELL; // cells per side
    const heights = new Float32Array((n + 1) * (n + 1));
    const geo = new THREE.PlaneGeometry(this.half * 2, this.half * 2, n, n);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colours = new Float32Array(pos.count * 3);
    const slope = new THREE.Color(0x5d7a3a);
    const mud = new THREE.Color(0x7d6a4a);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.heightAt(x, z);
      const grass = this.landColour(x, z);
      pos.setY(i, h);
      // Plane vertices run row by row from -z to +z; the heightfield wants
      // column-major with rows along z and columns along x.
      const row = Math.round((z + this.half) / CELL);
      const col = Math.round((x + this.half) / CELL);
      heights[col * (n + 1) + row] = h;
      const depth = -h / VALLEY_DEPTH;
      if (depth < 0.02) c.copy(grass);
      else if (depth < 0.85) c.copy(grass).lerp(slope, Math.min(1, depth * 3));
      else c.copy(slope).lerp(mud, (depth - 0.85) / 0.15);
      colours.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(
      geo,
      // Pushed back a touch in depth so the road painted at y≈0 always wins.
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: tiled(grassTexture(), (this.half * 2) / GRASS_TILE),
        roughness: 0.95,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    ground.receiveShadow = true;
    scene.add(ground);
    world.createCollider(
      RAPIER.ColliderDesc.heightfield(n, n, heights, { x: this.half * 2, y: 1, z: this.half * 2 }).setFriction(1),
    );

    this.addOutskirts(scene, world);
    this.addWater(scene);
  }

  // Flat prairie beyond the detailed terrain: four strips framing it.
  addOutskirts(scene, world) {
    const far = this.half + 4000;
    const width = far - this.half;
    const material = new THREE.MeshStandardMaterial({
      color: 0x8a9a52, // the farm fields, blurred together at this distance
      map: tiled(grassTexture(), 200),
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const strips = [
      [0, -(this.half + width / 2), far * 2, width],
      [0, this.half + width / 2, far * 2, width],
      [-(this.half + width / 2), 0, width, this.half * 2],
      [this.half + width / 2, 0, width, this.half * 2],
    ];
    for (const [x, z, w, d] of strips) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0, z);
      mesh.receiveShadow = true;
      scene.add(mesh);
      world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, 0.5, d / 2).setTranslation(x, -0.5, z).setFriction(1));
    }
  }

  addWater(scene) {
    const positions = [];
    const line = this.river;
    for (let i = 0; i < line.length; i++) {
      const a = line[Math.max(0, i - 1)];
      const b = line[Math.min(line.length - 1, i + 1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / len;
      const nz = (b[0] - a[0]) / len;
      const [x, z] = line[i];
      const y = -VALLEY_DEPTH + 1.2;
      positions.push(x + nx * WATER_HALF_WIDTH, y, z + nz * WATER_HALF_WIDTH, x - nx * WATER_HALF_WIDTH, y, z - nz * WATER_HALF_WIDTH);
    }
    const indices = [];
    for (let i = 0; i < line.length - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const water = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x4f6f7a, roughness: 0.25, metalness: 0.2, side: THREE.DoubleSide }),
    );
    scene.add(water);
  }
}

// A cutting for a road passing under the Henday: a flat-bottomed trench
// CUTTING_DEPTH deep where it crosses, sloping back up to ground level.
export const CUTTING_DEPTH = 7.5;
export const CUTTING_FLAT = 32; // metres either side of the Henday at full depth
export const CUTTING_REACH = 140; // back at ground level this far out
const CUTTING_FLOOR = 13; // half-width of the flat bottom (road plus verges)
const CUTTING_SLOPE = 1.5; // horizontal metres per metre of depth on the side walls

// How deep the cutting's road is, `u` metres along the crossing road.
export function cuttingDepth(u) {
  const t = THREE.MathUtils.clamp((Math.abs(u) - CUTTING_FLAT) / (CUTTING_REACH - CUTTING_FLAT), 0, 1);
  return CUTTING_DEPTH * (1 - t * t * (3 - 2 * t));
}

function cuttingHeight({ x: cx, z: cz, ux, uz }, x, z) {
  const dx = x - cx;
  const dz = z - cz;
  const u = dx * ux + dz * uz; // along the crossing road
  const w = Math.abs(-dx * uz + dz * ux); // across it
  if (Math.abs(u) > CUTTING_REACH || w > CUTTING_FLOOR + CUTTING_SLOPE * CUTTING_DEPTH) return 0;
  const depth = cuttingDepth(u);
  return Math.min(0, -depth + Math.max(0, w - CUTTING_FLOOR) / CUTTING_SLOPE);
}

// A smooth river line: in at the south-west crossing (square to the road),
// a lazy bend through the middle of the loop, and out at the north-east.
function riverLine(crossings) {
  const [west, east] = crossings;
  // Unit normal at a crossing, pointing into the loop (toward the origin).
  const inward = ({ x, z, tx, tz }) => {
    let nx = -tz;
    let nz = tx;
    if (nx * -x + nz * -z < 0) {
      nx = -nx;
      nz = -nz;
    }
    return [nx, nz];
  };
  const [wx, wz] = inward(west);
  const [ex, ez] = inward(east);
  const at = (c, n, d) => new THREE.Vector3(c.x + n[0] * d, 0, c.z + n[1] * d);
  const a = at(west, [wx, wz], 250);
  const b = at(east, [ex, ez], 250);
  const across = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize().multiplyScalar(80);
  const controls = [
    at(west, [wx, wz], -RIVER_OUTSIDE),
    at(west, [wx, wz], -150),
    at(west, [wx, wz], 0),
    at(west, [wx, wz], 150),
    a.clone().lerp(b, 1 / 3).add(across),
    a.clone().lerp(b, 2 / 3).sub(across),
    at(east, [ex, ez], 150),
    at(east, [ex, ez], 0),
    at(east, [ex, ez], -150),
    at(east, [ex, ez], -RIVER_OUTSIDE),
  ];
  const curve = new THREE.CatmullRomCurve3(controls, false, 'centripetal');
  return curve.getSpacedPoints(Math.ceil(curve.getLength() / 8)).map((p) => [p.x, p.z]);
}

// Spatial buckets of river segments so height lookups only check nearby ones.
const BUCKET = 100;
const bucketKey = (x, z) => `${Math.floor(x / BUCKET)},${Math.floor(z / BUCKET)}`;

function bucketPoints(points, pad) {
  const buckets = new Map();
  for (const p of points) {
    const x0 = Math.floor((p[0] - pad) / BUCKET);
    const x1 = Math.floor((p[0] + pad) / BUCKET);
    const z0 = Math.floor((p[1] - pad) / BUCKET);
    const z1 = Math.floor((p[1] + pad) / BUCKET);
    for (let bx = x0; bx <= x1; bx++) {
      for (let bz = z0; bz <= z1; bz++) {
        const key = `${bx},${bz}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(p);
      }
    }
  }
  return buckets;
}

function bucketSegments(line, pad) {
  const buckets = new Map();
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const x0 = Math.floor((Math.min(ax, bx) - pad) / BUCKET);
    const x1 = Math.floor((Math.max(ax, bx) + pad) / BUCKET);
    const z0 = Math.floor((Math.min(az, bz) - pad) / BUCKET);
    const z1 = Math.floor((Math.max(az, bz) + pad) / BUCKET);
    for (let bxi = x0; bxi <= x1; bxi++) {
      for (let bzi = z0; bzi <= z1; bzi++) {
        const key = `${bxi},${bzi}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push([ax, az, bx, bz]);
      }
    }
  }
  return buckets;
}

function tiled(texture, repeat) {
  if (!texture) return null;
  const t = texture.clone();
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  return t;
}

// Ray-casting point-in-polygon test.
function insidePolygon(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Stable pseudo-random number in [0, 1) for a grid cell.
function hash(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
