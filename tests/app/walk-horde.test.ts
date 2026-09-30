import { expect, test } from 'vitest';
import {
  COLLAPSE_TIME, DIFFICULTY, FORM_TIME, INFECTED_AT, createSiege, createVirus, isDifficulty, isInfected, pickSpawnSite, type SiegeWorld, type VirusSite,
} from '../../src/features/walk/walkVirus';
import { FOES, approach, shamble } from '../../src/features/walk/walkHorde';
import { alongPath } from '../../src/features/walk/walkFx';

const calm: SiegeWorld = { allInfected: false, bossDown: false, zombies: 0, elites: 0 };
const run = (siege: ReturnType<typeof createSiege>, seconds: number, world: SiegeWorld, step = 0.1) => {
  const events: string[] = [];
  for (let t = 0; t < seconds - 1e-9; t += step) events.push(...siege.update(step, world));
  return events;
};

test('difficulty: only easy shows the guide, hard spreads and spawns faster, easy and normal share the pace', () => {
  expect(DIFFICULTY.easy.guide).toBe(true);
  expect(DIFFICULTY.normal.guide).toBe(false);
  expect(DIFFICULTY.hard.guide).toBe(false);
  expect(DIFFICULTY.normal.spread).toBe(150);
  expect(Math.abs(DIFFICULTY.hard.spread - 150 * 0.55)).toBeLessThan(1);
  expect(DIFFICULTY.hard.zombieEvery).toBeLessThan(DIFFICULTY.normal.zombieEvery);
  expect(DIFFICULTY.hard.eliteEvery).toBeLessThan(DIFFICULTY.normal.eliteEvery);
  expect(DIFFICULTY.hard.bossTime).toBeLessThan(DIFFICULTY.normal.bossTime);
  const { guide: _g, label: _l, ...easy } = DIFFICULTY.easy;
  const { guide: _n, label: _m, ...normal } = DIFFICULTY.normal;
  expect(easy).toEqual(normal);
  expect(isDifficulty('hard')).toBe(true);
  expect(isDifficulty('nightmare')).toBe(false);
  expect(isDifficulty(null)).toBe(false);
});

test('an outbreak can run at a difficulty-specific speed', () => {
  const line: VirusSite[] = Array.from({ length: 10 }, (_, k) => ({ x: k * 10, z: 0 }));
  const v = createVirus(line, 150, () => 0.5);
  v.start(0, 20);
  for (let t = 0; t < 30; t++) v.update(1);
  expect(v.infected).toBe(line.length);
});

test('zombies rise only at infected buildings within reach of the player, never on top of them', () => {
  const sites: VirusSite[] = [{ x: 5, z: 0 }, { x: 30, z: 0 }, { x: 50, z: 0 }, { x: 200, z: 0 }];
  const levels = [1, 1, INFECTED_AT - 0.01, 1];
  const player = { x: 0, z: 0 };
  for (let k = 0; k < 10; k++) expect(pickSpawnSite(sites, levels, player, () => k / 10)).toBe(1);
  expect(pickSpawnSite(sites, [0, 0, 0, 1], player, Math.random)).toBe(-1);
  expect(pickSpawnSite(sites, [0, 0, 0, 1], player, Math.random, 14, 250)).toBe(3);
  expect(isInfected(INFECTED_AT)).toBe(true);
  expect(isInfected(0.2)).toBe(false);
});

test('the siege schedules zombies and elites, holding them at the cap', () => {
  const siege = createSiege();
  const rule = DIFFICULTY.normal;
  siege.start(rule);
  expect(siege.cancellable).toBe(true);
  const events = run(siege, 60, calm);
  const zombies = events.filter((e) => e === 'zombie').length;
  expect(zombies).toBeGreaterThanOrEqual(Math.floor(60 / rule.zombieEvery) - 1);
  expect(zombies).toBeLessThanOrEqual(Math.ceil(60 / rule.zombieEvery) + 1);
  expect(events.filter((e) => e === 'elite').length).toBeGreaterThanOrEqual(1);
  expect(run(siege, 30, { ...calm, zombies: rule.zombieCap, elites: rule.eliteCap })).toEqual([]);
  expect(run(siege, 0.2, calm)).toEqual(expect.arrayContaining(['zombie', 'elite']));
});

test('hard mode raises zombies faster than normal', () => {
  const count = (d: 'normal' | 'hard') => {
    const siege = createSiege();
    siege.start(DIFFICULTY[d]);
    return run(siege, 60, calm).filter((e) => e === 'zombie').length;
  };
  expect(count('hard')).toBeGreaterThan(count('normal'));
});

test('full infection forms the giant, and killing it in time wins', () => {
  const siege = createSiege();
  siege.start(DIFFICULTY.normal);
  expect(siege.update(0.1, { ...calm, allInfected: true })).toEqual(['form']);
  expect(siege.phase).toBe('forming');
  expect(siege.cancellable).toBe(false);
  expect(run(siege, FORM_TIME - 0.2, { ...calm, allInfected: true })).toEqual([]);
  expect(run(siege, 0.4, { ...calm, allInfected: true })).toEqual(['boss']);
  expect(siege.timeLeft).toBeGreaterThan(DIFFICULTY.normal.bossTime - 0.5);
  run(siege, 10, { ...calm, allInfected: true });
  expect(siege.timeLeft).toBeCloseTo(DIFFICULTY.normal.bossTime - 10, 0);
  siege.stop();
  expect(siege.phase).toBe('boss');
  expect(siege.update(0.1, { ...calm, allInfected: true, bossDown: true })).toEqual(['won']);
  expect(siege.phase).toBe('off');
});

test('running out of time collapses the repo exactly once, and nothing stops it', () => {
  const siege = createSiege();
  siege.start(DIFFICULTY.hard);
  const world = { ...calm, allInfected: true };
  const events = run(siege, FORM_TIME + DIFFICULTY.hard.bossTime + 0.5, world);
  expect(events).toEqual(['form', 'boss', 'collapse']);
  expect(siege.phase).toBe('collapsing');
  siege.stop();
  expect(siege.update(0.1, { ...world, bossDown: true })).toEqual([]);
  expect(run(siege, COLLAPSE_TIME + 1, world)).toEqual(['collapsed']);
  expect(siege.phase).toBe('over');
  expect(siege.progress).toBe(1);
  expect(run(siege, 5, world)).toEqual([]);
});

test('curing before full infection ends the siege quietly', () => {
  const siege = createSiege();
  siege.start(DIFFICULTY.easy);
  run(siege, 20, calm);
  siege.stop();
  expect(siege.phase).toBe('off');
  expect(siege.update(1, { ...calm, allInfected: true })).toEqual([]);
});

test('zombies close in without overshooting and never break into a run', () => {
  const dt = 1 / 60;
  expect(approach(10, 1.5, 2.4, dt)).toBe(2.4);
  expect(approach(1.5 + 0.01, 1.5, 2.4, dt)).toBeCloseTo(0.6);
  expect(approach(1.2, 1.5, 2.4, dt)).toBe(0);
  let d = 5;
  for (let k = 0; k < 600; k++) d -= approach(d, 1.5, 2.4, dt) * dt;
  expect(d).toBeGreaterThanOrEqual(1.5 - 1e-9);
  expect(d).toBeLessThan(1.51);
  expect(shamble('Walking', 20)).toBe('Walking');
  expect(shamble('Idle', 0)).toBe('Idle');
  expect(shamble('Walking', 0.4)).toBe('Walking');
  expect(shamble('Idle', 0.4)).toBe('Idle');
});

test('elites are much bigger and tougher than zombies, the giant bigger still', () => {
  expect(FOES.elite.scale / FOES.zombie.scale).toBeGreaterThanOrEqual(2);
  expect(FOES.elite.hp).toBeGreaterThan(FOES.zombie.hp * 4);
  expect(FOES.elite.damage).toBeGreaterThan(FOES.zombie.damage);
  expect(FOES.elite.speed).toBeLessThan(FOES.zombie.speed);
  expect(FOES.boss.scale).toBeGreaterThanOrEqual(6);
  expect(FOES.boss.hp).toBeGreaterThan(FOES.elite.hp * 5);
});

test('guide arrows are laid evenly along the route and face along it', () => {
  const pts: [number, number][] = [[0, 0], [0, 10], [10, 10]];
  const spots = alongPath(pts, 1, 3, 10);
  expect(spots.map((p) => p.s)).toEqual([1, 4, 7, 10, 13, 16, 19]);
  expect(spots[0]).toMatchObject({ x: 0, z: 1 });
  expect(spots[0].angle).toBeCloseTo(0);
  expect(spots[4].x).toBeCloseTo(3);
  expect(spots[4].z).toBeCloseTo(10);
  expect(spots[4].angle).toBeCloseTo(Math.PI / 2);
  expect(alongPath([[0, 0]], 0, 1, 5)).toEqual([]);
  expect(alongPath(pts, 0, 3, 2)).toHaveLength(2);
});
