import * as THREE from 'three';

// Low-poly vehicle models built in code: a coupe for the player, sedans,
// hatchbacks, SUVs, pickups (it's Alberta), and North American semis.
//
// Each model faces +x with its wheels on the ground at y = 0 and its centre
// at x = z = 0. `model.userData.headlights` is the headlight material (the
// wrong-way drivers flash theirs). Swapping in real model files later only
// means replacing buildVehicle.

// Overall sizes, and the collision box half-extents traffic uses.
export const VEHICLE_SIZES = {
  coupe: { halfLength: 2.2, halfWidth: 0.9, halfHeight: 0.65 },
  sedan: { halfLength: 2.35, halfWidth: 0.9, halfHeight: 0.73 },
  hatch: { halfLength: 2.0, halfWidth: 0.88, halfHeight: 0.76 },
  suv: { halfLength: 2.4, halfWidth: 0.96, halfHeight: 0.88 },
  pickup: { halfLength: 2.85, halfWidth: 1.0, halfHeight: 0.94 },
  semi: { halfLength: 8, halfWidth: 1.3, halfHeight: 2 },
};

// Side profiles (x along the car, y up), all in metres.
// belt: top of the doors/hood; roof: [front x, rear x, height];
// glass: [windshield base x, rear window base x].
const CARS = {
  coupe: { length: 4.4, width: 1.8, wheelbase: 2.7, track: 1.62, wheel: 0.38, belt: 0.82, roof: [0.25, -0.75, 1.25], glass: [0.95, -1.6], trunk: 0.86, spoiler: true },
  sedan: { length: 4.7, width: 1.8, wheelbase: 2.8, track: 1.6, wheel: 0.36, belt: 0.9, roof: [0.45, -0.75, 1.46], glass: [1.15, -1.45], trunk: 0.94 },
  hatch: { length: 4.0, width: 1.76, wheelbase: 2.55, track: 1.55, wheel: 0.34, belt: 0.9, roof: [0.35, -1.45, 1.5], glass: [0.95, -1.85], trunk: 1.25 },
  suv: { length: 4.8, width: 1.92, wheelbase: 2.85, track: 1.68, wheel: 0.4, belt: 1.05, roof: [0.6, -2.05, 1.76], glass: [1.25, -2.3], trunk: 1.6 },
  pickup: { length: 5.7, width: 2.0, wheelbase: 3.6, track: 1.75, wheel: 0.42, belt: 1.12, roof: [0.85, -0.45, 1.88], glass: [1.45, -0.5], bed: -0.6 },
};

const BED_DEPTH = 0.5;

const mats = {
  glass: new THREE.MeshStandardMaterial({ color: 0x16202a, metalness: 0.9, roughness: 0.06 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.7 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 1, roughness: 0.25 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xa8acb1, metalness: 0.8, roughness: 0.35 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x8a0000, emissive: 0xff1a00, emissiveIntensity: 3 }),
  liner: new THREE.MeshStandardMaterial({ color: 0x232426, roughness: 0.95 }),
  trailer: new THREE.MeshStandardMaterial({ color: 0xe4e4df, roughness: 0.7 }),
};

const paintCache = new Map();
function paint(color) {
  if (!paintCache.has(color)) {
    paintCache.set(color, new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.3 }));
  }
  return paintCache.get(color);
}

export function buildVehicle(type, color, { wheels = true } = {}) {
  return type === 'semi' ? buildSemi(color, wheels) : buildCar(CARS[type], color, wheels);
}

function buildCar(spec, color, withWheels) {
  const { length: L, width: W, wheelbase, track, wheel, belt } = spec;
  const [roofFront, roofRear, H] = spec.roof;
  const [glassFront, glassRear] = spec.glass;
  const body = paint(color);
  const car = new THREE.Group();
  const add = (mesh) => {
    mesh.castShadow = true;
    car.add(mesh);
    return mesh;
  };

  // Lower body: bumper to beltline, with arches over the wheels.
  const clear = 0.24;
  const arch = wheel + 0.07;
  const front = L / 2;
  const rear = -L / 2;
  const axles = [-wheelbase / 2, wheelbase / 2];
  const s = new THREE.Shape();
  s.moveTo(rear + 0.15, clear);
  for (const axle of axles) {
    s.lineTo(axle - arch, clear);
    s.lineTo(axle - arch, wheel);
    s.absarc(axle, wheel, arch, Math.PI, 0, true);
    s.lineTo(axle + arch, clear);
  }
  s.lineTo(front - 0.15, clear);
  s.quadraticCurveTo(front, clear, front, clear + 0.18);
  s.lineTo(front, belt - 0.22);
  // Hood: rounded nose, rising gently to the windshield.
  s.quadraticCurveTo(front, belt - 0.05, front - 0.3, belt - 0.02);
  s.lineTo(glassFront, belt + 0.03);
  if (spec.bed !== undefined) {
    // Pickup: cab back, then down to the bed floor (walls added below).
    s.lineTo(spec.bed + 0.05, belt + 0.03);
    s.lineTo(spec.bed + 0.05, belt - BED_DEPTH);
    s.lineTo(rear + 0.05, belt - BED_DEPTH);
  } else {
    s.lineTo(glassRear, spec.trunk);
    s.lineTo(rear + 0.25, spec.trunk - 0.02);
    s.quadraticCurveTo(rear, spec.trunk - 0.04, rear, spec.trunk - 0.25);
  }
  s.lineTo(rear, clear + 0.15);
  s.quadraticCurveTo(rear, clear, rear + 0.15, clear);
  add(extrude(s, W, body, 0.05));

  // Glasshouse: windows, with the roof on top in body colour.
  const g = new THREE.Shape();
  g.moveTo(glassFront, belt);
  g.lineTo(roofFront, H - 0.06);
  g.lineTo(roofRear, H - 0.06);
  g.lineTo(glassRear, spec.bed !== undefined ? belt : spec.trunk);
  add(extrude(g, W - 0.22, mats.glass, 0.03));
  const roof = new THREE.Shape();
  roof.moveTo(roofFront + 0.04, H - 0.07);
  roof.lineTo(roofFront - 0.02, H);
  roof.lineTo(roofRear + 0.02, H);
  roof.lineTo(roofRear - 0.04, H - 0.07);
  add(extrude(roof, W - 0.2, body, 0.03));
  // Door pillars between the windows.
  const pillarX = (roofFront + roofRear) / 2;
  add(box(0.12, H - belt, W - 0.18, body)).position.set(pillarX, (H + belt) / 2, 0);

  if (spec.bed !== undefined) {
    // Open bed: side walls, tailgate, and a dark liner on the floor.
    const bedLength = spec.bed - rear;
    for (const side of [-1, 1]) {
      add(box(bedLength, BED_DEPTH, 0.08, body)).position.set((spec.bed + rear) / 2, belt - BED_DEPTH / 2, side * (W / 2 - 0.04));
    }
    add(box(0.08, BED_DEPTH, W - 0.08, body)).position.set(rear + 0.04, belt - BED_DEPTH / 2, 0);
    add(box(bedLength - 0.12, 0.03, W - 0.2, mats.liner)).position.set((spec.bed + rear) / 2, belt - BED_DEPTH + 0.02, 0);
  }
  if (spec.spoiler) {
    add(box(0.32, 0.05, W - 0.1, body)).position.set(rear + 0.25, spec.trunk + 0.16, 0);
    for (const z of [-0.6, 0.6]) add(box(0.08, 0.16, 0.06, mats.trim)).position.set(rear + 0.28, spec.trunk + 0.07, z);
  }

  // Bumpers, grille, lights, mirrors, plate.
  add(box(0.18, 0.2, W + 0.04, mats.trim)).position.set(front - 0.04, clear + 0.12, 0);
  add(box(0.18, 0.2, W + 0.04, mats.trim)).position.set(rear + 0.04, clear + 0.12, 0);
  add(box(0.06, 0.18, W * 0.42, mats.trim)).position.set(front + 0.02, belt - 0.3, 0);
  const headlights = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 4 });
  for (const side of [-1, 1]) {
    add(box(0.06, 0.12, 0.34, headlights)).position.set(front + 0.01, belt - 0.24, side * (W / 2 - 0.26));
    add(box(0.06, 0.13, 0.36, mats.tail)).position.set(rear - 0.01, (spec.trunk ?? belt) - 0.22, side * (W / 2 - 0.25));
    add(box(0.16, 0.1, 0.12, body)).position.set(glassFront - 0.12, belt + 0.12, side * (W / 2 + 0.04));
  }
  add(box(0.03, 0.14, 0.42, mats.chrome)).position.set(rear - 0.03, clear + 0.32, 0);

  if (withWheels) {
    for (const x of axles) for (const side of [-1, 1]) car.add(wheelMesh(wheel, x, side * (track / 2)));
  }
  car.userData.headlights = headlights;
  return car;
}

// North American semi: long-nose tractor with a sleeper, and a dry-van trailer.
function buildSemi(color, withWheels) {
  const { halfLength } = VEHICLE_SIZES.semi;
  const truck = new THREE.Group();
  const cabPaint = paint(color);
  const add = (mesh) => {
    mesh.castShadow = true;
    truck.add(mesh);
    return mesh;
  };
  const front = halfLength;
  // Trailer: a long box up on its wheels, with a rear frame.
  const trailerLength = 12.6;
  const trailerRear = -halfLength;
  add(box(trailerLength, 2.75, 2.6, mats.trailer)).position.set(trailerRear + trailerLength / 2, 1.25 + 1.375, 0);
  add(box(0.08, 2.75, 2.62, mats.trim)).position.set(trailerRear - 0.02, 2.625, 0);
  add(box(trailerLength - 0.3, 0.12, 2.4, mats.trim)).position.set(trailerRear + trailerLength / 2, 1.18, 0);
  // Tractor: hood, cab, sleeper.
  const hoodLength = 2.1;
  const cabLength = 1.7;
  const sleeperLength = 1.9;
  const hood = new THREE.Shape();
  hood.moveTo(front, 0.85);
  hood.lineTo(front, 1.75);
  hood.quadraticCurveTo(front - 0.15, 2.0, front - 0.6, 2.05);
  hood.lineTo(front - hoodLength, 2.15);
  hood.lineTo(front - hoodLength, 0.85);
  add(extrude(hood, 2.2, cabPaint, 0.06));
  const cabX = front - hoodLength - cabLength / 2;
  add(box(cabLength, 2.1, 2.45, cabPaint)).position.set(cabX, 0.9 + 1.05, 0);
  add(box(0.06, 0.9, 2.2, mats.glass)).position.set(front - hoodLength + 0.02, 2.55, 0);
  for (const side of [-1, 1]) add(box(cabLength * 0.55, 0.7, 0.04, mats.glass)).position.set(cabX + 0.2, 2.45, side * 1.23);
  add(box(sleeperLength, 2.6, 2.45, cabPaint)).position.set(cabX - cabLength / 2 - sleeperLength / 2, 0.9 + 1.3, 0);
  // Grille, bumper, stacks, fuel tanks, lights.
  add(box(0.08, 0.85, 1.2, mats.chrome)).position.set(front + 0.02, 1.35, 0);
  add(box(0.3, 0.3, 2.5, mats.chrome)).position.set(front + 0.05, 0.75, 0);
  for (const side of [-1, 1]) {
    const stack = add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.6, 10), mats.chrome));
    stack.position.set(cabX - cabLength / 2 + 0.1, 2.9, side * 1.2);
    const tank = add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.3, 14), mats.chrome));
    tank.rotation.z = Math.PI / 2;
    tank.position.set(cabX, 0.75, side * 1.05);
  }
  const headlights = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 4 });
  for (const side of [-1, 1]) {
    add(box(0.08, 0.18, 0.3, headlights)).position.set(front + 0.02, 1.55, side * 0.85);
    add(box(0.05, 0.15, 0.3, mats.tail)).position.set(trailerRear - 0.06, 1.35, side * 1.05);
  }
  if (withWheels) {
    const r = 0.52;
    for (const x of [front - 1.2, cabX - cabLength / 2 - 0.9, cabX - cabLength / 2 - 2.2, trailerRear + 1.6, trailerRear + 2.9]) {
      for (const side of [-1, 1]) truck.add(wheelMesh(r, x, side * 1.0, 0.32));
    }
  }
  truck.userData.headlights = headlights;
  return truck;
}

function wheelMesh(radius, x, z, width = 0.26) {
  const wheel = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 18), mats.tyre);
  tyre.rotation.x = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, width + 0.02, 12), mats.rim);
  rim.rotation.x = Math.PI / 2;
  wheel.add(tyre, rim);
  wheel.position.set(x, radius, z);
  tyre.castShadow = true;
  return wheel;
}

function extrude(shape, width, material, bevel) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  return new THREE.Mesh(geo, material);
}

function box(x, y, z, material) {
  return new THREE.Mesh(new THREE.BoxGeometry(x, y, z), material);
}
