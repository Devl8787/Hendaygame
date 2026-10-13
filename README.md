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

### Load the real Anthony Henday

Out of the box you drive a straight 2 km test strip. To drive the real road,
download it from OpenStreetMap once (needs internet, takes about 30 seconds):

```bash
npm run fetch-henday
```

This saves the raw map data to `data/henday-osm.json` and builds the track
into `public/henday-track.json`. Refresh the page and you're racing the Henday.

The real loop is ~78 km (a 47-minute lap), so the game shrinks it to a ~4 km
loop with the same shape, about a 1.5-minute lap at up to 200 km/h. Lanes stay
full size. To drive the real-length loop, open http://localhost:5173/?full. To rebuild the track from the saved data
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
| Enter | Restart the race |

A race is 3 laps. The loop is split into checkpoints, so cutting across the
infield or reversing over the line doesn't count. Your best lap is saved in the
browser.

Hazards: traffic (including semis and a left-lane camper), wrong-way drivers
that line up on your lane (one more every lap), potholes, frost heaves that
give you air, work zones with a crew and an excavator that move every lap, and
grass that slows you to ~90 km/h.

The North Saskatchewan river valley crosses the loop where the real Henday
crosses it, in the south-west and north-east (the longest bridges in the
OpenStreetMap data), with twin bridges on piers. Everywhere else is flat
prairie, like the real thing.

## How it fits together

| File | What it does |
| --- | --- |
| `src/main.js` | Sets up the renderer, camera and physics world; runs the game loop (physics at a fixed 60 Hz). |
| `src/track.js` | Loads the Henday track (or the test strip if it hasn't been downloaded). |
| `src/world.js` | Builds the scenery from the track: asphalt, lane lines, bridge barriers, light poles, knock-over cones. |
| `src/minimap.js` | The map in the corner. |
| `src/race.js` | Countdown, laps, checkpoints, lap timer, best lap, wrong-way warning. |
| `src/hazards.js` | Traffic and its lane-changing AI, wrong-way drivers, potholes, moving lane closures, grass. |
| `src/construction.js` | Work zones: sign, arrow board, cones, barriers, excavator and crew. |
| `src/terrain.js` | The river valley: ground mesh, physics heightfield and water. |
| `scripts/fetch-henday.mjs` | Downloads the Henday from OpenStreetMap's Overpass API. |
| `scripts/osm-to-track.mjs` | Stitches the OpenStreetMap road pieces into one loop per direction, in metres. |
| `src/car.js` | The car: a Rapier ray-cast vehicle (box chassis + 4 spring wheels), engine, brakes, steering, drag. |
| `src/input.js` | Keyboard controls. |

Every frame, Rapier moves the invisible physics bodies, and each Three.js mesh is
then copied to its body's position and rotation.

## Roadmap

1. ✅ Three.js + Rapier: drivable car on a test highway
2. ✅ Import the real Henday route from OpenStreetMap
3. ✅ Laps, checkpoints and a timer (on a ~4 km scaled-down Henday)
4. ✅ Hazards: potholes, road closures, traffic, wrong-way drivers
5. ✅ Hills: the south-west and north-east river valleys, frost heaves (overpasses still to come)
6. Music and sound
7. Graphics pass: textures, lighting, real models (Blender / free assets)
8. Optional Google Photorealistic 3D Tiles for scenery
