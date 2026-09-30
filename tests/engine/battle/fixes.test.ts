import { describe, expect, test } from 'vitest';
import { fixCandidates, rankFixes, withLowRiskFile } from '../../../src/engine/battle/fixes';
import { predict } from '../../../src/engine/battle/sim';
import type { Quality, QualityFile } from '../../../src/engine/battle/types';
import { synthQuality } from './synth';

const CLEAN = { ccnShares: [0.85, 0.1, 0.05, 0] as const, lenShares: [0.7, 0.2, 0.1, 0] as const };

function spoil(q: Quality, index: number, over: Partial<QualityFile> = {}): Quality {
  const files = q.files.map((f, i) =>
    i === index ? { ...f, ccnTier: new Array(f.lines).fill(3), lenTier: new Array(f.lines).fill(3), ...over } : f,
  );
  return { ...q, files };
}

describe('rankFixes', () => {
  test('a file full of very high-risk functions ranks first', () => {
    const q = spoil(synthQuality({ name: 'loser', totalLines: 6000, files: 30, seed: 2, ...CLEAN }), 7);
    const ranked = rankFixes(q);
    expect(ranked[0].path).toBe(q.files[7].path);
    expect(ranked[0].reasons.slice(0, 2)).toEqual(['complexity', 'length']);
  });

  test('ties go by path and cost-free files are left out', () => {
    const q = synthQuality({ name: 'flat', totalLines: 3000, files: 10, seed: 2, ccnShares: [1, 0, 0, 0], lenShares: [1, 0, 0, 0] });
    expect(rankFixes(q)).toEqual([]);
    const bad50 = (f: QualityFile) => ({ ...f, ccnTier: f.ccnTier.map((_, k) => (k < 50 ? 3 : 0)) });
    const both = rankFixes({ ...q, files: q.files.map((f, i) => (i === 5 || i === 3 ? bad50(f) : f)) });
    expect(both.map((r) => r.path)).toEqual([q.files[3].path, q.files[5].path]);
  });

  test('cycle and removable duplicate lines add to the penalty', () => {
    const q = synthQuality({ name: 'x', totalLines: 3000, files: 10, seed: 2, ccnShares: [1, 0, 0, 0], lenShares: [1, 0, 0, 0] });
    const f = q.files[4];
    const tangled = { ...q, files: q.files.map((g, i) => (i === 4 ? { ...g, cycle: 0, removable: g.removable.map((_, k) => (k < 10 ? 1 : 0)) } : g)) };
    const [top] = rankFixes(tangled);
    expect(top.path).toBe(f.path);
    expect(top.reasons).toEqual(['tangle', 'duplication']);
    expect(top.penalty).toBeCloseTo(f.lines * 0.3 + 10 * 0.5, 9);
  });
});

describe('withLowRiskFile', () => {
  test('clears tiers, copies and the cycle of one file without touching the input', () => {
    const q = synthQuality({ name: 'x', totalLines: 6000, files: 30, seed: 5, cycleShare: 0.3, removableShare: 0.05 });
    const cyc = q.cycles.find((c) => c.files.length === 2) ?? q.cycles[0];
    const path = cyc.files[0];
    const before = JSON.stringify(q);
    const fixed = withLowRiskFile(q, path);
    expect(JSON.stringify(q)).toBe(before);
    const f = fixed.files.find((g) => g.path === path)!;
    expect(f.cycle).toBe(-1);
    expect([...f.ccnTier, ...f.lenTier, ...f.clone, ...f.removable].every((v) => v === 0)).toBe(true);
    expect(f.functions.every((fn) => fn.ccn <= 5 && fn.nloc <= 15)).toBe(true);
    expect(fixed.cycles.some((c) => c.files.includes(path))).toBe(false);
    expect(fixed.clones.every((g) => g.fragments.every((fr) => fr.path !== path) && g.fragments.length >= 2)).toBe(true);
    if (cyc.files.length === 2) {
      expect(fixed.files.find((g) => g.path === cyc.files[1])!.cycle).toBe(-1);
      expect(fixed.cycles.some((c) => c.id === cyc.id)).toBe(false);
    }
  });
});

describe('fixCandidates', { timeout: 60_000 }, () => {
  const base = synthQuality({ name: 'winner', totalLines: 4000, files: 10, seed: 8, ...CLEAN });
  const winner = base;
  // Same code as the winner except one big file of very high-risk functions: fixing it should help.
  const loser = spoil({ ...base, name: 'loser', fingerprint: 'l' }, 2);

  test('fixing the bad file does not lower the win share', () => {
    const out = fixCandidates(loser, winner, 'a', { seeds: 8, count: 2 });
    expect(out[0].path).toBe(loser.files[2].path);
    expect(out[0].delta).toBeGreaterThan(0);
    for (const c of out) {
      expect(c.delta).toBeGreaterThanOrEqual(0);
      expect(c.delta).toBeCloseTo(c.improved - c.baseline, 12);
    }
  });

  test('keeps the real side order: baseline matches the prediction for that side', () => {
    const out = fixCandidates(loser, winner, 'b', { seeds: 6, count: 1 });
    const p = predict(winner, loser, 6);
    expect(out[0].baseline).toBeCloseTo(p.bWins / 6, 12);
  });

  test('is deterministic and respects count and seeds', () => {
    const one = fixCandidates(loser, winner, 'a', { seeds: 3, count: 2 });
    const two = fixCandidates(loser, winner, 'a', { seeds: 3, count: 2 });
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
    expect(one).toHaveLength(2);
    for (const c of one) {
      expect(Number.isInteger(Math.round(c.baseline * 3 * 1e9) / 1e9)).toBe(true);
      expect(Number.isInteger(Math.round(c.improved * 3 * 1e9) / 1e9)).toBe(true);
    }
    expect(fixCandidates(loser, winner, 'a', { seeds: 1, count: 0 })).toEqual([]);
  });

  test('defaults to five candidates', () => {
    const q = synthQuality({ name: 'many', totalLines: 3000, files: 15, seed: 3 });
    expect(fixCandidates(q, winner, 'a', { seeds: 1 })).toHaveLength(5);
  });
});
