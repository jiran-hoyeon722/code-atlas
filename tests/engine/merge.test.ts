import { describe, expect, test } from 'vitest';
import type { Architecture, ArchNode } from '../../src/engine/architecture';
import { baseRoleName, mergeArchitectures, mergeRoles } from '../../src/engine/merge';
import { layers, type Role } from '../../src/engine/presets';

const role = (name: string, layer: Role['layer']): Role => ({ name, layer, patterns: [], description: '' });
const node = (path: string, r: number): ArchNode => ({
  path, name: path, kind: 'file', role: r, lines: 1, functions: 0, complexity: 0, maxComplexity: 0,
  fanIn: 0, fanOut: 0, instability: 0, centrality: 1, routeRefs: 0, routeFiles: [],
});

const py: Architecture = {
  version: 1, name: 'mono', lang: 'py', framework: null, sourceDir: 'src', generatedAt: '2026-01-01T00:00:00.000Z',
  layers: layers('애플리케이션', '도메인'),
  roles: [role('진입점', 0), role('기타', 3)],
  nodes: [node('a.py', 0), node('b.py', 1)],
  edges: [[0, 1, 1, { import: 1 }, 0]],
  failed: [{ path: 'x.py', reason: 'syntax' }],
  unresolved: 2,
};
const go: Architecture = {
  version: 1, name: 'other', lang: 'go', framework: null, sourceDir: '', generatedAt: '2026-02-02T00:00:00.000Z',
  layers: layers('애플리케이션', '도메인'),
  roles: [role('진입점', 0), role('기타', 3)],
  nodes: [node('m.go', 0), node('n.go', 1), node('o.go', 1)],
  edges: [[0, 1, 1, { import: 1 }, 0], [2, 0, 3, { import: 3 }, 1]],
  failed: [{ path: 'y.go', reason: 'syntax' }],
  unresolved: 5,
};

describe('mergeArchitectures', () => {
  test('nodes, roles and edges are offset per part', () => {
    const m = mergeArchitectures([py, go]);
    expect(m.nodes).toHaveLength(5);
    expect(m.nodes.map((n) => n.role)).toEqual([0, 1, 2, 3, 3]);
    expect(m.edges).toEqual([
      [0, 1, 1, { import: 1 }, 0],
      [2, 3, 1, { import: 1 }, 0],
      [4, 2, 3, { import: 3 }, 1],
    ]);
    expect(m.name).toBe('mono');
    expect(m.generatedAt).toBe(py.generatedAt);
    expect(m.lang).toBe('py');
    expect(m.framework).toBeNull();
    expect(m.sourceDir).toBe('');
    expect(m.layers).toEqual(layers('애플리케이션', '도메인·인프라'));
  });

  test('each node remembers its language and langs lists parts', () => {
    const m = mergeArchitectures([py, go]);
    expect(m.nodes[0].lang).toBe('py');
    expect(m.nodes[2].lang).toBe('go');
    expect(m.langs).toEqual(['py', 'go']);
  });

  test('role names get the language label', () => {
    const names = mergeArchitectures([py, go]).roles.map((r) => r.name);
    expect(names).toEqual(['Python · 진입점', 'Python · 기타', 'Go · 진입점', 'Go · 기타']);
  });

  test('same role names in two languages stay separate roles', () => {
    const m = mergeArchitectures([py, go]);
    const a = m.nodes[0].role;
    const b = m.nodes[2].role;
    expect(a).not.toBe(b);
    expect(m.roles[a].name).not.toBe(m.roles[b].name);
  });

  test('failed are concatenated and unresolved summed', () => {
    const m = mergeArchitectures([py, go]);
    expect(m.failed.map((f) => f.path)).toEqual(['x.py', 'y.go']);
    expect(m.unresolved).toBe(7);
  });

  test('one part comes back unchanged', () => {
    const m = mergeArchitectures([py]);
    expect(m).toEqual(py);
    expect('langs' in m).toBe(false);
    expect('lang' in m.nodes[0]).toBe(false);
  });

  test('mergeRoles matches the merged roles', () => {
    expect(mergeRoles([py, go])).toEqual(mergeArchitectures([py, go]).roles);
  });

  test('no parts is an error', () => {
    expect(() => mergeArchitectures([])).toThrow('mergeArchitectures needs at least one part');
  });

  test('edge kinds are copied, not shared', () => {
    const m = mergeArchitectures([py, go]);
    expect(m.edges[0][3]).toEqual(py.edges[0][3]);
    expect(m.edges[0][3]).not.toBe(py.edges[0][3]);
  });
});

describe('baseRoleName', () => {
  test('strips the language prefix of a merged role', () => {
    expect(baseRoleName('PHP · Event')).toBe('Event');
    expect(baseRoleName('Python · 진입점')).toBe('진입점');
  });

  test('keeps an un-prefixed role name', () => {
    expect(baseRoleName('Event')).toBe('Event');
  });
});
