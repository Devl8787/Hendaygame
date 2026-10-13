# Henday Racer

A parody 3D racing game set on Edmonton's Anthony Henday Drive (Highway 216).
Built with [Three.js](https://threejs.org/) for graphics and
[Rapier](https://rapier.rs/) for physics, running in the browser.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

### Load the real Anthony Henday

Out of the box you drive a straight 2 km test strip. To drive the real road,
download it from OpenStreetMap once (needs internet, takes about 30 seconds):

```bash
npm run fetch-henday
```

This saves the raw map data to `data/henday-osm.json` and builds the track
into `public/henday-track.json`. Restart `npm run dev` (or refresh the page)
and you're on the real ~78 km loop. To rebuild the track from the saved data
without downloading again: `npm run fetch-henday -- --offline`.

Road data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

| Key | Action |
| --- | --- |
| W / ↑ | Gas |
| S / ↓ | Brake, then reverse once stopped |
| A / D or ← / → | Steer |
| Space | Handbrake (drift) |
| R | Put the car back in the right lane of the nearest road |
| C | Switch chase / driver camera |

## How it fits together

| File | What it does |
| --- | --- |
| `src/main.js` | Sets up the renderer, camera and physics world; runs the game loop (physics at a fixed 60 Hz). |
| `src/track.js` | Loads the Henday track (or the test strip if it hasn't been downloaded). |
| `src/world.js` | Builds the scenery from the track: asphalt, lane lines, bridge barriers, light poles, knock-over cones. |
| `src/minimap.js` | The map in the corner. |
| `scripts/fetch-henday.mjs` | Downloads the Henday from OpenStreetMap's Overpass API. |
| `scripts/osm-to-track.mjs` | Stitches the OpenStreetMap road pieces into one loop per direction, in metres. |
| `src/car.js` | The car: a Rapier ray-cast vehicle (box chassis + 4 spring wheels), engine, brakes, steering, drag. |
| `src/input.js` | Keyboard controls. |

Every frame, Rapier moves the invisible physics bodies, and each Three.js mesh is
then copied to its body's position and rotation.

## Roadmap

1. ✅ Three.js + Rapier: drivable car on a test highway
2. ✅ Import the real Henday route from OpenStreetMap
3. Laps, checkpoints and a timer
4. Hazards: potholes, road closures, traffic, wrong-way drivers
5. Music and sound
6. Optional Google Photorealistic 3D Tiles for scenery
