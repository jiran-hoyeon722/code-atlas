import { expect, test } from 'vitest';
import {
  BOSS_MIN_TIME, COLLAPSE_TIME, DIFFICULTIES, DIFFICULTY, FORM_TIME, TIME_LIMIT, INFECTED_AT, createSiege, createVirus, isDifficulty, isInfected, pickSpawnSite, storedDifficulty, type SiegeWorld, type VirusSite,
} from '../../src/features/walk/walkVirus';
import { FOES, RECALL, THROW, approach, eliteThrows, seesPlayer, shamble, steer, straggler } from '../../src/features/walk/walkHorde';
import { alongPath } from '../../src/features/walk/walkFx';

const calm: SiegeWorld = { allInfected: false, bossDown: false, zombies: 0, elites: 0 };
const run = (siege: ReturnType<typeof createSiege>, seconds: number, world: SiegeWorld, step = 0.1) => {
  const events: string[] = [];
  for (let t = 0; t < seconds - 1e-9; t += step) events.push(...siege.update(step, world));
  return events;
};

test('difficulty: five tiers in order, only easy shows the guide', () => {
  expect(DIFFICULTIES).toEqual(['easy', 'normal', 'hard', 'hell', 'god']);
  expect(DIFFICULTIES.map((d) => DIFFICULTY[d].label)).toEqual(['쉬움', '보통', '어려움', '지옥', '신']);
  expect(DIFFICULTIES.filter((d) => DIFFICULTY[d].guide)).toEqual(['easy']);
  expect(DIFFICULTIES.filter((d) => DIFFICULTY[d].chase)).toEqual(['hard', 'hell', 'god']);
  expect(DIFFICULTIES.filter((d) => DIFFICULTY[d].tank)).toEqual(['hell', 'god']);
  expect(isDifficulty('god')).toBe(true);
  expect(isDifficulty('nightmare')).toBe(false);
  expect(isDifficulty(null)).toBe(false);
});

test('each harder tier has more origins, a faster spread, more spawns and tougher foes', () => {
  DIFFICULTIES.slice(1).forEach((d, k) => {
    const prev = DIFFICULTY[DIFFICULTIES[k]];
    const next = DIFFICULTY[d];
    expect(next.origins).toBeGreaterThan(prev.origins);
    expect(next.spread).toBeLessThan(prev.spread);
    expect(next.zombieEvery).toBeLessThan(prev.zombieEvery);
    expect(next.zombieCap).toBeGreaterThan(prev.zombieCap);
    expect(next.eliteEvery).toBeLessThan(prev.eliteEvery);
    expect(next.eliteCap).toBeGreaterThan(prev.eliteCap);
    expect(next.foe.hp).toBeGreaterThan(prev.foe.hp);
    expect(next.foe.damage).toBeGreaterThan(prev.foe.damage);
    expect(next.foe.speed).toBeGreaterThan(prev.foe.speed);
  });
  DIFFICULTIES.forEach((d) => expect(DIFFICULTY[d].spread).toBeLessThan(TIME_LIMIT));
});

test('a saved difficulty survives, older saves included, and junk falls back to normal', () => {
  expect(storedDifficulty('easy')).toBe('easy');
  expect(storedDifficulty('hard')).toBe('hard');
  expect(storedDifficulty('god')).toBe('god');
  expect(storedDifficulty('하')).toBe('normal');
  expect(storedDifficulty(null)).toBe('normal');
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
  expect(siege.timeLeft).toBeCloseTo(TIME_LIMIT - 0.1 - FORM_TIME, 0);
  run(siege, 10, { ...calm, allInfected: true });
  expect(siege.timeLeft).toBeCloseTo(TIME_LIMIT - 10.1 - FORM_TIME, 0);
  siege.stop();
  expect(siege.phase).toBe('boss');
  expect(siege.update(0.1, { ...calm, allInfected: true, bossDown: true })).toEqual(['won']);
  expect(siege.phase).toBe('off');
});

test('running out of time collapses the repo exactly once, and nothing stops it', () => {
  const siege = createSiege();
  siege.start(DIFFICULTY.hard);
  const world = { ...calm, allInfected: true };
  const events = run(siege, TIME_LIMIT + 0.5, world, 0.5);
  expect(events).toEqual(['form', 'boss', 'collapse']);
  expect(siege.phase).toBe('collapsing');
  siege.stop();
  expect(siege.update(0.1, { ...world, bossDown: true })).toEqual([]);
  expect(run(siege, COLLAPSE_TIME + 1, world)).toEqual(['collapsed']);
  expect(siege.phase).toBe('over');
  expect(siege.progress).toBe(1);
  expect(run(siege, 5, world)).toEqual([]);
});

test('the 10-minute clock collapses the repo whatever phase it runs out in', () => {
  const outbreak = createSiege();
  outbreak.start(DIFFICULTY.god);
  const capped = { ...calm, zombies: 999, elites: 999 };
  expect(run(outbreak, TIME_LIMIT - 1, capped, 1)).toEqual([]);
  expect(outbreak.phase).toBe('outbreak');
  expect(outbreak.timeLeft).toBeCloseTo(1);
  expect(run(outbreak, 2, capped, 1)).toEqual(['collapse']);
  expect(outbreak.phase).toBe('collapsing');

  const forming = createSiege();
  forming.start(DIFFICULTY.easy, 3);
  expect(forming.update(0.5, { ...calm, allInfected: true })).toEqual(['form']);
  expect(run(forming, 3, { ...calm, allInfected: true })).toEqual(['collapse']);

  const boss = createSiege();
  boss.start(DIFFICULTY.normal, BOSS_MIN_TIME + FORM_TIME + 5);
  const world = { ...calm, allInfected: true };
  expect(run(boss, FORM_TIME + 1, world)).toEqual(['form', 'boss']);
  expect(boss.timeLeft).toBeGreaterThan(BOSS_MIN_TIME);
  expect(run(boss, BOSS_MIN_TIME + 5, world)).toEqual(['collapse']);
});

test('a late giant still gets three minutes, an early one keeps the clock it has', () => {
  const late = createSiege();
  late.start(DIFFICULTY.easy, FORM_TIME + 5);
  const world = { ...calm, allInfected: true };
  expect(run(late, FORM_TIME + 1, world)).toEqual(['form', 'boss', 'overtime']);
  expect(late.timeLeft).toBeGreaterThan(BOSS_MIN_TIME - 1);
  expect(run(late, BOSS_MIN_TIME - 2, world)).toEqual([]);
  expect(late.phase).toBe('boss');
  expect(run(late, 3, world)).toEqual(['collapse']);

  const early = createSiege();
  early.start(DIFFICULTY.god);
  expect(run(early, FORM_TIME + 1, world)).toEqual(['form', 'boss']);
  expect(early.timeLeft).toBeGreaterThan(TIME_LIMIT - FORM_TIME - 2);
});

test('killing the giant on the last frame still wins', () => {
  const siege = createSiege();
  siege.start(DIFFICULTY.normal, FORM_TIME + 1);
  run(siege, FORM_TIME + 0.95, { ...calm, allInfected: true });
  expect(siege.phase).toBe('boss');
  expect(siege.update(1, { ...calm, allInfected: true, bossDown: true })).toEqual(['won']);
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

test('below hard, foes only react in sight and far zombies wander off; chasers see the player from anywhere', () => {
  expect(seesPlayer('zombie', FOES.zombie.sight + 1, false)).toBe(false);
  expect(seesPlayer('elite', FOES.elite.sight - 1, false)).toBe(true);
  expect(seesPlayer('zombie', 500, true)).toBe(true);
  expect(seesPlayer('elite', 500, true)).toBe(true);
  expect(seesPlayer('boss', 500, false)).toBe(true);
  expect(straggler('zombie', 111, false)).toBe('release');
  expect(straggler('elite', 500, false)).toBe('keep');
  expect(straggler('zombie', 120, true)).toBe('keep');
  expect(straggler('zombie', RECALL + 1, true)).toBe('recall');
  expect(straggler('elite', RECALL + 1, true)).toBe('recall');
  expect(straggler('boss', 500, true)).toBe('keep');
});

test('a blocked chaser turns 45° then 90°, its own side first, and gives up only when boxed in', () => {
  const near = (v: [number, number] | null, x: number, z: number) => { expect(v).not.toBeNull(); expect(v![0]).toBeCloseTo(x); expect(v![1]).toBeCloseTo(z); };
  near(steer(0, 5, 1, () => true), 0, 1);
  const wallAhead = (_ux: number, uz: number) => uz < 0.9;
  near(steer(0, 5, 1, wallAhead), Math.SQRT1_2, Math.SQRT1_2);
  near(steer(0, 5, -1, wallAhead), -Math.SQRT1_2, Math.SQRT1_2);
  const wide = (ux: number, uz: number) => uz < 0.1 && ux < 0;
  near(steer(0, 5, 1, wide), -1, 0);
  expect(steer(0, 5, 1, () => false)).toBeNull();
});

test('elites throw only when the player is out of reach — up on a roof or too far to hit — and within throwing range', () => {
  const reach = FOES.elite.radius + FOES.elite.reach + 1.7;
  expect(eliteThrows(2, 0, reach)).toBe(false);
  expect(eliteThrows(2, 6, reach)).toBe(true);
  expect(eliteThrows(reach + 1, 0, reach)).toBe(true);
  expect(eliteThrows(THROW.range, 0, reach)).toBe(true);
  expect(eliteThrows(THROW.range + 1, 0, reach)).toBe(false);
  expect(eliteThrows(THROW.range + 1, 8, reach)).toBe(false);
  expect(THROW.damage).toBeLessThan(FOES.elite.damage);
});
