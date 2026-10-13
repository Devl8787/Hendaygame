// Loads the track made by `npm run fetch-henday`, or falls back to a
// straight test strip when it hasn't been downloaded yet.
//
// A track has one or two carriageways (one per direction). Each is a list of
// centreline points [x, z, lanes, bridge] in metres: x = east, z = south.

export const LANE_WIDTH = 3.7;

// The real Henday is ~78 km: a 47-minute lap. Racing on it, we shrink the loop
// (keeping its shape) so a lap at up to 200 km/h takes about a minute and a half.
// Lanes stay full size. Add ?full to the URL to drive the real-length loop.
const RACE_LAP_LENGTH = 4000; // metres
const RACE_LANES = 3;
const MEDIAN_WIDTH = 12;
const SPACING = 3;

// The track ships with the game (built by `npm run fetch-henday`).
const TRACK_URL = `${import.meta.env?.BASE_URL ?? '/'}track/henday.json`;

export async function loadTrack() {
  try {
    const res = await fetch(TRACK_URL);
    // Vite's dev server answers missing files with index.html, so check the type too.
    if (res.ok && res.headers.get('content-type')?.includes('json')) {
      const track = await res.json();
      const full = new URLSearchParams(window.location.search).has('full');
      return prepare(full ? { ...track, interchanges: [] } : compress(track, RACE_LAP_LENGTH), false);
    }
  } catch {
    // Fall through to the test strip.
  }
  return prepare(testStrip(), true);
}

// Scales the clockwise carriageway down to `lapLength` and rebuilds both
// directions either side of it as a divided highway.
function compress(track, lapLength) {
  const source = track.carriageways[0];
  if (!source.closed) return track;

  let pts = source.points.map(([x, z]) => [x, z]);
  const scale = lapLength / loopLength(pts);
  const [cx, cz] = centroid(pts);
  pts = pts.map(([x, z]) => [(x - cx) * scale, (z - cz) * scale]);
  // Shrinking turns gentle real-world wiggles into kinks; resample and smooth them out.
  const centre = smoothLoop(resampleLoop(pts, SPACING), 12);

  const half = (RACE_LANES * LANE_WIDTH) / 2;
  const offset = MEDIAN_WIDTH / 2 + half;
  const along = offsetLoop(centre, offset);
  const against = offsetLoop(centre, -offset).reverse();
  const toPoints = (line) => line.map(([x, z]) => [x, z, RACE_LANES, 0]);
  const river = riverCrossings(source, centre);

  return {
    ...track,
    carriageways: [
      { name: 'Clockwise', closed: true, length: Math.round(loopLength(along)), points: toPoints(along) },
      { name: 'Counter-clockwise', closed: true, length: Math.round(loopLength(against)), points: toPoints(against) },
    ],
    river,
    interchanges: pickInterchanges(track.interchanges ?? [], centre, river),
  };
}

// The shrunk loop only has room for a handful of the Henday's ~35
// interchanges: the famous ones first, spaced out so their ramps don't
// overlap, and clear of the start line and the river bridges.
const FAMOUS = ['Whitemud', 'Yellowhead', 'Gateway', 'Stony Plain', 'St. Albert', 'Manning', 'Sherwood Park', 'Baseline'];
const INTERCHANGE_SPACING = 320; // metres between interchanges on the shrunk loop
const CLEAR_OF_START = 300;
const CLEAR_OF_RIVER = 180;
function pickInterchanges(all, centre, river) {
  const n = centre.length;
  const length = n * SPACING;
  const fame = (name) => {
    const i = FAMOUS.findIndex((f) => name.includes(f));
    return i < 0 ? FAMOUS.length : i;
  };
  const candidates = [...all].sort((a, b) => fame(a.name) - fame(b.name) || b.rank - a.rank);
  const loopGap = (a, b) => {
    const d = Math.abs(a - b) % length;
    return Math.min(d, length - d);
  };
  const picked = [];
  for (const c of candidates) {
    const at = c.fraction * length;
    const [x, z] = centre[Math.round(at / SPACING) % n];
    if (loopGap(at, 0) < CLEAR_OF_START) continue;
    if (river.some((r) => Math.hypot(r.x - x, r.z - z) < CLEAR_OF_RIVER)) continue;
    if (picked.some((p) => loopGap(p.at, at) < INTERCHANGE_SPACING)) continue;
    picked.push({ ...c, at });
  }
  return picked.map((c) => {
    const i = Math.round(c.at / SPACING) % n;
    const prev = centre[(i - 1 + n) % n];
    const next = centre[(i + 1) % n];
    const len = Math.hypot(next[0] - prev[0], next[1] - prev[1]) || 1;
    return { name: c.name, over: c.over, x: centre[i][0], z: centre[i][1], tx: (next[0] - prev[0]) / len, tz: (next[1] - prev[1]) / len };
  });
}

// Where the North Saskatchewan crosses the loop, on the shrunk centre line.
// The river bridges are the longest bridge on each side (west / east) of the
// real loop; without bridge data we fall back to the south-west and north-east.
function riverCrossings(source, centre) {
  const pts = source.points;
  const n = pts.length;
  const along = [0];
  for (let i = 1; i < n; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = along[n - 1];
  const [cx] = centroid(pts);

  const runs = [];
  for (let i = 0, start = -1; i <= n; i++) {
    const bridge = i < n && pts[i][3] === 1;
    if (bridge && start < 0) start = i;
    if (!bridge && start >= 0) {
      runs.push({ length: along[i - 1] - along[start], mid: Math.floor((start + i - 1) / 2) });
      start = -1;
    }
  }
  const longest = (west) =>
    runs
      .filter((r) => r.length > 200 && pts[r.mid][0] < cx === west)
      .sort((a, b) => b.length - a.length)[0];

  // Compass angles (0 = east, 90 = north) for the fallback.
  const fallback = { true: -135, false: 45 };
  return [true, false].map((west) => {
    const run = longest(west);
    let i;
    if (run) {
      i = Math.round((along[run.mid] / total) * centre.length) % centre.length;
    } else {
      const want = (fallback[west] * Math.PI) / 180;
      let best = Infinity;
      centre.forEach(([x, z], k) => {
        const diff = Math.abs(Math.atan2(Math.sin(Math.atan2(-z, x) - want), Math.cos(Math.atan2(-z, x) - want)));
        if (diff < best) {
          best = diff;
          i = k;
        }
      });
    }
    const prev = centre[(i - 1 + centre.length) % centre.length];
    const next = centre[(i + 1) % centre.length];
    const len = Math.hypot(next[0] - prev[0], next[1] - prev[1]) || 1;
    return { x: centre[i][0], z: centre[i][1], tx: (next[0] - prev[0]) / len, tz: (next[1] - prev[1]) / len };
  });
}

function loopLength(pts) {
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

function centroid(pts) {
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0];
    z += p[1];
  }
  return [x / pts.length, z / pts.length];
}

function resampleLoop(pts, spacing) {
  const out = [];
  let carry = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = carry;
    while (t < len) {
      out.push([a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len]);
      t += spacing;
    }
    carry = t - len;
  }
  return out;
}

function smoothLoop(pts, radius) {
  const n = pts.length;
  return pts.map((_, i) => {
    let x = 0;
    let z = 0;
    for (let k = -radius; k <= radius; k++) {
      const p = pts[(i + k + n) % n];
      x += p[0];
      z += p[1];
    }
    return [x / (2 * radius + 1), z / (2 * radius + 1)];
  });
}

// Shifts a loop sideways: positive = to the right of the direction of travel.
function offsetLoop(pts, offset) {
  const n = pts.length;
  return pts.map(([x, z], i) => {
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const dx = next[0] - prev[0];
    const dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    return [x - (dz / len) * offset, z + (dx / len) * offset];
  });
}

function testStrip() {
  const line = (x, z0, z1) => {
    const pts = [];
    const step = z1 > z0 ? 3 : -3;
    for (let z = z0; step > 0 ? z <= z1 : z >= z1; z += step) pts.push([x, z, 2, 0]);
    return pts;
  };
  return {
    name: 'Test strip',
    attribution: '',
    carriageways: [
      { name: 'Northbound', closed: false, points: line(LANE_WIDTH, 50, -2000) },
      { name: 'Southbound', closed: false, points: line(-17.7, -2000, 50) },
    ],
  };
}

// Precompute per-point direction and distance along the road.
function prepare(track, isTestStrip) {
  for (const c of track.carriageways) {
    const pts = c.points;
    const n = pts.length;
    c.tangents = new Float32Array(n * 2);
    c.distance = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const prev = pts[c.closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const next = pts[c.closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const dx = next[0] - prev[0];
      const dz = next[1] - prev[1];
      const len = Math.hypot(dx, dz) || 1;
      c.tangents[i * 2] = dx / len;
      c.tangents[i * 2 + 1] = dz / len;
      if (i > 0) c.distance[i] = c.distance[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    c.widths = taperedWidths(pts, c.closed);
    c.width = (i) => c.widths[i];
    const [lx, lz] = pts[n - 1];
    c.totalLength = c.distance[n - 1] + (c.closed ? Math.hypot(pts[0][0] - lx, pts[0][1] - lz) : 0);
  }
  track.isTestStrip = isTestStrip;
  return track;
}

// Road width at each point, eased over ~60 m where the lane count changes
// so lanes taper in and out instead of jumping sideways.
function taperedWidths(pts, closed, radius = 10) {
  const n = pts.length;
  const widths = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let k = -radius; k <= radius; k++) {
      let j = i + k;
      if (closed) j = (j + n) % n;
      else if (j < 0 || j >= n) continue;
      sum += pts[j][2] * LANE_WIDTH;
      count++;
    }
    widths[i] = sum / count;
  }
  return widths;
}

// Position and heading at point i, shifted sideways by `offset` metres
// (positive = toward the right-hand shoulder).
export function poseAt(carriageway, i, offset = 0) {
  const [x, z] = carriageway.points[i];
  const tx = carriageway.tangents[i * 2];
  const tz = carriageway.tangents[i * 2 + 1];
  // Facing (tx, tz), the right-hand side is (-tz, tx).
  return {
    x: x - tz * offset,
    z: z + tx * offset,
    // Rotation about y that turns the car's local +x onto the tangent.
    heading: Math.atan2(-tz, tx),
  };
}

// Pose at `distance` metres along a closed carriageway (wrapping around),
// smoothly between points, shifted sideways by `offset`.
export function sampleAt(c, distance, offset = 0) {
  const n = c.points.length;
  const d = ((distance % c.totalLength) + c.totalLength) % c.totalLength;
  // Binary search for the last point at or before d.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c.distance[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  const i = lo;
  const j = (i + 1) % n;
  const segment = (j === 0 ? c.totalLength : c.distance[j]) - c.distance[i];
  const f = segment > 0 ? (d - c.distance[i]) / segment : 0;
  const lerp = (a, b) => a + (b - a) * f;
  let tx = lerp(c.tangents[i * 2], c.tangents[j * 2]);
  let tz = lerp(c.tangents[i * 2 + 1], c.tangents[j * 2 + 1]);
  const len = Math.hypot(tx, tz) || 1;
  tx /= len;
  tz /= len;
  return {
    x: lerp(c.points[i][0], c.points[j][0]) - tz * offset,
    z: lerp(c.points[i][1], c.points[j][1]) + tx * offset,
    heading: Math.atan2(-tz, tx),
    index: i,
  };
}

// Sideways offset of the centre of lane `lane` (0 = left/median lane).
export function laneOffset(c, i, lane) {
  return -c.width(i) / 2 + (lane + 0.5) * LANE_WIDTH;
}

// Pose in the right-hand lane of the carriageway closest to (x, z).
export function nearestLanePose(track, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const c of track.carriageways) {
    for (let i = 0; i < c.points.length; i++) {
      const d = (c.points[i][0] - x) ** 2 + (c.points[i][1] - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { c, i };
      }
    }
  }
  return poseAt(best.c, best.i, rightLaneOffset(best.c, best.i));
}

export function rightLaneOffset(carriageway, i) {
  return carriageway.width(i) / 2 - LANE_WIDTH / 2;
}
