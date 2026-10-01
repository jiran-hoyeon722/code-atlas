import { expect, test } from 'vitest';
import type { Architecture, ArchNode } from '../../src/engine/architecture';
import type { Role } from '../../src/engine/presets';
import {
  ARRIVE, BRIEF_TIME, DEBRIEF_TIME, FAST_TRAVEL, READ_TIME, createAtlas, createPilot, loops, packOf, planExpedition, readRepo, rootOrder, tagOf,
  type Atlas, type Expedition, type PilotCommand, type PilotWorld, type Point, type Sign,
} from '../../src/features/walk/walkAuto';

const node = (name: string, role: number, over: Partial<ArchNode> = {}): ArchNode => ({
  path: `src/${name}.php`, name, kind: 'class', role, lines: 40, functions: 2, complexity: 3, maxComplexity: 2,
  fanIn: 1, fanOut: 1, instability: 0.5, centrality: 1, routeRefs: 0, routeFiles: [], ...over,
});

function fakeArch(nodes: ArchNode[], edges: Architecture['edges']): Architecture {
  const roles: Role[] = [
    { name: 'Controller', layer: 0, patterns: ['c'], description: '요청을 받는 곳' },
    { name: 'Service', layer: 1, patterns: ['s'], description: '업무 로직' },
    { name: 'Model', layer: 2, patterns: ['m'], description: '데이터' },
  ];
  return {
    version: 1, name: 'fake', lang: 'php', framework: 'laravel', sourceDir: 'app', generatedAt: '2026-01-01T00:00:00Z',
    layers: [{ key: 'entry', label: '진입점', hint: '' }, { key: 'application', label: '앱', hint: '' }, { key: 'domain', label: '기반', hint: '' }],
    roles, nodes, edges, failed: [], unresolved: 0,
  };
}

/** User is the root everyone leans on; around it sit one of each warning sign. */
const shop = () => fakeArch([
  node('User', 2, { fanIn: 3 }), // 0
  node('UserService', 1, { fanIn: 1 }), // 1
  node('UserRepository', 2, { fanIn: 1 }), // 2: references a controller (type only) -> upward
  node('UserController', 0, { fanIn: 0 }), // 3: entry point, no sign
  node('Orphan', 2, { fanIn: 0 }), // 4: nothing uses it -> ghost
  node('Helper', 2, { fanIn: 1 }), // 5: loop with 6
  node('Other', 2, { fanIn: 1 }), // 6
  node('Big', 1, { lines: 900 }), // 7
  node('Branchy', 1, { maxComplexity: 40, fanIn: 1 }), // 8
  node('Pillar', 1, { fanIn: 9, fanOut: 9 }), // 9
], [
  [1, 0, 1, { inject: 1 }, 0],
  [2, 0, 1, { 'static-call': 1 }, 0],
  [5, 0, 1, { new: 1 }, 0],
  [3, 1, 1, { inject: 1 }, 0],
  [1, 2, 1, { inject: 1 }, 0],
  [5, 6, 1, { new: 1 }, 0],
  [6, 5, 1, { new: 1 }, 0],
  [2, 3, 1, { type: 1 }, 1],
  [8, 9, 1, { type: 1 }, 0],
  [9, 8, 1, { type: 1 }, 0],
]);

test('loops: reference cycles are found, and a very long chain does not overflow the stack', () => {
  const found = loops(5, [[0, 1], [1, 2], [2, 0], [3, 4]]);
  expect(found.groups[found.group[0]].sort()).toEqual([0, 1, 2]);
  expect(found.group[3]).toBe(-1);
  const n = 50_000;
  const chain = loops(n, Array.from({ length: n - 1 }, (_, k) => [k, k + 1] as [number, number]).concat([[n - 1, 0]]));
  expect(chain.groups[chain.group[0]].length).toBe(n);
});

test('each file shows at most one warning sign, from its own numbers', () => {
  const repo = readRepo(shop());
  const kinds = shop().nodes.map((_, i) => repo.sign(i)?.kind ?? null);
  expect(kinds).toEqual([null, null, 'upward', null, 'ghost', 'cycle', 'cycle', 'bulky', 'complex', 'pillar']);
});

test('::class references and huge rings do not count as a cycle', () => {
  const models = fakeArch([node('A', 2), node('B', 2)], [[0, 1, 1, { 'class-ref': 1 }, 0], [1, 0, 1, { 'class-ref': 1 }, 0]]);
  expect(readRepo(models).sign(0)?.kind).not.toBe('cycle');
  const ring = 12;
  const big = fakeArch(Array.from({ length: ring }, (_, k) => node(`N${k}`, 2)), Array.from({ length: ring }, (_, k) => [k, (k + 1) % ring, 1, { new: 1 }, 0] as Architecture['edges'][number]));
  expect(readRepo(big).loop(0)).toEqual([]);
});

test('a loop made only of type hints is not a cycle; a loop beats every other sign', () => {
  const repo = readRepo(shop());
  expect(repo.loop(8)).toEqual([]);
  const loud = fakeArch([node('A', 2, { maxComplexity: 99, lines: 2000 }), node('B', 2)], [[0, 1, 1, { new: 1 }, 1], [1, 0, 1, { new: 1 }, 0]]);
  expect(readRepo(loud).sign(0)?.kind).toBe('cycle');
});

test('lessons are plain sentences with the file\'s own numbers and names', () => {
  const repo = readRepo(shop());
  expect(repo.sign(5)?.lesson).toContain('Other');
  expect(repo.sign(2)?.lesson).toContain('1번');
  expect(repo.sign(7)?.lesson).toContain('900줄');
  expect(repo.sign(8)?.lesson).toContain('40개');
  expect(repo.sign(9)?.lesson).toContain('9곳');
});

test('roots: the most leaned-on foundation file comes first', () => {
  expect(rootOrder(readRepo(shop()))[0]).toBe(0);
});

test('an expedition starts at the root and only ever steps to a file that uses an earlier stop', () => {
  const repo = readRepo(shop());
  const e = planExpedition(repo, 0, 1);
  expect(e.stops[0].i).toBe(0);
  expect(e.stops[0].via).toBeNull();
  const seen = new Set<number>();
  e.stops.forEach((s, k) => {
    expect(seen.has(s.i)).toBe(false);
    seen.add(s.i);
    if (k === 0 || !s.via) return;
    expect(e.stops.slice(0, k).some((p) => p.i === s.via!.from)).toBe(true);
    expect(shop().edges.some(([from, to]) => from === s.i && to === s.via!.from)).toBe(true);
  });
  expect(e.stops.map((s) => s.i)).toContain(3);
  expect(e.stops[1].line).toContain('User');
});

test('an expedition climbs toward the entry points and ends with an unused file nearby as a bonus', () => {
  const e = planExpedition(readRepo(shop()), 0, 1);
  const names = e.stops.map((s) => shop().nodes[s.i].name);
  expect(names.indexOf('UserController')).toBeGreaterThan(names.indexOf('UserService'));
  expect(names[names.length - 1]).toBe('Orphan');
  expect(e.stops[e.stops.length - 1].via).toBeNull();
  expect(planExpedition(readRepo(shop()), 0, 1, new Set(), 2).stops.filter((s) => s.via).length).toBe(1);
});

test('the atlas hands out expeditions forever: a new root each time, going round again once all are walked', () => {
  const atlas = createAtlas(readRepo(shop()));
  const trips = Array.from({ length: 6 }, () => atlas.next());
  expect(trips.map((e) => e.n)).toEqual([1, 2, 3, 4, 5, 6]);
  const first = new Set(trips[0].stops.map((s) => s.i));
  if (atlas.lap === 1) expect(first.has(trips[1].root)).toBe(false);
  expect(atlas.lap).toBeGreaterThan(1);
  const lonely = createAtlas(readRepo(fakeArch([node('A', 1)], [])));
  expect(lonely.next().stops.length).toBeGreaterThan(0);
});

test('packs: how bad a sign is sets the crowd, later laps are tougher, the first one carries the file name', () => {
  const sign = (kind: Sign['kind'], severity: number): Sign => ({ kind, severity, lesson: '' });
  expect(packOf(sign('complex', 40), 'Branchy', 1)[0]).toMatchObject({ kind: 'elite', label: 'Branchy' });
  expect(packOf(sign('complex', 40), 'x', 3)[0].hp).toBeGreaterThan(packOf(sign('complex', 40), 'x', 1)[0].hp);
  expect(packOf(sign('upward', 50), 'x', 1).length).toBe(5);
  expect(packOf(sign('upward', 1), 'x', 1).length).toBe(2);
  expect(packOf(sign('cycle', 2), 'x', 1).length).toBe(2);
  expect(packOf(sign('ghost', 1), 'x', 1)[0].ghost).toBe(true);
  expect(packOf(sign('upward', 3), 'x', 1).slice(1).every((m) => m.label === null)).toBe(true);
});

// ---- pilot ----

const trip = (n: number, stops: { i: number; sign?: Sign['kind'] }[]): Expedition => ({
  n, root: stops[0].i,
  stops: stops.map((s, k) => ({ i: s.i, via: k ? { from: stops[k - 1].i, kinds: 'import' } : null, sign: s.sign ? { kind: s.sign, severity: 1, lesson: '' } : null, line: '' })),
});
const fakeAtlas = (make: (n: number) => Expedition): Atlas => {
  let n = 0;
  return { get lap() { return 1; }, next: () => make(++n) };
};
const hooks = { route: () => null, range: () => 3 };

/** A hero that walks exactly where it is told and monsters that fall when attacked. */
function simulate(atlas: Atlas, doors: Map<number, Point>, seconds: number) {
  const pilot = createPilot(atlas, doors, hooks);
  const hero = { x: 0, z: 0 };
  let inside = false;
  let foes: PilotWorld['foes'] = [];
  const log: { t: number; cmd: PilotCommand; phase: string }[] = [];
  const step = 0.05;
  for (let t = 0; t < seconds; t += step) {
    const cmd = pilot.update(step, { x: hero.x, z: hero.z, ready: !inside, inside, foes });
    log.push({ t, cmd, phase: pilot.phase });
    if (cmd.teleport) [hero.x, hero.z] = cmd.teleport;
    if (cmd.move) { hero.x += cmd.move[0] * 11 * step; hero.z += cmd.move[1] * 11 * step; }
    if (cmd.spawn) {
      const tag = tagOf(pilot.expedition!, pilot.at);
      const d = doors.get(cmd.spawn.i)!;
      foes = [{ x: d[0], z: d[1] + 1, tag }, { x: d[0] + 1, z: d[1] + 1, tag }];
      pilot.spawned(foes.length);
    }
    if (cmd.attack && foes.length) pilot.onKill(foes.shift()!.tag);
    if (cmd.enter !== null) inside = true;
    if (cmd.leave) inside = false;
  }
  return { pilot, log };
}

test('pilot: brief, every stop in order, monsters only where there is a sign, debrief, then the next expedition', () => {
  const doors = new Map<number, Point>([[0, [10, 0]], [1, [30, 0]], [2, [50, 0]]]);
  const { pilot, log } = simulate(fakeAtlas((n) => trip(n, [{ i: 0 }, { i: 1, sign: 'upward' }, { i: 2 }])), doors, 120);
  const entered = log.filter((l) => l.cmd.enter !== null).map((l) => l.cmd.enter);
  expect(entered.slice(0, 3)).toEqual([0, 1, 2]);
  expect(log.filter((l) => l.cmd.spawn).map((l) => l.cmd.spawn!.i).slice(0, 1)).toEqual([1]);
  const phases = log.map((l) => l.phase).filter((p, k, all) => p !== all[k - 1]);
  expect(phases.slice(0, 2)).toEqual(['brief', 'travel']);
  expect(phases).toContain('fight');
  expect(phases).toContain('debrief');
  expect(pilot.expedition!.n).toBeGreaterThan(1);
  expect(pilot.learned).toBeGreaterThanOrEqual(3);
});

test('pilot: the brief, the code and the debrief each stay up for their time', () => {
  const doors = new Map<number, Point>([[0, [5, 0]]]);
  const { log } = simulate(fakeAtlas((n) => trip(n, [{ i: 0 }])), doors, 40);
  const span = (phase: string) => {
    const at = log.filter((l) => l.phase === phase).map((l) => l.t);
    return at.length ? at[at.length - 1] - at[0] : 0;
  };
  expect(span('brief')).toBeGreaterThanOrEqual(BRIEF_TIME - 0.2);
  expect(span('read')).toBeGreaterThanOrEqual(READ_TIME - 0.2);
  expect(span('debrief')).toBeGreaterThanOrEqual(DEBRIEF_TIME - 0.2);
});

const pastBrief = (pilot: ReturnType<typeof createPilot>, w: PilotWorld) => {
  for (let t = 0; t <= BRIEF_TIME + 0.1; t += 0.05) pilot.update(0.05, w);
};

test('pilot: a long trip jumps ahead instead of running across the whole city', () => {
  const doors = new Map<number, Point>([[0, [FAST_TRAVEL * 2, 0]]]);
  const pilot = createPilot(fakeAtlas((n) => trip(n, [{ i: 0 }])), doors, { route: () => [[0, 20], [FAST_TRAVEL * 2, 20]], range: () => 3 });
  const w = { x: 0, z: 0, ready: true, inside: false, foes: [] };
  let jumped: Point | null = null;
  for (let t = 0; t < BRIEF_TIME + 1 && !jumped; t += 0.05) jumped = pilot.update(0.05, w).teleport;
  expect(jumped).toEqual([FAST_TRAVEL * 2, 20]);
});

test('pilot: a stuck hero skips to the next corner', () => {
  const doors = new Map<number, Point>([[0, [100, 0]]]);
  const pilot = createPilot(fakeAtlas((n) => trip(n, [{ i: 0 }])), doors, { route: () => [[40, 0], [100, 0]], range: () => 3 });
  const w = { x: 0, z: 0, ready: true, inside: false, foes: [] };
  pastBrief(pilot, w);
  let jumped: Point | null = null;
  for (let t = 0; t < 5 && !jumped; t += 0.05) jumped = pilot.update(0.05, w).teleport;
  expect(jumped).toEqual([40, 0]);
});

test('pilot: a sign counts as beaten only when its whole pack is down', () => {
  const doors = new Map<number, Point>([[0, [ARRIVE / 2, 0]]]);
  const pilot = createPilot(fakeAtlas((n) => trip(n, [{ i: 0, sign: 'cycle' }])), doors, hooks);
  const w = { x: 0, z: 0, ready: true, inside: false, foes: [] };
  let spawn = null;
  for (let t = 0; t < BRIEF_TIME + 1 && !spawn; t += 0.05) spawn = pilot.update(0.05, w).spawn;
  expect(spawn?.i).toBe(0);
  pilot.spawned(3);
  const tag = tagOf(pilot.expedition!, 0);
  pilot.onKill('9:9');
  pilot.onKill(tag);
  pilot.onKill(tag);
  expect(pilot.beaten.has(0)).toBe(false);
  pilot.onKill(tag);
  expect(pilot.beaten.has(0)).toBe(true);
  expect(pilot.slowmo).toBeGreaterThan(0);
});

test('pilot: after the player takes over, it picks the walk up at the same stop', () => {
  const doors = new Map<number, Point>([[0, [5, 0]], [1, [200, 0]]]);
  const pilot = createPilot(fakeAtlas((n) => trip(n, [{ i: 0 }, { i: 1 }])), doors, hooks);
  const w = { x: 0, z: 0, ready: true, inside: false, foes: [] };
  pastBrief(pilot, w);
  pilot.update(0.05, w);
  expect(pilot.stop?.i).toBe(0);
  pilot.reset();
  expect(pilot.phase).toBe('travel');
  pilot.update(0.05, { ...w, x: 3 });
  expect(pilot.stop?.i).toBe(0);
});

test('test files and routed controllers are never mistaken for unused code', () => {
  const arch = fakeArch([
    node('Base', 2, { fanIn: 3 }),
    node('Routed', 1, { fanIn: 0, routeRefs: 2 }),
    { ...node('BaseTest', 1, { fanIn: 0, lines: 2000 }), path: 'tests/Unit/BaseTest.php' },
    { ...node('base.test', 1, { fanIn: 0 }), path: 'src/base.test.ts' },
    node('A', 1), node('B', 1),
  ], [[2, 0, 1, { new: 1 }, 0], [3, 0, 1, { import: 1 }, 0], [4, 0, 1, { new: 1 }, 0], [5, 0, 1, { new: 1 }, 0]]);
  const repo = readRepo(arch);
  expect([1, 2, 3].map((i) => repo.sign(i))).toEqual([null, null, null]);
  expect(planExpedition(repo, 0, 1).stops.map((s) => s.i)).not.toContain(2);
  expect(planExpedition(repo, 0, 1).stops.map((s) => s.i)).not.toContain(3);
});

test('an expedition stops early instead of listing a whole family of plain siblings', () => {
  const kids = Array.from({ length: 10 }, (_, k) => node(`Kid${k}`, 0, { fanIn: 0, routeRefs: 1 }));
  const arch = fakeArch([node('Base', 0, { fanIn: 10 }), ...kids], kids.map((_, k) => [k + 1, 0, 1, { extends: 1 }, 0] as Architecture['edges'][number]));
  expect(planExpedition(readRepo(arch), 0, 1).stops.length).toBe(4);
});
