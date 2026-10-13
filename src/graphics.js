import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

// The look of the game: a real sky with a prairie sun, sky reflections on
// everything shiny, and filmic colour. G cycles the quality (low / medium /
// high: sharpness and shadows) to keep it smooth on any PC.
//
// (A glow/bloom pass was tried: the bright daytime sky glowed across the
// whole picture. Glow belongs with a night mode, where it can be selective.)

// Sun: fairly high in the south-west, warm.
const SUN_ELEVATION = 32; // degrees
const SUN_AZIMUTH = 215; // degrees clockwise from north
const QUALITY_LEVELS = ['low', 'medium', 'high'];

export class Graphics {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.85;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Direction to the sun (x east, y up, z south).
    const el = THREE.MathUtils.degToRad(SUN_ELEVATION);
    const az = THREE.MathUtils.degToRad(SUN_AZIMUTH);
    this.sunDirection = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));

    this.sky = makeSky(this.sunDirection, 1500);
    scene.add(this.sky);
    // Bake the sky into an environment map: soft ambient light from above,
    // and something for the car's paint and the glass towers to reflect.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene();
    skyScene.add(makeSky(this.sunDirection, 10));
    scene.environment = pmrem.fromScene(skyScene).texture;
    scene.environmentIntensity = 0.6;
    pmrem.dispose();

    // Haze that matches the horizon, a bit further out than before so the
    // skyline across the loop shows.
    scene.fog = new THREE.Fog(0xc2d3e2, 250, 1500);
    scene.background = new THREE.Color(0xc2d3e2);

    // Retune the lights from world.js now the sky does some of the work.
    scene.traverse((o) => {
      if (o.isHemisphereLight) o.intensity = 0.45;
      if (o.isDirectionalLight) {
        o.color.set(0xfff0d8);
        o.intensity = 2.4;
      }
    });
    this.sun = scene.userData.sun;
    scene.userData.sunOffset = this.sunDirection.clone().multiplyScalar(200);

    this.setQuality(loadQuality());
  }

  setQuality(level) {
    this.quality = level;
    saveQuality(level);
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

function makeSky(sunDirection, scale) {
  const sky = new Sky();
  sky.scale.setScalar(scale);
  const u = sky.material.uniforms;
  u.turbidity.value = 4;
  u.rayleigh.value = 1.3;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.85;
  u.sunPosition.value.copy(sunDirection);
  return sky;
}

function loadQuality() {
  try {
    const q = localStorage.getItem('henday-graphics');
    if (QUALITY_LEVELS.includes(q)) return q;
  } catch {
    // Fall through to the default.
  }
  return 'high';
}

function saveQuality(level) {
  try {
    localStorage.setItem('henday-graphics', level);
  } catch {
    // Private windows can block storage; the setting just won't stick.
  }
}
