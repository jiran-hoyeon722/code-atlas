import { describe, expect, test } from 'vitest';
import type { Architecture, ArchNode } from '../../../src/engine/architecture';
import type { Edge, Lang } from '../../../src/engine/types';
import { findCycles, pickCommander, tangleScore, testsScore } from '../../../src/engine/battle/graph';

const node = (path: string): ArchNode => ({
  path,
  name: path,
  kind: 'module',
  role: 0,
  lines: 10,
  functions: 0,
  complexity: 0,
  maxComplexity: 0,
  fanIn: 0,
  fanOut: 0,
  instability: 0,
  centrality: 0,
  routeRefs: 0,
  routeFiles: [],
});

function arch(lang: Lang, paths: string[], edges: [string, string, Edge['kinds']][]): Architecture {
  const index = new Map(paths.map((p, i) => [p, i]));
  return {
    version: 1,
    name: 'fake',
    lang,
    framework: null,
    sourceDir: 'src',
    generatedAt: '',
    layers: [],
    roles: [],
    nodes: paths.map(node),
    edges: edges.map(([from, to, kinds]) => [index.get(from)!, index.get(to)!, 1, kinds, 0]),
    failed: [],
    unresolved: 0,
  };
}

describe('findCycles', () => {
  test('ignores a cycle made only of type imports', () => {
    const a = arch('ts', ['src/a.ts', 'src/b.ts'], [
      ['src/a.ts', 'src/b.ts', { 'type-import': 1 }],
      ['src/b.ts', 'src/a.ts', { import: 1 }],
    ]);
    expect(findCycles(a, new Set(['src/a.ts', 'src/b.ts']))).toEqual([]);
  });

  test('counts an edge that mixes type and runtime kinds', () => {
    const a = arch('ts', ['src/a.ts', 'src/b.ts'], [
      ['src/a.ts', 'src/b.ts', { 'type-import': 2, import: 1 }],
      ['src/b.ts', 'src/a.ts', { import: 1 }],
    ]);
    expect(findCycles(a, new Set(['src/a.ts', 'src/b.ts']))).toEqual([{ id: 0, files: ['src/a.ts', 'src/b.ts'] }]);
  });

  test('ignores php type, binds and triggers edges', () => {
    const paths = ['app/A.php', 'app/B.php', 'app/C.php'];
    const a = arch('php', paths, [
      ['app/A.php', 'app/B.php', { type: 1 }],
      ['app/B.php', 'app/A.php', { new: 1 }],
      ['app/B.php', 'app/C.php', { binds: 1, triggers: 1 }],
      ['app/C.php', 'app/B.php', { 'static-call': 1 }],
    ]);
    expect(findCycles(a, new Set(paths))).toEqual([]);
  });

  test('a self-loop is not a cycle', () => {
    const a = arch('ts', ['src/a.ts'], [['src/a.ts', 'src/a.ts', { import: 1 }]]);
    expect(findCycles(a, new Set(['src/a.ts']))).toEqual([]);
  });

  test('skips files outside production', () => {
    const a = arch('ts', ['src/a.ts', 'src/a.test.ts'], [
      ['src/a.ts', 'src/a.test.ts', { import: 1 }],
      ['src/a.test.ts', 'src/a.ts', { import: 1 }],
    ]);
    expect(findCycles(a, new Set(['src/a.ts']))).toEqual([]);
  });

  test('orders two cycles by their smallest path', () => {
    const paths = ['src/z.ts', 'src/y.ts', 'src/c.ts', 'src/b.ts', 'src/x.ts', 'src/a.ts'];
    const a = arch('ts', paths, [
      ['src/z.ts', 'src/y.ts', { import: 1 }],
      ['src/y.ts', 'src/x.ts', { import: 1 }],
      ['src/x.ts', 'src/z.ts', { import: 1 }],
      ['src/c.ts', 'src/b.ts', { import: 1 }],
      ['src/b.ts', 'src/c.ts', { require: 1 }],
      ['src/x.ts', 'src/c.ts', { import: 1 }],
      ['src/a.ts', 'src/z.ts', { import: 1 }],
    ]);
    expect(findCycles(a, new Set(paths))).toEqual([
      { id: 0, files: ['src/b.ts', 'src/c.ts'] },
      { id: 1, files: ['src/x.ts', 'src/y.ts', 'src/z.ts'] },
    ]);
  });

  test('handles a long chain without recursion', () => {
    const n = 50_000;
    const paths = Array.from({ length: n }, (_, i) => `src/f${String(i).padStart(5, '0')}.ts`);
    const edges: [string, string, Edge['kinds']][] = paths.map((p, i) => [p, paths[(i + 1) % n], { import: 1 }]);
    const cycles = findCycles(arch('ts', paths, edges), new Set(paths));
    expect(cycles).toHaveLength(1);
    expect(cycles[0].files).toHaveLength(n);
  });
});

describe('pickCommander', () => {
  test('takes at least five files on a small repo', () => {
    const files = Array.from({ length: 8 }, (_, i) => ({ path: `src/f${i}.ts`, lines: 100, centrality: 8 - i }));
    expect(pickCommander(files, 800)).toEqual({
      files: ['src/f0.ts', 'src/f1.ts', 'src/f2.ts', 'src/f3.ts', 'src/f4.ts'],
      display: 'f0.ts',
    });
  });

  test('keeps stacking until five percent of the code on a large repo', () => {
    const files = Array.from({ length: 20 }, (_, i) => ({ path: `src/m/f${String(i).padStart(2, '0')}.ts`, lines: 100, centrality: 1 }));
    const picked = pickCommander(files, 16_000);
    expect(picked.files).toHaveLength(8);
    expect(picked.files[0]).toBe('src/m/f00.ts');
    expect(picked.display).toBe('f00.ts');
  });

  test('sorts by centrality, then path', () => {
    const files = [
      { path: 'src/b.ts', lines: 1, centrality: 2 },
      { path: 'src/a.ts', lines: 1, centrality: 2 },
      { path: 'src/c.ts', lines: 1, centrality: 5 },
    ];
    expect(pickCommander(files, 3).files).toEqual(['src/c.ts', 'src/a.ts', 'src/b.ts']);
  });

  test('takes every file when there are fewer than five', () => {
    const files = [
      { path: 'src/a.ts', lines: 10, centrality: 1 },
      { path: 'src/b.ts', lines: 10, centrality: 3 },
    ];
    expect(pickCommander(files, 20)).toEqual({ files: ['src/b.ts', 'src/a.ts'], display: 'b.ts' });
  });

  test('empty input gives an empty commander', () => {
    expect(pickCommander([], 0)).toEqual({ files: [], display: '' });
  });
});

describe('scores', () => {
  test('tangle is the share of lines inside cycles', () => {
    expect(tangleScore([{ lines: 30, cycle: 0 }, { lines: 70, cycle: -1 }, { lines: 20, cycle: 1 }], 120)).toBeCloseTo(50 / 120);
    expect(tangleScore([], 0)).toBe(0);
  });

  test('tests ratio is capped at one and zero without production code', () => {
    expect(testsScore(50, 200)).toBe(0.25);
    expect(testsScore(500, 200)).toBe(1);
    expect(testsScore(10, 0)).toBe(0);
  });
});
