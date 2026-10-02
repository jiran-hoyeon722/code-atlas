import * as THREE from 'three';
import { spawnRobot, type Robot, type RobotLook } from './walkRobot';
import { turnToward } from './walkMotion';
import type { Decoy } from './walkHorde';
import type { HeldWeapon, WeaponKit } from './walkWeapons';
import { TERRITORY } from './walkTerritory';

const HP = 50;
const SIGHT = 18;
const COOLDOWN = 0.5;
const DAMAGE = 3;
const SPEED = 3.4;
/** Posts farther than this from the player hold without soldiers; nothing fights out there anyway. */
const ACTIVE = 85;
/** Soldier robots are full skinned clones like the foes, so the whole army is capped. */
const CAP = 16;

export const SOLDIER_COLOR = '#5fd0ff';

const mat = (color: string, opts: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...opts });
export const SOLDIER_LOOK: RobotLook = {
  body: '#eef3f8', joint: '#2f6fd0', glow: SOLDIER_COLOR,
  gear({ w, h, d }) {
    const g = new THREE.Group();
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, h * 0.22, d * 1.06), mat('#2f6fd0'));
    helmet.position.y = -h * 0.09;
    g.add(helmet);
    const red = mat('#ff4b5c', { emissive: '#ff2a3d', emissiveIntensity: 0.6 });
    [[w * 0.34, w * 0.1], [w * 0.1, w * 0.34]].forEach(([a, b]) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(a, h * 0.05, b), red);
      bar.position.y = h * 0.03;
      g.add(bar);
    });
    return g;
  },
};

export interface SoldierHooks {
  blocked(x: number, z: number, r: number): boolean;
  clear(ax: number, az: number, bx: number, bz: number): boolean;
  spot(x: number, z: number, min: number, max: number): { x: number; z: number } | null;
  /** A soldier fires from `from` at the foe standing at (x, z). */
  fire(from: THREE.Vector3, x: number, z: number, damage: number): void;
}

export interface Soldiers {
  /** Starts guarding `site` from its door at (x, z). */
  post(site: number, x: number, z: number): void;
  /** The building fell or the outbreak ended: its soldiers vanish. */
  unpost(site: number): void;
  /** Soldiers standing at each post. */
  count(site: number): number;
  readonly decoys: readonly Decoy[];
  update(dt: number, player: { x: number; z: number }, foes: readonly { x: number; z: number; kind: string }[]): void;
  /** Positions for the mini-map. */
  positions(): { x: number; z: number }[];
  clear(): void;
  dispose(): void;
}

type Post = { site: number; x: number; z: number; respawnIn: number; muster: number };
type Soldier = Decoy & { post: Post; robot: Robot | null; held: HeldWeapon; root: THREE.Group; hp: number; heading: number; cooldown: number; dead: number; wander: { x: number; z: number } | null; gone: boolean };

export function createSoldiers(scene: THREE.Scene, url: string, kit: WeaponKit, hooks: SoldierHooks): Soldiers {
  const posts = new Map<number, Post>();
  const army: Soldier[] = [];
  const decoys: Soldier[] = [];
  const aim = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  let disposed = false;

  const remove = (s: Soldier) => {
    s.gone = true;
    s.robot?.dispose();
    s.held.dispose();
    scene.remove(s.root);
    army.splice(army.indexOf(s), 1);
  };
  const enlist = (p: Post) => {
    const at = hooks.spot(p.x, p.z, 0, 6) ?? { x: p.x, z: p.z };
    const root = new THREE.Group();
    root.position.set(at.x, 0.16, at.z);
    scene.add(root);
    const s: Soldier = {
      post: p, robot: null, held: kit.hold(scene, 'smg'), root, hp: HP, heading: 0, cooldown: Math.random() * COOLDOWN, dead: 0, wander: null, gone: false,
      x: at.x, z: at.z,
      hit(damage, fx, fz) {
        if (s.dead || !s.robot) return;
        s.hp -= damage;
        s.heading = Math.atan2(fx - s.x, fz - s.z);
        if (s.hp <= 0) { s.dead = 0.001; s.robot.play('Death', 0.1); } else s.robot.play('No', 0.08);
      },
    };
    army.push(s);
    void spawnRobot(url, 1.75, SOLDIER_LOOK).then((robot) => {
      if (disposed || s.gone) { robot.dispose(); return; }
      s.robot = robot;
      root.add(robot.root);
      robot.play('Idle', 0);
    }).catch(() => remove(s));
  };
  const live = (p: Post) => army.filter((s) => s.post === p && !s.dead).length;

  return {
    get decoys() { return decoys; },
    post(site, x, z) {
      if (!posts.has(site)) posts.set(site, { site, x, z, respawnIn: 0, muster: TERRITORY.squad });
    },
    unpost(site) {
      const p = posts.get(site);
      if (!p) return;
      posts.delete(site);
      army.filter((s) => s.post === p).forEach(remove);
    },
    count(site) {
      const p = posts.get(site);
      return p ? army.filter((s) => s.post === p && !s.dead && s.robot).length : 0;
    },
    positions: () => army.filter((s) => !s.dead && s.robot).map((s) => ({ x: s.x, z: s.z })),
    update(dt, player, foes) {
      // Nearest posts to the player get soldiers first; far ones give theirs back.
      const near = [...posts.values()].map((p) => ({ p, d: Math.hypot(p.x - player.x, p.z - player.z) })).sort((a, b) => a.d - b.d);
      near.forEach(({ p, d }) => { if (d > ACTIVE) army.filter((s) => s.post === p).forEach(remove); });
      near.forEach(({ p, d }) => {
        p.respawnIn -= dt;
        if (d > ACTIVE || army.length >= CAP || p.respawnIn > 0 || live(p) >= TERRITORY.squad) return;
        enlist(p);
        // A freshly taken building turns out its whole squad at once; losses after that trickle back.
        p.muster = Math.max(0, p.muster - 1);
        p.respawnIn = p.muster > 0 ? 0.4 : TERRITORY.respawn;
      });
      decoys.length = 0;
      [...army].forEach((s) => {
        const robot = s.robot;
        if (!robot) return;
        robot.mixer.update(dt);
        if (s.dead) {
          s.dead += dt;
          s.held.follow(robot.root, null, false);
          if (s.dead > 2.5) remove(s);
          return;
        }
        decoys.push(s);
        let target: { x: number; z: number } | null = null;
        let best = SIGHT;
        foes.forEach((f) => {
          const d = Math.hypot(f.x - s.x, f.z - s.z);
          if (d < best && hooks.clear(s.x, s.z, f.x, f.z)) { best = d; target = f; }
        });
        s.cooldown -= dt;
        if (target) {
          const t = target as { x: number; z: number };
          s.heading = turnToward(s.heading, Math.atan2(t.x - s.x, t.z - s.z), dt, 10, 9);
          if (robot.current !== robot.actions.Idle && robot.current !== robot.actions.No) robot.play('Idle', 0.2);
          if (s.cooldown <= 0) {
            s.cooldown = COOLDOWN;
            s.held.kick();
            hooks.fire(s.held.tip(muzzle), t.x, t.z, DAMAGE);
          }
          s.wander = null;
        } else {
          if (!s.wander || Math.hypot(s.wander.x - s.x, s.wander.z - s.z) < 0.6) {
            s.wander = Math.random() < dt * 0.4 ? hooks.spot(s.post.x, s.post.z, 1, 7) : null;
          }
          if (s.wander) {
            const dx = s.wander.x - s.x, dz = s.wander.z - s.z;
            const len = Math.hypot(dx, dz) || 1;
            const nx = s.x + (dx / len) * SPEED * dt, nz = s.z + (dz / len) * SPEED * dt;
            if (hooks.blocked(nx, nz, 0.4)) s.wander = null;
            else { s.x = nx; s.z = nz; }
            s.heading = turnToward(s.heading, Math.atan2(dx, dz), dt, 8, 6);
            robot.play('Walking', 0.3);
          } else if (robot.current !== robot.actions.No || !robot.current.isRunning()) robot.play('Idle', 0.3);
        }
        s.root.position.set(s.x, 0.16, s.z);
        s.root.rotation.y = s.heading;
        aim.set(Math.sin(s.heading), 0, Math.cos(s.heading));
        s.held.follow(robot.root, target ? aim : null, true);
      });
    },
    clear() {
      posts.clear();
      [...army].forEach(remove);
      decoys.length = 0;
    },
    dispose() {
      disposed = true;
      [...army].forEach(remove);
      posts.clear();
    },
  };
}
