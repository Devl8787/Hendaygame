// Loads the track made by `npm run fetch-henday`, or falls back to a
// straight test strip when it hasn't been downloaded yet.
//
// A track has one or two carriageways (one per direction). Each is a list of
// centreline points [x, z, lanes, bridge] in metres: x = east, z = south.

export const LANE_WIDTH = 3.7;

export async function loadTrack() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}henday-track.json`);
    // Vite's dev server answers missing files with index.html, so check the type too.
    if (res.ok && res.headers.get('content-type')?.includes('json')) {
      return prepare(await res.json(), false);
    }
  } catch {
    // Fall through to the test strip.
  }
  return prepare(testStrip(), true);
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
