import * as THREE from 'three';
import { ease, type Heli } from './walkHeli';
import type { Sparks } from './walkFx';
import type { Tracers } from './walkWeapons';
import { HELI_BOSS_BONUS } from './walkHorde';

export const GUN_COOLDOWN = 0.075;
export const GUN_DAMAGE = 1;
export const GUN_RADIUS = 1.6;
export const BOMB_COOLDOWN = 1.5;
export const BOMB_DAMAGE = 10;
export const BOMB_RADIUS = 10;
export const BOMB_GRAVITY = 24;
const GUN_RANGE = 240;
const BOMBS = 4;
const BLASTS = 5;
const PUFFS = 96;
const BLAST_LIFE = 1.4;

/** Top of the ground or the building at (x, z). */
export type Surface = (x: number, z: number) => number;
export interface Ballistic { x: number; y: number; z: number; vx: number; vy: number; vz: number }
export interface Impact { x: number; y: number; z: number }

/** Moves a falling body by `dt`, exact for constant gravity so the frame rate does not change where it lands. */
export function fall(b: Ballistic, dt: number, g = BOMB_GRAVITY) {
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  b.y += b.vy * dt - 0.5 * g * dt * dt;
  b.vy -= g * dt;
  return b;
}

/** Advances `b` by `dt`; returns where it struck a roof, a wall or the ground during the step, or null while still falling. */
export function stepFall(b: Ballistic, dt: number, surfaceAt: Surface, g = BOMB_GRAVITY): Impact | null {
  const px = b.x, py = b.y, pz = b.z;
  fall(b, dt, g);
  const top = surfaceAt(b.x, b.z);
  if (b.y > top) return null;
  // Still above the surface a step ago means it came down on it; otherwise it flew into a wall.
  const k = py > top ? (py - top) / (py - b.y) : 0;
  return { x: px + (b.x - px) * k, y: Math.max(0, py + (b.y - py) * k), z: pz + (b.z - pz) * k };
}

/** Where a body released with `b`'s position and velocity comes down. */
export function dropPoint(b: Ballistic, surfaceAt: Surface, g = BOMB_GRAVITY, step = 1 / 20, maxT = 12): Impact & { t: number } {
  const p = { ...b };
  for (let t = step; t <= maxT; t += step) {
    const hit = stepFall(p, step, surfaceAt, g);
    if (hit) return { ...hit, t };
  }
  return { x: p.x, y: Math.max(0, p.y), z: p.z, t: maxT };
}

/** Distance along the unit ray from (ox, oy, oz) towards (dx, dy, dz) to the first surface, or `max` when nothing is hit. */
export function rayHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, surfaceAt: Surface, step = 1.5) {
  const below = (t: number) => oy + dy * t <= surfaceAt(ox + dx * t, oz + dz * t);
  let prev = 0;
  for (let t = Math.min(step, max); ; t = Math.min(t + step, max)) {
    if (below(t)) {
      let lo = prev, hi = t;
      for (let k = 0; k < 7; k++) {
        const mid = (lo + hi) / 2;
        if (below(mid)) hi = mid; else lo = mid;
      }
      return hi;
    }
    if (t >= max) return max;
    prev = t;
  }
}

/** Camera shake from a blast `distance` away: strong up close, gone past `reach`. */
export const shakeAt = (distance: number, reach = 80) => Math.max(0, 1 - distance / reach) ** 1.5 * 1.1;

export interface HeliArmsHooks {
  surfaceAt: Surface;
  /** Area damage at a hit point, knocking targets away from (fromX, fromZ); `bossBonus` multiplies what the giant takes. */
  hit(x: number, y: number, z: number, radius: number, damage: number, fromX: number, fromZ: number, bossBonus: number): number;
  blast(x: number, y: number, z: number): void;
  sparks: Sparks;
  tracers: Tracers;
}

export interface HeliArmsInput {
  active: boolean;
  firing: boolean;
  /** Aim angle below the horizon, in radians. */
  pitch: number;
}

export interface HeliArms {
  /** Where the guns point: the first surface along the aim line. */
  readonly aim: THREE.Vector3;
  readonly firing: boolean;
  /** 0 right after a drop, 1 when the next bomb is ready. */
  readonly bombCharge: number;
  bomb(): boolean;
  /** A blast with the bomb's flash, smoke and shake; the hero's rockets and grenades go off through here too, with `bossBonus` 1. */
  explode(p: Impact, radius?: number, damage?: number, bossBonus?: number): void;
  update(dt: number, time: number, input: HeliArmsInput): void;
  dispose(): void;
}

export function createHeliArms(scene: THREE.Scene, heli: Heli, hooks: HeliArmsHooks): HeliArms {
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const additive = (color: string, boost: number) => keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(boost), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));

  const gunMark = new THREE.Group();
  const gunRing = new THREE.Mesh(keep(new THREE.RingGeometry(0.8, 1.0, 32).rotateX(-Math.PI / 2)), additive('#ff4d4d', 2));
  const gunDot = new THREE.Mesh(keep(new THREE.CircleGeometry(0.16, 12).rotateX(-Math.PI / 2)), additive('#ff4d4d', 2));
  const tickGeo = keep(new THREE.PlaneGeometry(0.12, 0.5).rotateX(-Math.PI / 2));
  for (let k = 0; k < 4; k++) {
    const tick = new THREE.Mesh(tickGeo, gunRing.material);
    const a = (k * Math.PI) / 2;
    tick.position.set(Math.sin(a) * 1.3, 0, Math.cos(a) * 1.3);
    tick.rotation.y = a;
    gunRing.add(tick);
  }
  gunMark.add(gunRing, gunDot);
  const bombMat = additive('#ffa53b', 1.6);
  const bombMark = new THREE.Mesh(keep(new THREE.RingGeometry(BOMB_RADIUS * 0.36, BOMB_RADIUS * 0.4, 48).rotateX(-Math.PI / 2)), bombMat);
  gunMark.visible = bombMark.visible = false;
  gunMark.renderOrder = bombMark.renderOrder = 5;
  scene.add(gunMark, bombMark);

  const shellGeo = keep(new THREE.CapsuleGeometry(0.28, 0.9, 4, 10).rotateX(Math.PI / 2));
  const finGeo = keep(new THREE.BoxGeometry(0.7, 0.05, 0.3));
  const shellMat = keep(new THREE.MeshStandardMaterial({ color: '#3b4150', metalness: 0.6, roughness: 0.4 }));
  const stripeMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb347').multiplyScalar(2) }));
  const stripeGeo = keep(new THREE.CylinderGeometry(0.29, 0.29, 0.1, 10).rotateX(Math.PI / 2));
  const bombs = Array.from({ length: BOMBS }, () => {
    const mesh = new THREE.Group();
    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.castShadow = true;
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.z = 0.3;
    mesh.add(shell, stripe);
    [0, Math.PI / 2].forEach((a) => {
      const fin = new THREE.Mesh(finGeo, shellMat);
      fin.position.z = -0.65;
      fin.rotation.z = a;
      mesh.add(fin);
    });
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, live: false, b: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 } as Ballistic };
  });

  const flashGeo = keep(new THREE.SphereGeometry(1, 16, 12));
  const ringGeo = keep(new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2));
  const blasts = Array.from({ length: BLASTS }, () => {
    const flash = new THREE.Mesh(flashGeo, additive('#ffc46b', 4));
    const smoke = new THREE.Mesh(flashGeo, keep(new THREE.MeshBasicMaterial({ color: '#2a2c33', transparent: true, depthWrite: false })));
    const ring = new THREE.Mesh(ringGeo, additive('#ffd9a0', 2.4));
    flash.visible = smoke.visible = ring.visible = false;
    scene.add(smoke, flash, ring);
    return { flash, smoke, ring, age: BLAST_LIFE, radius: BOMB_RADIUS };
  });
  // One light that is always in the scene, so a blast never changes the light count and forces shaders to recompile.
  const blastLight = new THREE.PointLight('#ffb35c', 0, 60, 1.6);
  scene.add(blastLight);

  const puffs = new THREE.InstancedMesh(keep(new THREE.IcosahedronGeometry(0.5, 0)), keep(new THREE.MeshBasicMaterial({ color: '#8d8a84', transparent: true, opacity: 0.45, depthWrite: false })), PUFFS);
  puffs.frustumCulled = false;
  scene.add(puffs);
  const puff = Array.from({ length: PUFFS }, () => ({ x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1 }));
  let nextPuff = 0;
  const m4 = new THREE.Matrix4();
  const qi = new THREE.Quaternion();
  const vp = new THREE.Vector3();
  const vs = new THREE.Vector3();
  const writePuff = (k: number) => {
    const p = puff[k];
    const f = p.life > 0 ? p.life / p.max : 0;
    const grow = p.size * (1 + (1 - f) * 2.2) * Math.min(1, f * 3);
    puffs.setMatrixAt(k, m4.compose(vp.set(p.x, p.y, p.z), qi, vs.setScalar(Math.max(0.0001, grow))));
  };
  for (let k = 0; k < PUFFS; k++) writePuff(k);
  puffs.instanceMatrix.needsUpdate = true;
  const spawnPuffs = (x: number, y: number, z: number, count: number, size: number, speed: number) => {
    for (let n = 0; n < count; n++) {
      const p = puff[nextPuff];
      nextPuff = (nextPuff + 1) % PUFFS;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      Object.assign(p, { x, y: y + 0.2, z, vx: Math.cos(a) * s, vy: 0.8 + Math.random() * speed * 0.4, vz: Math.sin(a) * s, max: 0.6 + Math.random() * 0.8, size: size * (0.6 + Math.random() * 0.8) });
      p.life = p.max;
    }
  };

  const aim = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const end = new THREE.Vector3();
  const heliVel = new THREE.Vector3();
  const bayAt = new THREE.Vector3();
  let aimDist = 0;
  let gunCool = 0;
  let bombCool = 0;
  let side = 1;
  let firing = false;
  let lightFor = 0;

  function shoot() {
    side = -side;
    heli.muzzle(side, muzzle);
    heli.fire(side);
    const spread = 0.5 + aimDist * 0.028;
    end.set(aim.x + (Math.random() - 0.5) * spread * 2, aim.y, aim.z + (Math.random() - 0.5) * spread * 2);
    dir.subVectors(end, muzzle).normalize();
    const d = rayHit(muzzle.x, muzzle.y, muzzle.z, dir.x, dir.y, dir.z, GUN_RANGE, hooks.surfaceAt);
    end.copy(muzzle).addScaledVector(dir, d);
    hooks.tracers.fire(muzzle, end, '#ffd27a');
    if (d >= GUN_RANGE) return;
    hooks.sparks.burst(end.x, end.y + 0.1, end.z, 3);
    if (Math.random() < 0.6) spawnPuffs(end.x, end.y, end.z, 1, 0.55, 1.2);
    hooks.hit(end.x, end.y, end.z, GUN_RADIUS, GUN_DAMAGE, heli.root.position.x, heli.root.position.z, HELI_BOSS_BONUS);
  }

  function explode(p: Impact, radius = BOMB_RADIUS, damage = BOMB_DAMAGE, bossBonus = HELI_BOSS_BONUS) {
    const blast = blasts.reduce((a, c) => (c.age > a.age ? c : a), blasts[0]);
    blast.age = 0;
    blast.radius = radius;
    blast.flash.position.set(p.x, p.y + 1, p.z);
    blast.smoke.position.set(p.x, p.y + 1.5, p.z);
    blast.ring.position.set(p.x, p.y + 0.25, p.z);
    blast.flash.visible = blast.smoke.visible = blast.ring.visible = true;
    blastLight.position.set(p.x, p.y + 4, p.z);
    lightFor = 0.5;
    hooks.sparks.burst(p.x, p.y + 0.5, p.z, 60);
    spawnPuffs(p.x, p.y, p.z, Math.round(radius * 1.6), 1.6 * Math.min(1, radius / 7), radius * 0.7);
    hooks.hit(p.x, p.y, p.z, radius, damage, p.x, p.z, bossBonus);
    hooks.blast(p.x, p.y, p.z);
  }

  const self: HeliArms = {
    aim,
    get firing() { return firing; },
    get bombCharge() { return 1 - Math.max(0, bombCool) / BOMB_COOLDOWN; },
    explode,
    bomb() {
      if (bombCool > 0 || heli.state !== 'flying') return false;
      const slot = bombs.find((b) => !b.live);
      if (!slot) return false;
      heli.bay(bayAt);
      heli.velocity(heliVel);
      Object.assign(slot.b, { x: bayAt.x, y: bayAt.y, z: bayAt.z, vx: heliVel.x, vy: Math.min(0, heliVel.y) - 1.5, vz: heliVel.z });
      slot.live = true;
      slot.mesh.visible = true;
      bombCool = BOMB_COOLDOWN;
      return true;
    },
    update(dt, time, input) {
      bombCool = Math.max(0, bombCool - dt);
      const active = input.active && heli.state === 'flying';
      if (active) {
        const h = heli.heading, p = input.pitch;
        origin.copy(heli.root.position).y += 1.1;
        dir.set(Math.sin(h) * Math.cos(p), -Math.sin(p), Math.cos(h) * Math.cos(p));
        aimDist = rayHit(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, GUN_RANGE, hooks.surfaceAt);
        aim.copy(origin).addScaledVector(dir, aimDist);
        gunMark.position.set(aim.x, aim.y + 0.12, aim.z);
        gunMark.scale.setScalar(Math.max(1, aimDist * 0.035));
        gunRing.rotation.y = time * 1.5;
        heli.bay(bayAt);
        heli.velocity(heliVel);
        const drop = dropPoint({ x: bayAt.x, y: bayAt.y, z: bayAt.z, vx: heliVel.x, vy: Math.min(0, heliVel.y) - 1.5, vz: heliVel.z }, hooks.surfaceAt);
        bombMark.position.set(drop.x, drop.y + 0.1, drop.z);
        bombMat.opacity = bombCool > 0 ? 0.25 : 0.75 + Math.sin(time * 6) * 0.2;
      }
      gunMark.visible = bombMark.visible = active;
      firing = active && input.firing && heli.rpm > 0.8;
      gunCool -= dt;
      if (firing) {
        while (gunCool <= 0) { shoot(); gunCool += GUN_COOLDOWN; }
      } else gunCool = Math.max(0, gunCool);

      bombs.forEach((slot) => {
        if (!slot.live) return;
        const hit = stepFall(slot.b, dt, hooks.surfaceAt);
        const b = slot.b;
        slot.mesh.position.set(b.x, b.y, b.z);
        slot.mesh.lookAt(vp.set(b.x + b.vx, b.y + b.vy, b.z + b.vz));
        if (!hit) return;
        slot.live = false;
        slot.mesh.visible = false;
        explode(hit);
      });

      blasts.forEach((bl) => {
        if (bl.age >= BLAST_LIFE) return;
        bl.age += dt;
        const a = bl.age;
        (bl.flash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - a / 0.35);
        bl.flash.scale.setScalar(1 + Math.min(1, a / 0.2) * 5);
        (bl.smoke.material as THREE.MeshBasicMaterial).opacity = 0.6 * Math.max(0, 1 - a / BLAST_LIFE) * Math.min(1, a / 0.1);
        bl.smoke.scale.setScalar(2 + a * 5);
        bl.smoke.position.y += dt * 2.5;
        const r = Math.min(1, a / 0.6);
        (bl.ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - r);
        bl.ring.scale.setScalar(1 + (1 - (1 - r) ** 2) * bl.radius * 1.4);
        if (a >= BLAST_LIFE) bl.flash.visible = bl.smoke.visible = bl.ring.visible = false;
      });
      lightFor = Math.max(0, lightFor - dt);
      blastLight.intensity = lightFor > 0 ? 900 * (lightFor / 0.5) ** 2 : 0;

      let moved = false;
      for (let k = 0; k < PUFFS; k++) {
        const p = puff[k];
        if (p.life <= 0) continue;
        p.life = Math.max(0, p.life - dt);
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.vx *= 1 - ease(3, dt); p.vz *= 1 - ease(3, dt);
        writePuff(k);
        moved = true;
      }
      if (moved) puffs.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      scene.remove(gunMark, bombMark, puffs, blastLight);
      bombs.forEach((b) => scene.remove(b.mesh));
      blasts.forEach((b) => scene.remove(b.flash, b.smoke, b.ring));
      blastLight.dispose();
      puffs.dispose();
      owned.forEach((o) => o.dispose());
    },
  };
  return self;
}
