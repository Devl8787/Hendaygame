// Turns raw OpenStreetMap ways for the Henday into a game track:
// each carriageway (one per direction) becomes one ordered loop of points
// in metres, resampled every few metres.

const EARTH_RADIUS = 6371000;
const SAMPLE_SPACING = 3; // metres between track points
const GAP_BRIDGE = 150; // join ways whose ends are this close (OSM gaps)
const MIN_CARRIAGEWAY = 5000; // ignore chains shorter than this (ramps, C-D lanes)

export function osmToTrack(osm) {
  const ways = osm.elements.filter((e) => e.type === 'way' && e.geometry?.length > 1);
  if (ways.length === 0) throw new Error('No Henday ways found in the OSM data.');

  const origin = centreOf(ways);
  const project = makeProjection(origin);
  const segs = ways.map((w) => ({
    id: w.id,
    nodes: w.nodes,
    pts: w.geometry.map(project),
    lanes: parseInt(w.tags?.lanes, 10) || 2,
    bridge: w.tags?.bridge === 'yes',
  }));
  for (const s of segs) s.length = polylineLength(s.pts);

  const chains = chainWays(segs)
    .filter((c) => c.length >= MIN_CARRIAGEWAY)
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);
  if (chains.length === 0) throw new Error('Could not stitch the OSM ways into a road.');

  const carriageways = chains.map((chain) => {
    const samples = resample(chain, SAMPLE_SPACING);
    smooth(samples, chain.closed);
    const clockwise = signedArea(samples) < 0;
    return {
      name: clockwise ? 'Clockwise' : 'Counter-clockwise',
      closed: chain.closed,
      length: Math.round(polylineLength(samples.map((s) => s.p))),
      // [x, z, lanes, bridge] per point; x = east, z = south (Three.js ground plane).
      points: samples.map((s) => [round(s.p[0]), round(s.p[1]), s.lanes, s.bridge ? 1 : 0]),
    };
  });
  // Clockwise first so the game spawns there by default.
  carriageways.sort((a, b) => (a.name === 'Clockwise' ? -1 : 1) - (b.name === 'Clockwise' ? -1 : 1));

  return {
    name: 'Anthony Henday Drive',
    attribution: '© OpenStreetMap contributors (ODbL)',
    generated: new Date().toISOString(),
    origin,
    carriageways,
  };
}

function centreOf(ways) {
  let lat = 0;
  let lon = 0;
  let n = 0;
  for (const w of ways) {
    for (const g of w.geometry) {
      lat += g.lat;
      lon += g.lon;
      n++;
    }
  }
  return { lat: lat / n, lon: lon / n };
}

// Flat-earth projection around the origin: plenty accurate across one city.
function makeProjection({ lat, lon }) {
  const k = (Math.PI / 180) * EARTH_RADIUS;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  return (g) => [(g.lon - lon) * k * cosLat, -(g.lat - lat) * k];
}

// Follow one-way ways end-to-start until we come back around (or run out).
function chainWays(segs) {
  const byStartNode = new Map();
  for (const s of segs) {
    const first = s.nodes[0];
    if (!byStartNode.has(first)) byStartNode.set(first, []);
    byStartNode.get(first).push(s);
  }

  const used = new Set();
  const chains = [];
  const remaining = [...segs].sort((a, b) => b.length - a.length);
  for (const start of remaining) {
    if (used.has(start)) continue;
    const parts = [start];
    used.add(start);
    let closed = false;
    for (;;) {
      const cur = parts[parts.length - 1];
      const endNode = cur.nodes[cur.nodes.length - 1];
      if (endNode === start.nodes[0]) {
        closed = true;
        break;
      }
      const dir = endDirection(cur.pts);
      let next = pickStraightest(byStartNode.get(endNode)?.filter((s) => !used.has(s)) ?? [], dir);
      if (!next) next = bridgeGap(cur, segs, used, dir);
      if (!next) {
        // A gap back to our own start also closes the loop.
        closed = dist(cur.pts[cur.pts.length - 1], start.pts[0]) < GAP_BRIDGE;
        break;
      }
      parts.push(next);
      used.add(next);
    }
    chains.push({ parts, closed, length: parts.reduce((sum, p) => sum + p.length, 0) });
  }
  return chains;
}

function pickStraightest(candidates, dir) {
  let best = null;
  let bestDot = -Infinity;
  for (const c of candidates) {
    const d = dot(dir, startDirection(c.pts));
    if (d > bestDot) {
      best = c;
      bestDot = d;
    }
  }
  return best;
}

function bridgeGap(cur, segs, used, dir) {
  const end = cur.pts[cur.pts.length - 1];
  let best = null;
  let bestDist = GAP_BRIDGE;
  for (const s of segs) {
    if (used.has(s)) continue;
    const d = dist(end, s.pts[0]);
    if (d < bestDist && dot(dir, startDirection(s.pts)) > 0.5) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

// Walk the chain and drop a point every `spacing` metres. Gaps between ways
// (and the closing gap of a loop) get filled in with straight road.
function resample(chain, spacing) {
  const line = [];
  for (const part of chain.parts) {
    for (const p of part.pts) line.push({ p, lanes: part.lanes, bridge: part.bridge });
  }
  if (chain.closed) line.push(line[0]);

  const out = [];
  let carry = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i].p;
    const b = line[i + 1].p;
    const len = dist(a, b);
    if (len === 0) continue; // the shared node where two ways meet
    let t = carry;
    while (t < len) {
      const f = t / len;
      out.push({ p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], lanes: line[i].lanes, bridge: line[i].bridge });
      t += spacing;
    }
    carry = t - len;
  }
  return out;
}

// Light moving-average to take the kinks out of OSM's straight segments.
function smooth(samples, closed, radius = 10) {
  const n = samples.length;
  const src = samples.map((s) => s.p);
  for (let i = 0; i < n; i++) {
    let x = 0;
    let z = 0;
    let count = 0;
    for (let k = -radius; k <= radius; k++) {
      let j = i + k;
      if (closed) j = (j + n) % n;
      else if (j < 0 || j >= n) continue;
      x += src[j][0];
      z += src[j][1];
      count++;
    }
    samples[i].p = [x / count, z / count];
  }
}

// Shoelace area with north = -z: positive means counter-clockwise on a north-up map.
function signedArea(samples) {
  let a = 0;
  for (let i = 0; i < samples.length; i++) {
    const [x1, z1] = samples[i].p;
    const [x2, z2] = samples[(i + 1) % samples.length].p;
    a += x1 * -z2 - x2 * -z1;
  }
  return a / 2;
}

function startDirection(pts) {
  return normalize(sub(pts[Math.min(1, pts.length - 1)], pts[0]));
}

function endDirection(pts) {
  return normalize(sub(pts[pts.length - 1], pts[Math.max(0, pts.length - 2)]));
}

function polylineLength(pts) {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) len += dist(pts[i], pts[i + 1]);
  return len;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round = (v) => Math.round(v * 100) / 100;
function normalize(v) {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}
