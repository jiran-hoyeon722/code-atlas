import type { Architecture } from '../../engine/architecture';
import type { WeaponId } from './walkWeapons';

// ---- warning signs: what a file's numbers say could go wrong there ----

export type SignKind = 'cycle' | 'upward' | 'complex' | 'pillar' | 'bulky' | 'ghost';

export interface SignRule {
  label: string;
  /** Monster body: an elite is the big one. */
  kind: 'zombie' | 'elite';
  color: string;
  /** Brighter colour for the HUD. */
  tint: string;
  weapon: WeaponId;
  speed: number;
  ghost?: boolean;
}

export const SIGNS: Record<SignKind, SignRule> = {
  cycle: { label: '순환 참조', kind: 'zombie', color: '#0f6b6b', tint: '#63e6be', weapon: 'smg', speed: 1.2 },
  upward: { label: '역방향 의존', kind: 'zombie', color: '#8a1010', tint: '#ff6b6b', weapon: 'smg', speed: 1.7 },
  complex: { label: '복잡한 함수', kind: 'elite', color: '#5a1d8a', tint: '#b197fc', weapon: 'shotgun', speed: 1 },
  pillar: { label: '흔들리는 기둥', kind: 'elite', color: '#6b5a10', tint: '#ffd43b', weapon: 'shotgun', speed: 0.8 },
  bulky: { label: '거대 파일', kind: 'zombie', color: '#7a4a0a', tint: '#ffa94d', weapon: 'pipe', speed: 0.9 },
  ghost: { label: '아무도 안 쓰는 파일', kind: 'zombie', color: '#3d5f86', tint: '#74c0fc', weapon: 'pistol', speed: 1.1, ghost: true },
};

export const COMPLEX_AT = 15;
export const BULKY_LINES = 300;
export const BULKY_FUNCTIONS = 25;
export const PILLAR_IN = 8;
export const PILLAR_OUT = 8;

export interface Sign { kind: SignKind; severity: number; lesson: string }

const KIND_LABEL: Record<string, string> = {
  inject: '생성자 주입', type: '타입 힌트', 'static-call': '정적 호출', new: 'new 생성', const: '상수·enum',
  'class-ref': '::class 참조', trait: '트레이트', catch: '예외 catch', instanceof: 'instanceof', extends: '상속',
  implements: '인터페이스 구현', attribute: '어트리뷰트', triggers: '이벤트 → 리스너', binds: '컨테이너 바인딩', other: '참조',
  import: 'import', 'type-import': '타입 import', 'dynamic-import': '동적 import', 're-export': '재export', require: 'require',
};
/**
 * References that cannot form a loop worth a lesson: type-checker only, framework wiring, and `X::class`
 * (Eloquent relations point both ways by design, which would tie every model into one ring).
 */
const LOOSE = new Set(['type', 'type-import', 'binds', 'triggers', 'class-ref']);
/** A ring this big is a repo-wide tangle, not something one file can learn from. */
export const LOOP_MAX = 8;
const fmt = (n: number) => Number(n).toLocaleString('ko-KR');

export interface Use { from: number; kinds: string }
export interface Repo {
  arch: Architecture;
  /** users[i]: files that reference file i. */
  users: Use[][];
  /** Other files in the same reference loop as i (empty when none). */
  loop(i: number): number[];
  upward: number[];
  layer: (i: number) => number;
  /** Test code: nothing references it by design, so it is never a stop or a warning sign. */
  test(i: number): boolean;
  sign(i: number): Sign | null;
}

const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[^/]+$|Test\.php$/;

/** Strongly connected components of size > 1 (group[i] indexes `groups`, -1 when alone), iteratively so a deep repo cannot overflow the stack. */
export function loops(count: number, edges: [number, number][]): { group: number[]; groups: number[][] } {
  const group = new Array<number>(count).fill(-1);
  const groups: number[][] = [];
  const next: number[][] = Array.from({ length: count }, () => []);
  edges.forEach(([a, b]) => { if (a !== b) next[a].push(b); });
  const index = new Array<number>(count).fill(-1);
  const low = new Array<number>(count).fill(0);
  const on = new Array<boolean>(count).fill(false);
  const stack: number[] = [];
  let counter = 0;
  for (let s = 0; s < count; s++) {
    if (index[s] >= 0) continue;
    const work: [number, number][] = [[s, 0]];
    index[s] = low[s] = counter++;
    stack.push(s);
    on[s] = true;
    while (work.length) {
      const top = work[work.length - 1];
      const [v, k] = top;
      if (k < next[v].length) {
        top[1]++;
        const w = next[v][k];
        if (index[w] < 0) {
          index[w] = low[w] = counter++;
          stack.push(w);
          on[w] = true;
          work.push([w, 0]);
        } else if (on[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      work.pop();
      if (work.length) { const u = work[work.length - 1][0]; low[u] = Math.min(low[u], low[v]); }
      if (low[v] !== index[v]) continue;
      const comp: number[] = [];
      let w: number;
      do { w = stack.pop()!; on[w] = false; comp.push(w); } while (w !== v);
      if (comp.length > 1) { comp.forEach((c) => { group[c] = groups.length; }); groups.push(comp); }
    }
  }
  return { group, groups };
}

export function readRepo(arch: Architecture): Repo {
  const n = arch.nodes.length;
  const users: Use[][] = Array.from({ length: n }, () => []);
  const upward = new Array<number>(n).fill(0);
  const tight: [number, number][] = [];
  arch.edges.forEach(([from, to, , kinds, up]) => {
    const names = Object.keys(kinds);
    users[to].push({ from, kinds: names.map((k) => KIND_LABEL[k] ?? k).join(' · ') });
    if (up) upward[from]++;
    if (names.some((k) => !LOOSE.has(k))) tight.push([from, to]);
  });
  const found = loops(n, tight);
  const loop = (i: number) => {
    const g = found.group[i] < 0 ? null : found.groups[found.group[i]];
    return g && g.length <= LOOP_MAX ? g.filter((x) => x !== i) : [];
  };
  const layer = (i: number) => arch.roles[arch.nodes[i].role]?.layer ?? 3;
  const name = (i: number) => arch.nodes[i].name;
  const test = (i: number) => TEST_PATH.test(arch.nodes[i].path);
  const sign = (i: number): Sign | null => {
    const node = arch.nodes[i];
    if (test(i)) return null;
    const ring = loop(i);
    if (ring.length) {
      const others = ring.slice(0, 2).map(name).join(', ') + (ring.length > 2 ? ` 외 ${fmt(ring.length - 2)}개` : '');
      return { kind: 'cycle', severity: ring.length + 1, lesson: `${others}와(과) 서로를 참조하는 고리에 묶여 있어요. 한쪽을 고치면 다른 쪽이 같이 깨지기 쉬워요.` };
    }
    if (upward[i]) return { kind: 'upward', severity: upward[i], lesson: `아래 계층인데 위 계층 코드를 ${fmt(upward[i])}번 참조해요. 기반이 위층을 알게 되면 위층을 바꿀 때 기반까지 흔들려요.` };
    if (node.maxComplexity >= COMPLEX_AT) return { kind: 'complex', severity: node.maxComplexity, lesson: `갈림길이 ${fmt(node.maxComplexity)}개인 함수가 있어요. 경우의 수가 많아 테스트가 빠지기 쉬운 곳이에요.` };
    if (node.fanIn >= PILLAR_IN && node.fanOut >= PILLAR_OUT) return { kind: 'pillar', severity: node.fanIn + node.fanOut, lesson: `${fmt(node.fanIn)}곳이 기대는데 이 파일도 ${fmt(node.fanOut)}곳에 기대요. 아래가 바뀌면 위의 ${fmt(node.fanIn)}곳까지 파장이 번져요.` };
    if (node.lines >= BULKY_LINES || node.functions >= BULKY_FUNCTIONS) return { kind: 'bulky', severity: node.lines, lesson: `${fmt(node.lines)}줄, 함수 ${fmt(node.functions)}개 — 한 파일에 일이 몰려 있어서 읽는 데도 고치는 데도 오래 걸려요.` };
    if (node.fanIn === 0 && node.routeRefs === 0 && layer(i) !== 0) return { kind: 'ghost', severity: node.lines, lesson: '코드에서 이 파일을 쓰는 곳이 안 보여요. 안 쓰는 코드이거나 설정·문자열로만 연결돼 있을 수 있어요.' };
    return null;
  };
  return { arch, users, loop, upward, layer, test, sign };
}

// ---- expeditions: start at a root everyone leans on, then walk out along the files that use it ----

export const MAX_STOPS = 7;

export interface Stop {
  i: number;
  /** The stop it was reached from and how that file is referenced; null for the root and the bonus stop. */
  via: { from: number; kinds: string } | null;
  sign: Sign | null;
  /** What the narrator says on the way there. */
  line: string;
}

export interface Expedition { n: number; root: number; stops: Stop[] }

/** Most leaned-on files first, foundation layers before entry points. */
export function rootOrder(repo: Repo): number[] {
  const { arch } = repo;
  return arch.nodes.map((_, i) => i).filter((i) => !repo.test(i) && repo.users[i].filter((u) => !repo.test(u.from)).length >= 2)
    .sort((a, b) => arch.nodes[b].fanIn * (1 + 0.35 * repo.layer(b)) - arch.nodes[a].fanIn * (1 + 0.35 * repo.layer(a)) || a - b);
}

/** `seen`: files earlier expeditions already walked through; they are only taken when nothing new is left. */
export function planExpedition(repo: Repo, root: number, n: number, seen: ReadonlySet<number> = new Set(), max = MAX_STOPS): Expedition {
  const { arch } = repo;
  const node = (i: number) => arch.nodes[i];
  const role = (i: number) => arch.roles[node(i).role]?.name ?? '';
  const stops: Stop[] = [{
    i: root, via: null, sign: repo.sign(root),
    line: `원정 시작 — ${node(root).name}. 파일 ${fmt(node(root).fanIn)}곳이 기대는 ${role(root)} 코드예요. 여기서부터 이 파일을 쓰는 쪽으로 뻗어 나가 볼게요.`,
  }];
  const taken = new Set([root]);
  const branches = new Map<number, number>();
  type Pick = { u: Use; from: number; score: number };
  while (stops.length < max) {
    let best: Pick | null = null as Pick | null;
    stops.forEach((s, k) => {
      const latest = k === stops.length - 1;
      repo.users[s.i].forEach((u) => {
        if (taken.has(u.from) || repo.test(u.from)) return;
        // Climbing toward the entry points tells the story bottom-up; staying on the latest stop keeps it one thread.
        const score = (repo.layer(u.from) <= repo.layer(s.i) ? 1 : 0.35) * (1 + Math.log2(1 + node(u.from).fanIn)) * (repo.sign(u.from) ? 1.4 : 1) * (latest ? 1.6 : 1) * (seen.has(u.from) ? 0.15 : 1)
          // A third sibling off the same stop waits until nothing deeper is left, so the walk goes somewhere instead of listing a family.
          * ((branches.get(s.i) ?? 0) >= 2 ? 0.2 : 1);
        if (!best || score > best.score || (score === best.score && u.from < best.u.from)) best = { u, from: s.i, score };
      });
    });
    if (!best) break;
    const { u, from } = best;
    // Only plain siblings left (a base class and its subclasses, say): end here rather than list them all.
    if (stops.length >= 4 && (branches.get(from) ?? 0) >= 2 && !repo.sign(u.from)) break;
    taken.add(u.from);
    branches.set(from, (branches.get(from) ?? 0) + 1);
    stops.push({
      i: u.from, via: { from, kinds: u.kinds }, sign: repo.sign(u.from),
      line: `다음은 ${node(u.from).name} — ${node(from).name}을(를) ${u.kinds}(으)로 쓰는 ${role(u.from)} 파일이에요.`,
    });
  }
  // Bonus: a file in the same neighbourhood that nothing uses.
  const roles = new Set(stops.map((s) => node(s.i).role));
  const ghost = arch.nodes.findIndex((x, i) => !taken.has(i) && !seen.has(i) && roles.has(x.role) && repo.sign(i)?.kind === 'ghost');
  if (ghost >= 0) stops.push({ i: ghost, via: null, sign: repo.sign(ghost), line: `마지막으로 같은 동네의 ${node(ghost).name}. 아무도 이 파일을 쓰지 않아요 — 버려진 코드일까요?` });
  return { n, root, stops };
}

export interface Atlas { readonly lap: number; next(): Expedition }

/** Hands out expeditions forever: each starts from the most leaned-on file no expedition has walked through yet; once all are walked, around again. */
export function createAtlas(repo: Repo): Atlas {
  const order = rootOrder(repo);
  const fallback = repo.arch.nodes.map((_, i) => i).sort((a, b) => repo.arch.nodes[b].centrality - repo.arch.nodes[a].centrality || a - b);
  const roots = order.length ? order : fallback.slice(0, 1);
  const seen = new Set<number>();
  let n = 0;
  let lap = 1;
  return {
    get lap() { return lap; },
    next() {
      let root = roots.find((r) => !seen.has(r));
      if (root === undefined) {
        seen.clear();
        lap++;
        root = roots[0];
      }
      const e = planExpedition(repo, root, ++n, seen);
      e.stops.forEach((s) => seen.add(s.i));
      return e;
    },
  };
}

export interface Spawn { kind: 'zombie' | 'elite'; hp: number; speed: number; color: string; ghost: boolean; label: string | null }

/** The monsters a warning sign turns into; how bad it is sets how many and how tough, each lap adds a fifth. */
export function packOf(sign: Sign, name: string, lap: number): Spawn[] {
  const rule = SIGNS[sign.kind];
  const tough = 1 + 0.2 * Math.max(0, lap - 1);
  const one = (kind: 'zombie' | 'elite', hp: number, label: string | null): Spawn =>
    ({ kind, hp: Math.round(hp * tough), speed: rule.speed, color: rule.color, ghost: !!rule.ghost, label });
  const crowd = (count: number, hp: number) => Array.from({ length: count }, (_, k) => one('zombie', hp, k === 0 ? name : null));
  switch (sign.kind) {
    case 'cycle': return crowd(Math.min(4, Math.max(2, sign.severity)), 7);
    case 'upward': return crowd(Math.min(5, 1 + sign.severity), 5);
    case 'complex': return [one('elite', Math.min(120, 20 + sign.severity * 1.2), name), one('zombie', 6, null), one('zombie', 6, null)];
    case 'pillar': return [one('elite', Math.min(110, 24 + sign.severity * 0.4), name)];
    case 'bulky': return crowd(Math.min(4, 1 + Math.floor(sign.severity / 400)), 9);
    case 'ghost': return [one('zombie', 3, name)];
  }
}

// ---- the pilot: a pure state machine; mountWalk feeds it the world and carries out its commands ----

export type Point = [x: number, z: number];
export type Phase = 'brief' | 'travel' | 'fight' | 'enter' | 'read' | 'leave' | 'debrief';

export const BRIEF_TIME = 4;
export const DEBRIEF_TIME = 6;
export const READ_TIME = 6;
export const FIGHT_LIMIT = 40;
export const ARRIVE = 2.2;
export const FAST_TRAVEL = 160;
const ENGAGE = 26;
const STUCK_TIME = 2.5;
/** Less than this per update counts as not moving; absolute, since the pilot's clock can run ahead of the hero's on a slow frame. */
const STUCK_STEP = 0.02;
const SLOWMO = 0.7;

export interface PilotWorld {
  x: number;
  z: number;
  /** The hero can act on foot (not dead, not in a vehicle or a building). */
  ready: boolean;
  /** The code panel is open. */
  inside: boolean;
  /** Our monsters still standing, with the tag they were spawned with. */
  foes: { x: number; z: number; tag: string }[];
}

export interface PilotCommand {
  /** Unit direction to walk in, or null to stand. */
  move: Point | null;
  run: boolean;
  /** Heading (atan2(dx, dz)) to face and aim along, or null. */
  face: number | null;
  attack: boolean;
  weapon: WeaponId | null;
  /** Spawn the current stop's monsters now. */
  spawn: Stop | null;
  /** Open this building's code (node index). */
  enter: number | null;
  leave: boolean;
  /** Jump straight to this point (a long trip). */
  teleport: Point | null;
}

export interface PilotHooks {
  /** Road route from the hero to the file's door, or null when unknown. */
  route(fromX: number, fromZ: number, target: number): Point[] | null;
  range(weapon: WeaponId): number;
}

export interface Pilot {
  readonly phase: Phase;
  readonly expedition: Expedition | null;
  /** Index of the current stop in the expedition. */
  readonly at: number;
  readonly stop: Stop | null;
  /** Stops whose warning sign was beaten in this expedition. */
  readonly beaten: ReadonlySet<number>;
  /** Files read since the start. */
  readonly learned: number;
  readonly slowmo: number;
  /** Path left to walk, for the camera: long trips pull it up into the sky. */
  readonly remaining: number;
  /** 0..1 through the current timed phase (brief, read, debrief). */
  readonly progress: number;
  readonly lap: number;
  update(dt: number, world: PilotWorld): PilotCommand;
  /** How many monsters of the requested pack actually appeared. */
  spawned(count: number): void;
  /** One of our monsters went down. */
  onKill(tag: string): void;
  /** Picks up at the current stop again (after the player took control). */
  reset(): void;
}

export const tagOf = (e: Expedition, at: number) => `${e.n}:${at}`;
const idle = (): PilotCommand => ({ move: null, run: false, face: null, attack: false, weapon: null, spawn: null, enter: null, leave: false, teleport: null });
const length = (pts: Point[]) => pts.reduce((sum, p, k) => (k ? sum + Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) : 0), 0);

export function createPilot(atlas: Atlas, doors: Map<number, Point>, hooks: PilotHooks): Pilot {
  let phase: Phase = 'brief';
  let expedition: Expedition | null = null;
  let at = 0;
  let path: Point[] = [];
  let timer = 0;
  let slowmo = 0;
  let spawned = false;
  let pending = 0;
  let stuckFor = 0;
  let last: Point = [0, 0];
  let learned = 0;
  let lap = 1;
  const beaten = new Set<number>();

  const stop = () => expedition?.stops[at] ?? null;
  const begin = () => {
    expedition = atlas.next();
    lap = atlas.lap;
    at = 0;
    beaten.clear();
    phase = 'brief';
    timer = 0;
    path = [];
  };
  const advance = () => {
    at++;
    timer = 0;
    path = [];
    phase = expedition && at < expedition.stops.length ? 'travel' : 'debrief';
  };
  const beginTravel = (w: PilotWorld, door: Point, i: number) => {
    const road = hooks.route(w.x, w.z, i);
    path = road && road.length ? [...road] : [];
    if (!path.length || Math.hypot(path[path.length - 1][0] - door[0], path[path.length - 1][1] - door[1]) > 0.5) path.push(door);
    spawned = false;
    pending = 0;
    stuckFor = 0;
    last = [w.x, w.z];
  };
  const nearest = (foes: PilotWorld['foes'], w: PilotWorld) =>
    foes.reduce((a, b) => (Math.hypot(b.x - w.x, b.z - w.z) < Math.hypot(a.x - w.x, a.z - w.z) ? b : a));

  return {
    get phase() { return phase; },
    get expedition() { return expedition; },
    get at() { return at; },
    get stop() { return stop(); },
    get beaten() { return beaten; },
    get learned() { return learned; },
    get slowmo() { return slowmo; },
    get lap() { return lap; },
    get remaining() { return phase === 'travel' ? length([last, ...path]) : 0; },
    get progress() {
      const span = phase === 'brief' ? BRIEF_TIME : phase === 'read' ? READ_TIME : phase === 'debrief' ? DEBRIEF_TIME : 0;
      return span ? Math.min(1, timer / span) : 0;
    },
    update(dt, w) {
      slowmo = Math.max(0, slowmo - dt);
      const cmd = idle();
      if (!expedition) begin();
      const e = expedition!;
      if (phase === 'brief' || phase === 'debrief') {
        timer += dt;
        if (phase === 'brief' && timer >= BRIEF_TIME) { phase = 'travel'; timer = 0; path = []; }
        else if (phase === 'debrief' && timer >= DEBRIEF_TIME) begin();
        return cmd;
      }
      const s = stop();
      const door = s ? doors.get(s.i) : undefined;
      if (!s || !door) { advance(); return cmd; }
      const tag = tagOf(e, at);
      const mine = w.foes.filter((f) => f.tag === tag);
      const rule = s.sign ? SIGNS[s.sign.kind] : null;
      if (phase === 'travel') {
        if (!w.ready) return cmd;
        if (!path.length) { beginTravel(w, door, s.i); return cmd; }
        const left = length([[w.x, w.z], ...path]);
        if (left > FAST_TRAVEL && path.length > 1) {
          const to = path[path.length - 2];
          path = [door];
          cmd.teleport = to;
          last = to;
          return cmd;
        }
        while (path.length > 1 && Math.hypot(path[0][0] - w.x, path[0][1] - w.z) < ARRIVE) path.shift();
        const [px, pz] = path[0];
        const dx = px - w.x, dz = pz - w.z;
        const d = Math.hypot(dx, dz);
        if (rule && !spawned && Math.hypot(door[0] - w.x, door[1] - w.z) < ENGAGE) {
          spawned = true;
          cmd.spawn = s;
          cmd.weapon = rule.weapon;
        }
        if (path.length === 1 && d < ARRIVE) {
          phase = spawned ? 'fight' : 'enter';
          timer = 0;
          return cmd;
        }
        // No headway for a while: skip to the next corner so a lamp post or a parked car never ends the walk.
        stuckFor = Math.hypot(w.x - last[0], w.z - last[1]) < STUCK_STEP ? stuckFor + dt : 0;
        last = [w.x, w.z];
        if (stuckFor > STUCK_TIME) {
          stuckFor = 0;
          cmd.teleport = path.length > 1 ? path.shift()! : path[0];
          return cmd;
        }
        cmd.move = [dx / (d || 1), dz / (d || 1)];
        cmd.run = true;
        cmd.face = Math.atan2(dx, dz);
        if (rule && mine.length) {
          const f = nearest(mine, w);
          if (Math.hypot(f.x - w.x, f.z - w.z) < hooks.range(rule.weapon) * 0.8) { phase = 'fight'; timer = 0; }
        }
        return cmd;
      }
      if (phase === 'fight') {
        timer += dt;
        if (!w.ready) return cmd;
        if ((pending <= 0 && !mine.length) || timer > FIGHT_LIMIT) { phase = 'enter'; timer = 0; return cmd; }
        cmd.weapon = rule?.weapon ?? null;
        if (!mine.length) {
          // Monsters still rising out of the ground: wait at the door.
          const dx = door[0] - w.x, dz = door[1] - w.z;
          const d = Math.hypot(dx, dz);
          if (d > ARRIVE) { cmd.move = [dx / d, dz / d]; cmd.face = Math.atan2(dx, dz); }
          return cmd;
        }
        const f = nearest(mine, w);
        const dx = f.x - w.x, dz = f.z - w.z;
        const d = Math.hypot(dx, dz) || 1;
        cmd.face = Math.atan2(dx, dz);
        if (d > hooks.range(rule?.weapon ?? 'fist') * 0.8) { cmd.move = [dx / d, dz / d]; cmd.run = d > 8; }
        else cmd.attack = true;
        return cmd;
      }
      if (phase === 'enter') {
        if (w.inside) { phase = 'read'; timer = 0; learned++; return cmd; }
        if (!w.ready) return cmd;
        const dx = door[0] - w.x, dz = door[1] - w.z;
        const d = Math.hypot(dx, dz);
        if (d > ARRIVE) {
          cmd.move = [dx / d, dz / d];
          cmd.face = Math.atan2(dx, dz);
          timer += dt;
          if (timer > 6) cmd.teleport = door;
          return cmd;
        }
        cmd.enter = s.i;
        return cmd;
      }
      if (phase === 'read') {
        timer += dt;
        if (timer >= READ_TIME) { cmd.leave = true; phase = 'leave'; }
        return cmd;
      }
      // leave: wait until the panel is shut and the hero is back on foot.
      if (!w.inside && w.ready) advance();
      return cmd;
    },
    spawned(count) {
      pending = count;
    },
    onKill(tag) {
      if (!expedition || tag !== tagOf(expedition, at)) return;
      pending--;
      if (pending > 0) return;
      beaten.add(at);
      slowmo = SLOWMO;
    },
    reset() {
      if (!expedition) return;
      if (phase === 'read' || phase === 'leave') advance();
      else if (phase === 'fight' || phase === 'enter' || phase === 'travel') { phase = 'travel'; path = []; }
    },
  };
}
