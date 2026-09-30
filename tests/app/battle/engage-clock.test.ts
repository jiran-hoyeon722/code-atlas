import { describe, expect, test } from 'vitest';
import { simulate } from '../../../src/engine/battle/sim';
import { advance, blend, createClock, ease, seek, setSpeed, targetTick, togglePause } from '../../../src/features/battle/engage/clock';
import { Replay } from '../../../src/features/battle/engage/replay';
import { synthQuality } from '../../engine/battle/synth';

describe('replay clock', () => {
  test('one second of playback is 10 ticks at 1× and 20 at 2×', () => {
    let c = createClock(100);
    c = advance(c, 0.2);
    c = advance(c, 0.2);
    c = advance(c, 0.2);
    c = advance(c, 0.2);
    c = advance(c, 0.2);
    expect(c.t).toBeCloseTo(10);
    c = setSpeed(c, 2);
    for (let i = 0; i < 5; i++) c = advance(c, 0.2);
    expect(c.t).toBeCloseTo(30);
  });

  test('pause freezes playback and a resume continues from the same spot', () => {
    let c = advance(createClock(100), 0.1);
    c = togglePause(c);
    expect(advance(c, 1).t).toBeCloseTo(1);
    c = togglePause(c);
    expect(advance(c, 0.1).t).toBeCloseTo(2);
  });

  test('stops exactly at the end and caps a long frame gap', () => {
    const c = createClock(12);
    expect(advance(c, 10).t).toBeCloseTo(2.5);
    let d = c;
    for (let i = 0; i < 20; i++) d = advance(d, 0.25);
    expect(d.t).toBe(12);
    expect(togglePause(d).paused).toBe(false);
  });

  test('seek only moves forward and stays inside the battle', () => {
    const c = { ...createClock(50), t: 20 };
    expect(seek(c, 10).t).toBe(20);
    expect(seek(c, 30).t).toBe(30);
    expect(seek(c, 99).t).toBe(50);
  });

  test('interpolates from the tick before the target tick', () => {
    const c = { ...createClock(50), t: 3.25 };
    expect(targetTick(c)).toBe(4);
    expect(blend(c)).toBeCloseTo(0.25);
    expect(targetTick({ ...c, t: 3 })).toBe(3);
    expect(blend({ ...c, t: 3 })).toBeCloseTo(1);
    expect(targetTick({ ...c, t: 0 })).toBe(0);
  });

  test('easing starts fast and settles at 1', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.25)).toBeGreaterThan(0.5);
    let prev = 0;
    for (let x = 0.05; x <= 1; x += 0.05) {
      expect(ease(x)).toBeGreaterThanOrEqual(prev);
      prev = ease(x);
    }
  });
});

describe('Replay against the precomputed result', () => {
  const qa = synthQuality({ name: 'left', seed: 3, cycleShare: 0.3, removableShare: 0.1, testRatio: 0.2 });
  const qb = synthQuality({ name: 'right', seed: 9, ccnShares: [0.4, 0.3, 0.2, 0.1], testRatio: 0.8 });
  const result = simulate(qa, qb, 1, { record: true });

  test('the stepper follows the clock one tick per 0.1 s', () => {
    const r = new Replay(qa, qb, 1, result.ticks, result.final.tick);
    r.update(0.1);
    r.update(0.1);
    r.update(0.05);
    expect(r.battle.tick).toBe(3);
    expect(r.blend).toBeCloseTo(0.5);
    r.togglePause();
    r.update(0.2);
    expect(r.battle.tick).toBe(3);
  });

  test('skip to the final lands on the final phase at the recorded tick', () => {
    const r = new Replay(qa, qb, 1, result.ticks, result.final.tick);
    expect(r.skipToFinal()).toBe(true);
    expect(r.battle.phase).toBe('final');
    expect(r.battle.tick).toBe(result.final.tick);
    expect(r.jumped).toBe(true);
    expect(r.drain().length).toBeGreaterThan(0);
    expect(r.drain()).toEqual([]);
  });

  test('playback ends at result.ticks with the same result as simulate()', () => {
    const r = new Replay(qa, qb, 1, result.ticks, result.final.tick);
    r.skipToFinal();
    r.setSpeed(2);
    let guard = 0;
    while (!r.done && guard++ < 100_000) r.update(0.25);
    expect(r.clock.t).toBe(result.ticks);
    expect(r.battle.tick).toBe(result.ticks);
    expect(r.battle.done).toBe(true);
    expect(r.battle.result()).toEqual(result);
  });
});
