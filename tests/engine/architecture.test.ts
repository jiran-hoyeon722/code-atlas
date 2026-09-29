import { describe, expect, test } from 'vitest';
import { buildArchitecture } from '../../src/engine/architecture';
import type { Preset } from '../../src/engine/presets';
import type { Detection } from '../../src/engine/detect';
import type { Edge, Extraction, FileNode } from '../../src/engine/types';

const det: Detection = { lang: 'ts', framework: null, sourceDir: '', routeDirs: [] };
const layers: Preset['layers'] = [
  { key: 'entry', label: 'e', hint: '' },
  { key: 'application', label: 'a', hint: '' },
  { key: 'domain', label: 'd', hint: '' },
  { key: 'foundation', label: 'f', hint: '' },
];
const preset: Preset = {
  layers,
  roles: [
    { name: 'A', layer: 0, patterns: ['a'], description: '' },
    { name: 'B', layer: 1, patterns: ['b'], description: '' },
    { name: 'C', layer: 3, patterns: [''], description: '' },
  ],
};
const node = (id: string): FileNode => ({ id, name: id, kind: 'class', lines: 10, functions: 1, complexity: 2, maxComplexity: 2 });
const edge = (from: string, to: string, kinds: Edge['kinds'] = { import: 1 }): Edge => ({ from, to, weight: 1, kinds });
const ex = (edges: Edge[], routeRefs: Extraction['routeRefs'] = {}): Extraction => ({
  nodes: ['a.ts', 'b.ts', 'c.ts'].map(node),
  edges,
  routeRefs,
  failed: [],
  unresolved: 4,
});
const now = new Date('2026-01-02T03:04:05.000Z');

describe('buildArchitecture', () => {
  const arch = buildArchitecture(ex([edge('a.ts', 'b.ts'), edge('a.ts', 'c.ts'), edge('b.ts', 'c.ts'), edge('c.ts', 'a.ts')]), det, preset, 'demo', now);

  test('metrics on small graph', () => {
    const [a, b, c] = arch.nodes;
    expect([a.role, b.role, c.role]).toEqual([0, 1, 2]);
    expect(c.fanIn).toBe(2);
    expect(a.fanOut).toBe(2);
    expect(a.instability).toBe(0.67);
    expect(arch.nodes.reduce((s, n) => s + n.centrality, 0)).toBeGreaterThan(2.95);
    expect(arch.nodes.reduce((s, n) => s + n.centrality, 0)).toBeLessThan(3.05);
    const up = (from: number, to: number) => arch.edges.find((e) => e[0] === from && e[1] === to)![4];
    expect(up(2, 0)).toBe(1);
    expect(up(0, 1)).toBe(0);
  });

  test('carries metadata', () => {
    expect(arch.version).toBe(1);
    expect(arch.name).toBe('demo');
    expect(arch.generatedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(arch.unresolved).toBe(4);
    expect(arch.nodes[0]).toMatchObject({ path: 'a.ts', lines: 10, functions: 1, complexity: 2, maxComplexity: 2 });
  });

  test('binds edges never upward', () => {
    const a2 = buildArchitecture(ex([edge('c.ts', 'a.ts', { binds: 1 }), edge('b.ts', 'a.ts', { binds: 1, triggers: 1 })]), det, preset, 'x', now);
    expect(a2.edges.map((e) => e[4])).toEqual([0, 0]);
  });

  test('mixed kinds with a non-conceptual kind can be upward', () => {
    const a2 = buildArchitecture(ex([edge('c.ts', 'a.ts', { binds: 1, inject: 1 })]), det, preset, 'x', now);
    expect(a2.edges[0][4]).toBe(1);
  });

  test('routeRefs sum and files', () => {
    const a2 = buildArchitecture(ex([], { 'a.ts': { 'routes/web.php': 2, 'routes/api.php': 3 } }), det, preset, 'x', now);
    expect(a2.nodes[0].routeRefs).toBe(5);
    expect(a2.nodes[0].routeFiles).toEqual(['routes/web.php', 'routes/api.php']);
    expect(a2.nodes[1].routeRefs).toBe(0);
  });

  test('roles use path relative to sourceDir', () => {
    const d: Detection = { ...det, sourceDir: 'src' };
    const e: Extraction = { nodes: [node('src/a.ts'), node('src/z.ts')], edges: [], routeRefs: {}, failed: [], unresolved: 0 };
    const r = buildArchitecture(e, d, preset, 'x', now);
    expect(r.nodes.map((n) => n.role)).toEqual([0, 2]);
  });
});

describe('buildArchitecture output isolation', () => {
  test('mutating returned roles does not touch the preset', () => {
    const p: Preset = { layers, roles: preset.roles.map((r) => ({ ...r, patterns: [...r.patterns] })) };
    const out = buildArchitecture(ex([]), det, p, 'demo', now);
    expect(out.roles).not.toBe(p.roles);
    out.roles[0].name = 'changed';
    out.roles[0].patterns.push('x');
    out.roles.push({ name: 'Z', layer: 3, patterns: [], description: '' });
    expect(p.roles.map((r) => r.name)).toEqual(['A', 'B', 'C']);
    expect(p.roles[0].patterns).toEqual(['a']);
  });
});
