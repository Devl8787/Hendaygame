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

| Key | Action |
| --- | --- |
| W / ↑ | Gas |
| S / ↓ | Brake, then reverse once stopped |
| A / D or ← / → | Steer |
| Space | Handbrake (drift) |
| R | Flip the car back upright |
| C | Switch chase / driver camera |

## How it fits together

| File | What it does |
| --- | --- |
| `src/main.js` | Sets up the renderer, camera and physics world; runs the game loop (physics at a fixed 60 Hz). |
| `src/world.js` | The test track: a straight 2 km divided highway, light poles and knock-over construction cones. |
| `src/car.js` | The car: a Rapier ray-cast vehicle (box chassis + 4 spring wheels), engine, brakes, steering, drag. |
| `src/input.js` | Keyboard controls. |

Every frame, Rapier moves the invisible physics bodies, and each Three.js mesh is
then copied to its body's position and rotation.

## Roadmap

1. ✅ Three.js + Rapier: drivable car on a test highway
2. Import the real Henday route from OpenStreetMap
3. Laps, checkpoints and a timer
4. Hazards: potholes, road closures, traffic, wrong-way drivers
5. Music and sound
6. Optional Google Photorealistic 3D Tiles for scenery
