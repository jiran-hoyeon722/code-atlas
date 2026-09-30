import { beforeAll, describe, expect, test } from 'vitest';
import { UnsupportedRepoError } from '../../../src/engine/analyze';
import { loadParsers, type Parsers } from '../../../src/engine/parsers';
import { nodeLocate } from '../../../src/engine/node';
import { buildQuality, TooSmallRepoError, type QualityProgress } from '../../../src/engine/battle/quality';
import { RULE_VERSION } from '../../../src/engine/battle/rules';
import type { RepoInput } from '../../../src/engine/types';
import { loadFixture } from './fixture';

let parsers: Parsers;
beforeAll(async () => {
  parsers = await loadParsers(nodeLocate, ['php', 'ts']);
});

const paths = (files: { path: string }[]) => files.map((f) => f.path);

describe('buildQuality on the TS fixture', () => {
  test('splits production and test code', () => {
    const q = buildQuality(loadFixture('battle-ts'), parsers);
    expect(q.lang).toBe('ts');
    expect(q.ruleVersion).toBe(RULE_VERSION);
    expect(q.config.sourceDir).toBe('src');
    const prod = paths(q.files);
    expect(prod).toEqual([...prod].sort());
    expect(prod).toContain('src/lib/scheduler.ts');
    expect(prod.some((p) => p.includes('.test.') || p.includes('__tests__') || p.endsWith('.d.ts'))).toBe(false);
    expect(q.totals.testFiles).toBe(2);
    expect(q.totals.testLines).toBeGreaterThan(0);
    expect(q.config.excludedLines).toBeGreaterThan(0);
    expect(q.totals.prodLines).toBe(q.files.reduce((s, f) => s + f.lines, 0));
    expect(q.totals.prodLines).toBeGreaterThanOrEqual(300);
    expect(q.warnings).toContain('shaky');
    expect(q.scores.tests).toBeCloseTo(q.totals.testLines / q.totals.prodLines);
    expect(q.scores.hotspot).toBeNull();
    for (const f of q.files) {
      for (const arr of [f.ccnTier, f.lenTier, f.clone, f.removable]) expect(arr).toHaveLength(f.lines);
    }
  });

  test('finds the runtime cycle and ignores the type-only one', () => {
    const q = buildQuality(loadFixture('battle-ts'), parsers);
    expect(q.cycles).toEqual([{ id: 0, files: ['src/store/plotEvents.ts', 'src/store/plotStore.ts'] }]);
    const cycleOf = (p: string) => q.files.find((f) => f.path === p)!.cycle;
    expect(cycleOf('src/store/plotStore.ts')).toBe(0);
    expect(cycleOf('src/models/seed.ts')).toBe(-1);
    expect(cycleOf('src/models/bed.ts')).toBe(-1);
    expect(q.scores.tangle).toBeGreaterThan(0);
  });

  test('counts the copied block as removable duplication', () => {
    const q = buildQuality(loadFixture('battle-ts'), parsers);
    const removable = q.files.reduce((s, f) => s + f.removable.reduce((a, b) => a + b, 0), 0);
    expect(removable).toBeGreaterThan(0);
    expect(q.scores.duplication).toBeCloseTo(removable / q.totals.prodLines);
    const cloned = new Set(q.clones.flatMap((g) => g.fragments.map((f) => f.path)));
    expect(cloned).toEqual(new Set(['src/components/Summary.tsx', 'src/lib/format.ts']));
  });

  test('the long, branchy function raises readability', () => {
    const input = loadFixture('battle-ts');
    const q = buildQuality(input, parsers);
    const scheduler = q.files.find((f) => f.path === 'src/lib/scheduler.ts')!;
    expect(Math.max(...scheduler.functions.map((f) => f.ccn))).toBeGreaterThan(25);
    expect(Math.max(...scheduler.ccnTier)).toBe(3);
    const calm = input.files.map((f) =>
      f.path === 'src/lib/scheduler.ts' ? { ...f, text: f.text.replace(/export function planWeek[\s\S]*?\n}\n/, 'export function planWeek() {\n  return { tasks: [], warnings: [] };\n}\n') } : f,
    );
    const filler = { path: 'src/lib/filler.ts', text: Array.from({ length: 90 }, (_, i) => `export const filler${i} = ${i};`).join('\n') };
    const q2 = buildQuality({ ...input, files: [...calm, filler] }, parsers);
    expect(q.scores.readability).toBeGreaterThan(q2.scores.readability);
  });

  test('commander holds five files or all of them', () => {
    const q = buildQuality(loadFixture('battle-ts'), parsers);
    expect(q.commander.files.length).toBeGreaterThanOrEqual(Math.min(5, q.files.length));
    expect(q.commander.display).toBe(q.commander.files[0].slice(q.commander.files[0].lastIndexOf('/') + 1));
  });

  test('fingerprint is stable and follows file text', () => {
    const input = loadFixture('battle-ts');
    const a = buildQuality(input, parsers).fingerprint;
    expect(buildQuality(loadFixture('battle-ts'), parsers).fingerprint).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    const edited = { ...input, files: input.files.map((f) => (f.path === 'src/lib/math.ts' ? { ...f, text: f.text + '\n// edit\n' } : f)) };
    expect(buildQuality(edited, parsers).fingerprint).not.toBe(a);
    const testEdited = { ...input, files: input.files.map((f) => (f.path === 'src/lib/format.test.ts' ? { ...f, text: f.text + 'x;\n' } : f)) };
    expect(buildQuality(testEdited, parsers).fingerprint).not.toBe(a);
    const reordered = { ...input, files: [...input.files].reverse() };
    expect(buildQuality(reordered, parsers).fingerprint).toBe(a);
  });

  test('is plain JSON and carries no source text', () => {
    const input = loadFixture('battle-ts');
    const q = buildQuality(input, parsers);
    const json = JSON.stringify(q);
    expect(JSON.parse(json)).toEqual(q);
    expect(json).not.toContain('planWeek');
    expect(json).not.toContain('waterLiters');
  });

  test('reports progress phases in order', () => {
    const seen: QualityProgress['phase'][] = [];
    let last: QualityProgress | undefined;
    buildQuality(loadFixture('battle-ts'), parsers, {
      onProgress: (p) => {
        if (seen.at(-1) !== p.phase) seen.push(p.phase);
        if (p.phase === 'functions') last = p;
      },
    });
    expect(seen).toEqual(['analyze', 'functions', 'clones', 'graph']);
    expect(last).toMatchObject({ done: 14, total: 14 });
  });
});

describe('buildQuality on the PHP fixture', () => {
  test('laravel app is production, tests folder is test code', () => {
    const q = buildQuality(loadFixture('battle-php'), parsers);
    expect(q.lang).toBe('php');
    expect(q.config.sourceDir).toBe('app');
    expect(q.files.every((f) => f.path.startsWith('app/'))).toBe(true);
    expect(q.totals.testFiles).toBe(2);
    expect(q.totals.prodLines).toBeGreaterThanOrEqual(300);
    expect(q.files.some((f) => f.functions.length > 0)).toBe(true);
    expect(q.cycles).toEqual([
      { id: 0, files: ['app/Models/Loan.php', 'app/Models/Reader.php', 'app/Models/Shelf.php', 'app/Models/Volume.php'] },
      { id: 1, files: ['app/Services/LendingService.php', 'app/Services/ShelfReport.php'] },
    ]);
    expect(q.commander.files.length).toBeGreaterThanOrEqual(5);
    expect(JSON.parse(JSON.stringify(q))).toEqual(q);
  });
});

describe('buildQuality errors and edge cases', () => {
  const repo = (files: Record<string, string>): RepoInput => ({
    name: 'fake',
    files: Object.entries(files).map(([path, text]) => ({ path, text })),
    configs: {},
  });

  test('too small repo throws', () => {
    expect(() => buildQuality(repo({ 'a.ts': 'export const a = 1;\n' }), parsers)).toThrow(TooSmallRepoError);
  });

  test('no sources throws UnsupportedRepoError', () => {
    expect(() => buildQuality(repo({}), parsers)).toThrow(UnsupportedRepoError);
  });

  test('a file that fails to parse still counts its lines, with no functions', () => {
    const body = Array.from({ length: 320 }, (_, i) => `export const v${i} = ${i};`).join('\n');
    const broken = { parse: () => null } as unknown as ReturnType<Parsers['get']>;
    const q = buildQuality(repo({ 'a.ts': body }), { get: (lang) => (lang === 'ts' ? broken : parsers.get(lang)) });
    expect(q.files).toHaveLength(1);
    expect(q.files[0]).toMatchObject({ lines: 320, functions: [] });
    expect(q.files[0].ccnTier).toHaveLength(320);
  });

  test('heavy excluded code warns', () => {
    const body = Array.from({ length: 320 }, (_, i) => `export const v${i} = ${i};`).join('\n');
    const decl = Array.from({ length: 40 }, (_, i) => `declare const d${i}: number;`).join('\n');
    const q = buildQuality(repo({ 'a.ts': body, 'types.d.ts': decl }), parsers);
    expect(q.config.excludedLines).toBe(40);
    expect(q.warnings).toEqual(['shaky', 'excluded-heavy']);
  });
});
