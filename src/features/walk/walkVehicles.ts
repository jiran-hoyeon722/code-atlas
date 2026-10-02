import * as THREE from 'three';
import type { WalkLayout } from './walkLayout';

export type VehicleKind = 'car' | 'bike';

const SPEC = {
  car: { top: 26, boost: 38, accel: 13, brake: 24, steer: 1.9, radius: 1.0, half: 1.55, reach: 3.2 },
  bike: { top: 30, boost: 44, accel: 16, brake: 26, steer: 2.4, radius: 0.45, half: 0.6, reach: 2.4 },
} as const;
const COUNT = { car: 5, bike: 5 };
const PAINT = ['#e8554e', '#3ec48a', '#f2a93b', '#4dabf7', '#e36bd0', '#e9ecef', '#845ef7'];
const RESPAWN_AWAY = 60;
const EXTRA_MAX = 6;

export interface DriveInput { throttle: number; steer: number; boost: boolean; handbrake: boolean }
export interface Impact { x: number; z: number; speed: number }
export interface Vehicle { id: number; kind: VehicleKind; x: number; z: number; heading: number; speed: number; lean: number; group: THREE.Group }

export interface Vehicles {
  nearest(x: number, z: number): Vehicle | null;
  enter(v: Vehicle): void;
  /** Leaves the driven vehicle where it is; it respawns elsewhere once the player walks away. */
  exit(): Vehicle | null;
  readonly driving: Vehicle | null;
  /** Moves the driven vehicle; returns the collision it just had, if any. */
  update(dt: number, input: DriveInput, player: THREE.Vector3): Impact | null;
  /** True when a circle at (x, z) overlaps a parked or driven vehicle body. */
  occupied(x: number, z: number, r: number): boolean;
  /** Knocks the driven vehicle back after hitting something outside this module (traffic, people). */
  bounce(factor: number): void;
  /** Parks one more vehicle at that pose if it fits; past the cap the oldest extra one (not being driven) goes. */
  add(kind: VehicleKind, x: number, z: number, heading: number): Vehicle | null;
  dispose(): void;
}

export function createVehicles(scene: THREE.Scene, layout: WalkLayout, blocked: (x: number, z: number, r: number) => boolean, random: () => number): Vehicles {
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => keep(new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5, ...extra }));
  const glow = (color: string, k: number) => keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) }));
  const tire = mat('#15171c', { roughness: 0.9, metalness: 0 });
  const chrome = mat('#aab1bf', { metalness: 0.9, roughness: 0.2 });
  const glass = mat('#0e1420', { roughness: 0.05, metalness: 0.9 });
  const head = glow('#fff2d8', 2.6);
  const tail = glow('#ff2a2a', 1.8);
  const box = (w: number, h: number, d: number, m: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const wheel = (r: number, w: number, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const m = new THREE.Mesh(keep(new THREE.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2)), tire);
    m.castShadow = true;
    pivot.add(m);
    parent.add(pivot);
    return pivot;
  };

  const buildCar = (paint: THREE.Material) => {
    const g = new THREE.Group();
    const body = new THREE.Group();
    g.add(body);
    box(1.95, 0.55, 4.4, paint, body, 0, 0.62, 0);
    box(1.7, 0.52, 2.3, glass, body, 0, 1.15, -0.2);
    box(1.72, 0.06, 2.1, paint, body, 0, 1.43, -0.25);
    box(1.6, 0.14, 0.06, head, body, 0, 0.7, 2.21);
    box(1.6, 0.12, 0.06, tail, body, 0, 0.72, -2.21);
    box(2.0, 0.14, 0.3, chrome, body, 0, 0.42, 2.12);
    const wheels = [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]].map(([x, z]) => wheel(0.38, 0.3, g, x, 0.38, z));
    return { g, body, wheels, front: wheels.slice(0, 2) };
  };
  const buildBike = (paint: THREE.Material) => {
    const g = new THREE.Group();
    const body = new THREE.Group();
    g.add(body);
    box(0.34, 0.42, 1.25, paint, body, 0, 0.72, 0.05);
    box(0.3, 0.14, 0.7, mat('#1b1f29'), body, 0, 0.98, -0.25);
    box(0.08, 0.6, 0.08, chrome, body, 0, 0.95, 0.72);
    box(0.7, 0.05, 0.05, chrome, body, 0, 1.25, 0.72);
    box(0.2, 0.12, 0.06, head, body, 0, 1.0, 0.8);
    box(0.18, 0.08, 0.05, tail, body, 0, 0.9, -0.62);
    const wheels = [wheel(0.36, 0.14, body, 0, 0.36, 0.78), wheel(0.36, 0.16, body, 0, 0.36, -0.7)];
    return { g, body, wheels, front: [wheels[0]] };
  };

  const spots = () => {
    for (let k = 0; k < 60; k++) {
      const lane = layout.lanes[Math.floor(random() * layout.lanes.length)];
      if (!lane) break;
      const side = random() < 0.5 ? -1 : 1;
      const x = lane.x + (random() - 0.5) * (lane.w - 20);
      const z = lane.z + side * 2.6;
      if (!blocked(x, z, 2)) return { x, z, heading: side < 0 ? Math.PI / 2 : -Math.PI / 2 };
    }
    return { x: 0, z: layout.bounds.maxZ - 12, heading: Math.PI };
  };

  type Unit = Vehicle & { parts: ReturnType<typeof buildCar>; spin: number; steerAngle: number; left: boolean; extra?: boolean };
  let nextId = 0;
  const units: Unit[] = [];
  const build = (kind: VehicleKind, at: { x: number; z: number; heading: number }) => {
    const paint = mat(PAINT[Math.floor(random() * PAINT.length)], { metalness: 0.6, roughness: 0.3 });
    const parts = kind === 'car' ? buildCar(paint) : buildBike(paint);
    const u: Unit = { id: nextId++, kind, x: at.x, z: at.z, heading: at.heading, speed: 0, lean: 0, group: parts.g, parts, spin: 0, steerAngle: 0, left: false };
    scene.add(parts.g);
    units.push(u);
    return u;
  };
  if (layout.lanes.length) (['car', 'bike'] as VehicleKind[]).forEach((kind) => {
    for (let k = 0; k < COUNT[kind]; k++) build(kind, spots());
  });
  const shared = new Set<unknown>([tire, chrome, glass, head, tail]);
  const drop = (u: Unit) => {
    units.splice(units.indexOf(u), 1);
    scene.remove(u.group);
    u.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      if (!shared.has(o.material)) (o.material as THREE.Material).dispose();
    });
  };

  let driving: Unit | null = null;
  const axis = (u: Vehicle, k: number): [number, number] => [u.x + Math.sin(u.heading) * SPEC[u.kind].half * k, u.z + Math.cos(u.heading) * SPEC[u.kind].half * k];
  const touches = (u: Vehicle, x: number, z: number, r: number) => [-1, 0, 1].some((k) => {
    const [ax, az] = axis(u, k);
    return Math.hypot(ax - x, az - z) < SPEC[u.kind].radius + r;
  });
  // The body is three circles along its axis so a car's nose can't poke into walls the way a single circle would.
  const hits = (u: Unit, x: number, z: number, heading: number) => {
    const probe = { ...u, x, z, heading };
    return [-1, 0, 1].some((k) => {
      const [ax, az] = axis(probe, k);
      return blocked(ax, az, SPEC[u.kind].radius) || units.some((o) => o !== u && touches(o, ax, az, SPEC[u.kind].radius));
    });
  };
  const place = (u: Unit) => {
    u.group.position.set(u.x, 0.16, u.z);
    u.group.rotation.y = u.heading;
    u.parts.body.rotation.z = u.lean;
    u.parts.wheels.forEach((w) => (w.children[0].rotation.x = u.spin));
    u.parts.front.forEach((w) => (w.rotation.y = u.steerAngle));
  };
  units.forEach(place);

  return {
    get driving() { return driving; },
    nearest(x, z) {
      let best: Unit | null = null;
      let bestD = Infinity;
      units.forEach((u) => {
        const d = Math.hypot(u.x - x, u.z - z);
        if (u !== driving && d < SPEC[u.kind].reach && d < bestD) { best = u; bestD = d; }
      });
      return best;
    },
    enter(v) {
      driving = units.find((u) => u.id === v.id) ?? null;
      if (driving) driving.left = false;
    },
    exit() {
      const u = driving;
      if (!u) return null;
      u.speed = 0;
      u.left = true;
      driving = null;
      return u;
    },
    occupied: (x, z, r) => units.some((u) => touches(u, x, z, r)),
    bounce(factor) {
      if (driving) driving.speed *= factor;
    },
    add(kind, x, z, heading) {
      const probe = { kind, x, z, heading } as Unit;
      if ([-1, 0, 1].some((k) => {
        const [ax, az] = axis(probe, k);
        return blocked(ax, az, SPEC[kind].radius) || units.some((o) => touches(o, ax, az, SPEC[kind].radius));
      })) return null;
      const extras = units.filter((u) => u.extra && u !== driving);
      if (extras.length >= EXTRA_MAX) drop(extras[0]);
      const u = build(kind, { x, z, heading });
      u.extra = true;
      place(u);
      return u;
    },
    update(dt, input, player) {
      units.forEach((u) => {
        if (u.left && u !== driving && Math.hypot(u.x - player.x, u.z - player.z) > RESPAWN_AWAY) {
          Object.assign(u, spots(), { left: false, speed: 0, lean: 0 });
          place(u);
        }
      });
      const u = driving;
      if (!u) return null;
      const spec = SPEC[u.kind];
      const top = input.boost ? spec.boost : spec.top;
      if (input.throttle > 0) u.speed += spec.accel * dt * (u.speed < 0 ? 2 : 1);
      else if (input.throttle < 0) u.speed -= (u.speed > 0 ? spec.brake : spec.accel * 0.6) * dt;
      else u.speed *= Math.pow(0.55, dt);
      if (input.handbrake) u.speed *= Math.pow(0.02, dt);
      u.speed = Math.max(-8, Math.min(top, u.speed));
      const grip = Math.min(1, Math.abs(u.speed) / 6);
      u.steerAngle += (input.steer * 0.5 - u.steerAngle) * Math.min(1, dt * 8);
      // Already overlapping (spawned or shoved into something): let it drive out instead of pinning it forever.
      const stuck = hits(u, u.x, u.z, u.heading);
      const clear = (x: number, z: number, h: number) => stuck || !hits(u, x, z, h);
      const turned = u.heading + input.steer * spec.steer * grip * Math.sign(u.speed || 1) * dt;
      if (clear(u.x, u.z, turned)) u.heading = turned;
      const nx = u.x + Math.sin(u.heading) * u.speed * dt;
      const nz = u.z + Math.cos(u.heading) * u.speed * dt;
      let impact: Impact | null = null;
      const crash = () => {
        const [fx, fz] = axis(u, Math.sign(u.speed || 1));
        if (Math.abs(u.speed) > 2.5) impact = { x: fx, z: fz, speed: Math.abs(u.speed) };
        u.speed *= -0.3;
      };
      if (clear(nx, u.z, u.heading)) u.x = nx; else crash();
      if (clear(u.x, nz, u.heading)) u.z = nz; else if (!impact) crash();
      u.spin += (u.speed / 0.37) * dt;
      const lean = u.kind === 'bike' ? -input.steer * 0.45 * grip : -input.steer * 0.04 * grip;
      u.lean += (lean - u.lean) * Math.min(1, dt * 6);
      place(u);
      return impact;
    },
    dispose() {
      units.forEach((u) => scene.remove(u.group));
      owned.forEach((o) => o.dispose());
    },
  };
}
