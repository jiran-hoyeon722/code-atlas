import { describe, expect, test } from 'vitest';
import { buildArmy, chunkStart, isShield, placeSquads } from '../../../src/engine/battle/sim/army';
import { chainSplit, cloneBurst, guardDamage, hitDamage } from '../../../src/engine/battle/sim/battle';
import { createBattle, predict, simulate, victoryLabel } from '../../../src/engine/battle/sim';
import type { BattleEvent, Squad } from '../../../src/engine/battle/sim';
import { synthQuality, tinyQuality } from './synth';

const fivePaths = (lines: number) =>
  [0, 1, 2, 3, 4].map((i) => ({ path: `src/m${i}/f${i}.ts`, lines }));

describe('army', () => {
  test('chunks split lines with integer boundaries', () => {
    expect(chunkStart(0, 1000)).toBe(0);
    expect(chunkStart(1, 1000)).toBe(3);
    expect(chunkStart(2, 1000)).toBe(6);
    expect(chunkStart(3, 1000)).toBe(10);
    expect(chunkStart(300, 1000)).toBe(1000);
    const army = buildArmy(tinyQuality('x', fivePaths(200)));
    expect(army.soldiers).toHaveLength(300);
    expect(army.soldiers[0]).toMatchObject({ start: 0, end: 3 });
    expect(army.soldiers[299].end).toBe(1000);
    for (let i = 1; i < 300; i++) expect(army.soldiers[i].start).toBe(army.soldiers[i - 1].end);
  });

  test('home is the file with most chunk lines, earlier file on ties', () => {
    const army = buildArmy(tinyQuality('x', [
      { path: 'a/p.ts', lines: 1 },
      { path: 'a/q.ts', lines: 299 },
      { path: 'b/x.ts', lines: 100 },
      { path: 'b/y.ts', lines: 100 },
      { path: 'b/z.ts', lines: 100 },
    ]));
    expect(army.soldiers[0].home).toBe('a/p.ts');
    expect(army.soldiers[0].key).toBe('a/p.ts#0');
    expect(army.soldiers[1].home).toBe('a/q.ts');
    expect(army.soldiers[299]).toMatchObject({ home: 'b/z.ts', key: 'b/z.ts#299' });
  });

  test('stats are line-weighted tier averages and effect shares', () => {
    const army = buildArmy(tinyQuality('x', [
      { path: 'a/f0.ts', lines: 150, ccn: 3, len: 3, cycle: 0, clone: 2, removable: true },
      { path: 'a/f1.ts', lines: 150 },
      { path: 'a/f2.ts', lines: 300 },
      { path: 'a/f3.ts', lines: 300 },
      { path: 'a/f4.ts', lines: 300 },
    ]));
    // 1200 lines -> 4 lines each; soldier 37 covers lines 148..151: half in f0.
    const s = army.soldiers[37];
    expect(s.atk).toBeCloseTo((2 * 0.5 + 2 * 1) / 4);
    expect(s.spd).toBeCloseTo((2 * 0.6 + 2 * 1) / 4);
    expect(s.r).toBe(0.5);
    expect(s.chainGroup).toBe(0);
    expect(s.d).toBe(0.5);
    expect(s.cloneGroup).toBe(1);
    expect(army.soldiers[100]).toMatchObject({ r: 0, chainGroup: -1, d: 0, cloneGroup: -1, burn: 0 });
  });

  test('shields are spread evenly: S = round(300 * tests)', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => isShield(i, 100))).toEqual([false, false, true, false, false, true]);
    const count = (t: number) => buildArmy(tinyQuality('x', fivePaths(200), t)).soldiers.filter((s) => s.shield).length;
    expect(count(0)).toBe(0);
    expect(count(1)).toBe(300);
    expect(count(0.5)).toBe(150);
    expect(count(0.1234)).toBe(37);
    const army = buildArmy(tinyQuality('x', fivePaths(200), 0.5));
    expect(army.soldiers.slice(0, 4).map((s) => s.shield)).toEqual([false, true, false, true]);
  });

  test('squads: 15 x 20, named by most common folder, body and gear', () => {
    const army = buildArmy(tinyQuality('x', [
      { path: 'core/a.ts', lines: 100, ccn: 3, cycle: 0 },
      { path: 'core/b.ts', lines: 100, ccn: 3, cycle: 0 },
      { path: 'root.ts', lines: 100, removable: true, clone: 1 },
      { path: 'ui/c.ts', lines: 1200 },
      { path: 'ui/d.ts', lines: 1500 },
    ], 1));
    expect(army.squads).toHaveLength(15);
    expect(army.squads.map((s) => s.to - s.from)).toEqual(new Array(15).fill(20));
    expect(army.squads[0]).toMatchObject({ name: 'core', body: 'heavy', gear: ['link', 'shield'] });
    expect(army.squads[1]).toMatchObject({ name: 'root.ts', body: 'sprint', gear: ['shield', 'mirror'] });
    expect(army.squads[5]).toMatchObject({ name: 'ui', body: 'sprint', gear: ['shield'] });
    expect(army.commander.hp).toBe(1000);
    expect(army.commander.guard).toBeCloseTo(0.7);
  });

  test('lanes: ranks 1,4,7 mid; 2,5,8 top; 3,6,9 bottom', () => {
    const squads = Array.from({ length: 15 }, (_, i) => ({ index: i, power: [5, 9, 1, 9, 3, 7, 2, 8, 4, 6, 0.5, 0.4, 0.3, 0.2, 0.1][i] }));
    const lanes = placeSquads(squads as Squad[]);
    // power order: 1(9), 3(9), 7(8), 5(7), 9(6), 0(5), 8(4), 4(3), 6(2), 2(1), 10, 11, 12, 13, 14
    expect(lanes.mid).toEqual([1, 5, 8, 2, 12]);
    expect(lanes.top).toEqual([3, 9, 4, 10, 13]);
    expect(lanes.bottom).toEqual([7, 0, 6, 11, 14]);
  });

  test('fewer than 300 code lines cannot fight', () => {
    expect(() => buildArmy(tinyQuality('x', fivePaths(59)))).toThrow();
    expect(() => simulate(tinyQuality('x', fivePaths(59)), synthQuality(), 1)).toThrow();
  });
});

describe('mechanics', () => {
  test('hit damage: luck range and crit', () => {
    expect(hitDamage(1, 0, 0.5).damage).toBeCloseTo(8.5);
    expect(hitDamage(1, 0, 0.5).crit).toBe(false);
    expect(hitDamage(0.5, 1, 0.5).damage).toBeCloseTo(5);
    expect(hitDamage(1, 0, 0.01).damage).toBeCloseTo(12.75);
    expect(hitDamage(1, 0, 0.01).crit).toBe(true);
  });

  test('shield cuts 30%, commander guard scales with tests', () => {
    const shielded = guardDamage(10, true, 1);
    expect(shielded.damage).toBeCloseTo(7);
    expect(shielded.blocked).toBeCloseTo(3);
    expect(guardDamage(10, false, 1)).toEqual({ damage: 10, blocked: 0 });
    expect(guardDamage(10, false, 0.85).damage).toBeCloseTo(8.5);
  });

  test('chain shares 30% x r among allies, or none without allies', () => {
    const split = chainSplit(10, 0.5, 3);
    expect(split.self).toBeCloseTo(8.5);
    expect(split.each).toBeCloseTo(0.5);
    expect(chainSplit(10, 0.5, 0)).toEqual({ self: 10, each: 0 });
  });

  test('clone burst is max hp x 50% x d', () => {
    expect(cloneBurst(100, 0.4)).toBeCloseTo(20);
    expect(cloneBurst(100, 0)).toBe(0);
  });

  const allEvents = (events: BattleEvent[]) => {
    const kinds = new Map<string, number>();
    for (const e of events) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
    return kinds;
  };

  test('chain events carry the shared part of a hit on a tangled army', () => {
    const tangled = tinyQuality('tangled', fivePaths(200).map((f) => ({ ...f, cycle: 0 })));
    const plain = tinyQuality('plain', fivePaths(200));
    const r = simulate(tangled, plain, 1, { record: true });
    const at = r.events.findIndex((e) => e.kind === 'hit' && e.target.side === 'a' && e.target.index >= 0);
    const first = r.events[at];
    if (first.kind !== 'hit') throw new Error('no hit');
    let total = 0;
    let n = 0;
    for (let i = at + 1; r.events[i].kind === 'chain'; i++) {
      const e = r.events[i];
      if (e.kind === 'chain') {
        expect(e.from).toEqual(first.target);
        total += e.damage;
        n++;
      }
    }
    expect(n).toBe(19);
    expect(total).toBeCloseTo(first.damage * 0.3);
    expect(allEvents(r.events).get('chain')).toBeGreaterThan(0);
  });

  test('clone bursts hit same-group soldiers when one dies, without cascading', () => {
    const cloned = tinyQuality('cloned', fivePaths(200).map((f) => ({ ...f, clone: 1, removable: true })));
    const plain = tinyQuality('plain', fivePaths(200));
    const r = simulate(cloned, plain, 1, { record: true });
    const bursts = r.events.filter((e) => e.kind === 'clone');
    expect(bursts.length).toBeGreaterThan(0);
    for (const e of bursts) if (e.kind === 'clone') expect(e.damage).toBeCloseTo(50);
    const cloneDeaths = r.events.filter((e) => e.kind === 'death' && e.cause === 'clone');
    const sources = new Set(bursts.map((e) => (e.kind === 'clone' ? `${e.tick}:${e.source.index}` : '')));
    for (const d of cloneDeaths) if (d.kind === 'death') expect(sources.has(`${d.tick}:${d.unit.index}`)).toBe(false);
  });

  test('shields record blocked damage', () => {
    const tested = tinyQuality('tested', fivePaths(200), 1);
    const r = simulate(tested, tinyQuality('plain', fivePaths(200)), 1, { record: true });
    const onShield = r.events.find((e) => e.kind === 'hit' && e.target.side === 'a' && e.target.index >= 0);
    if (!onShield || onShield.kind !== 'hit') throw new Error('no hit');
    expect(onShield.blocked / (onShield.damage + onShield.blocked)).toBeCloseTo(0.3);
  });
});

describe('battle', () => {
  const A = synthQuality({ name: 'alpha', totalLines: 6000, seed: 3, cycleShare: 0.1, removableShare: 0.05, testRatio: 0.3 });
  const B = synthQuality({ name: 'beta', totalLines: 9000, seed: 4, cycleShare: 0.05, removableShare: 0.08, testRatio: 0.5 });

  test('same inputs give an identical JSON result', () => {
    expect(JSON.stringify(simulate(A, B, 3, { record: true }))).toBe(JSON.stringify(simulate(A, B, 3, { record: true })));
  });

  test('swapping sides mirrors everything', () => {
    for (const m of [1, 2, 3]) {
      const ab = simulate(A, B, m, { record: true });
      const ba = simulate(B, A, m, { record: true });
      const flip = (s: string) => s.replace(/"(a|b)"/g, (_, x) => (x === 'a' ? '"b"' : '"a"'));
      expect(flip(JSON.stringify(ba))).toBe(JSON.stringify(ab));
    }
    const p = predict(A, B, 6);
    const q = predict(B, A, 6);
    expect([q.bWins, q.aWins, q.draws]).toEqual([p.aWins, p.bWins, p.draws]);
  });

  test('self vs self is not always a draw', () => {
    const p = predict(A, A, 6);
    expect(p.aWins + p.bWins).toBeGreaterThan(0);
  });

  test('stepper run equals simulate', () => {
    const battle = createBattle(A, B, 2, { record: true });
    expect(battle.phase).toBe('lanes');
    expect(battle.lanes.every((l) => l.duel !== null)).toBe(true);
    expect(battle.soldiers.a).toHaveLength(300);
    const duel = battle.lanes[0].duel!;
    for (let j = 0; j < 20; j++) {
      const ua = battle.soldiers.a[duel.squads.a * 20 + j];
      const ub = battle.soldiers.b[duel.squads.b * 20 + j];
      expect(ua.x).toBeLessThan(0);
      expect(ub.x).toBe(-ua.x);
      expect(ub.z).toBe(ua.z);
      expect(ua.lane).toBe(battle.lanes[0].lane);
    }
    let steps = 0;
    while (!battle.done) {
      battle.step();
      steps++;
    }
    expect(steps).toBe(battle.tick);
    expect(JSON.stringify(battle.result())).toBe(JSON.stringify(simulate(A, B, 2, { record: true })));
  });

  test('result has duels and a final', () => {
    const r = simulate(A, B, 1, { record: true });
    expect(r.duels.length).toBeGreaterThanOrEqual(3);
    expect(r.final.tick).toBeGreaterThan(0);
    expect(r.ticks).toBeLessThanOrEqual(2400);
    expect(r.events.some((e) => e.kind === 'final-start')).toBe(true);
    expect(r.events.at(-1)?.kind).toBe('battle-end');
    expect(simulate(A, B, 1).events).toEqual([]);
  });

  test('a clearly better repo usually wins', () => {
    const good = synthQuality({ name: 'good', totalLines: 8000, seed: 5, ccnShares: [1, 0, 0, 0], lenShares: [1, 0, 0, 0], testRatio: 1 });
    const bad = synthQuality({
      name: 'bad', totalLines: 8000, seed: 6, ccnShares: [0.3, 0.3, 0.2, 0.2], lenShares: [0.3, 0.3, 0.2, 0.2],
      cycleShare: 0.3, removableShare: 0.15, testRatio: 0,
    });
    const p = predict(good, bad, 10);
    expect(p.aWins).toBeGreaterThanOrEqual(8);
  });

  test('victory label by the winner prior win rate', () => {
    expect(victoryLabel(0.6)).toBe('skill');
    expect(victoryLabel(0.59)).toBe('close');
    expect(victoryLabel(0.4)).toBe('close');
    expect(victoryLabel(0.39)).toBe('upset');
  });
});
