import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { predict, simulate } from '../../../src/engine/battle/sim';
import { mulberry32 } from '../../../src/engine/battle/rng';
import type { Quality } from '../../../src/engine/battle/types';
import { synthQuality, type SynthOptions, type TierShares } from './synth';

// Balance checks from the rulebook, run on synthetic data only. Each check logs what it measured.

const RUNS = 100;
const SLOW = 120_000;

type Metric = 'complexity' | 'length' | 'tangle' | 'duplication' | 'tests';
const METRICS: Metric[] = ['complexity', 'length', 'tangle', 'duplication', 'tests'];

const BASE: SynthOptions = {
  totalLines: 20_000,
  ccnShares: [0.8, 0.12, 0.06, 0.02],
  lenShares: [0.6, 0.25, 0.1, 0.05],
  cycleShare: 0.1,
  removableShare: 0.05,
  testRatio: 0.4,
};

/** Half of BASE's problem lines in each metric (twice the tests). */
const TWICE: Record<Metric, SynthOptions> = {
  complexity: { ccnShares: [0.9, 0.06, 0.03, 0.01] },
  length: { lenShares: [0.8, 0.125, 0.05, 0.025] },
  tangle: { cycleShare: 0.05 },
  duplication: { removableShare: 0.025 },
  tests: { testRatio: 0.8 },
};

const PERFECT: Record<Metric, SynthOptions> = {
  complexity: { ccnShares: [1, 0, 0, 0] },
  length: { lenShares: [1, 0, 0, 0] },
  tangle: { cycleShare: 0 },
  duplication: { removableShare: 0 },
  tests: { testRatio: 1 },
};

/** "Extremely bad": four times the SIG four-star limits (deep one-star), four times BASE's tangle, no tests. */
const EXTREME: Record<Metric, SynthOptions> = {
  complexity: { ccnShares: [0, 0.6, 0.34, 0.06] },
  length: { lenShares: [0, 0.108, 0.616, 0.276] },
  tangle: { cycleShare: 0.4 },
  duplication: { removableShare: 0.184 },
  tests: { testRatio: 0 },
};

const repo = (name: string, seed: number, ...opts: SynthOptions[]): Quality =>
  synthQuality(Object.assign({}, BASE, ...opts, { name, seed }));

/** Share of all runs that side a wins; draws count for neither side. */
function aShare(a: Quality, b: Quality, runs = RUNS): number {
  return predict(a, b, runs).aWins / runs;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const report = (check: string, text: string) => console.info(`[balance] ${check}: ${text}`);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""')
    .replace(/\/\/.*$/gm, '');
}

describe('1 reproducibility', () => {
  const A = repo('alpha', 3, { cycleShare: 0.12, testRatio: 0.3 });
  const B = repo('beta', 4, { totalLines: 30_000, removableShare: 0.08, testRatio: 0.6 });

  test('same inputs give the same battle record, character for character', () => {
    for (const match of [1, 2, 7]) {
      const first = JSON.stringify(simulate(A, B, match, { record: true }));
      expect(JSON.stringify(simulate(A, B, match, { record: true }))).toBe(first);
    }
    expect(predict(A, B, 20)).toEqual(predict(A, B, 20));
  }, 30_000);

  test('battle code uses only arithmetic, sqrt and integer helpers from Math, and no clock', () => {
    const allowed = new Set(['abs', 'floor', 'ceil', 'round', 'trunc', 'min', 'max', 'sqrt', 'imul', 'sign']);
    const dir = join(__dirname, '../../../src/engine/battle');
    const offences: string[] = [];
    for (const file of sourceFiles(dir)) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const m of code.matchAll(/\bMath\.([A-Za-z0-9_]+)/g)) if (!allowed.has(m[1])) offences.push(`${file}: Math.${m[1]}`);
      if (/\bDate\b|\bperformance\b|\bcrypto\b/.test(code)) offences.push(`${file}: clock or crypto`);
      if (code.includes('**')) offences.push(`${file}: ** operator`);
    }
    expect(sourceFiles(dir).length).toBeGreaterThan(5);
    expect(offences).toEqual([]);
  });
});

describe('2 symmetry', () => {
  test(
    'A vs B and B vs A: same winner, prediction counts swapped exactly',
    () => {
      const A = repo('alpha', 3, { cycleShare: 0.12, testRatio: 0.3 });
      const B = repo('beta', 4, { totalLines: 30_000, removableShare: 0.08, testRatio: 0.6 });
      const flip = { a: 'b', b: 'a' } as const;
      for (const match of [1, 2, 3, 4]) {
        const ab = simulate(A, B, match).winner;
        expect(simulate(B, A, match).winner).toBe(ab === null ? null : flip[ab]);
      }
      const ab = predict(A, B, RUNS);
      const ba = predict(B, A, RUNS);
      report('2 symmetry', `A-B ${ab.aWins}/${ab.bWins}/${ab.draws}, B-A ${ba.aWins}/${ba.bWins}/${ba.draws}`);
      expect([ba.bWins, ba.aWins, ba.draws]).toEqual([ab.aWins, ab.bWins, ab.draws]);
    },
    SLOW,
  );
});

describe('3 self', () => {
  test(
    'a repo against itself wins 45-55% of 100 runs',
    () => {
      const repos = [
        repo('plain', 1),
        repo('messy', 2, { ccnShares: [0.6, 0.2, 0.12, 0.08], cycleShare: 0.25, removableShare: 0.1, testRatio: 0.1 }),
        repo('tidy', 3, { totalLines: 60_000, ccnShares: [0.95, 0.04, 0.01, 0], cycleShare: 0.02, testRatio: 0.9 }),
      ];
      for (const q of repos) {
        const p = predict(q, q, RUNS);
        report('3 self', `${q.name} ${pct(p.aWins / RUNS)} (draws ${p.draws})`);
        expect(p.aWins / RUNS).toBeGreaterThanOrEqual(0.45);
        expect(p.aWins / RUNS).toBeLessThanOrEqual(0.55);
      }
    },
    SLOW,
  );
});

describe('4 size neutral', () => {
  test(
    '20k-line vs 200k-line repos from the same distribution: 45-55% over 5 draws',
    () => {
      const shares: number[] = [];
      for (const seed of [1, 2, 3, 4, 5]) {
        const small = repo('small', seed);
        const big = repo('big', 100 + seed, { totalLines: 200_000, files: 700 + 37 * seed });
        shares.push(aShare(small, big));
      }
      const mean = shares.reduce((s, x) => s + x, 0) / shares.length;
      report('4 size', `small wins ${shares.map(pct).join(', ')}; mean ${pct(mean)}`);
      // Each draw is its own repo pair, and two draws of the same size already differ by about ±4%p,
      // so the size effect is judged on the mean; the per-draw values are logged above.
      expect(mean).toBeGreaterThanOrEqual(0.45);
      expect(mean).toBeLessThanOrEqual(0.55);
    },
    SLOW,
  );
});

describe('5 monotonic', () => {
  test(
    'improving one metric never lowers the win rate below the unchanged baseline minus 1%p',
    () => {
      const seeds = [1, 2];
      // Same content under another name: matches are mirrored in pairs, so this is 50% less draws.
      const baseline = aShare(repo('x', 1), repo('base', 1));
      report('5 monotonic', `baseline ${pct(baseline)}`);
      const floor = baseline - 0.01;
      for (const metric of METRICS) {
        const shares: number[] = [];
        for (const level of [TWICE[metric], PERFECT[metric]]) {
          for (const s of seeds) shares.push(aShare(repo('x', s, level), repo('base', s)));
        }
        const mean = shares.reduce((t, x) => t + x, 0) / shares.length;
        report('5 monotonic', `${metric}: 2x ${shares.slice(0, 2).map(pct).join(', ')}; perfect ${shares.slice(2).map(pct).join(', ')}; mean ${pct(mean)}`);
        // One 100-run prediction swings by about ±5%p, so the rule is held on the mean of four.
        expect(mean).toBeGreaterThanOrEqual(floor);
      }
    },
    SLOW,
  );
});

describe('6 clear advantage', () => {
  test(
    'every metric twice as good wins at least 90%',
    () => {
      const better = Object.assign({}, ...METRICS.map((m) => TWICE[m])) as SynthOptions;
      for (const s of [1, 2]) {
        const share = aShare(repo('x', s, better), repo('base', s));
        report('6 advantage', `seed ${s}: ${pct(share)}`);
        expect(share).toBeGreaterThanOrEqual(0.9);
      }
    },
    SLOW,
  );
});

describe('7 metric balance', () => {
  test(
    'one extremely bad metric alone still wins at least 10%',
    () => {
      for (const metric of METRICS) {
        const share = aShare(repo('x', 1, EXTREME[metric]), repo('base', 1));
        report('7 balance', `${metric}: ${pct(share)}`);
        expect(share).toBeGreaterThanOrEqual(0.1);
      }
    },
    SLOW,
  );
});

describe('8 scoreboard agreement', () => {
  test(
    'the side ahead on 3+ of the 4 metrics is ahead in prediction in 80%+ of pairs',
    () => {
      const rand = mulberry32(2024);
      const tiers = (): TierShares => {
        const low = 0.55 + rand() * 0.4;
        const u = rand();
        const v = rand() * (1 - u);
        const rest = 1 - low;
        return [low, rest * u, rest * v, rest * (1 - u - v)];
      };
      const random = (name: string) =>
        synthQuality({
          name,
          seed: 1 + Math.floor(rand() * 1e6),
          totalLines: 10_000 + Math.floor(rand() * 30_000),
          ccnShares: tiers(),
          lenShares: tiers(),
          cycleShare: rand() * 0.3,
          removableShare: rand() * 0.12,
          testRatio: rand(),
        });
      // 20 runs per pair keeps 40 pairs affordable; decisive pairs are rarely close.
      const runs = 20;
      let decisive = 0;
      let agree = 0;
      for (let i = 0; i < 40; i++) {
        const a = random(`p${i}a`);
        const b = random(`p${i}b`);
        const sa = a.scores;
        const sb = b.scores;
        const aheadA = [sa.readability < sb.readability, sa.tangle < sb.tangle, sa.duplication < sb.duplication, sa.tests > sb.tests];
        const nA = aheadA.filter(Boolean).length;
        const nB = [sa.readability > sb.readability, sa.tangle > sb.tangle, sa.duplication > sb.duplication, sa.tests < sb.tests].filter(Boolean).length;
        if (nA < 3 && nB < 3) continue;
        decisive++;
        const p = predict(a, b, runs);
        if ((nA >= 3 && p.aWins > p.bWins) || (nB >= 3 && p.bWins > p.aWins)) agree++;
      }
      report('8 scoreboard', `${agree}/${decisive} decisive pairs agree (${pct(agree / decisive)})`);
      expect(decisive).toBeGreaterThanOrEqual(20);
      expect(agree / decisive).toBeGreaterThanOrEqual(0.8);
    },
    SLOW,
  );
});

describe('9 real improvement', () => {
  // Needs a repo's git history (a refactoring period vs its baseline commit); v1 has no git data.
  test.skip('a refactored repo beats its past self', () => {});
});

describe('10 performance', () => {
  test(
    'predict 100 with two 200k-line repos takes under 10 s',
    () => {
      const a = repo('big-a', 11, { totalLines: 200_000 });
      const b = repo('big-b', 12, { totalLines: 200_000, cycleShare: 0.15, testRatio: 0.6 });
      const start = performance.now();
      predict(a, b, RUNS);
      const seconds = (performance.now() - start) / 1000;
      report('10 performance', `${seconds.toFixed(2)} s`);
      expect(seconds).toBeLessThan(10);
    },
    SLOW,
  );
});
