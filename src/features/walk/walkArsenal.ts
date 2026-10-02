import * as THREE from 'three';
import { stepFall, type Ballistic, type Impact, type Surface } from './walkHeliArms';
import type { Motes, Sparks } from './walkFx';
import type { WeaponId, WeaponKit } from './walkWeapons';
import { RARITY_COLOR, rarityOf, type LootDrop, type Rarity } from './walkLoot';

export const ROCKET_SPEED = 28;
export const GRENADE_GRAVITY = 20;
export const GRENADE_FUSE = 1.2;
const GRENADE_FLIGHT = 0.85;
const ROCKETS = 6;
const GRENADES = 6;
const BEAMS = 6;
const BEAM_LIFE = 0.2;

export interface ShotHooks {
  surfaceAt: Surface;
  /** Walls that reach above height `y`, props, and the city edge. */
  blocked(x: number, y: number, z: number): boolean;
  /** A foe or rival close enough at (x, z) for a direct hit. */
  touches(x: number, y: number, z: number): boolean;
  explode(p: Impact, radius: number, damage: number): void;
  sparks: Sparks;
  smoke: Motes;
  fire: Motes;
}

export interface Shots {
  /** With a `target` well below the muzzle (fired from a roof) the rocket dives at it; otherwise it flies level. */
  rocket(from: THREE.Vector3, heading: number, range: number, radius: number, damage: number, speed?: number, target?: Point3 | null): void;
  /** Lobs a grenade so it lands about `distance` ahead; it goes off on impact or when the fuse burns down. */
  grenade(from: THREE.Vector3, heading: number, distance: number, radius: number, damage: number): void;
  beam(from: THREE.Vector3, to: THREE.Vector3, color: string, width: number): void;
  flame(from: THREE.Vector3, heading: number, length: number): void;
  update(dt: number): void;
  dispose(): void;
}

type Point3 = { x: number; y: number; z: number };
const DIVE_MIN = 1.5;

/** Unit flight direction along `heading`, tilted down onto `target` when it sits at least DIVE_MIN below `from`. */
export function rocketDir(heading: number, from: Point3, target?: Point3 | null) {
  const dx = Math.sin(heading), dz = Math.cos(heading);
  const fall = target ? from.y - target.y : 0;
  if (!target || fall < DIVE_MIN) return { dx, dy: 0, dz };
  const run = Math.max(0.5, Math.hypot(target.x - from.x, target.z - from.z));
  const len = Math.hypot(run, fall);
  return { dx: (dx * run) / len, dy: -fall / len, dz: (dz * run) / len };
}

export function createShots(scene: THREE.Scene, hooks: ShotHooks): Shots {
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const additive = (color: string, boost: number) => keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(boost), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));

  const bodyMat = keep(new THREE.MeshStandardMaterial({ color: '#4f5a2e', roughness: 0.6 }));
  const tipMat = keep(new THREE.MeshStandardMaterial({ color: '#c92a2a', roughness: 0.5 }));
  const jetMat = additive('#ffb347', 3);
  const bodyGeo = keep(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 10).rotateX(Math.PI / 2));
  const tipGeo = keep(new THREE.ConeGeometry(0.07, 0.18, 10).rotateX(Math.PI / 2).translate(0, 0, 0.39));
  const jetGeo = keep(new THREE.SphereGeometry(0.12, 8, 6).translate(0, 0, -0.36));
  const rockets = Array.from({ length: ROCKETS }, () => {
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(bodyGeo, bodyMat), new THREE.Mesh(tipGeo, tipMat), new THREE.Mesh(jetGeo, jetMat));
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, live: false, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, left: 0, radius: 0, damage: 0, speed: ROCKET_SPEED };
  });

  const nadeGeo = keep(new THREE.SphereGeometry(0.13, 10, 8));
  const grenades = Array.from({ length: GRENADES }, () => {
    const mesh = new THREE.Mesh(nadeGeo, bodyMat);
    mesh.castShadow = true;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, live: false, fuse: 0, radius: 0, damage: 0, b: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 } as Ballistic };
  });

  // A unit tube from z = 0 to z = 1, so one scale stretches it from the muzzle to the end point.
  const tubeGeo = keep(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5));
  const coreMat = additive('#ffffff', 2.5);
  const beams = Array.from({ length: BEAMS }, () => {
    const glowMat = additive('#ff4df0', 2.5);
    const group = new THREE.Group();
    const glow = new THREE.Mesh(tubeGeo, glowMat);
    const core = new THREE.Mesh(tubeGeo, coreMat);
    group.add(glow, core);
    group.visible = false;
    scene.add(group);
    return { group, glow, core, glowMat, age: BEAM_LIFE, width: 0.1 };
  });

  const v = new THREE.Vector3();
  function explode(p: Impact, radius: number, damage: number) {
    hooks.explode(p, radius, damage);
  }

  return {
    rocket(from, heading, range, radius, damage, speed = ROCKET_SPEED, target) {
      const r = rockets.find((o) => !o.live) ?? rockets[0];
      const y = Math.max(0.6, from.y);
      Object.assign(r, { live: true, x: from.x, y, z: from.z, ...rocketDir(heading, { x: from.x, y, z: from.z }, target), left: range, radius, damage, speed });
      r.mesh.visible = true;
      r.mesh.position.set(r.x, r.y, r.z);
      r.mesh.lookAt(v.set(r.x + r.dx, r.y + r.dy, r.z + r.dz));
    },
    grenade(from, heading, distance, radius, damage) {
      const g = grenades.find((o) => !o.live) ?? grenades[0];
      const t = GRENADE_FLIGHT;
      const speed = distance / t;
      Object.assign(g.b, { x: from.x, y: from.y, z: from.z, vx: Math.sin(heading) * speed, vy: (GRENADE_GRAVITY * t) / 2 - from.y / t, vz: Math.cos(heading) * speed });
      Object.assign(g, { live: true, fuse: GRENADE_FUSE, radius, damage });
      g.mesh.visible = true;
      g.mesh.position.set(from.x, from.y, from.z);
    },
    beam(from, to, color, width) {
      const b = beams.reduce((a, c) => (c.age > a.age ? c : a), beams[0]);
      b.age = 0;
      b.width = width;
      b.glowMat.color.set(color).multiplyScalar(2.5);
      b.group.position.copy(from);
      b.group.lookAt(to);
      const len = from.distanceTo(to);
      b.glow.scale.set(width, width, len);
      b.core.scale.set(width * 0.35, width * 0.35, len);
      b.group.visible = true;
    },
    flame(from, heading, length) {
      const dx = Math.sin(heading), dz = Math.cos(heading);
      for (let k = 0; k < 5; k++) {
        const t = (0.15 + Math.random() * 0.85) * length;
        const side = (Math.random() - 0.5) * t * 0.35;
        hooks.fire.burst(from.x + dx * t + dz * side, from.y - t * 0.04, from.z + dz * t - dx * side, 3, 1.2 + t * 0.2, 1.2, 0.35);
      }
    },
    update(dt) {
      rockets.forEach((r) => {
        if (!r.live) return;
        const step = r.speed * dt;
        const n = Math.max(1, Math.ceil(step / 0.5));
        for (let k = 0; k < n; k++) {
          r.x += (r.dx * step) / n;
          r.y += (r.dy * step) / n;
          r.z += (r.dz * step) / n;
          r.left -= step / n;
          if (r.left <= 0 || hooks.blocked(r.x, r.y, r.z) || hooks.surfaceAt(r.x, r.z) > r.y || hooks.touches(r.x, r.y, r.z)) {
            r.live = false;
            r.mesh.visible = false;
            explode({ x: r.x - r.dx * 0.3, y: Math.max(0, r.y - r.dy * 0.3 - 1), z: r.z - r.dz * 0.3 }, r.radius, r.damage);
            return;
          }
        }
        r.mesh.position.set(r.x, r.y, r.z);
        hooks.smoke.burst(r.x - r.dx * 0.4, r.y - r.dy * 0.4, r.z - r.dz * 0.4, 2, 0.4, 0.4, 0.6);
      });
      grenades.forEach((g) => {
        if (!g.live) return;
        g.fuse -= dt;
        const hit = stepFall(g.b, dt, hooks.surfaceAt, GRENADE_GRAVITY);
        const b = g.b;
        g.mesh.position.set(b.x, b.y, b.z);
        g.mesh.rotation.x += dt * 12;
        if (!hit && g.fuse > 0 && !hooks.blocked(b.x, b.y, b.z) && !hooks.touches(b.x, b.y, b.z)) return;
        g.live = false;
        g.mesh.visible = false;
        explode(hit ?? { x: b.x, y: Math.max(0, b.y - 1), z: b.z }, g.radius, g.damage);
      });
      beams.forEach((b) => {
        if (b.age >= BEAM_LIFE) return;
        b.age += dt;
        const f = Math.max(0, 1 - b.age / BEAM_LIFE);
        b.glowMat.opacity = f;
        b.glow.scale.x = b.glow.scale.y = b.width * (0.6 + f * 0.4);
        if (b.age >= BEAM_LIFE) b.group.visible = false;
      });
    },
    dispose() {
      rockets.forEach((r) => scene.remove(r.mesh));
      grenades.forEach((g) => scene.remove(g.mesh));
      beams.forEach((b) => scene.remove(b.group));
      owned.forEach((o) => o.dispose());
    },
  };
}

export interface Pickups {
  /** Rebuilds the pickup at `k` to match its drop (shown, hidden or a new weapon). */
  sync(k: number, drop: LootDrop): void;
  update(time: number): void;
  dispose(): void;
}

const BEAM_HEIGHT = 12;
const BEAM_PULSE: Record<Rarity, { base: number; amp: number; rate: number }> = {
  common: { base: 0.45, amp: 0.1, rate: 2 },
  uncommon: { base: 0.5, amp: 0.12, rate: 2 },
  rare: { base: 0.55, amp: 0.15, rate: 2.4 },
  legendary: { base: 0.8, amp: 0.2, rate: 3.2 },
};

// Floating weapon models over a rarity-coloured ring and a tall light beam seen from afar; no real lights, so the shader count never changes.
export function createPickups(scene: THREE.Scene, kit: WeaponKit, drops: readonly LootDrop[]): Pickups {
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const ringGeo = keep(new THREE.RingGeometry(0.55, 0.78, 32).rotateX(-Math.PI / 2));
  const beamGeo = keep(new THREE.CylinderGeometry(0.3, 0.55, BEAM_HEIGHT, 16, 6, true).translate(0, BEAM_HEIGHT / 2, 0));
  // Additive blending turns black into nothing, so vertex colours fading to black give the beam a soft top without a texture.
  const beamPos = beamGeo.getAttribute('position');
  const fade = new Float32Array(beamPos.count * 3);
  for (let k = 0; k < beamPos.count; k++) fade.fill((1 - beamPos.getY(k) / BEAM_HEIGHT) ** 1.6, k * 3, k * 3 + 3);
  beamGeo.setAttribute('color', new THREE.BufferAttribute(fade, 3));
  const mats = new Map<Rarity, { ring: THREE.Material; beam: THREE.MeshBasicMaterial }>();
  (Object.keys(RARITY_COLOR) as Rarity[]).forEach((r) => {
    const c = new THREE.Color(RARITY_COLOR[r]);
    mats.set(r, {
      ring: keep(new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2.2), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })),
      beam: keep(new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(r === 'legendary' ? 2 : 1.4), vertexColors: true, transparent: true, opacity: BEAM_PULSE[r].base, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })),
    });
  });
  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  const items = drops.map(() => {
    const root = new THREE.Group();
    const ring = new THREE.Mesh(ringGeo);
    ring.position.y = 0.2;
    const beam = new THREE.Mesh(beamGeo);
    const holder = new THREE.Group();
    root.add(ring, beam, holder);
    root.visible = false;
    scene.add(root);
    return { root, ring, beam, holder, id: null as WeaponId | null };
  });
  const self: Pickups = {
    sync(k, drop) {
      const it = items[k];
      if (!it) return;
      it.root.visible = drop.live;
      if (!drop.live) return;
      it.root.position.set(drop.x, 0, drop.z);
      if (it.id === drop.id) return;
      it.id = drop.id;
      const m = mats.get(rarityOf(drop.id))!;
      it.ring.material = m.ring;
      it.beam.material = m.beam;
      it.holder.clear();
      const model = kit.model(drop.id);
      const s = (drop.id === 'grenade' ? 4 : drop.id === 'pistol' ? 2.8 : 2.1) * 1.5;
      model.scale.setScalar(s);
      box.setFromObject(model).getCenter(center);
      model.position.sub(center);
      it.holder.add(model);
    },
    update(time) {
      mats.forEach((m, r) => { const p = BEAM_PULSE[r]; m.beam.opacity = p.base + Math.sin(time * p.rate) * p.amp; });
      items.forEach((it, k) => {
        if (!it.root.visible) return;
        it.holder.position.y = 1.2 + Math.sin(time * 2 + k) * 0.15;
        it.holder.rotation.y = time * 1.4 + k;
        it.ring.rotation.y = -time * 0.8;
      });
    },
    dispose() {
      items.forEach((it) => scene.remove(it.root));
      owned.forEach((o) => o.dispose());
    },
  };
  drops.forEach((d, k) => self.sync(k, d));
  return self;
}
