import { describe, expect, test } from 'vitest';
import { buildArmy, chunkStart, isShield, placeSquads } from '../../../src/engine/battle/sim/army';
import { chainExtra, cloneBurst, guardDamage, hitDamage } from '../../../src/engine/battle/sim/battle';
import { ATTACK_BY_TIER, EFFECTS, FIELD, LUCK, SPEED_BY_TIER } from '../../../src/engine/battle/rules';
import { createBattle, predict, simulate, victoryLabel } from '../../../src/engine/battle/sim';
import type { BattleEvent, Squad, UnitState } from '../../../src/engine/battle/sim';
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
    expect(s.atk).toBeCloseTo((2 * ATTACK_BY_TIER[3] + 2 * 1) / 4);
    expect(s.spd).toBeCloseTo((2 * SPEED_BY_TIER[3] + 2 * 1) / 4);
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
    expect(army.commander.guard).toBeCloseTo(1 - EFFECTS.shieldCut);
  });

  test('lanes: path order 1,4,7 mid; 2,5,8 top; 3,6,9 bottom', () => {
    const squads = Array.from({ length: 15 }, (_, i) => ({ index: i }));
    const lanes = placeSquads(squads as Squad[]);
    expect(lanes.mid).toEqual([0, 3, 6, 9, 12]);
    expect(lanes.top).toEqual([1, 4, 7, 10, 13]);
    expect(lanes.bottom).toEqual([2, 5, 8, 11, 14]);
  });

  test('fewer than 300 code lines cannot fight', () => {
    expect(() => buildArmy(tinyQuality('x', fivePaths(59)))).toThrow();
    expect(() => simulate(tinyQuality('x', fivePaths(59)), synthQuality(), 1)).toThrow();
  });
});

describe('mechanics', () => {
  test('hit damage: luck range and crit', () => {
    expect(hitDamage(1, 0, 0.5).damage).toBeCloseTo(10 * LUCK.hitMin);
    expect(hitDamage(1, 0, 0.5).crit).toBe(false);
    expect(hitDamage(0.5, 1, 0.5).damage).toBeCloseTo(5);
    expect(hitDamage(1, 0, 0.01).damage).toBeCloseTo(10 * LUCK.hitMin * LUCK.critMul);
    expect(hitDamage(1, 0, 0.01).crit).toBe(true);
  });

  test('shield cuts shieldCut, commander guard scales with tests', () => {
    const shielded = guardDamage(10, true, 1);
    expect(shielded.damage).toBeCloseTo(10 * (1 - EFFECTS.shieldCut));
    expect(shielded.blocked).toBeCloseTo(10 * EFFECTS.shieldCut);
    expect(guardDamage(10, false, 1)).toEqual({ damage: 10, blocked: 0 });
    expect(guardDamage(10, false, 0.85).damage).toBeCloseTo(8.5);
  });

  test('chain adds chainShare x r of the hit on top, nothing without cycles', () => {
    expect(chainExtra(10, 0.5)).toBeCloseTo(10 * EFFECTS.chainShare * 0.5);
    expect(chainExtra(10, 0)).toBe(0);
  });

  test('clone burst is max hp x cloneBurst x d', () => {
    expect(cloneBurst(100, 0.4)).toBeCloseTo(100 * EFFECTS.cloneBurst * 0.4);
    expect(cloneBurst(100, 0)).toBe(0);
  });

  const allEvents = (events: BattleEvent[]) => {
    const kinds = new Map<string, number>();
    for (const e of events) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
    return kinds;
  };

  test('chain events carry the extra a tangled soldier takes on top of a hit', () => {
    const tangled = tinyQuality('tangled', fivePaths(200).map((f) => ({ ...f, cycle: 0 })));
    const plain = tinyQuality('plain', fivePaths(200));
    const r = simulate(tangled, plain, 1, { record: true });
    const at = r.events.findIndex((e) => e.kind === 'hit' && e.target.side === 'a' && e.target.index >= 0);
    const first = r.events[at];
    if (first.kind !== 'hit') throw new Error('no hit');
    const chain = r.events[at + 1];
    if (chain.kind !== 'chain') throw new Error('no chain event');
    expect(chain.from).toEqual(first.target);
    expect(chain.target).toEqual(first.target);
    expect(chain.damage).toBeCloseTo(first.damage * EFFECTS.chainShare);
    expect(allEvents(simulate(plain, tinyQuality('plain2', fivePaths(200)), 1, { record: true }).events).get('chain')).toBeUndefined();
  });

  test('a dying clone splits max hp x cloneBurst x d among its group, without cascading', () => {
    const cloned = tinyQuality('cloned', fivePaths(200).map((f) => ({ ...f, clone: 1, removable: true })));
    const plain = tinyQuality('plain', fivePaths(200));
    const r = simulate(cloned, plain, 1, { record: true });
    const bursts = r.events.filter((e) => e.kind === 'clone');
    expect(bursts.length).toBeGreaterThan(0);
    const perDeath = new Map<string, number>();
    for (const e of bursts) {
      if (e.kind !== 'clone') continue;
      const k = `${e.tick}:${e.source.index}`;
      perDeath.set(k, (perDeath.get(k) ?? 0) + e.damage);
    }
    for (const total of perDeath.values()) expect(total).toBeCloseTo(100 * EFFECTS.cloneBurst);
    const cloneDeaths = r.events.filter((e) => e.kind === 'death' && e.cause === 'clone');
    const sources = new Set(bursts.map((e) => (e.kind === 'clone' ? `${e.tick}:${e.source.index}` : '')));
    for (const d of cloneDeaths) if (d.kind === 'death') expect(sources.has(`${d.tick}:${d.unit.index}`)).toBe(false);
  });

  test('shields record blocked damage', () => {
    const tested = tinyQuality('tested', fivePaths(200), 1);
    const r = simulate(tested, tinyQuality('plain', fivePaths(200)), 1, { record: true });
    const onShield = r.events.find((e) => e.kind === 'hit' && e.target.side === 'a' && e.target.index >= 0);
    if (!onShield || onShield.kind !== 'hit') throw new Error('no hit');
    expect(onShield.blocked / (onShield.damage + onShield.blocked)).toBeCloseTo(EFFECTS.shieldCut);
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

  const nearestAlly = (units: readonly UnitState[]) =>
    units.map((u) => {
      let best = Infinity;
      for (const v of units) if (v !== u) best = Math.min(best, Math.sqrt((u.x - v.x) ** 2 + (u.z - v.z) ** 2));
      return best;
    });

  test('fighting allies keep apart instead of piling onto one spot', () => {
    const battle = createBattle(A, B, 1);
    const near: number[] = [];
    while (battle.tick < 300 && battle.phase === 'lanes') {
      battle.step();
      if (battle.tick % 10 !== 0) continue;
      for (const lane of battle.lanes) {
        if (!lane.duel) continue;
        for (const side of ['a', 'b'] as const) {
          const units = battle.soldiers[side].filter((u) => u.alive && u.squad === lane.duel!.squads[side]);
          if (units.length > 1) near.push(...nearestAlly(units));
        }
      }
    }
    expect(near.length).toBeGreaterThan(100);
    const mean = near.reduce((s, d) => s + d, 0) / near.length;
    expect(mean).toBeGreaterThan(FIELD.minGap * 0.8);
    expect(Math.min(...near)).toBeGreaterThan(FIELD.minGap * 0.3);
  });

  test('allies on the exact same spot are split the same way on both sides', () => {
    const battle = createBattle(A, A, 1);
    const duel = battle.lanes[1].duel!;
    const squad = (side: 'a' | 'b') => battle.soldiers[side].filter((u) => u.squad === duel.squads[side]) as { x: number; z: number }[];
    for (const u of squad('a')) Object.assign(u, { x: -3, z: 0 });
    for (const u of squad('b')) Object.assign(u, { x: 3, z: 0 });
    battle.step();
    const a = squad('a');
    const b = squad('b');
    for (let j = 0; j < a.length; j++) {
      expect(b[j].x).toBe(-a[j].x);
      expect(b[j].z).toBe(a[j].z);
    }
    expect(new Set(a.map((u) => `${u.x},${u.z}`)).size).toBeGreaterThan(1);
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
