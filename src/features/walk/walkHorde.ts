import * as THREE from 'three';
import { spawnRobot, type Robot } from './walkRobot';
import { apart, decay, nextGait, separationInto, turnToward, within, type Gait } from './walkMotion';
import { damageAt, inBeam, splash, type Weapon } from './walkWeapons';
import type { Motes } from './walkFx';

export type FoeKind = 'zombie' | 'elite' | 'boss';

interface FoeRule {
  /** Size relative to the player's robot. */
  scale: number;
  hp: number;
  speed: number;
  /** Melee reach beyond the body radius. */
  reach: number;
  damage: number;
  radius: number;
  cooldown: number;
  sight: number;
  /** How much knockback and stun a hit does. */
  give: number;
}

export const FOES: Record<FoeKind, FoeRule> = {
  zombie: { scale: 0.95, hp: 6, speed: 2.4, reach: 1.1, damage: 6, radius: 0.45, cooldown: 1.3, sight: 55, give: 1 },
  elite: { scale: 2.3, hp: 40, speed: 1.9, reach: 1.9, damage: 16, radius: 1.1, cooldown: 1.9, sight: 75, give: 0.3 },
  boss: { scale: 7, hp: 300, speed: 2.4, reach: 0, damage: 26, radius: 3.2, cooldown: 0, sight: Infinity, give: 0 },
};
const ROBOT_H = 1.75;
const RISE = 1.1;
const GONE = 2.6;
const DESPAWN = 110;
/** A chaser left this far behind is brought back near the player instead of trudging across the city. */
export const RECALL = 140;
/** Seconds before the same foe can be recalled again. */
export const RECALL_COOLDOWN = 8;
/** Seconds before trying again when there was no free spot to recall a foe to. */
export const RECALL_RETRY = 1.5;
/** A chaser that has moved less than STUCK_MOVE in STUCK_FOR seconds is wedged somewhere and gets recalled too. */
export const STUCK_FOR = 6;
const STUCK_MOVE = 1.5;
/** Stuck foes this close are just held up by the crowd round the player, not wedged. */
const STUCK_NEAR = 25;
/** Foes this far off animate every third frame. */
const FAR_ANIM = 70;
/** How many robots `warm` loads per frame, so a big warm-up does not clone them all in one hitch. */
const WARM_PER_FRAME = 4;
const SLAM_EVERY = 6.5;
const SLAM_RADIUS = 22;
const SLAM_SPEED = 20;
const ORB_EVERY = 2.8;
const ORB_SPEED = 17;
const ORB_DAMAGE = 12;
/** Elites lob a slow orb at a player they cannot reach: up on a roof, or out of arm's length. */
export const THROW = { every: 3.5, range: 22, damage: 8, speed: 11, gravity: 9.8 } as const;
const MINION_EVERY = 11;
const MINIONS = 3;
const MINION_CAP = 9;
// Every foe is a full skinned robot clone, so this caps the crowd for the frame rate; the hardest virus caps sit above it on purpose.
const POOL = 64;
/** Heli fire hurts the giant this much more than a zombie. */
export const HELI_BOSS_BONUS = 2.5;

/** Walking speed that closes the gap to `stop` without overshooting it in one frame, so a foe settles instead of jittering on the spot. */
export const approach = (distance: number, stop: number, speed: number, dt: number) => Math.min(speed, Math.max(0, distance - stop) / Math.max(dt, 1e-3));

/** Whether a foe goes for the player; a chaser always does, whatever the distance. */
export const seesPlayer = (kind: FoeKind, d: number, chase: boolean) => (chase && kind !== 'boss') || d < FOES[kind].sight;

/** What happens to a far-off foe: zombies wander off and vanish, unless chasing, when stragglers are recalled near the player. */
export function straggler(kind: FoeKind, d: number, chase: boolean, stuck = false): 'keep' | 'release' | 'recall' {
  if (kind === 'boss') return 'keep';
  if (chase) return d > RECALL || stuck ? 'recall' : 'keep';
  return kind === 'zombie' && d > DESPAWN ? 'release' : 'keep';
}

/** Whether a foe due for recall goes now: never while the player flies (it would only fall behind again), and not before its wait runs out. */
export const recallNow = (wait: number, flying: boolean) => !flying && wait <= 0;

const STEER = [0, 1, -1, 2, -2].map((k) => (k * Math.PI) / 4);

/** The first heading off (dx, dz) — straight, then ±45°, then ±90°, `side` first — whose step `free` allows, as a unit vector, or null. */
export function steer(dx: number, dz: number, side: 1 | -1, free: (ux: number, uz: number) => boolean): [number, number] | null {
  const base = Math.atan2(dx, dz);
  for (const a of STEER) {
    const h = base + a * side;
    const ux = Math.sin(h), uz = Math.cos(h);
    if (free(ux, uz)) return [ux, uz];
  }
  return null;
}

/** Whether an elite that sees the player throws instead of only closing in: too high or too far to hit, yet within throwing range. */
export const eliteThrows = (d: number, playerY: number, hitReach: number) => d <= THROW.range && (playerY >= 2 || d > hitReach);

/** Shamblers never break into a run, whatever speed they end up at. */
export const shamble = (prev: Gait, speed: number): Gait => (nextGait(prev, speed) === 'Idle' ? 'Idle' : 'Walking');

/** Per-spawn overrides, so the same bodies can play monsters other than the virus. */
export interface FoeStyle {
  hp?: number;
  /** Multiplies the kind's walking speed. */
  speed?: number;
  /** Multiplies the kind's hit damage. */
  damage?: number;
  color?: string;
  /** See-through body. */
  ghost?: boolean;
  /** Name shown over the head with a health bar. */
  label?: string | null;
  /** Comes back through onKill and positions(). */
  tag?: string;
}

export interface HordeHooks {
  blocked(x: number, z: number, r: number): boolean;
  clear(ax: number, az: number, bx: number, bz: number): boolean;
  /** A free spot between `min` and `max` from (x, z), or null. */
  spot(x: number, z: number, min: number, max: number): { x: number; z: number } | null;
  onPlayerHit(damage: number, fromX: number, fromZ: number, push: number, from: FoeKind): void;
  /** (x, z) is where the foe fell. */
  onKill(kind: FoeKind, tag: string | undefined, x: number, z: number): void;
  onBossDown(): void;
  /** The giant's slam hit the ground at (x, z). */
  onQuake(x: number, z: number): void;
}

/** Something on the street other than the player that foes go for when it is nearer, e.g. a vaccine soldier. */
export interface Decoy { x: number; z: number; hit(damage: number, fromX: number, fromZ: number): void }
/** Foes leave the player for a decoy this close that is nearer than the player. */
export const DECOY_SIGHT = 14;
export interface HordePlayer { x: number; z: number; y: number; flying?: boolean; decoys?: readonly Decoy[] }

/** The decoy a foe at (x, z) goes for instead of a player `playerD` away, or null. */
export function preyOf(decoys: readonly Decoy[] | undefined, x: number, z: number, playerD: number): Decoy | null {
  let best: Decoy | null = null;
  let bestD = Math.min(DECOY_SIGHT, playerD);
  decoys?.forEach((c) => {
    const d = Math.hypot(c.x - x, c.z - z);
    if (d < bestD) { bestD = d; best = c; }
  });
  return best;
}

export interface Horde {
  /** Starts loading robots so spawns later do not wait on the model. */
  warm(count: number): void;
  spawn(kind: 'zombie' | 'elite', x: number, z: number, style?: FoeStyle): boolean;
  /** Pulls the giant together at (x, z) over `duration` seconds; it cannot be hurt until it has formed. */
  formBoss(x: number, z: number, duration: number, style?: FoeStyle): boolean;
  update(dt: number, time: number, player: HordePlayer, canHit: boolean): void;
  /** Virus foes hunt the player from anywhere on the map and steer round buildings; tagged hunt monsters are left alone. */
  setChase(on: boolean): void;
  strike(at: THREE.Vector3, heading: number, weapon: Weapon): boolean;
  /** Where a shot along `heading` would land on a foe, or null. */
  aimTarget(at: THREE.Vector3, heading: number, weapon: Weapon): { x: number; z: number; d: number; r: number } | null;
  /** Fires at the best foe in the cone; returns true and the hit point in `out` when it hits. */
  shoot(at: THREE.Vector3, heading: number, weapon: Weapon, out: THREE.Vector3): boolean;
  ram(x: number, z: number, r: number, dx: number, dz: number, speed: number): number;
  /** Run over by something heavy: zombies inside any [x, z, r] circle die outright, elites lose `heavy` hp once however many circles cover them, the giant is not hurt. */
  crush(circles: readonly (readonly [number, number, number])[], heavy: number, dx: number, dz: number): number;
  /** Area damage from a hit at height `y`; `bossBonus` multiplies what the giant takes. */
  damageArea(x: number, y: number, z: number, radius: number, damage: number, fromX: number, fromZ: number, bossBonus?: number): number;
  /** Hurts every foe the segment (ax, az)–(bx, bz) passes within `width` of, e.g. a laser that goes through a crowd; returns how many. */
  beam(ax: number, az: number, bx: number, bz: number, width: number, damage: number): number;
  /** Every zombie and elite drops dead (cure) or vanishes in a puff (the giant forming); `boss` takes the giant and its shots too. */
  clear(how: 'die' | 'poof', boss?: boolean): void;
  positions(): { kind: FoeKind; x: number; z: number; tag?: string }[];
  /** Whether a live foe's body comes within `pad` of (x, z); allocation-free for per-substep hit tests. */
  touches(x: number, z: number, pad: number): boolean;
  readonly zombies: number;
  readonly elites: number;
  readonly boss: { hp: number; max: number; forming: boolean; alive: boolean; x: number; z: number } | null;
  dispose(): void;
}

type Pooled = { robot: Robot; mats: THREE.MeshStandardMaterial[]; meshes: THREE.Mesh[]; eyes: THREE.Group; colors: THREE.Color[] };
type Tag = { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; sprite: THREE.Sprite; hp: number };
type Foe = {
  kind: FoeKind; rule: FoeRule; p: Pooled; root: THREE.Group;
  x: number; z: number; heading: number; hp: number; state: 'rise' | 'live' | 'dead'; t: number;
  gait: Gait; engaged: boolean; cooldown: number; pendingHit: number; stun: number; vx: number; vz: number; flash: number;
  tag: Tag | null; growFor: number; slam: number; orb: number; minion: number; slamAt: number; orbAt: number; throwIn: number;
  max: number; speedMul: number; damageMul: number; label: string | null; hunt?: string; glow: THREE.Color; side: 1 | -1;
  anim: number; skip: number; recallIn: number; stuckX: number; stuckZ: number; stuckT: number;
};
type Wave = { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; x: number; z: number; r: number; hit: boolean; on: boolean };
type Orb = { mesh: THREE.Mesh; x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; g: number; damage: number; from: FoeKind };

const EMISSIVE: Record<FoeKind, THREE.Color> = {
  zombie: new THREE.Color('#0c3a0e'),
  elite: new THREE.Color('#1f7a1a'),
  boss: new THREE.Color('#2cff5a'),
};
const HUNCH: Record<FoeKind, number> = { zombie: 0.24, elite: 0.12, boss: 0.04 };

export function createHorde(scene: THREE.Scene, url: string, motes: Motes, hooks: HordeHooks): Horde {
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  /** The decoy each swing in flight was aimed at; a swing with no entry is aimed at the player. */
  const swungAt = new Map<Foe, Decoy>();
  let disposed = false;
  const idle: Pooled[] = [];
  const all: Pooled[] = [];
  let loading = 0;
  const foes: Foe[] = [];
  let giant: FoeStyle = {};
  let chase = false;
  let warmTo = 0;
  const active: Foe[] = [];
  const push: [number, number] = [0, 0];
  const eyeGeo = keep(new THREE.SphereGeometry(0.045, 8, 6));
  const eyeMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color('#b6ff4a').multiplyScalar(4) }));
  const v = new THREE.Vector3();

  // Eyes ride on the head bone so they follow every nod, shamble and fall.
  const addEyes = (robot: Robot) => {
    const eyes = new THREE.Group();
    let head: THREE.Object3D | null = null;
    robot.root.traverse((o) => { if ((o as THREE.Bone).isBone && /^Head(_\d+)?$/.test(o.name)) head = o; });
    robot.root.updateMatrixWorld(true);
    const bone = head as THREE.Object3D | null;
    if (!bone) return eyes;
    const box = new THREE.Box3().setFromObject(robot.root);
    const headAt = bone.getWorldPosition(new THREE.Vector3());
    const frontZ = box.max.z * 0.92;
    const eyeY = headAt.y + (box.max.y - headAt.y) * 0.42;
    [-1, 1].forEach((side) => {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(side * (box.max.x - box.min.x) * 0.1, eyeY, frontZ);
      eyes.add(eye);
    });
    const scale = bone.getWorldScale(new THREE.Vector3()).x;
    eyes.children.forEach((eye) => {
      bone.worldToLocal(eye.position);
      eye.scale.setScalar(1 / Math.max(1e-4, scale));
    });
    bone.add(eyes);
    return eyes;
  };
  const load = () => {
    loading++;
    void spawnRobot(url, ROBOT_H, '#5b9a3c').then((robot) => {
      loading--;
      if (disposed) { robot.dispose(); return; }
      const mats: THREE.MeshStandardMaterial[] = [];
      const meshes: THREE.Mesh[] = [];
      robot.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        meshes.push(mesh);
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => { if ((m as THREE.MeshStandardMaterial).emissive) mats.push(m as THREE.MeshStandardMaterial); });
      });
      const p = { robot, mats, meshes, eyes: addEyes(robot), colors: mats.map((m) => m.color.clone()) };
      all.push(p);
      idle.push(p);
    }).catch(() => { loading--; });
  };

  const tags: Tag[] = [];
  const makeTag = (): Tag => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 80;
    const tex = keep(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })));
    sprite.scale.set(2.6, 0.81, 1);
    sprite.visible = false;
    scene.add(sprite);
    return { canvas, tex, sprite, hp: -1 };
  };
  const paintTag = (tag: Tag, f: Foe) => {
    const hp = Math.max(0, Math.ceil(f.hp));
    if (tag.hp === hp) return;
    tag.hp = hp;
    const ctx = tag.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 256, 80);
    ctx.fillStyle = 'rgba(8,14,10,.82)';
    ctx.beginPath();
    ctx.roundRect(8, 4, 240, 72, 14);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = '700 28px system-ui, sans-serif';
    ctx.fillStyle = f.label ? '#f4f5f8' : '#b6ff9a';
    let text = f.label ?? '엘리트 바이러스';
    while (text.length > 4 && ctx.measureText(text).width > 228) text = text.slice(0, -2);
    ctx.fillText(text === (f.label ?? '엘리트 바이러스') ? text : `${text}…`, 128, 38);
    ctx.fillStyle = 'rgba(255,255,255,.15)';
    ctx.fillRect(30, 52, 196, 10);
    ctx.fillStyle = f.label ? `#${f.glow.clone().multiplyScalar(2.2).getHexString()}` : '#39ff7a';
    ctx.fillRect(30, 52, 196 * (f.hp / f.max), 10);
    tag.tex.needsUpdate = true;
  };

  const waves: Wave[] = Array.from({ length: 3 }, () => {
    const mat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color('#5dff8f').multiplyScalar(2.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    const mesh = new THREE.Mesh(keep(new THREE.RingGeometry(0.9, 1, 72).rotateX(-Math.PI / 2)), mat);
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, mat, x: 0, z: 0, r: 0, hit: false, on: false };
  });
  const orbGeo = keep(new THREE.IcosahedronGeometry(0.55, 1));
  const orbMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color('#7dff6a').multiplyScalar(3) }));
  const orbs: Orb[] = Array.from({ length: 12 }, () => {
    const mesh = new THREE.Mesh(orbGeo, orbMat);
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, g: 0, damage: 0, from: 'boss' as FoeKind };
  });

  const height = (f: Foe) => ROBOT_H * f.rule.scale * (f.kind === 'boss' ? bossGrow(f) : 1);
  const bossGrow = (f: Foe) => (f.growFor > 0 ? 0.12 + 0.88 * Math.min(1, f.t / f.growFor) ** 2 : 1);
  const live = (f: Foe) => f.state !== 'dead' && !(f.kind === 'boss' && f.growFor > 0);
  const release = (f: Foe) => {
    swungAt.delete(f);
    scene.remove(f.root);
    f.root.remove(f.p.robot.root);
    f.p.robot.mixer.stopAllAction();
    f.p.robot.root.rotation.set(0, 0, 0);
    f.p.robot.root.position.set(0, 0, 0);
    if (f.tag) { f.tag.sprite.visible = false; tags.push(f.tag); f.tag = null; }
    idle.push(f.p);
    foes.splice(foes.indexOf(f), 1);
  };
  const acquire = (kind: FoeKind, x: number, z: number, style: FoeStyle = {}): Foe | null => {
    const p = idle.pop();
    if (!p) { if (all.length + loading < POOL) load(); return null; }
    const rule = FOES[kind];
    const root = new THREE.Group();
    root.scale.setScalar(rule.scale);
    root.add(p.robot.root);
    p.robot.root.rotation.x = HUNCH[kind];
    // A crowd of shadow casters is thousands of extra draw calls; only the giant keeps its shadow.
    p.meshes.forEach((m) => { m.castShadow = kind === 'boss'; });
    const glow = style.color ? new THREE.Color(style.color) : EMISSIVE[kind];
    p.mats.forEach((m, k) => {
      m.emissive.copy(glow);
      m.emissiveIntensity = kind === 'boss' ? 0.5 : 1;
      m.color.copy(p.colors[k]);
      if (style.color) m.color.lerp(glow, 0.55);
      const ghost = !!style.ghost;
      if (m.transparent !== ghost) { m.transparent = ghost; m.needsUpdate = true; }
      m.opacity = ghost ? 0.42 : 1;
      m.depthWrite = !ghost;
    });
    p.robot.play('Idle', 0, true);
    scene.add(root);
    const f: Foe = {
      kind, rule, p, root, x, z, heading: Math.random() * Math.PI * 2, hp: rule.hp, state: 'rise', t: 0,
      gait: 'Idle', engaged: false, cooldown: 0.6, pendingHit: 0, stun: 0, vx: 0, vz: 0, flash: 0,
      tag: kind === 'elite' || style.label ? tags.pop() ?? makeTag() : null, growFor: 0, slam: SLAM_EVERY * 0.5, orb: ORB_EVERY, minion: MINION_EVERY * 0.6, slamAt: 0, orbAt: 0, throwIn: THROW.every * 0.6,
      max: style.hp ?? rule.hp, speedMul: style.speed ?? 1, damageMul: style.damage ?? 1, label: style.label ?? null, hunt: style.tag, glow, side: Math.random() < 0.5 ? 1 : -1,
      anim: 0, skip: Math.floor(Math.random() * 3), recallIn: 0, stuckX: x, stuckZ: z, stuckT: 0,
    };
    f.hp = f.max;
    if (f.tag) f.tag.hp = -1;
    foes.push(f);
    return f;
  };
  const kill = (f: Foe) => {
    f.state = 'dead';
    f.t = 0;
    f.pendingHit = 0;
    f.p.robot.play('Death', 0.12);
    if (f.tag) f.tag.sprite.visible = false;
    motes.burst(f.x, height(f) * 0.5, f.z, f.kind === 'boss' ? 160 : f.kind === 'elite' ? 40 : 14, f.kind === 'boss' ? 16 : 4, 3, 1.2);
    hooks.onKill(f.kind, f.hunt, f.x, f.z);
    if (f.kind === 'boss') hooks.onBossDown();
  };
  // `interrupt` false: a flame or beam tick only flashes the foe, otherwise ticks every 0.12 s would cancel every attack.
  const hurt = (f: Foe, damage: number, dx: number, dz: number, push: number, stun: number, interrupt = true) => {
    if (!live(f) || damage <= 0) return;
    const d = Math.hypot(dx, dz) || 1;
    f.hp = Math.max(0, f.hp - damage);
    f.flash = 0.12;
    f.vx = (dx / d) * push * f.rule.give;
    f.vz = (dz / d) * push * f.rule.give;
    if (interrupt) f.stun = Math.max(f.stun, stun * f.rule.give);
    if (interrupt && f.rule.give > 0.5) f.pendingHit = 0;
    if (f.hp <= 0) kill(f);
    else if (interrupt && f.kind === 'zombie') f.p.robot.play('No', 0.08, true);
  };
  const move = (f: Foe, dx: number, dz: number, speed: number, dt: number, around = false) => {
    const len = Math.hypot(dx, dz) || 1;
    let sx = (dx / len) * speed * dt, sz = (dz / len) * speed * dt;
    const r = Math.min(2, f.rule.radius);
    if (around && hooks.blocked(f.x + sx, f.z + sz, r)) {
      const step = speed * dt;
      const dir = steer(dx, dz, f.side, (ux, uz) => !hooks.blocked(f.x + ux * step, f.z + uz * step, r));
      if (dir) { sx = dir[0] * step; sz = dir[1] * step; }
    }
    if (!hooks.blocked(f.x + sx, f.z, r)) f.x += sx;
    if (!hooks.blocked(f.x, f.z + sz, r)) f.z += sz;
  };
  const turn = (f: Foe, dx: number, dz: number, dt: number, rate: number) => {
    if (Math.hypot(dx, dz) < 0.35) return;
    f.heading = turnToward(f.heading, Math.atan2(dx, dz), dt, rate, f.kind === 'boss' ? 2 : 6);
  };
  const nudge = (f: Foe, sx: number, sz: number) => {
    if (!sx && !sz) return;
    const r = Math.min(2, f.rule.radius);
    if (!hooks.blocked(f.x + sx, f.z, r)) f.x += sx;
    if (!hooks.blocked(f.x, f.z + sz, r)) f.z += sz;
  };
  const separate = (player: HordePlayer) => {
    active.length = 0;
    for (const f of foes) if (f.state === 'live') active.push(f);
    for (let k = 0; k < active.length; k++) {
      const f = active[k];
      if (!apart(f.x, f.z, player.x, player.z, f.rule.radius + 0.5)) {
        separationInto(push, f.x, f.z, player.x, player.z, f.rule.radius + 0.5, f.heading + Math.PI);
        nudge(f, push[0], push[1]);
      }
      for (let j = k + 1; j < active.length; j++) {
        const o = active[j];
        const min = f.rule.radius + o.rule.radius;
        if (apart(f.x, f.z, o.x, o.z, min)) continue;
        separationInto(push, f.x, f.z, o.x, o.z, min, k * 2.4);
        const sx = push[0], sz = push[1];
        const wf = o.rule.radius / min;
        nudge(f, sx * wf, sz * wf);
        nudge(o, -sx * (1 - wf), -sz * (1 - wf));
      }
    }
  };
  const angleTo = (at: THREE.Vector3, heading: number, x: number, z: number) => {
    const target = Math.atan2(x - at.x, z - at.z);
    return Math.abs(Math.atan2(Math.sin(target - heading), Math.cos(target - heading)));
  };
  const inSight = (at: THREE.Vector3, heading: number, w: Weapon) => {
    const cone = w.id === 'shotgun' ? 0.32 : 0.2;
    let best: { f: Foe; d: number; score: number } | null = null;
    for (const f of foes) {
      if (!live(f)) continue;
      const d = Math.hypot(f.x - at.x, f.z - at.z);
      if (d - f.rule.radius > w.range) continue;
      const a = angleTo(at, heading, f.x, f.z);
      if (a > cone + Math.atan2(f.rule.radius, Math.max(0.5, d))) continue;
      if (f.kind !== 'boss' && !hooks.clear(at.x, at.z, f.x, f.z)) continue;
      const score = a * 8 + d * 0.05;
      if (!best || score < best.score) best = { f, d, score };
    }
    return best;
  };

  function bossUpdate(f: Foe, dt: number, player: HordePlayer) {
    const dx = player.x - f.x, dz = player.z - f.z;
    const d = Math.hypot(dx, dz);
    turn(f, dx, dz, dt, 3);
    const busy = f.slamAt > 0 || f.orbAt > 0;
    if (!busy && d > 15) {
      move(f, dx, dz, approach(d, 15, f.rule.speed * f.speedMul, dt), dt);
      f.gait = 'Walking';
      f.p.robot.play('Walking', 0.4);
    } else if (!busy) {
      f.gait = 'Idle';
      f.p.robot.play('Idle', 0.4);
    }
    f.slam -= dt;
    f.orb -= dt;
    f.minion -= dt;
    if (f.slam <= 0 && d < SLAM_RADIUS + 4 && !busy) {
      f.slam = SLAM_EVERY;
      f.slamAt = 0.75;
      f.p.robot.play('Jump', 0.15, true);
    }
    if (f.orb <= 0 && d > 9 && !busy) {
      f.orb = ORB_EVERY;
      f.orbAt = 0.4;
      f.p.robot.play('Punch', 0.12, true);
    }
    if (f.slamAt > 0) {
      f.slamAt -= dt;
      if (f.slamAt <= 0) {
        const w = waves.find((x) => !x.on);
        if (w) Object.assign(w, { on: true, x: f.x, z: f.z, r: 1, hit: false });
        motes.burst(f.x, 0.3, f.z, 50, 14, 1.5, 0.9);
        hooks.onQuake(f.x, f.z);
      }
    }
    if (f.orbAt > 0) {
      f.orbAt -= dt;
      if (f.orbAt <= 0) {
        const o = orbs.find((x) => x.life <= 0);
        if (o) {
          const y0 = height(f) * 0.75;
          v.set(player.x - f.x, 1.2 + player.y - y0, player.z - f.z).normalize().multiplyScalar(ORB_SPEED);
          Object.assign(o, { x: f.x + Math.sin(f.heading) * 2, y: y0, z: f.z + Math.cos(f.heading) * 2, vx: v.x, vy: v.y, vz: v.z, life: 4, g: 0, damage: ORB_DAMAGE * (giant.damage ?? 1), from: 'boss' });
        }
      }
    }
    if (f.minion <= 0) {
      f.minion = MINION_EVERY;
      const count = foes.filter((x) => x.kind === 'zombie' && x.state !== 'dead').length;
      for (let k = 0; k < MINIONS && count + k < MINION_CAP; k++) {
        const at = hooks.spot(f.x, f.z, 6, 16);
        if (at) spawnAt('zombie', at.x, at.z, giant);
      }
    }
  }

  // A ballistic arc timed to land where the player stands now, so it clears the roof edge and can be dodged.
  function lob(f: Foe, player: HordePlayer) {
    const o = orbs.find((x) => x.life <= 0);
    if (!o) return false;
    const y0 = height(f) * 0.8;
    const tx = player.x - f.x, tz = player.z - f.z;
    const t = Math.min(2.6, Math.max(1.1, Math.hypot(tx, tz) / THROW.speed));
    const dy = player.y + 1.1 - y0;
    Object.assign(o, {
      x: f.x, y: y0, z: f.z, vx: tx / t, vy: (dy + 0.5 * THROW.gravity * t * t) / t, vz: tz / t, g: THROW.gravity,
      life: t + (player.y >= 2 ? 0.12 : 1), damage: THROW.damage * f.damageMul, from: 'elite',
    });
    return true;
  }

  function spawnAt(kind: 'zombie' | 'elite', x: number, z: number, style?: FoeStyle) {
    const f = acquire(kind, x, z, style);
    if (!f) return false;
    motes.burst(x, 0.2, z, kind === 'elite' ? 30 : 12, kind === 'elite' ? 5 : 2.5, 2, 0.9);
    return true;
  }

  return {
    get zombies() { return foes.filter((f) => f.kind === 'zombie' && f.state !== 'dead').length; },
    get elites() { return foes.filter((f) => f.kind === 'elite' && f.state !== 'dead').length; },
    get boss() {
      const f = foes.find((x) => x.kind === 'boss');
      return f ? { hp: f.hp, max: f.max, forming: f.growFor > 0, alive: f.state !== 'dead', x: f.x, z: f.z } : null;
    },
    warm(count) {
      warmTo = Math.max(warmTo, Math.min(count, POOL));
    },
    spawn: spawnAt,
    setChase(on) { chase = on; },
    formBoss(x, z, duration, style = {}) {
      const f = acquire('boss', x, z, style);
      if (!f) return false;
      giant = { hp: FOES.zombie.hp * (f.max / FOES.boss.hp), speed: f.speedMul, damage: f.damageMul };
      f.growFor = duration;
      f.state = 'live';
      f.heading = 0;
      return true;
    },
    positions: () => foes.filter((f) => f.state !== 'dead').map((f) => ({ kind: f.kind, x: f.x, z: f.z, tag: f.hunt })),
    touches(x, z, pad) {
      for (const f of foes) if (f.state !== 'dead' && Math.hypot(f.x - x, f.z - z) < f.rule.radius + pad) return true;
      return false;
    },
    clear(how, boss = false) {
      if (boss) {
        orbs.forEach((o) => { o.life = 0; o.mesh.visible = false; });
        waves.forEach((w) => { w.on = false; w.mesh.visible = false; });
      }
      [...foes].forEach((f) => {
        if ((f.kind === 'boss' && !boss) || f.state === 'dead') return;
        if (how === 'die') { kill(f); return; }
        motes.burst(f.x, height(f) * 0.5, f.z, f.kind === 'elite' ? 40 : 16, 5, 3, 1);
        release(f);
      });
    },
    update(dt, time, player, canHit) {
      for (let k = 0; k < WARM_PER_FRAME && all.length + loading < warmTo; k++) load();
      [...foes].forEach((f) => {
        const robot = f.p.robot;
        f.anim += dt;
        // The crowd far off is a few pixels tall, so it animates every third frame with the time it skipped.
        if (f.kind === 'boss' || ++f.skip >= 3 || Math.hypot(player.x - f.x, player.z - f.z) <= FAR_ANIM) {
          robot.mixer.update(f.kind === 'boss' ? f.anim * 0.7 : f.anim);
          f.anim = 0;
          f.skip = 0;
        }
        f.cooldown -= dt;
        f.flash = Math.max(0, f.flash - dt);
        const glow = f.kind === 'boss' ? (f.growFor > 0 ? 2.5 : 0.45 + 0.25 * Math.sin(time * 4)) : 1;
        f.p.mats.forEach((m) => { m.emissiveIntensity = f.flash > 0 ? glow + 2 : glow; });
        if (f.state === 'dead') {
          f.t += dt;
          const sink = Math.max(0, f.t - (f.kind === 'boss' ? 3 : 1.4));
          f.root.position.set(f.x, 0.16 - sink * height(f) * 0.6, f.z);
          if (f.t > (f.kind === 'boss' ? 5 : GONE)) release(f);
          return;
        }
        const dx = player.x - f.x, dz = player.z - f.z;
        const d = Math.hypot(dx, dz);
        const hunting = chase && !f.hunt;
        f.recallIn -= dt;
        const far = straggler(f.kind, d, hunting, f.stuckT >= STUCK_FOR && d > STUCK_NEAR);
        if (f.kind === 'boss' && f.growFor > 0) {
          f.t += dt;
          f.root.scale.setScalar(f.rule.scale * bossGrow(f));
          if (Math.random() < dt * 30) motes.converge(f.x, height(f) * 0.5, f.z, 34, 6, 1.2);
          if (f.t >= f.growFor) { f.growFor = 0; f.root.scale.setScalar(f.rule.scale); motes.burst(f.x, height(f) * 0.5, f.z, 120, 18, 4, 1.4); }
        } else if (f.state === 'rise') {
          f.t += dt;
          if (f.t >= RISE) { f.state = 'live'; f.t = 0; }
        } else if (far === 'release') {
          release(f);
          return;
        } else if (far === 'recall' && recallNow(f.recallIn, !!player.flying)) {
          const at = hooks.spot(player.x, player.z, 40, 60);
          if (at) {
            Object.assign(f, { x: at.x, z: at.z, state: 'rise', t: 0, engaged: false, pendingHit: 0, recallIn: RECALL_COOLDOWN, stuckX: at.x, stuckZ: at.z, stuckT: 0 });
            motes.burst(at.x, 0.2, at.z, f.kind === 'elite' ? 30 : 12, f.kind === 'elite' ? 5 : 2.5, 2, 0.9);
          } else f.recallIn = RECALL_RETRY;
        } else if (f.stun > 0) {
          f.stun -= dt;
          nudge(f, f.vx * dt, f.vz * dt);
          f.vx = decay(f.vx, 6, dt);
          f.vz = decay(f.vz, 6, dt);
          f.engaged = false;
        } else if (f.kind === 'boss') {
          bossUpdate(f, dt, player);
        } else {
          const reach = f.rule.radius + f.rule.reach;
          const prey = preyOf(player.decoys, f.x, f.z, d);
          const tx = prey ? prey.x - f.x : dx, tz = prey ? prey.z - f.z : dz;
          const td = prey ? Math.hypot(tx, tz) : d;
          const sees = !!prey || seesPlayer(f.kind, d, hunting);
          // A crowd keeps the back row from reaching the player, so the swing starts a step early instead of shoving forever.
          f.engaged = sees && within(f.engaged, td, reach + 0.8, reach + 1.5);
          if (!hunting || f.engaged || Math.hypot(f.x - f.stuckX, f.z - f.stuckZ) > STUCK_MOVE) { f.stuckX = f.x; f.stuckZ = f.z; f.stuckT = 0; }
          else f.stuckT += dt;
          if (f.pendingHit > 0) {
            f.pendingHit -= dt;
            if (f.pendingHit <= 0) {
              const aimed = swungAt.get(f);
              swungAt.delete(f);
              if (aimed) { if (Math.hypot(aimed.x - f.x, aimed.z - f.z) < reach + 1.7) aimed.hit(f.rule.damage * f.damageMul, f.x, f.z); }
              // Nothing on the street can climb, so a swing never reaches a player up on a roof.
              else if (canHit && d < reach + 1.7 && player.y < 2) hooks.onPlayerHit(f.rule.damage * f.damageMul, f.x, f.z, f.kind === 'elite' ? 12 : 6, f.kind);
            }
          }
          if (f.kind === 'elite' && !f.hunt && !prey) {
            f.throwIn -= dt * f.speedMul;
            if (f.throwIn <= 0 && sees && canHit && eliteThrows(d, player.y, reach + 1.7) && (player.y >= 2 || hooks.clear(f.x, f.z, player.x, player.z)) && lob(f, player)) {
              f.throwIn = THROW.every;
              robot.play('Punch', 0.1, true);
            }
          }
          if (f.engaged) {
            turn(f, tx, tz, dt, 10);
            f.gait = 'Idle';
            if (f.cooldown <= 0) {
              robot.play('Punch', 0.1, true);
              f.cooldown = f.rule.cooldown;
              f.pendingHit = f.kind === 'elite' ? 0.55 : 0.4;
              if (prey) swungAt.set(f, prey); else swungAt.delete(f);
            } else if (robot.current !== robot.actions.Punch || !robot.current.isRunning()) robot.play('Idle', 0.25);
          } else if (sees) {
            const speed = approach(td, reach, f.rule.speed * f.speedMul, dt);
            move(f, tx, tz, speed, dt, hunting);
            turn(f, tx, tz, dt, 6);
            f.gait = shamble(f.gait, speed);
            robot.play(f.gait, 0.3);
            if (robot.current) robot.current.timeScale = f.gait === 'Walking' ? 0.62 : 1;
          } else {
            f.gait = 'Idle';
            robot.play('Idle', 0.4);
          }
        }
        const lift = f.state === 'rise' ? -(1 - Math.min(1, f.t / RISE)) * height(f) : 0;
        f.root.position.set(f.x, 0.16 + lift, f.z);
        f.root.rotation.y = f.heading;
        if (f.tag) {
          paintTag(f.tag, f);
          f.tag.sprite.visible = f.state === 'live';
          f.tag.sprite.position.set(f.x, height(f) + 0.9, f.z);
        }
      });
      separate(player);
      waves.forEach((w) => {
        if (!w.on) { w.mesh.visible = false; return; }
        w.r += SLAM_SPEED * dt;
        const k = w.r / SLAM_RADIUS;
        w.mesh.visible = true;
        w.mesh.position.set(w.x, 0.3, w.z);
        w.mesh.scale.set(w.r, 1 + (1 - k) * 3, w.r);
        w.mat.opacity = Math.max(0, 1 - k);
        const d = Math.hypot(player.x - w.x, player.z - w.z);
        if (!w.hit && canHit && Math.abs(d - w.r) < 1.6 && player.y < 0.6) {
          w.hit = true;
          hooks.onPlayerHit(FOES.boss.damage * (giant.damage ?? 1), w.x, w.z, 14, 'boss');
        }
        if (w.r >= SLAM_RADIUS) w.on = false;
      });
      orbs.forEach((o) => {
        if (o.life <= 0) { o.mesh.visible = false; return; }
        o.life -= dt;
        o.vy -= o.g * dt;
        o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
        o.mesh.visible = true;
        o.mesh.position.set(o.x, o.y, o.z);
        o.mesh.rotation.y = time * 6;
        if (canHit && Math.hypot(o.x - player.x, o.y - (player.y + 1.1), o.z - player.z) < 1.3) {
          hooks.onPlayerHit(o.damage, o.x - o.vx, o.z - o.vz, 8, o.from);
          o.life = 0;
        }
        if (o.y < 0.2 || o.life <= 0) {
          motes.burst(o.x, 0.4, o.z, 14, 4, 2, 0.6);
          o.life = 0;
          o.mesh.visible = false;
        }
      });
    },
    strike(at, heading, w) {
      let landed = false;
      const fx = Math.sin(heading), fz = Math.cos(heading);
      foes.forEach((f) => {
        if (!live(f)) return;
        const dx = f.x - at.x, dz = f.z - at.z;
        const d = Math.hypot(dx, dz);
        if (d - f.rule.radius > w.range || (d > f.rule.radius && (dx * fx + dz * fz) / (d || 1) < 0.4)) return;
        landed = true;
        hurt(f, w.damage, dx, dz, 4 + w.damage * 1.2, 0.5 + w.damage * 0.05);
      });
      return landed;
    },
    aimTarget(at, heading, w) {
      const hit = inSight(at, heading, w);
      return hit ? { x: hit.f.x, z: hit.f.z, d: hit.d, r: hit.f.rule.radius } : null;
    },
    shoot(at, heading, w, out) {
      const hit = inSight(at, heading, w);
      if (!hit) return false;
      const f = hit.f;
      hurt(f, damageAt(w, Math.max(0, hit.d - f.rule.radius)), f.x - at.x, f.z - at.z, w.id === 'shotgun' ? 7 : 2.5, 0.3);
      const back = Math.max(0, hit.d - f.rule.radius * 0.8) / Math.max(hit.d, 1e-3);
      out.set(at.x + (f.x - at.x) * back, Math.min(1.2 * f.rule.scale, height(f) * 0.55), at.z + (f.z - at.z) * back);
      return true;
    },
    ram(x, z, r, dx, dz, speed) {
      if (speed < 4) return 0;
      let count = 0;
      foes.forEach((f) => {
        if (!live(f) || f.stun > 0.6) return;
        if (Math.hypot(f.x - x, f.z - z) > r + f.rule.radius) return;
        count++;
        const damage = f.kind === 'boss' ? 3 : speed > 14 ? 8 : speed > 8 ? 6 : 4;
        hurt(f, damage, dx, dz, speed * 0.7, 1.2);
      });
      return count;
    },
    crush(circles, heavy, dx, dz) {
      let count = 0;
      foes.forEach((f) => {
        if (!live(f) || f.kind === 'boss' || !circles.some(([x, z, r]) => Math.hypot(f.x - x, f.z - z) <= r + f.rule.radius)) return;
        const damage = f.kind === 'zombie' ? f.hp : heavy;
        if (damage <= 0) return;
        count++;
        hurt(f, damage, dx, dz, 9, 1.4);
      });
      return count;
    },
    damageArea(x, y, z, radius, damage, fromX, fromZ, bossBonus = 1) {
      let count = 0;
      foes.forEach((f) => {
        if (!live(f) || y > height(f) + radius) return;
        const amount = splash(damage, Math.max(0, Math.hypot(f.x - x, f.z - z) - f.rule.radius), radius + 0.45);
        if (!amount) return;
        count++;
        hurt(f, f.kind === 'boss' ? amount * bossBonus : amount, f.x - fromX, f.z - fromZ, 2 + amount * 1.4, 0.25 + amount * 0.06);
      });
      return count;
    },
    beam(ax, az, bx, bz, width, damage) {
      let count = 0;
      foes.forEach((f) => {
        if (!live(f) || !inBeam(f.x, f.z, ax, az, bx, bz, width + f.rule.radius)) return;
        count++;
        hurt(f, damage, bx - ax, bz - az, 2, 0, false);
      });
      return count;
    },
    dispose() {
      disposed = true;
      [...foes].forEach(release);
      all.forEach((p) => p.robot.dispose());
      waves.forEach((w) => scene.remove(w.mesh));
      orbs.forEach((o) => scene.remove(o.mesh));
      tags.forEach((t) => scene.remove(t.sprite));
      owned.forEach((o) => o.dispose());
    },
  };
}
