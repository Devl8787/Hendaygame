import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

// The look of the game: a real sky with a prairie sun, sky reflections on
// everything shiny, and filmic colour. G cycles the quality (low / medium /
// high: sharpness and shadows) to keep it smooth on any PC; T switches
// between a summer afternoon and sunset.
//
// (A glow/bloom pass was tried: the bright daytime sky glowed across the
// whole picture. Glow belongs with a night mode, where it can be selective.)

const QUALITY_LEVELS = ['low', 'medium', 'high'];

// Sun angles in degrees (azimuth clockwise from north). Edmonton summer
// sunsets are well round to the west-north-west.
const TIMES = {
  day: {
    label: 'afternoon',
    elevation: 32,
    azimuth: 215,
    sky: { turbidity: 4, rayleigh: 1.3, mieCoefficient: 0.004, mieDirectionalG: 0.85 },
    sun: [0xfff0d8, 2.4],
    hemisphere: [0xdfefff, 0x5a6b3a, 0.45],
    environment: 0.6,
    exposure: 0.85,
    fog: [0xc2d3e2, 250, 1500],
    windows: 'day',
  },
  sunset: {
    label: 'sunset',
    elevation: 3.5,
    azimuth: 292,
    sky: { turbidity: 9, rayleigh: 3, mieCoefficient: 0.006, mieDirectionalG: 0.93 },
    sun: [0xff9a4d, 1.9],
    hemisphere: [0xffc4a0, 0x3a3328, 0.38],
    environment: 0.55,
    exposure: 0.76,
    fog: [0xd9a487, 200, 1300],
    windows: 'sunset',
  },
};

export class Graphics {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.sunDirection = new THREE.Vector3();
    this.sky = makeSky(1500);
    scene.add(this.sky);
    this.envSky = makeSky(10);
    this.envScene = new THREE.Scene();
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    scene.fog = new THREE.Fog(0xc2d3e2, 250, 1500);
    this.sun = scene.userData.sun;
    scene.traverse((o) => {
      if (o.isHemisphereLight) this.hemisphere = o;
    });
    scene.userData.sunOffset = new THREE.Vector3();

    this.setTime(loadSetting('henday-time', Object.keys(TIMES), 'day'));
    this.setQuality(loadSetting('henday-graphics', QUALITY_LEVELS, 'high'));
  }

  setTime(name) {
    const t = TIMES[name];
    this.time = name;
    saveSetting('henday-time', name);

    const el = THREE.MathUtils.degToRad(t.elevation);
    const az = THREE.MathUtils.degToRad(t.azimuth);
    // Direction to the sun (x east, y up, z south).
    this.sunDirection.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    for (const sky of [this.sky, this.envSky]) {
      const u = sky.material.uniforms;
      for (const [k, v] of Object.entries(t.sky)) u[k].value = v;
      u.sunPosition.value.copy(this.sunDirection);
    }
    // Bake the sky into an environment map: soft ambient light from above,
    // and something for the car's paint and the glass towers to reflect.
    this.envMap?.dispose();
    this.envMap = this.pmrem.fromScene(this.envScene).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = t.environment;

    this.renderer.toneMappingExposure = t.exposure;
    const [fogColour, near, far] = t.fog;
    this.scene.fog.color.set(fogColour);
    this.scene.fog.near = near;
    this.scene.fog.far = far;
    this.scene.background = new THREE.Color(fogColour);
    if (this.sun) {
      this.sun.color.set(t.sun[0]);
      this.sun.intensity = t.sun[1];
    }
    if (this.hemisphere) {
      this.hemisphere.color.set(t.hemisphere[0]);
      this.hemisphere.groundColor.set(t.hemisphere[1]);
      this.hemisphere.intensity = t.hemisphere[2];
    }
    // The sun (and its shadow camera) sits this far from the car.
    this.scene.userData.sunOffset.copy(this.sunDirection).multiplyScalar(200);
    // Lit windows and the like brighten as the light goes.
    for (const glow of this.scene.userData.glowing ?? []) glow.material.emissiveIntensity = glow[t.windows];
    return t.label;
  }

  cycleTime() {
    const names = Object.keys(TIMES);
    return this.setTime(names[(names.indexOf(this.time) + 1) % names.length]);
  }

  setQuality(level) {
    this.quality = level;
    saveSetting('henday-graphics', level);
    const dpr = window.devicePixelRatio || 1;
    const pixelRatio = { low: 1, medium: Math.min(dpr, 1.5), high: Math.min(dpr, 2) }[level];
    this.renderer.setPixelRatio(pixelRatio);
    this.resize(window.innerWidth, window.innerHeight);
    if (this.sun) {
      this.sun.castShadow = level !== 'low';
      const size = level === 'high' ? 2048 : 1024;
      if (this.sun.shadow.mapSize.x !== size) {
        this.sun.shadow.mapSize.set(size, size);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
    }
  }

  cycleQuality() {
    const next = QUALITY_LEVELS[(QUALITY_LEVELS.indexOf(this.quality) + 1) % QUALITY_LEVELS.length];
    this.setQuality(next);
    return next;
  }

  resize(width, height) {
    this.renderer.setSize(width, height);
  }

  render() {
    // The sky dome travels with the camera so it's always all around.
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}

function makeSky(scale) {
  const sky = new Sky();
  sky.scale.setScalar(scale);
  return sky;
}

function loadSetting(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (allowed.includes(v)) return v;
  } catch {
    // Fall through to the default.
  }
  return fallback;
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows can block storage; the setting just won't stick.
  }
}
