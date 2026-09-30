import { describe, expect, test } from 'vitest';
import { battleSeed, hashString, mulberry32, rollFor } from '../../../src/engine/battle/rng';
import { CCN_TIERS, LENGTH_TIERS, tierOf } from '../../../src/engine/battle/rules';
import { codeLineMapper, codeLines } from '../../../src/engine/battle/lines';

describe('rng', () => {
  test('mulberry32 is a fixed sequence', () => {
    const r = mulberry32(42);
    expect([r(), r(), r()]).toEqual([0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
  });

  test('values stay in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 10_000; i++) {
      const v = r();
      expect(v >= 0 && v < 1).toBe(true);
    }
  });

  test('battle seed ignores side order but not the match number', () => {
    expect(battleSeed('a#1', 'b#2', 1)).toBe(battleSeed('b#2', 'a#1', 1));
    expect(battleSeed('a#1', 'b#2', 1)).not.toBe(battleSeed('a#1', 'b#2', 2));
  });

  test('rolls depend only on seed, tick and key', () => {
    expect(rollFor(1, 5, 'src/a.ts#0')).toBe(rollFor(1, 5, 'src/a.ts#0'));
    expect(rollFor(1, 5, 'src/a.ts#0')).not.toBe(rollFor(1, 6, 'src/a.ts#0'));
    expect(hashString('')).toBe(0x811c9dc5);
  });
});

describe('tiers', () => {
  test('complexity and length bounds are inclusive upper limits', () => {
    expect([1, 5, 6, 10, 11, 25, 26].map((v) => tierOf(v, CCN_TIERS))).toEqual([0, 0, 1, 1, 2, 2, 3]);
    expect([15, 16, 30, 31, 60, 61].map((v) => tierOf(v, LENGTH_TIERS))).toEqual([0, 1, 1, 2, 2, 3]);
  });
});

describe('code lines', () => {
  test('skips blank lines and maps physical ranges', () => {
    const phys = codeLines('a\n\n  \nb\nc\n');
    expect(phys).toEqual([0, 3, 4]);
    const m = codeLineMapper(phys);
    expect(m.atOrAfter(1)).toBe(1);
    expect(m.atOrBefore(2)).toBe(0);
    expect(m.atOrBefore(4)).toBe(2);
  });
});
