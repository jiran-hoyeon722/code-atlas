import * as THREE from 'three';

const TOP = 30;
const BOOST = 52;
const STRAFE = 18;
const CLIMB = 9;
const YAW = 1.5;
const CEILING = 220;
const SPIN_UP = 1.4;
const SPIN_DOWN = 3.5;
const TAKEOFF = 3.5;
/** Slower than this counts as hovering, so an auto-landing may touch down. */
export const TOUCHDOWN_SPEED = 3;

export interface HeliInput {
  forward: number;
  /** Positive slides to the right. */
  strafe: number;
  turn: number;
  lift: number;
  boost: boolean;
  /** Heading change from the mouse this frame, in radians. */
  yaw: number;
}

export interface Heli {
  readonly root: THREE.Group;
  readonly state: 'hidden' | 'landing' | 'parked' | 'flying';
  readonly heading: number;
  readonly speed: number;
  /** Height above whatever is below. */
  readonly altitude: number;
  /** Rotor speed from 0 (off) to 1 (flight). */
  readonly rpm: number;
  readonly autoLanding: boolean;
  /** Drops in from the sky and parks at (x, z). */
  arrive(x: number, z: number, heading: number): void;
  board(): void;
  /** Starts an eased descent that ends parked; lifting cancels it. Returns false when not flying. */
  land(): boolean;
  velocity(out: THREE.Vector3): THREE.Vector3;
  /** World position of the left (-1) or right (1) gun muzzle. */
  muzzle(side: number, out: THREE.Vector3): THREE.Vector3;
  /** World position bombs drop from. */
  bay(out: THREE.Vector3): THREE.Vector3;
  fire(side: number): void;
  update(dt: number, time: number, input: HeliInput, floorAt: (x: number, z: number) => number): void;
  dispose(): void;
}

/** Share of the gap to close this frame for an exponential ease at `rate` per second. */
export const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Highest floor under the heli and a little ahead of it, so it climbs before a tall building instead of popping up at the wall. */
export function clearance(floorAt: (x: number, z: number) => number, x: number, z: number, vx: number, vz: number, ahead: readonly number[] = [0.4, 0.9, 1.5]) {
  let floor = floorAt(x, z);
  for (const t of ahead) floor = Math.max(floor, floorAt(x + vx * t, z + vz * t));
  return floor;
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
  const gunmetal = std('#23262d', { metalness: 0.7, roughness: 0.4 });
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
  const GUN_X = 1.3, GUN_Y = 1.15, GUN_Z = 1.75;
  const pylonGeo = keep(new THREE.BoxGeometry(0.7, 0.08, 0.3));
  const podGeo = keep(new THREE.CylinderGeometry(0.13, 0.15, 0.9, 10).rotateX(Math.PI / 2));
  const barrelGeo = keep(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 6).rotateX(Math.PI / 2));
  const flashGeo = keep(new THREE.SphereGeometry(0.22, 8, 6));
  const flashMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a').multiplyScalar(4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const flashes = [-1, 1].map((side) => {
    const pylon = new THREE.Mesh(pylonGeo, gunmetal);
    pylon.position.set(side * 0.95, GUN_Y + 0.05, 0.6);
    const pod = new THREE.Mesh(podGeo, gunmetal);
    pod.position.set(side * GUN_X, GUN_Y, 0.9);
    const barrel = new THREE.Mesh(barrelGeo, gunmetal);
    barrel.position.set(side * GUN_X, GUN_Y, 1.45);
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(side * GUN_X, GUN_Y, GUN_Z + 0.05);
    flash.visible = false;
    frame.add(pylon, pod, barrel, flash);
    return { flash, t: 0 };
  });
  add(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8), metal, frame, 0, 3.05, 0.1);
  const rotor = new THREE.Group();
  rotor.position.set(0, 3.32, 0.1);
  frame.add(rotor);
  const bladeMat = std('#1b1f29');
  for (let k = 0; k < 4; k++) {
    const blade = add(new THREE.BoxGeometry(0.28, 0.04, 5.2), bladeMat, rotor, 0, 0, 2.6);
    const arm = new THREE.Group();
    arm.rotation.y = (k * Math.PI) / 2;
    rotor.add(arm);
    arm.add(blade);
  }
  const blurMat = keep(new THREE.MeshBasicMaterial({ color: '#c8d2e8', transparent: true, opacity: 0, depthWrite: false }));
  const blur = add(new THREE.CircleGeometry(5.3, 40).rotateX(-Math.PI / 2), blurMat, rotor, 0, 0.02, 0);
  blur.castShadow = false;
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.18, 2.55, -5.6);
  frame.add(tailRotor);
  [0, Math.PI / 2].forEach((a) => {
    const b = add(new THREE.BoxGeometry(0.03, 1.1, 0.14), bladeMat, tailRotor);
    b.rotation.x = a;
  });
  const beaconMat = keep(new THREE.MeshBasicMaterial({ color: '#ff3030' }));
  add(new THREE.SphereGeometry(0.12, 10, 8), beaconMat, frame, 0, 2.95, -1.0);
  const beaconColor = new THREE.Color('#ff3030');
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
  let floorSmooth = 0;
  let altitude = 0;
  const vel = new THREE.Vector2();
  const prevVel = new THREE.Vector2();
  const want = new THREE.Vector2();
  const accel = new THREE.Vector2();
  let turnVel = 0;
  let spin = 0;
  let rpm = 0;
  let takeoff = 0;
  let autoLand = false;
  let landing = { t: 0, x: 0, z: 0 };
  let tilt = 0;
  let bank = 0;
  const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  return {
    root,
    get state() { return state; },
    get heading() { return heading; },
    get speed() { return vel.length(); },
    get altitude() { return altitude; },
    get rpm() { return rpm; },
    get autoLanding() { return autoLand; },
    arrive(x, z, h) {
      state = 'landing';
      heading = h;
      landing = { t: 0, x, z };
      y = 90;
      rpm = 1;
      root.position.set(x, y, z);
      root.visible = true;
    },
    board() {
      if (state !== 'parked') return;
      state = 'flying';
      floorSmooth = y;
      vy = 0;
      takeoff = 4;
      autoLand = false;
    },
    land() {
      if (state !== 'flying') return false;
      autoLand = true;
      takeoff = 0;
      return true;
    },
    velocity(out) {
      return out.set(vel.x, state === 'flying' ? vy : 0, vel.y);
    },
    muzzle(side, out) {
      return frame.localToWorld(out.set(Math.sign(side || 1) * GUN_X, GUN_Y, GUN_Z));
    },
    bay(out) {
      return frame.localToWorld(out.set(0, 0.55, 0.3));
    },
    fire(side) {
      const f = flashes[side < 0 ? 0 : 1];
      f.t = 0.05;
      f.flash.rotation.z = Math.random() * Math.PI;
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
        rpm = Math.min(1, rpm + dt / SPIN_UP);
        const power = clampTo((rpm - 0.3) / 0.6, 0, 1);
        const speed = vel.length();
        turnVel += (input.turn * YAW * (0.6 + Math.min(1, speed / TOP) * 0.4) * power - turnVel) * ease(6, dt);
        heading += turnVel * dt + input.yaw * power;
        const fx = Math.sin(heading), fz = Math.cos(heading);
        const rx = -Math.cos(heading), rz = Math.sin(heading);
        const top = (input.boost ? BOOST : TOP) * (input.forward < 0 ? 0.5 : 1) * power;
        want.set(fx * input.forward * top + rx * input.strafe * STRAFE * power, fz * input.forward * top + rz * input.strafe * STRAFE * power);
        prevVel.copy(vel);
        vel.lerp(want, ease(input.forward || input.strafe ? (input.boost ? 1.1 : 0.9) : autoLand ? 1.6 : 1.2, dt));
        const margin = 60;
        const push = (v: number, lo: number, hi: number) => (v < lo - margin ? lo - margin - v : v > hi + margin ? hi + margin - v : 0);
        vel.x += push(root.position.x, limits.minX, limits.maxX) * dt * 4;
        vel.y += push(root.position.z, limits.minZ, limits.maxZ) * dt * 4;
        root.position.x += vel.x * dt;
        root.position.z += vel.y * dt;
        if (dt > 0) accel.lerp(prevVel.subVectors(vel, prevVel).divideScalar(dt), ease(8, dt));

        const ahead = clearance(floorAt, root.position.x, root.position.z, vel.x, vel.y);
        floorSmooth += (ahead - floorSmooth) * ease(ahead > floorSmooth ? 5 : autoLand ? 3 : 1.5, dt);
        if (input.lift) autoLand = false;
        const here = floorAt(root.position.x, root.position.z);
        let wantVy = input.lift * CLIMB * (input.boost ? 1.6 : 1) * power;
        if (autoLand) wantVy = -Math.min(CLIMB * 1.2, (y - here) * 1.4 + 0.8);
        else if (takeoff > 0 && !input.lift) {
          takeoff -= dt;
          wantVy = y - here < TAKEOFF ? 3.2 * power : 0;
        }
        vy += (wantVy - vy) * ease(4, dt);
        y = Math.min(CEILING, y + vy * dt);
        if (y < floorSmooth) { y += (floorSmooth - y) * ease(6, dt); vy = Math.max(0, vy); }
        y = Math.max(y, here - 1.1);
        if (autoLand && y - here < 0.15 && vel.length() < TOUCHDOWN_SPEED) {
          state = 'parked';
          autoLand = false;
        }
      } else {
        rpm = Math.max(0, rpm - dt / SPIN_DOWN);
        vel.multiplyScalar(1 - ease(4, dt));
        accel.multiplyScalar(1 - ease(4, dt));
        turnVel = 0;
        y += (floor - y) * ease(5, dt);
      }
      altitude = Math.max(0, y - floorAt(root.position.x, root.position.z));
      root.position.y = y;
      const flying = state === 'flying';
      spin += dt * 38 * rpm;
      rotor.rotation.y = spin;
      tailRotor.rotation.x = spin * 1.6;
      blurMat.opacity = Math.max(0, rpm - 0.4) * 0.12;
      const sn = Math.sin(heading), cs = Math.cos(heading);
      const fwd = vel.x * sn + vel.y * cs;
      const accF = accel.x * sn + accel.y * cs;
      const accR = -accel.x * cs + accel.y * sn;
      tilt += ((flying ? clampTo(accF * 0.022 + fwd * 0.004, -0.32, 0.38) : 0) - tilt) * ease(4, dt);
      bank += ((flying ? clampTo(-turnVel * 0.3 + accR * 0.022, -0.5, 0.5) : 0) - bank) * ease(4, dt);
      frame.rotation.set(tilt, 0, bank);
      root.rotation.y = heading;
      root.position.y += flying ? Math.sin(time * 2.1) * 0.05 * rpm : 0;
      beaconMat.color.copy(beaconColor).multiplyScalar(Math.sin(time * 5) > 0.3 ? 3 : 0.2);
      spot.intensity = 90 * Math.min(1, rpm * 2);
      flashes.forEach((f) => {
        f.t = Math.max(0, f.t - dt);
        f.flash.visible = f.t > 0;
        f.flash.scale.setScalar(0.7 + Math.random() * 0.6);
      });
      root.updateMatrixWorld();
    },
    dispose() {
      scene.remove(root);
      spot.dispose();
      owned.forEach((o) => o.dispose());
    },
  };
}
