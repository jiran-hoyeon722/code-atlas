import * as THREE from 'three';

const ACCEL = 16;
const TOP = 30;
const BOOST = 52;
const CLIMB = 9;
const YAW = 1.5;
const CEILING = 220;

export interface HeliInput { forward: number; turn: number; lift: number; boost: boolean }

export interface Heli {
  readonly root: THREE.Group;
  readonly state: 'hidden' | 'landing' | 'parked' | 'flying';
  readonly heading: number;
  readonly speed: number;
  /** Drops in from the sky and parks at (x, z). */
  arrive(x: number, z: number, heading: number): void;
  board(): void;
  /** Returns false while too high to land. */
  land(): boolean;
  update(dt: number, time: number, input: HeliInput, floorAt: (x: number, z: number) => number): void;
  dispose(): void;
}

export function createHeli(scene: THREE.Scene, limits: { minX: number; maxX: number; minZ: number; maxZ: number }): Heli {
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => keep(new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.5, ...extra }));
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(keep(geo), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  const root = new THREE.Group();
  const frame = new THREE.Group();
  root.add(frame);
  const paint = std('#2c3445');
  const accent = std('#7c93f5', { emissive: '#1d2658' });
  const metal = std('#8b92a3', { metalness: 0.8 });
  const cabin = add(new THREE.SphereGeometry(1.25, 24, 16), paint, frame, 0, 1.75, 0.2);
  cabin.scale.set(1, 0.9, 1.6);
  const glass = add(new THREE.SphereGeometry(1.0, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), std('#8fd0ff', { transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.2, emissive: '#10324a' }), frame, 0, 1.9, 1.05);
  glass.scale.set(1, 0.85, 1.1);
  glass.rotation.x = 0.9;
  add(new THREE.BoxGeometry(2.3, 0.18, 1.2), accent, frame, 0, 1.45, 0.2);
  const boom = add(new THREE.CylinderGeometry(0.22, 0.34, 4.6, 12), paint, frame, 0, 2.0, -3.4);
  boom.rotation.x = Math.PI / 2 - 0.08;
  add(new THREE.BoxGeometry(0.12, 1.3, 0.8), accent, frame, 0, 2.6, -5.5);
  add(new THREE.BoxGeometry(1.6, 0.08, 0.5), paint, frame, 0, 2.1, -5.3);
  [-0.85, 0.85].forEach((x) => {
    const skid = add(new THREE.CylinderGeometry(0.07, 0.07, 3.6, 8), metal, frame, x, 0.12, 0.2);
    skid.rotation.x = Math.PI / 2;
    [-0.8, 1.0].forEach((z) => add(new THREE.CylinderGeometry(0.05, 0.05, 0.85, 6), metal, frame, x * 0.85, 0.52, z));
  });
  add(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8), metal, frame, 0, 3.05, 0.1);
  const rotor = new THREE.Group();
  rotor.position.set(0, 3.32, 0.1);
  frame.add(rotor);
  for (let k = 0; k < 4; k++) {
    const blade = add(new THREE.BoxGeometry(0.28, 0.04, 5.2), std('#1b1f29'), rotor, 0, 0, 2.6);
    const arm = new THREE.Group();
    arm.rotation.y = (k * Math.PI) / 2;
    rotor.add(arm);
    arm.add(blade);
  }
  const blur = add(new THREE.CircleGeometry(5.3, 40).rotateX(-Math.PI / 2), keep(new THREE.MeshBasicMaterial({ color: '#c8d2e8', transparent: true, opacity: 0, depthWrite: false })), rotor, 0, 0.02, 0);
  blur.castShadow = false;
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.18, 2.55, -5.6);
  frame.add(tailRotor);
  [0, Math.PI / 2].forEach((a) => {
    const b = add(new THREE.BoxGeometry(0.03, 1.1, 0.14), std('#1b1f29'), tailRotor);
    b.rotation.x = a;
  });
  const beacon = add(new THREE.SphereGeometry(0.12, 10, 8), keep(new THREE.MeshBasicMaterial({ color: '#ff3030' })), frame, 0, 2.95, -1.0);
  const lamp = add(new THREE.SphereGeometry(0.14, 10, 8), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff6e0').multiplyScalar(3) })), frame, 0, 1.0, 1.7);
  lamp.castShadow = false;
  const spot = new THREE.SpotLight('#fff1d6', 0, 70, 0.5, 0.5, 1.2);
  spot.position.set(0, 1.0, 1.8);
  spot.target.position.set(0, -6, 10);
  frame.add(spot, spot.target);
  root.visible = false;
  scene.add(root);

  let state: Heli['state'] = 'hidden';
  let heading = 0;
  let y = 0;
  let vy = 0;
  const vel = new THREE.Vector2();
  let spin = 0;
  let landing = { t: 0, x: 0, z: 0 };
  let tilt = 0;
  let bank = 0;

  return {
    root,
    get state() { return state; },
    get heading() { return heading; },
    get speed() { return vel.length(); },
    arrive(x, z, h) {
      state = 'landing';
      heading = h;
      landing = { t: 0, x, z };
      y = 90;
      root.position.set(x, y, z);
      root.visible = true;
    },
    board() {
      if (state === 'parked') state = 'flying';
    },
    land() {
      if (state !== 'flying' || y > 5) return false;
      state = 'parked';
      vel.set(0, 0);
      return true;
    },
    update(dt, time, input, floorAt) {
      if (state === 'hidden') return;
      const floor = floorAt(root.position.x, root.position.z);
      if (state === 'landing') {
        landing.t = Math.min(1, landing.t + dt / 4);
        const k = 1 - Math.pow(1 - landing.t, 3);
        y = 90 + (floor - 90) * k;
        if (landing.t === 1) state = 'parked';
      } else if (state === 'flying') {
        heading += input.turn * YAW * dt * (0.6 + Math.min(1, vel.length() / TOP) * 0.4);
        const fx = Math.sin(heading), fz = Math.cos(heading);
        const top = input.boost ? BOOST : TOP;
        vel.x += fx * input.forward * ACCEL * dt;
        vel.y += fz * input.forward * ACCEL * dt;
        if (vel.length() > top) vel.setLength(top);
        vel.multiplyScalar(Math.pow(input.forward ? 0.6 : 0.35, dt));
        vy += (input.lift * CLIMB - vy) * Math.min(1, dt * 3);
        root.position.x += vel.x * dt;
        root.position.z += vel.y * dt;
        const margin = 60;
        const push = (v: number, lo: number, hi: number) => (v < lo - margin ? lo - margin - v : v > hi + margin ? hi + margin - v : 0);
        const px = push(root.position.x, limits.minX, limits.maxX), pz = push(root.position.z, limits.minZ, limits.maxZ);
        vel.x += px * dt * 4;
        vel.y += pz * dt * 4;
        y = Math.min(CEILING, y + vy * dt);
        if (y < floor) { y += (floor - y) * Math.min(1, dt * 6); vy = Math.max(0, vy); }
      } else {
        y += (floor - y) * Math.min(1, dt * 4);
      }
      root.position.y = y;
      const powered = state !== 'parked';
      spin += dt * (powered ? 38 : 4);
      rotor.rotation.y = spin;
      tailRotor.rotation.x = spin * 1.6;
      (blur.material as THREE.MeshBasicMaterial).opacity = powered ? 0.18 : 0;
      const fwd = vel.x * Math.sin(heading) + vel.y * Math.cos(heading);
      tilt += ((state === 'flying' ? input.forward * 0.18 + fwd * 0.004 : 0) - tilt) * Math.min(1, dt * 3);
      bank += ((state === 'flying' ? -input.turn * 0.25 : 0) - bank) * Math.min(1, dt * 3);
      frame.rotation.set(tilt, 0, bank);
      root.rotation.y = heading;
      root.position.y += powered && state === 'flying' ? Math.sin(time * 2.1) * 0.05 : 0;
      (beacon.material as THREE.MeshBasicMaterial).color.setScalar(Math.sin(time * 5) > 0.3 ? 3 : 0.2).multiply(new THREE.Color('#ff3030'));
      spot.intensity = powered ? 90 : 0;
    },
    dispose() {
      scene.remove(root);
      spot.dispose();
      owned.forEach((o) => o.dispose());
    },
  };
}
