import { describe, expect, test } from 'vitest';
import type { Architecture, ArchNode } from '../../src/engine/architecture';
import { toCodeCharta } from '../../src/features/shell/codecharta';

const node = (path: string, extra: Partial<ArchNode> = {}): ArchNode => ({
  path, name: path.split('/').pop()!, kind: 'class', role: 0, lines: 40, functions: 3, complexity: 5, maxComplexity: 2,
  fanIn: 0, fanOut: 0, instability: 0, centrality: 1, routeRefs: 0, routeFiles: [], ...extra,
});

const arch: Architecture = {
  version: 1, name: 'demo', lang: 'php', framework: 'laravel', sourceDir: 'app', generatedAt: '2026-01-01T00:00:00Z',
  layers: [], roles: [],
  nodes: [
    node('app/Http/X.php', { lines: 120, fanIn: 1, fanOut: 2, instability: 0.666, centrality: 1.234, maxComplexity: 7, functions: 4 }),
    node('app/Http/Y.php'),
    node('app/Models/User.php'),
    node('bootstrap.php'),
  ],
  edges: [[0, 1, 3, { inject: 3 }, 0], [0, 2, 1, { new: 1 }, 0], [3, 2, 2, { 'static-call': 2 }, 1]],
  failed: [], unresolved: 0,
};

type CCNode = { name: string; type: string; attributes: Record<string, number>; children?: CCNode[] };
const child = (n: CCNode, name: string) => n.children!.find((c) => c.name === name)!;

describe('toCodeCharta', () => {
  const cc = toCodeCharta(arch) as {
    projectName: string; apiVersion: string; nodes: CCNode[];
    edges: { fromNodeName: string; toNodeName: string; attributes: Record<string, number> }[];
    attributeTypes: { nodes: Record<string, string>; edges: Record<string, string> };
  };

  test('header and attribute types', () => {
    expect(cc.projectName).toBe('demo');
    expect(cc.apiVersion).toBe('1.3');
    expect(cc.attributeTypes.nodes).toEqual({
      rloc: 'absolute', fan_in: 'absolute', fan_out: 'absolute', instability: 'relative', centrality: 'absolute',
      max_complexity_per_function: 'absolute', functions: 'absolute',
    });
    expect(cc.attributeTypes.edges).toEqual({ code_dependency: 'absolute' });
  });

  test('builds a nested folder tree under root', () => {
    expect(cc.nodes).toHaveLength(1);
    const root = cc.nodes[0];
    expect(root).toMatchObject({ name: 'root', type: 'Folder', attributes: {} });
    const app = child(root, 'app');
    expect(app.type).toBe('Folder');
    const http = child(app, 'Http');
    expect(http.type).toBe('Folder');
    expect(http.children!.map((c) => c.name).sort()).toEqual(['X.php', 'Y.php']);
    const x = child(http, 'X.php');
    expect(x.type).toBe('File');
    expect(x.attributes).toEqual({
      rloc: 120, fan_in: 1, fan_out: 2, instability: 67, centrality: 123, max_complexity_per_function: 7, functions: 4,
    });
    expect(child(child(app, 'Models'), 'User.php').type).toBe('File');
    expect(child(root, 'bootstrap.php').type).toBe('File');
  });

  test('one edge per arch edge with /root paths and weight', () => {
    expect(cc.edges).toHaveLength(arch.edges.length);
    expect(cc.edges[0]).toEqual({
      fromNodeName: '/root/app/Http/X.php', toNodeName: '/root/app/Http/Y.php', attributes: { code_dependency: 3 },
    });
    expect(cc.edges[2].fromNodeName).toBe('/root/bootstrap.php');
  });
});
