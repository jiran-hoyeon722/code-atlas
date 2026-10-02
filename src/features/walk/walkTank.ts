import * as THREE from 'three';
import type { DifficultyRule } from './walkVirus';

export const TANK = {
  top: 8,
  reverse: 3.5,
  accel: 3,
  brake: 9,
  coast: 3,
  /** Hull turn rate, radians per second; tracks let it pivot on the spot. */
  turn: 1.05,
  turretRate: 2.6,
  reload: 1.2,
  shellSpeed: 60,
  shellRange: 140,
  /** What an elite loses each time the tank runs into it; zombies are crushed outright. */
  crushElite: 35,
  /** Seconds before the same run-over can hurt elites again. */
  crushEvery: 0.6,
  reach: 4.6,
  radius: 1.75,
  half: 1.9,
} as const;

export const SHELL = { damage: 25, radius: 8 } as const;

export interface TankQuest {
  /** Arms the quest for a new outbreak; tiers without a tank leave it off. */
  start(rule: Pick<DifficultyRule, 'tank' | 'tankKills'>): void;
  stop(): void;
  /** Counts one virus kill; true only on the kill that reaches the goal. */
  kill(): boolean;
  readonly active: boolean;
  readonly count: number;
  readonly goal: number;
  readonly done: boolean;
}

export function createTankQuest(): TankQuest {
  let goal = 0;
  let count = 0;
  let done = false;
  return {
    start(rule) {
      goal = rule.tank ? rule.tankKills : 0;
      count = 0;
      done = false;
    },
    stop() {
      goal = 0;
      count = 0;
      done = false;
    },
    kill() {
      if (!goal || done) return false;
      count++;
      done = count >= goal;
      return done;
    },
    get active() { return goal > 0; },
    get count() { return Math.min(count, goal); },
    get goal() { return goal; },
    get done() { return done; },
  };
}

export const tankQuestText = (q: Pick<TankQuest, 'count' | 'goal' | 'done'>) =>
  q.done ? '탱크 퀘스트 완료 — 표시된 탱크에 E 로 탑승' : `탱크 퀘스트: 바이러스 ${q.count} / ${q.goal} 처치`;

export interface TankMotion { x: number; z: number; heading: number; speed: number }
export interface TankDrive { throttle: number; turn: number }

/**
 * One step of heavy tracked driving: slow to build up speed, quick to brake, coasting to a stop.
 * `clear` says whether the hull fits at a pose; returns the speed it hit something at, or 0.
 */
export function driveTank(m: TankMotion, input: TankDrive, dt: number, clear: (x: number, z: number, heading: number) => boolean = () => true): number {
  if (input.throttle > 0) m.speed += (m.speed < 0 ? TANK.brake : TANK.accel) * dt;
  else if (input.throttle < 0) m.speed -= (m.speed > 0 ? TANK.brake : TANK.accel) * dt;
  else m.speed = Math.abs(m.speed) <= TANK.coast * dt ? 0 : m.speed - Math.sign(m.speed) * TANK.coast * dt;
  m.speed = Math.max(-TANK.reverse, Math.min(TANK.top, m.speed));
  // Already overlapping (spawned or shoved into something): let it drive out instead of pinning it forever.
  const stuck = !clear(m.x, m.z, m.heading);
  const ok = (x: number, z: number, h: number) => stuck || clear(x, z, h);
  const turned = m.heading + input.turn * TANK.turn * dt;
  if (ok(m.x, m.z, turned)) m.heading = turned;
  const nx = m.x + Math.sin(m.heading) * m.speed * dt;
  const nz = m.z + Math.cos(m.heading) * m.speed * dt;
  let bump = 0;
  if (ok(nx, m.z, m.heading)) m.x = nx; else bump = Math.abs(m.speed);
  if (ok(m.x, nz, m.heading)) m.z = nz; else bump = Math.abs(m.speed);
  if (bump) m.speed *= 0.4;
  return bump;
}

/** Turns the turret from `current` towards `target` the short way round, no faster than `rate`. */
export function aimTurret(current: number, target: number, dt: number, rate: number = TANK.turretRate) {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  const step = rate * dt;
  return Math.abs(diff) <= step ? current + diff : current + Math.sign(diff) * step;
}

export interface TankInput extends TankDrive {
  /** World heading the turret should point at. */
  aim: number;
}

export interface Tank {
  readonly present: boolean;
  readonly driven: boolean;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  readonly turretYaw: number;
  /** 0 right after a shot, 1 when the next shell is loaded. */
  readonly charge: number;
  /** Still falling in from the sky. */
  readonly dropping: boolean;
  /** True when the hull fits at that pose. */
  fits(x: number, z: number, heading: number): boolean;
  /** Drops the tank in from the sky at (x, z). */
  spawn(x: number, z: number, heading: number): void;
  hide(): void;
  board(): void;
  exit(): void;
  occupied(x: number, z: number, r: number): boolean;
  /** Fires if loaded: writes the muzzle into `out` and kicks the barrel back. */
  fire(out: THREE.Vector3): boolean;
  /** Front and middle of the hull in the direction it is moving, for running things over. */
  front(out: THREE.Vector3): THREE.Vector3;
  update(dt: number, time: number, input: TankInput | null): number;
  dispose(): void;
}

const DROP = 0.9;

export function createTank(scene: THREE.Scene, blocked: (x: number, z: number, r: number) => boolean): Tank {
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => keep(new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.35, ...extra }));
  const additive = (color: string, boost: number, opacity = 1) => keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(boost), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  const olive = mat('#55643a');
  const dark = mat('#3c4728');
  const track = mat('#1a1c20', { roughness: 0.95, metalness: 0.1 });
  const steel = mat('#8a8f96', { metalness: 0.8, roughness: 0.35 });
  const lamp = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2d8').multiplyScalar(2.4) }));
  const box = (w: number, h: number, d: number, m: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  box(2.9, 0.75, 5.4, olive, body, 0, 1.0, 0);
  box(2.7, 0.5, 1.2, dark, body, 0, 0.95, 2.8).rotation.x = -0.45;
  box(3.5, 0.12, 5.6, dark, body, 0, 1.18, 0);
  box(0.3, 0.14, 0.08, lamp, body, -1.05, 1.15, 3.1);
  box(0.3, 0.14, 0.08, lamp, body, 1.05, 1.15, 3.1);
  const wheelGeo = keep(new THREE.CylinderGeometry(0.42, 0.42, 0.5, 14).rotateZ(Math.PI / 2));
  const wheels: THREE.Mesh[] = [];
  [-1, 1].forEach((side) => {
    box(0.75, 0.95, 5.9, track, body, side * 1.45, 0.55, 0);
    for (let k = 0; k < 5; k++) {
      const w = new THREE.Mesh(wheelGeo, steel);
      w.position.set(side * 1.85, 0.5, -2.2 + k * 1.1);
      body.add(w);
      wheels.push(w);
    }
  });
  const turret = new THREE.Group();
  turret.position.set(0, 1.4, -0.3);
  body.add(turret);
  const dome = new THREE.Mesh(keep(new THREE.CylinderGeometry(1.15, 1.35, 0.75, 20)), olive);
  dome.position.y = 0.37;
  dome.castShadow = true;
  turret.add(dome);
  box(1.9, 0.55, 1.1, dark, turret, 0, 0.4, -1.1);
  const hatch = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 14)), dark);
  hatch.position.set(0.45, 0.82, -0.2);
  turret.add(hatch);
  const antenna = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.02, 0.03, 2.2, 5)), steel);
  antenna.position.set(-0.7, 1.8, -1.3);
  turret.add(antenna);
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.42, 0.9);
  turret.add(barrel);
  const tube = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.15, 0.19, 3.6, 12).rotateX(Math.PI / 2).translate(0, 0, 1.8)), steel);
  tube.castShadow = true;
  barrel.add(tube);
  const brake = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.26, 0.26, 0.45, 12).rotateX(Math.PI / 2).translate(0, 0, 3.55)), dark);
  barrel.add(brake);
  const tip = new THREE.Object3D();
  tip.position.set(0, 0, 3.9);
  barrel.add(tip);
  const flash = new THREE.Mesh(keep(new THREE.SphereGeometry(0.55, 12, 8)), additive('#ffc46b', 4));
  flash.position.z = 4.1;
  flash.visible = false;
  barrel.add(flash);

  // The marker floats over the tank until the player climbs in: an arrow, a ground ring and a column seen from afar.
  const marker = new THREE.Group();
  const arrow = new THREE.Mesh(keep(new THREE.ConeGeometry(0.7, 1.4, 4).rotateX(Math.PI)), additive('#ffb347', 2.4));
  const ring = new THREE.Mesh(keep(new THREE.RingGeometry(TANK.reach - 0.35, TANK.reach, 48).rotateX(-Math.PI / 2)), additive('#ffb347', 1.8, 0.8));
  ring.position.y = 0.2;
  const column = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.5, 0.8, 70, 12, 1, true).translate(0, 35, 0)), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb347').multiplyScalar(1.2), transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })));
  column.frustumCulled = false;
  marker.add(arrow, ring, column);
  root.visible = marker.visible = false;
  scene.add(root, marker);

  const m: TankMotion = { x: 0, z: 0, heading: 0, speed: 0 };
  let present = false;
  let driven = false;
  let turretYaw = 0;
  let cool = 0;
  let recoil = 0;
  let flashFor = 0;
  let drop = 0;
  let spin = 0;

  const axis = (x: number, z: number, h: number, k: number): [number, number] => [x + Math.sin(h) * TANK.half * k, z + Math.cos(h) * TANK.half * k];
  const fits = (x: number, z: number, h: number) => [-1, 0, 1].every((k) => {
    const [ax, az] = axis(x, z, h, k);
    return !blocked(ax, az, TANK.radius);
  });
  const place = () => {
    root.position.set(m.x, drop > 0 ? (drop / DROP) ** 2 * 30 : 0, m.z);
    root.rotation.y = m.heading;
    turret.rotation.y = turretYaw - m.heading;
    barrel.position.z = 0.9 - recoil * 0.7;
    body.rotation.x = -recoil * 0.06;
    wheels.forEach((w) => (w.rotation.x = spin));
    marker.position.set(m.x, 0, m.z);
  };

  return {
    get present() { return present; },
    get driven() { return driven; },
    get x() { return m.x; },
    get z() { return m.z; },
    get heading() { return m.heading; },
    get speed() { return m.speed; },
    get turretYaw() { return turretYaw; },
    get charge() { return 1 - cool / TANK.reload; },
    get dropping() { return drop > 0; },
    fits,
    spawn(x, z, heading) {
      Object.assign(m, { x, z, heading, speed: 0 });
      turretYaw = heading;
      present = true;
      driven = false;
      cool = recoil = flashFor = 0;
      drop = DROP;
      root.visible = marker.visible = true;
      place();
    },
    hide() {
      present = driven = false;
      root.visible = marker.visible = false;
    },
    board() {
      if (present) driven = true;
    },
    exit() {
      driven = false;
      m.speed = 0;
    },
    occupied(x, z, r) {
      return present && [-1, 0, 1].some((k) => {
        const [ax, az] = axis(m.x, m.z, m.heading, k);
        return Math.hypot(ax - x, az - z) < TANK.radius + r;
      });
    },
    fire(out) {
      if (!driven || cool > 0 || drop > 0) return false;
      cool = TANK.reload;
      recoil = 1;
      flashFor = 0.09;
      root.updateMatrixWorld(true);
      tip.getWorldPosition(out);
      return true;
    },
    front(out) {
      const k = Math.sign(m.speed || 1);
      return out.set(m.x + Math.sin(m.heading) * TANK.half * k, 0, m.z + Math.cos(m.heading) * TANK.half * k);
    },
    update(dt, time, input) {
      if (!present) return 0;
      let bump = 0;
      if (drop > 0) drop = Math.max(0, drop - dt);
      else if (driven && input) {
        bump = driveTank(m, input, dt, fits);
        turretYaw = aimTurret(turretYaw, input.aim, dt);
      }
      cool = Math.max(0, cool - dt);
      recoil = Math.max(0, recoil - dt * 3.5);
      flashFor = Math.max(0, flashFor - dt);
      flash.visible = flashFor > 0;
      flash.scale.setScalar(1 + (0.09 - flashFor) * 12);
      spin += (m.speed / 0.42) * dt;
      marker.visible = !driven;
      arrow.position.y = 6.2 + Math.sin(time * 3) * 0.35;
      arrow.rotation.y = time * 1.6;
      const pulse = 1 + Math.sin(time * 4) * 0.05;
      ring.scale.set(pulse, 1, pulse);
      place();
      return bump;
    },
    dispose() {
      scene.remove(root, marker);
      owned.forEach((o) => o.dispose());
    },
  };
}
