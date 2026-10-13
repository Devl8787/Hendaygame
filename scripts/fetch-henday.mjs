// Downloads Anthony Henday Drive from OpenStreetMap and writes the game track.
//
//   npm run fetch-henday              download from Overpass, then build the track
//   npm run fetch-henday -- --offline rebuild the track from data/henday-osm.json
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { osmToTrack } from './osm-to-track.mjs';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const RAW_FILE = 'data/henday-osm.json';
const TRACK_FILE = 'public/henday-track.json';

// Main carriageways only (no on/off ramps), inside a box around Edmonton.
const QUERY = `
[out:json][timeout:120];
(
  way["highway"~"^(motorway|trunk)$"]["name"~"Anthony Henday"](53.35,-113.80,53.70,-113.20);
  way["highway"~"^(motorway|trunk)$"]["ref"~"(^|[; ])216([; ]|$)"](53.35,-113.80,53.70,-113.20);
);
out geom;
`;

async function download() {
  console.log('Downloading Anthony Henday Drive from OpenStreetMap (can take ~30 s)…');
  let res;
  try {
    res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'HendayRacer/0.1' },
      body: new URLSearchParams({ data: QUERY }),
    });
  } catch (err) {
    fail(`Couldn't reach ${OVERPASS_URL} (${err.cause?.code ?? err.message}). Check your internet connection.`);
  }
  if (!res.ok) {
    const busy = res.status === 429 || res.status === 504;
    fail(
      busy
        ? `Overpass is busy right now (HTTP ${res.status}). Wait a minute and try again.`
        : `Overpass answered HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  const text = await res.text();
  await mkdir('data', { recursive: true });
  await writeFile(RAW_FILE, text);
  console.log(`Saved raw OpenStreetMap data to ${RAW_FILE}`);
  return JSON.parse(text);
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

const offline = process.argv.includes('--offline');
const osm = offline ? JSON.parse(await readFile(RAW_FILE, 'utf8')) : await download();
console.log(`Got ${osm.elements.length} road pieces. Stitching them into carriageways…`);

const track = osmToTrack(osm);
await mkdir('public', { recursive: true });
await writeFile(TRACK_FILE, JSON.stringify(track));

for (const c of track.carriageways) {
  console.log(`  ${c.name}: ${(c.length / 1000).toFixed(1)} km, ${c.closed ? 'full loop' : 'NOT a closed loop'}`);
}
console.log(`Wrote ${TRACK_FILE}. Start the game with: npm run dev`);
