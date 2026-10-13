import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld } from './world.js';
import { loadTrack, poseAt, rightLaneOffset, nearestLanePose, laneOffset, LANE_WIDTH } from './track.js';
import { Car } from './car.js';
import { Minimap } from './minimap.js';
import { Race } from './race.js';
import { Hazards } from './hazards.js';
import { buildInterchanges } from './interchange.js';
import { Radio } from './radio.js';
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
const { terrain } = createWorld(scene, world, track);
const interchanges = buildInterchanges(scene, world, track, terrain);
const start = track.carriageways[0];
// Start a few metres behind the line, in the middle lane.
const startIndex = start.closed ? start.points.length - 3 : 0;
const startPose = poseAt(start, startIndex, start.closed ? 0 : rightLaneOffset(start, 0));
const car = new Car(scene, world, startPose);
const minimap = new Minimap(track, terrain?.river);
const race = start.closed ? new Race(start) : null;
const hazards = race ? new Hazards(scene, world, track, car) : null;
const radio = race ? new Radio() : null;
if (race) {
  hazards.radio = radio;
  race.onStart = () => radio.event('start');
  race.onLap = (lap) => {
    hazards.newLap(lap);
    radio.event(lap === race.laps ? 'finalLap' : 'lap');
  };
  race.onFinish = () => radio.event('finish');
  hazards.newRace();
}
document.getElementById('race-hud').hidden = !race;
showTrackInfo(track);

// Chase camera offsets in the car's local space (+x is forward).
const CAMERAS = [
  { offset: new THREE.Vector3(-9, 3.5, 0), look: new THREE.Vector3(4, 1, 0) }, // chase
  { offset: new THREE.Vector3(0.2, 0.75, -0.4), look: new THREE.Vector3(10, 0.6, -0.4) }, // driver
];
let cameraIndex = 0;
onPress('KeyC', () => (cameraIndex = (cameraIndex + 1) % CAMERAS.length));
onPress('KeyR', backOnTheRoad);
onPress('KeyM', () => radio?.toggleMute());

// Puts the car back on its wheels. In a race that's always our side of the
// road, facing the race direction, in the lane nearest to where the car was.
function backOnTheRoad() {
  const { x, z } = car.body.translation();
  if (!race) {
    car.reset(nearestLanePose(track, x, z));
    return;
  }
  const i = race.nearestIndex({ x, z });
  const [px, pz] = start.points[i];
  const lateral = (x - px) * -start.tangents[i * 2 + 1] + (z - pz) * start.tangents[i * 2];
  const lanes = Math.round(start.width(i) / LANE_WIDTH);
  const lane = THREE.MathUtils.clamp(Math.round((lateral + start.width(i) / 2) / LANE_WIDTH - 0.5), 0, lanes - 1);
  car.reset(poseAt(start, i, laneOffset(start, i, lane)));
  race.relocate();
}

// Upside down (or on its side) for a while: call the tow truck.
const TOW_AFTER = 2.5; // seconds
let upsideDownFor = 0;
const carUp = new THREE.Vector3();
function checkUpsideDown(dt) {
  carUp.set(0, 1, 0).applyQuaternion(car.mesh.quaternion);
  upsideDownFor = carUp.y < 0.3 ? upsideDownFor + dt : 0;
  if (upsideDownFor < TOW_AFTER) return;
  upsideDownFor = 0;
  backOnTheRoad();
  hazards?.toast('Towed back onto the Henday. That will be $300.', 3);
  radio?.event('tow');
}
onPress('Enter', () => {
  if (!race) return;
  car.reset(startPose);
  race.reset();
  hazards.newRace();
  radio.stop();
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
  // Potholes and grass shake the camera.
  const shake = (hazards?.shake ?? 0) * 0.12;
  if (shake > 0) {
    camera.position.y += (Math.random() - 0.5) * shake;
    camera.rotation.z += (Math.random() - 0.5) * shake * 0.3;
  }
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
    hazards?.step(FIXED_DT);
    world.step();
    accumulator -= FIXED_DT;
  }

  car.syncMeshes();
  checkUpsideDown(frameDt);
  radio?.update(frameDt, race?.state === 'racing');
  interchanges.update(frameDt);
  if (race) {
    carForward.set(1, 0, 0).applyQuaternion(car.mesh.quaternion);
    race.update(frameDt, car.mesh.position, carForward, car.speed);
    hazards.frame(frameDt, race.index);
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
