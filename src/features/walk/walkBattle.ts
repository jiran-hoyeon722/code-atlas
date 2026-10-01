import * as THREE from 'three';
import { spawnRobot, type Robot } from './walkRobot';
import type { Character } from './walkCharacters';
import { RIVAL_HP, damageAt, dealWeapons, type HeldWeapon, type Weapon, type WeaponKit } from './walkWeapons';

export const RIVALS = ['김준석', '유남균', '김명제', '박호연'];
const UNDRESSED = '#9aa0ad';
const SIGHT = 14;
const GUN_SIGHT = 22;
const WANDER_SPEED = 2.2;
const CHASE_SPEED = 6.2;

export interface BattleHooks {
  blocked(x: number, z: number): boolean;
  /** No building stands between the two points. */
  clear(ax: number, az: number, bx: number, bz: number): boolean;
  random(): number;
  shot(from: THREE.Vector3, to: THREE.Vector3, color: string): void;
  onPlayerHit(damage: number, fromX: number, fromZ: number): void;
  onCaught(name: string, caught: number, total: number): void;
}

export interface Battle {
  update(dt: number, player: THREE.Vector3, playerCanBeHit: boolean): void;
  /** Resolves a melee swing from `at` facing `heading`; returns true when it lands. */
  strike(at: THREE.Vector3, heading: number, weapon: Weapon): boolean;
  /** The rival a shot along `heading` would hit, or -1. */
  aimTarget(at: THREE.Vector3, heading: number, weapon: Weapon): number;
  /** Fires `weapon` along `heading`; returns where the bullet ends so the caller can draw it. */
  shoot(at: THREE.Vector3, heading: number, weapon: Weapon, out: THREE.Vector3): THREE.Vector3;
  /** A vehicle body at (x, z) moving along (dx, dz) at `speed` runs into rivals; returns how many it hit. */
  ram(x: number, z: number, r: number, dx: number, dz: number, speed: number): number;
  /** Rivals stay hidden until each is handed a character, in RIVALS order. */
  dress(looks: Character[]): void;
  /** Who holds what, available before the models finish loading. */
  roster(): { name: string; weapon: Weapon; tint: string; look: string | null }[];
  positions(): { x: number; z: number; down: boolean; tint: string; hp: number; name: string; weapon: Weapon }[];
  readonly caught: number;
  dispose(): void;
}

type Rival = {
  name: string; tint: string; look: Character | null; weapon: Weapon; held: HeldWeapon; robot: Robot | null; root: THREE.Group; hp: number;
  x: number; z: number; heading: number; vx: number; vz: number; aiming: boolean; burst: number;
  target: THREE.Vector2 | null; pause: number; cooldown: number; pendingHit: number; stun: number; down: boolean;
  tag: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; sprite: THREE.Sprite };
};

const angleTo = (at: THREE.Vector3, heading: number, x: number, z: number) => {
  const target = Math.atan2(x - at.x, z - at.z);
  return Math.abs(Math.atan2(Math.sin(target - heading), Math.cos(target - heading)));
};

export function createBattle(scene: THREE.Scene, url: string, spawn: THREE.Vector3, kit: WeaponKit, hooks: BattleHooks): Battle {
  const owned: { dispose(): void }[] = [];
  let disposed = false;
  let caught = 0;
  const aim = new THREE.Vector3();
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();

  const pickSpot = (cx: number, cz: number, min: number, max: number) => {
    for (let k = 0; k < 80; k++) {
      const a = hooks.random() * Math.PI * 2;
      const r = min + hooks.random() * (max - min);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!hooks.blocked(x, z)) return new THREE.Vector2(x, z);
    }
    return new THREE.Vector2(cx, cz);
  };
  const paintTag = (r: Rival) => {
    const ctx = r.tag.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 256, 112);
    ctx.fillStyle = 'rgba(10,12,18,.8)';
    ctx.beginPath();
    ctx.roundRect(8, 6, 240, 100, 16);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = '700 34px system-ui, sans-serif';
    ctx.fillStyle = r.down ? '#9aa0ad' : '#ffffff';
    ctx.fillText(r.down ? `${r.name} 잡았다!` : r.name, 128, 44);
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.fillStyle = r.tint;
    ctx.fillText(r.weapon.name, 128, 72);
    ctx.fillStyle = 'rgba(255,255,255,.15)';
    ctx.fillRect(40, 84, 176, 10);
    ctx.fillStyle = r.tint;
    ctx.fillRect(40, 84, 176 * (r.hp / RIVAL_HP), 10);
    r.tag.tex.needsUpdate = true;
  };

  // Weapons change every visit on purpose, so the tab plays differently each time.
  const dealt = dealWeapons(RIVALS.length, Math.random);
  const rivals: Rival[] = RIVALS.map((name, k) => {
    const at = pickSpot(spawn.x, spawn.z, 22, 42);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 112;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    owned.push(tex);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    owned.push(mat);
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.9, 0.83, 1);
    sprite.position.y = 2.4;
    const root = new THREE.Group();
    root.add(sprite);
    root.position.set(at.x, 0.16, at.y);
    root.visible = false;
    scene.add(root);
    const weapon = dealt[k];
    const r: Rival = {
      name, tint: UNDRESSED, look: null, weapon, held: kit.hold(scene, weapon.id), robot: null, root, hp: RIVAL_HP,
      x: at.x, z: at.y, heading: hooks.random() * Math.PI * 2, vx: 0, vz: 0, aiming: false, burst: 0,
      target: null, pause: 0, cooldown: 0, pendingHit: 0, stun: 0, down: false, tag: { canvas, tex, sprite },
    };
    paintTag(r);
    return r;
  });

  const move = (r: Rival, dx: number, dz: number, speed: number, dt: number) => {
    const len = Math.hypot(dx, dz) || 1;
    const sx = (dx / len) * speed * dt, sz = (dz / len) * speed * dt;
    let moved = false;
    if (!hooks.blocked(r.x + sx, r.z)) { r.x += sx; moved = true; }
    if (!hooks.blocked(r.x, r.z + sz)) { r.z += sz; moved = true; }
    turn(r, dx, dz, dt * 8);
    return moved;
  };
  const turn = (r: Rival, dx: number, dz: number, rate: number) => {
    const target = Math.atan2(dx, dz);
    r.heading += Math.atan2(Math.sin(target - r.heading), Math.cos(target - r.heading)) * Math.min(1, rate);
  };
  const hurt = (r: Rival, damage: number, dx: number, dz: number, push: number, stun: number) => {
    if (!r.robot || r.down) return;
    const d = Math.hypot(dx, dz) || 1;
    r.hp = Math.max(0, r.hp - damage);
    r.vx = (dx / d) * push;
    r.vz = (dz / d) * push;
    r.stun = stun;
    r.pendingHit = 0;
    r.burst = 0;
    if (r.hp <= 0) {
      r.down = true;
      caught++;
      r.robot.play('Death', 0.1);
      hooks.onCaught(r.name, caught, rivals.length);
    } else r.robot.play('No', 0.08);
    paintTag(r);
  };
  const cone = (w: Weapon) => (w.id === 'shotgun' ? 0.32 : 0.2);
  const inSight = (at: THREE.Vector3, heading: number, w: Weapon) => rivals
    .map((r, k) => ({ r, k, d: Math.hypot(r.x - at.x, r.z - at.z), a: angleTo(at, heading, r.x, r.z) }))
    .filter(({ r, d, a }) => r.robot && !r.down && d <= w.range && a <= cone(w) && hooks.clear(at.x, at.z, r.x, r.z))
    .sort((p, c) => p.a * 8 + p.d * 0.05 - (c.a * 8 + c.d * 0.05));

  function rivalFire(r: Rival, player: THREE.Vector3, d: number) {
    const w = r.weapon;
    r.robot?.play('Idle', 0.15);
    r.held.kick();
    const odds = Math.max(0.15, 0.5 - (d / w.range) * 0.35);
    const hit = hooks.random() < odds;
    to.set(player.x, 1.2, player.z);
    if (!hit) to.add(from.set((hooks.random() - 0.5) * 2.4, hooks.random() * 0.8, (hooks.random() - 0.5) * 2.4));
    r.held.tip(from);
    hooks.shot(from, to, '#ff8a6a');
    if (hit) hooks.onPlayerHit(w.id === 'shotgun' ? Math.round(w.rivalDamage * (1 - Math.min(1, d / w.range) * 0.6)) : w.rivalDamage, r.x, r.z);
  }

  return {
    get caught() { return caught; },
    roster: () => rivals.map((r) => ({ name: r.name, weapon: r.weapon, tint: r.tint, look: r.look?.name ?? null })),
    dress(looks) {
      rivals.forEach((r, k) => {
        const look = looks[k];
        if (!look || r.look) return;
        r.look = look;
        r.tint = look.color;
        paintTag(r);
        void spawnRobot(url, 1.75, look).then((robot) => {
          if (disposed) { robot.dispose(); return; }
          r.robot = robot;
          r.root.add(robot.root);
          r.root.visible = true;
          robot.play('Idle', 0);
        }).catch(() => {});
      });
    },
    positions: () => rivals.filter((r) => r.robot).map((r) => ({ x: r.x, z: r.z, down: r.down, tint: r.tint, hp: r.hp, name: r.name, weapon: r.weapon })),
    ram(x, z, radius, dx, dz, speed) {
      if (speed < 4) return 0;
      let count = 0;
      rivals.forEach((r) => {
        if (!r.robot || r.down || r.stun > 0.6) return;
        if (Math.hypot(r.x - x, r.z - z) > radius + 0.45) return;
        count++;
        hurt(r, speed > 14 ? 5 : 3, dx, dz, speed * 0.7, 1.2);
      });
      return count;
    },
    strike(at, heading, w) {
      let landed = false;
      const fx = Math.sin(heading), fz = Math.cos(heading);
      rivals.forEach((r) => {
        if (!r.robot || r.down) return;
        const dx = r.x - at.x, dz = r.z - at.z;
        const d = Math.hypot(dx, dz);
        if (d > w.range || (dx * fx + dz * fz) / (d || 1) < 0.4) return;
        landed = true;
        hurt(r, w.damage, dx, dz, 4 + w.damage * 1.2, 0.5 + w.damage * 0.05);
      });
      return landed;
    },
    aimTarget(at, heading, w) {
      return inSight(at, heading, w)[0]?.k ?? -1;
    },
    shoot(at, heading, w, out) {
      const hits = inSight(at, heading, w);
      (w.id === 'shotgun' ? hits : hits.slice(0, 1)).forEach(({ r, d }) => hurt(r, damageAt(w, d), r.x - at.x, r.z - at.z, w.id === 'shotgun' ? 7 : 2.5, 0.3));
      if (hits.length) return out.set(hits[0].r.x, 1.2, hits[0].r.z);
      let reach = w.range;
      for (let t = 1; t <= w.range; t += 0.75) {
        if (!hooks.clear(at.x, at.z, at.x + Math.sin(heading) * t, at.z + Math.cos(heading) * t)) { reach = t; break; }
      }
      return out.set(at.x + Math.sin(heading) * reach, 1.3, at.z + Math.cos(heading) * reach);
    },
    update(dt, player, playerCanBeHit) {
      rivals.forEach((r) => {
        if (!r.robot) return;
        r.robot.mixer.update(dt);
        r.root.position.set(r.x, 0.16, r.z);
        r.root.rotation.y = r.heading;
        r.robot.root.rotation.y = 0;
        r.aiming = false;
        const gun = r.weapon.kind === 'gun';
        const follow = () => {
          if (r.aiming) aim.set(Math.sin(r.heading), 0, Math.cos(r.heading));
          r.held.follow(r.robot!.root, r.aiming ? aim : null, !r.down);
        };
        if (r.down) { follow(); return; }
        r.cooldown -= dt;
        if (r.stun > 0) {
          r.stun -= dt;
          if (!hooks.blocked(r.x + r.vx * dt, r.z)) r.x += r.vx * dt;
          if (!hooks.blocked(r.x, r.z + r.vz * dt)) r.z += r.vz * dt;
          r.vx *= 0.9; r.vz *= 0.9;
          follow();
          return;
        }
        const dx = player.x - r.x, dz = player.z - r.z;
        const d = Math.hypot(dx, dz);
        const sees = playerCanBeHit && d < (gun ? GUN_SIGHT : SIGHT);
        const reach = gun ? Math.min(r.weapon.range * 0.8, 16) : Math.max(1.7, r.weapon.range * 0.7);
        const inReach = sees && d < reach && (!gun || hooks.clear(r.x, r.z, player.x, player.z));
        if (r.pendingHit > 0) {
          r.pendingHit -= dt;
          if (r.pendingHit <= 0 && playerCanBeHit && d < reach + 0.6) hooks.onPlayerHit(r.weapon.rivalDamage, r.x, r.z);
        }
        if (inReach && gun) {
          turn(r, dx, dz, dt * 10);
          r.aiming = true;
          if (r.cooldown <= 0) {
            rivalFire(r, player, d);
            if (r.weapon.auto && r.burst < 3) { r.burst++; r.cooldown = r.weapon.cooldown * 1.4; }
            else { r.burst = 0; r.cooldown = Math.max(0.9, r.weapon.cooldown * 3); }
          } else if (r.robot.current !== r.robot.actions.Idle) r.robot.play('Idle', 0.2);
        } else if (inReach) {
          turn(r, dx, dz, dt * 10);
          if (r.cooldown <= 0) {
            r.robot.play('Punch', 0.08);
            r.cooldown = Math.max(1.1, r.weapon.cooldown * 2.2);
            r.pendingHit = 0.35;
          } else if (r.robot.current !== r.robot.actions.Punch || !r.robot.current.isRunning()) r.robot.play('Idle', 0.2);
        } else if (sees) {
          move(r, dx, dz, CHASE_SPEED, dt);
          r.robot.play('Running', 0.2);
          r.target = null;
        } else {
          if (r.pause > 0) {
            r.pause -= dt;
            r.robot.play('Idle', 0.3);
            follow();
            return;
          }
          if (!r.target || r.target.distanceTo(new THREE.Vector2(r.x, r.z)) < 1) {
            if (r.target) { r.pause = 1 + hooks.random() * 2.5; r.target = null; follow(); return; }
            r.target = pickSpot(r.x, r.z, 6, 18);
          }
          const moved = move(r, r.target.x - r.x, r.target.y - r.z, WANDER_SPEED, dt);
          if (!moved) r.target = null;
          r.robot.play('Walking', 0.3);
          if (r.robot.current) r.robot.current.timeScale = 0.75;
        }
        follow();
      });
    },
    dispose() {
      disposed = true;
      rivals.forEach((r) => { r.robot?.dispose(); r.held.dispose(); scene.remove(r.root); });
      owned.forEach((o) => o.dispose());
    },
  };
}
