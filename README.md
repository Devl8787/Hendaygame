# Henday Racer

A parody 3D racing game set on Edmonton's Anthony Henday Drive (Highway 216).
Built with [Three.js](https://threejs.org/) for graphics and
[Rapier](https://rapier.rs/) for physics, running in the browser.

## Run it

On Windows, double-click **`Play Henday.bat`**. It updates the game, installs
what it needs, downloads the Henday map the first time, and opens the game in
your browser. Keep its window open while you play.

Or from a terminal:

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

### The map

The Anthony Henday comes with the game (`public/track/henday.json`), built
from OpenStreetMap: the road, the river bridges and the roads that cross it.
To rebuild it from the latest OpenStreetMap data (needs internet, ~1 minute):

```bash
npm run fetch-henday
```

The raw downloads are kept in `data/osm/`, and
`npm run fetch-henday -- --offline` rebuilds the track from them.

The real loop is ~78 km (a 47-minute lap), so the game shrinks it to a ~4 km
loop with the same shape, about a 1.5-minute lap at up to 200 km/h. Lanes stay
full size. To drive the real-length loop, open http://localhost:5173/?full.

Road data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

| Key | Action |
| --- | --- |
| W / ↑ | Gas |
| S / ↓ | Brake, then reverse once stopped |
| A / D or ← / → | Steer |
| Space | Handbrake (drift) |
| R | Put the car back on the road, facing the race direction (automatic if you're upside down) |
| C | Switch chase / driver camera |
| Enter | Restart the race |
| M | Mute / unmute Henday Traffic Radio |
| G | Graphics quality: low / medium / high (remembered) |
| T | Time of day: afternoon / sunset (remembered) |

A race is 3 laps. The loop is split into checkpoints, so cutting across the
infield or reversing over the line doesn't count. Your best lap is saved in the
browser.

Hazards: traffic (including semis and a left-lane camper), wrong-way drivers
that line up on your lane (one more every lap), potholes, one giant frost
heave on the straightest stretch (about a second of air at 200 km/h), work zones with a crew and an excavator that move every lap, and
grass that slows you to ~90 km/h.

**Henday Traffic Radio 2-16**: your host Brenda reports on wrong-way drivers,
work zones, potholes, airtime and tow trucks, with traffic chatter in between.
She uses your browser's built-in voice; Microsoft Edge has the most natural
ones (including a Canadian voice). Press M to mute her.

The North Saskatchewan river valley crosses the loop where the real Henday
crosses it, in the south-west and north-east (the longest bridges in the
OpenStreetMap data). The road dips 6 m down into the valley onto twin bridges
on piers and climbs back out. Everywhere else is flat prairie, like the real
thing.

Eight real interchanges (Whitemud, Yellowhead, Gateway, Manning and more) sit
where they are on the real Henday, either as overpasses or with the Henday
bridging over the crossing road, just like the real ones. It's a race, so every
ramp is barricaded: EXIT CLOSED.

## How it fits together

| File | What it does |
| --- | --- |
| `src/main.js` | Sets up the renderer, camera and physics world; runs the game loop (physics at a fixed 60 Hz). |
| `src/track.js` | Loads the Henday track (or the test strip if it hasn't been downloaded). |
| `src/world.js` | Builds the scenery from the track: asphalt, lane lines, bridge barriers, light poles, knock-over cones. |
| `src/minimap.js` | The map in the corner. |
| `src/race.js` | Countdown, laps, checkpoints, lap timer, best lap, wrong-way warning. |
| `src/graphics.js` | Sky, sunlight, reflections, colour, and the quality setting. |
| `src/textures.js` | Asphalt, grass, concrete and window textures, painted in code. |
| `src/vehicles.js` | Low-poly vehicle models: coupe, sedan, hatchback, SUV, pickup, semi. |
| `src/scenery.js` | Trees, downtown Edmonton's skyline and the Muttart pyramids. |
| `src/radio.js` | Henday Traffic Radio 2-16: Brenda's lines, voice, jingle and static. |
| `src/hazards.js` | Traffic and its lane-changing AI, wrong-way drivers, potholes, moving lane closures, grass. |
| `src/construction.js` | Work zones: sign, arrow board, cones, barriers, excavator and crew. |
| `src/terrain.js` | The river valley and road cuttings: ground mesh, physics heightfield and water. |
| `src/interchange.js` | Interchanges: overpasses or underpasses, crossing roads and their traffic, closed ramps, exit signs. |
| `scripts/fetch-henday.mjs` | Downloads the Henday from OpenStreetMap's Overpass API. |
| `scripts/osm-to-track.mjs` | Stitches the OpenStreetMap road pieces into one loop per direction, in metres, and finds the interchanges. |
| `src/car.js` | The car: a Rapier ray-cast vehicle (box chassis + 4 spring wheels), engine, brakes, steering, drag. |
| `src/input.js` | Keyboard controls. |

Every frame, Rapier moves the invisible physics bodies, and each Three.js mesh is
then copied to its body's position and rotation.

## Roadmap

1. ✅ Three.js + Rapier: drivable car on a test highway
2. ✅ Import the real Henday route from OpenStreetMap
3. ✅ Laps, checkpoints and a timer (on a ~4 km scaled-down Henday)
4. ✅ Hazards: potholes, road closures, traffic, wrong-way drivers
5. ✅ Hills: the south-west and north-east river valleys, a giant frost heave
6. ✅ Interchanges: overpasses, underpasses and closed exits
7. Sound: ✅ Henday Traffic Radio (browser voice); still to come: recorded voice, engine sounds, music
8. Graphics: ✅ sky, lighting, textures, trees, farmland, skyline, sunset mode, low-poly vehicles; still to come: night mode, imported 3D models
9. Optional Google Photorealistic 3D Tiles for scenery
