import * as THREE from 'three';
import { spawnRobot, type Robot } from './walkRobot';

export const RIVALS: { name: string; tint: string }[] = [
  { name: '김준석', tint: '#e8554e' },
  { name: '유남균', tint: '#3ec48a' },
  { name: '김명제', tint: '#f2a93b' },
  { name: '박호연', tint: '#e36bd0' },
];
const HP = 3;
const SIGHT = 14;
const REACH = 1.7;
const WANDER_SPEED = 2.2;
const CHASE_SPEED = 6.2;
const DAMAGE = 12;

export interface BattleHooks {
  blocked(x: number, z: number): boolean;
  random(): number;
  onPlayerHit(damage: number, fromX: number, fromZ: number): void;
  onCaught(name: string, caught: number, total: number): void;
}

export interface Battle {
  update(dt: number, player: THREE.Vector3, playerCanBeHit: boolean): void;
  /** Resolves a punch from `at` facing `heading`; returns true when it lands. */
  strike(at: THREE.Vector3, heading: number): boolean;
  positions(): { x: number; z: number; down: boolean; tint: string }[];
  readonly caught: number;
  dispose(): void;
}

type Rival = {
  name: string; tint: string; robot: Robot | null; root: THREE.Group; hp: number;
  x: number; z: number; heading: number; vx: number; vz: number;
  target: THREE.Vector2 | null; pause: number; cooldown: number; pendingHit: number; stun: number; down: boolean;
  tag: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; sprite: THREE.Sprite };
};

export function createBattle(scene: THREE.Scene, url: string, spawn: THREE.Vector3, hooks: BattleHooks): Battle {
  const owned: { dispose(): void }[] = [];
  let disposed = false;
  let caught = 0;

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
    ctx.clearRect(0, 0, 256, 96);
    ctx.fillStyle = 'rgba(10,12,18,.8)';
    ctx.beginPath();
    ctx.roundRect(8, 6, 240, 84, 16);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = '700 36px system-ui, sans-serif';
    ctx.fillStyle = r.down ? '#9aa0ad' : '#ffffff';
    ctx.fillText(r.down ? `${r.name} 잡았다!` : r.name, 128, 48);
    for (let k = 0; k < HP; k++) {
      ctx.fillStyle = k < r.hp ? r.tint : 'rgba(255,255,255,.15)';
      ctx.fillRect(128 - HP * 22 + k * 44 + 4, 62, 36, 12);
    }
    r.tag.tex.needsUpdate = true;
  };

  const rivals: Rival[] = RIVALS.map(({ name, tint }) => {
    const at = pickSpot(spawn.x, spawn.z, 22, 42);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    owned.push(tex);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    owned.push(mat);
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.9, 0.72, 1);
    sprite.position.y = 2.35;
    const root = new THREE.Group();
    root.add(sprite);
    root.position.set(at.x, 0.16, at.y);
    root.visible = false;
    scene.add(root);
    const r: Rival = { name, tint, robot: null, root, hp: HP, x: at.x, z: at.y, heading: hooks.random() * Math.PI * 2, vx: 0, vz: 0, target: null, pause: 0, cooldown: 0, pendingHit: 0, stun: 0, down: false, tag: { canvas, tex, sprite } };
    paintTag(r);
    void spawnRobot(url, 1.75, tint).then((robot) => {
      if (disposed) { robot.dispose(); return; }
      r.robot = robot;
      root.add(robot.root);
      root.visible = true;
      robot.play('Idle', 0);
    });
    return r;
  });

  const move = (r: Rival, dx: number, dz: number, speed: number, dt: number) => {
    const len = Math.hypot(dx, dz) || 1;
    const sx = (dx / len) * speed * dt, sz = (dz / len) * speed * dt;
    let moved = false;
    if (!hooks.blocked(r.x + sx, r.z)) { r.x += sx; moved = true; }
    if (!hooks.blocked(r.x, r.z + sz)) { r.z += sz; moved = true; }
    const target = Math.atan2(dx, dz);
    r.heading += Math.atan2(Math.sin(target - r.heading), Math.cos(target - r.heading)) * Math.min(1, dt * 8);
    return moved;
  };

  return {
    get caught() { return caught; },
    positions: () => rivals.filter((r) => r.robot).map((r) => ({ x: r.x, z: r.z, down: r.down, tint: r.tint })),
    strike(at, heading) {
      let landed = false;
      const fx = Math.sin(heading), fz = Math.cos(heading);
      rivals.forEach((r) => {
        if (!r.robot || r.down) return;
        const dx = r.x - at.x, dz = r.z - at.z;
        const d = Math.hypot(dx, dz);
        if (d > 2.2 || (dx * fx + dz * fz) / (d || 1) < 0.45) return;
        landed = true;
        r.hp -= 1;
        r.vx = (dx / (d || 1)) * 6;
        r.vz = (dz / (d || 1)) * 6;
        r.stun = 0.55;
        r.pendingHit = 0;
        if (r.hp <= 0) {
          r.down = true;
          caught++;
          r.robot.play('Death', 0.1);
          hooks.onCaught(r.name, caught, rivals.length);
        } else {
          r.robot.play('No', 0.08);
        }
        paintTag(r);
      });
      return landed;
    },
    update(dt, player, playerCanBeHit) {
      rivals.forEach((r) => {
        if (!r.robot) return;
        r.robot.mixer.update(dt);
        r.root.position.set(r.x, 0.16, r.z);
        r.root.rotation.y = r.heading;
        r.robot.root.rotation.y = 0;
        if (r.down) return;
        r.cooldown -= dt;
        if (r.stun > 0) {
          r.stun -= dt;
          if (!hooks.blocked(r.x + r.vx * dt, r.z)) r.x += r.vx * dt;
          if (!hooks.blocked(r.x, r.z + r.vz * dt)) r.z += r.vz * dt;
          r.vx *= 0.9; r.vz *= 0.9;
          return;
        }
        const dx = player.x - r.x, dz = player.z - r.z;
        const d = Math.hypot(dx, dz);
        const sees = playerCanBeHit && d < SIGHT;
        if (r.pendingHit > 0) {
          r.pendingHit -= dt;
          if (r.pendingHit <= 0 && playerCanBeHit && d < REACH + 0.6) hooks.onPlayerHit(DAMAGE, r.x, r.z);
        }
        if (sees && d < REACH) {
          const target = Math.atan2(dx, dz);
          r.heading += Math.atan2(Math.sin(target - r.heading), Math.cos(target - r.heading)) * Math.min(1, dt * 10);
          if (r.cooldown <= 0) {
            r.robot.play('Punch', 0.08);
            r.cooldown = 1.5;
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
            return;
          }
          if (!r.target || r.target.distanceTo(new THREE.Vector2(r.x, r.z)) < 1) {
            if (r.target) { r.pause = 1 + hooks.random() * 2.5; r.target = null; return; }
            r.target = pickSpot(r.x, r.z, 6, 18);
          }
          const moved = move(r, r.target.x - r.x, r.target.y - r.z, WANDER_SPEED, dt);
          if (!moved) r.target = null;
          r.robot.play('Walking', 0.3);
          if (r.robot.current) r.robot.current.timeScale = 0.75;
        }
      });
    },
    dispose() {
      disposed = true;
      rivals.forEach((r) => { r.robot?.dispose(); scene.remove(r.root); });
      owned.forEach((o) => o.dispose());
    },
  };
}
