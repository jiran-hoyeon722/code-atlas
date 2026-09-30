import { fireEvent } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Architecture, ArchNode } from '../../src/engine/architecture';
import type { ViewerEnv } from '../../src/features/viewer-env';

// WebGL is unavailable in jsdom, so 3d-force-graph is replaced by a chainable fake that records its callbacks
const h = vi.hoisted(() => ({ order: [] as string[], opts: {} as Record<string, unknown> }));
vi.mock('3d-force-graph', () => {
  const chain = (): unknown => new Proxy(() => {}, { get: () => () => chain() });
  class FakeGraph {
    constructor() {
      h.order = [];
      h.opts = {};
      const self: unknown = new Proxy(this, {
        get(_t, key: string) {
          if (key === 'renderer') return () => ({ forceContextLoss: () => h.order.push('forceContextLoss') });
          if (key === '_destructor') return () => h.order.push('_destructor');
          if (key === 'd3Force') return () => chain();
          return (...args: unknown[]) => {
            if (args.length === 0) return h.opts[key];
            h.opts[key] = args[0];
            return self;
          };
        },
      });
      return self as FakeGraph;
    }
  }
  return { default: FakeGraph };
});

import { mountGraph } from '../../src/features/graph/mountGraph';

const HOSTILE = '<img src=x onerror=alert(1)>.ts';
const HOSTILE_NAME = '<img src=x onerror=alert(1)>';

const node = (path: string, role: number, extra: Partial<ArchNode> = {}): ArchNode => ({
  path, name: path, kind: 'class', role, lines: 40, functions: 3, complexity: 5, maxComplexity: 2,
  fanIn: 0, fanOut: 0, instability: 0, centrality: 1, routeRefs: 0, routeFiles: [], ...extra,
});

const arch = (): Architecture => ({
  version: 1, name: '<b>repo</b>', lang: 'ts', framework: 'react', sourceDir: 'src', generatedAt: '2026-01-01T00:00:00Z',
  layers: [
    { key: 'entry', label: '진입점', hint: '요청이 들어오는 곳' },
    { key: 'application', label: '애플리케이션', hint: '작업 흐름' },
    { key: 'domain', label: '도메인', hint: '핵심 데이터' },
    { key: 'foundation', label: '<img src=y onerror=alert(2)>', hint: '공용 코드' },
  ],
  roles: [
    { name: 'Page', layer: 0, patterns: ['a'], description: '화면' },
    { name: '<b>role</b>', layer: 3, patterns: ['d'], description: '<img src=z onerror=alert(3)>' },
  ],
  nodes: [node('a/Home.ts', 0, { fanOut: 1 }), node(HOSTILE, 1, { fanIn: 1 })],
  edges: [[0, 1, 1, { import: 1 }, 0]],
  failed: [], unresolved: 0,
});

const env = (over: Partial<ViewerEnv> = {}): ViewerEnv => ({
  readSource: async () => null, vscodeHref: () => null, requestVscodeSetup: vi.fn(), selection: {}, onSelect: vi.fn(), goto: vi.fn(), ...over,
});

afterEach(() => {
  document.body.innerHTML = '';
});

function mount() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const dispose = mountGraph(root, arch(), env());
  return { root, dispose };
}

test('hostile names render as text in tooltip, panel, legend and search', () => {
  const { root } = mount();
  const nodes = (h.opts.graphData as { nodes: { name: string }[] }).nodes;
  const hostile = nodes.find((n) => n.name === HOSTILE_NAME)!;
  expect(hostile).toBeTruthy();

  const tip = document.createElement('div');
  tip.innerHTML = (h.opts.nodeLabel as (n: unknown) => string)(hostile);
  expect(tip.querySelector('img')).toBeNull();
  expect(tip.textContent).toContain(HOSTILE_NAME);
  expect(tip.textContent).toContain('<b>role</b>');

  (h.opts.onNodeClick as (n: unknown) => void)(hostile);
  (h.opts.onNodeClick as (n: unknown) => void)(nodes[0]);
  const panel = root.querySelector('[data-el="panel-body"]')!;
  expect(panel.textContent).toContain(HOSTILE_NAME);
  (h.opts.onNodeClick as (n: unknown) => void)(hostile);
  expect(panel.textContent).toContain(HOSTILE);
  expect(panel.textContent).toContain('<img src=z onerror=alert(3)>');

  const q = root.querySelector<HTMLInputElement>('[data-el="q"]')!;
  q.value = 'img';
  fireEvent.input(q);
  expect(root.querySelector('[data-el="results"]')!.textContent).toContain(HOSTILE);

  expect(root.querySelector('img')).toBeNull();
  expect(root.querySelector('b.up, h3 b, [data-el="roles"] b')).toBeNull();
  expect(root.textContent).toContain('<img src=y onerror=alert(2)>');
  expect(root.textContent).toContain('<b>repo</b>');
});

test('dispose releases the WebGL context before destroying the graph', () => {
  const { root, dispose } = mount();
  dispose();
  expect(h.order).toEqual(['forceContextLoss', '_destructor']);
  expect(root.children).toHaveLength(0);
});
