// Downloads Anthony Henday Drive from OpenStreetMap and writes the game track.
//
//   npm run fetch-henday              download from Overpass, then build the track
//   npm run fetch-henday -- --offline rebuild the track from the saved data/osm files
//
// The game ships with the track already built (public/track/henday.json), so
// you only need this to refresh it from the latest OpenStreetMap data.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { osmToTrack } from './osm-to-track.mjs';

// Public Overpass servers, tried in order. They're free and often busy.
const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const ROUNDS = 3;
const WAIT_BETWEEN_ROUNDS = 20; // seconds
const RAW_FILE = 'data/osm/henday.json';
const CROSS_FILE = 'data/osm/crossroads.json';
const TRACK_FILE = 'public/track/henday.json';

// Main carriageways only (no on/off ramps), inside a box around Edmonton.
const QUERY = `
[out:json][timeout:120];
(
  way["highway"~"^(motorway|trunk)$"]["name"~"Anthony Henday"](53.35,-113.80,53.70,-113.20);
  way["highway"~"^(motorway|trunk)$"]["ref"~"(^|[; ])216([; ]|$)"](53.35,-113.80,53.70,-113.20);
);
out geom;
`;

// Named major roads that touch the Henday: the interchanges.
const CROSS_QUERY = `
[out:json][timeout:180];
way["highway"~"^(motorway|trunk)$"]["name"~"Anthony Henday"](53.35,-113.80,53.70,-113.20)->.h;
way(around.h:25)["highway"~"^(motorway|trunk|primary|secondary)$"]["name"]["name"!~"Anthony Henday"];
out geom;
`;

async function download(query, file, what) {
  console.log(`Downloading ${what} from OpenStreetMap (can take ~30 s)…`);
  for (let round = 1; round <= ROUNDS; round++) {
    for (const url of OVERPASS_SERVERS) {
      const host = new URL(url).host;
      const result = await tryServer(url, query);
      if (result.text) {
        await mkdir('data/osm', { recursive: true });
        await writeFile(file, result.text);
        console.log(`Saved raw OpenStreetMap data from ${host} to ${file}`);
        return JSON.parse(result.text);
      }
      console.log(`  ${host}: ${result.problem}`);
    }
    if (round < ROUNDS) {
      console.log(`All servers busy. Waiting ${WAIT_BETWEEN_ROUNDS} s, then trying again (${round + 1}/${ROUNDS})…`);
      await new Promise((r) => setTimeout(r, WAIT_BETWEEN_ROUNDS * 1000));
    }
  }
  fail('Every Overpass server was busy or unreachable. Check your internet, wait a few minutes and run this again.');
}

// Returns { text } on success, or { problem } describing what went wrong.
async function tryServer(url, query) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'HendayRacer/0.1' },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(150_000),
    });
  } catch (err) {
    return { problem: `couldn't connect (${err.cause?.code ?? err.name})` };
  }
  if (!res.ok) {
    const busy = res.status === 429 || res.status === 503 || res.status === 504;
    return { problem: busy ? `busy (HTTP ${res.status})` : `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  }
  const text = await res.text();
  // Overpass can answer 200 with a timeout notice instead of data.
  try {
    if (JSON.parse(text).remark?.includes('timed out')) return { problem: 'timed out on the server' };
  } catch {
    return { problem: 'sent back something that isn\'t map data' };
  }
  return { text };
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

const offline = process.argv.includes('--offline');
const load = async (query, file, what) => (offline ? JSON.parse(await readFile(file, 'utf8')) : download(query, file, what));
const osm = await load(QUERY, RAW_FILE, 'Anthony Henday Drive');
const crossRoads = await load(CROSS_QUERY, CROSS_FILE, 'the roads crossing it');
console.log(`Got ${osm.elements.length} road pieces. Stitching them into carriageways…`);

const track = osmToTrack(osm, crossRoads);
await mkdir('public/track', { recursive: true });
await writeFile(TRACK_FILE, JSON.stringify(track));

for (const c of track.carriageways) {
  console.log(`  ${c.name}: ${(c.length / 1000).toFixed(1)} km, ${c.closed ? 'full loop' : 'NOT a closed loop'}`);
}
console.log(`  ${track.interchanges.length} interchanges`);
console.log(`Wrote ${TRACK_FILE}. Start the game with: npm run dev`);
