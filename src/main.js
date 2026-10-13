import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld, syncBodies } from './world.js';
import { loadTrack, poseAt, rightLaneOffset, nearestLanePose } from './track.js';
import { Car } from './car.js';
import { Minimap } from './minimap.js';
import { Race } from './race.js';
import { readInput, onPress } from './input.js';

const FIXED_DT = 1 / 60;

const [track] = await Promise.all([loadTrack(), RAPIER.init()]);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.3, 2000);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = FIXED_DT;
const { cones } = createWorld(scene, world, track);
const start = track.carriageways[0];
// Start a few metres behind the line, in the middle lane.
const startIndex = start.closed ? start.points.length - 3 : 0;
const startPose = poseAt(start, startIndex, start.closed ? 0 : rightLaneOffset(start, 0));
const car = new Car(scene, world, startPose);
const minimap = new Minimap(track);
const race = start.closed ? new Race(start) : null;
document.getElementById('race-hud').hidden = !race;
showTrackInfo(track);

// Chase camera offsets in the car's local space (+x is forward).
const CAMERAS = [
  { offset: new THREE.Vector3(-9, 3.5, 0), look: new THREE.Vector3(4, 1, 0) }, // chase
  { offset: new THREE.Vector3(0.2, 0.75, -0.4), look: new THREE.Vector3(10, 0.6, -0.4) }, // driver
];
let cameraIndex = 0;
onPress('KeyC', () => (cameraIndex = (cameraIndex + 1) % CAMERAS.length));
onPress('KeyR', () => {
  const { x, z } = car.body.translation();
  car.reset(nearestLanePose(track, x, z));
  race?.relocate();
});
onPress('Enter', () => {
  if (!race) return;
  car.reset(startPose);
  race.reset();
});

const HOLD = { throttle: false, brake: false, steer: 0, handbrake: true };
const carForward = new THREE.Vector3();

const camTarget = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
function updateCamera(dt, snap) {
  const { offset, look } = CAMERAS[cameraIndex];
  camTarget.copy(offset).applyQuaternion(car.mesh.quaternion).add(car.mesh.position);
  lookTarget.copy(look).applyQuaternion(car.mesh.quaternion).add(car.mesh.position);
  // The chase camera lags a little; the driver camera is locked to the car.
  const t = snap || cameraIndex === 1 ? 1 : 1 - Math.exp(-6 * dt);
  camera.position.lerp(camTarget, t);
  camera.lookAt(lookTarget);
  // Widen the view a little with speed so 200 km/h feels fast.
  const fov = 65 + Math.min(Math.abs(car.speed) * 3.6, 200) * 0.08;
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  }

  const sun = scene.userData.sun;
  sun.target.position.copy(car.mesh.position);
  sun.position.copy(car.mesh.position).add(new THREE.Vector3(60, 120, 40));
}

const speedEl = document.getElementById('speed-value');

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Physics runs at a fixed 60 Hz no matter the screen's refresh rate.
const clock = new THREE.Clock();
let accumulator = 0;
car.syncMeshes();
updateCamera(0, true);

renderer.setAnimationLoop(() => {
  const frameDt = Math.min(clock.getDelta(), 0.1);
  accumulator += frameDt;
  const input = race?.frozen ? HOLD : readInput();
  while (accumulator >= FIXED_DT) {
    car.update(input, FIXED_DT);
    world.step();
    accumulator -= FIXED_DT;
  }

  car.syncMeshes();
  syncBodies(cones);
  if (race) {
    carForward.set(1, 0, 0).applyQuaternion(car.mesh.quaternion);
    race.update(frameDt, car.mesh.position, carForward, car.speed);
  }
  updateCamera(frameDt, false);
  speedEl.textContent = Math.round(Math.abs(car.speed) * 3.6);
  minimap.draw(car.mesh.position.x, car.mesh.position.z);
  renderer.render(scene, camera);
});

document.getElementById('loading').remove();

function showTrackInfo(track) {
  const info = document.getElementById('track-info');
  if (track.isTestStrip) {
    info.textContent = 'Test strip: run "npm run fetch-henday" to load the real Anthony Henday';
  } else {
    const km = (track.carriageways[0].length / 1000).toFixed(1);
    info.textContent = `${track.name} · ${km} km lap · ${track.attribution}`;
  }
}
