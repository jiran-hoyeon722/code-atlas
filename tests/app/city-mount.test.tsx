import { fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Architecture, ArchNode } from '../../src/engine/architecture';
import type { ViewerEnv } from '../../src/features/viewer-env';

// jsdom has no WebGL or 2D canvas: the renderer is faked, the raycaster reports a chosen hit, and label text is recorded
const h = vi.hoisted(() => ({ hit: [] as { instanceId: number }[], labels: [] as string[] }));
vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  class WebGLRenderer {
    domElement = document.createElement('canvas');
    shadowMap = { enabled: false, type: 0 };
    setPixelRatio() {}
    setSize() {}
    setAnimationLoop() {}
    render() {}
    dispose() {}
    forceContextLoss() {}
  }
  class Raycaster extends three.Raycaster {
    intersectObject() {
      return h.hit as never;
    }
  }
  return { ...three, WebGLRenderer, Raycaster };
});

import { mountCity } from '../../src/features/city/mountCity';

const HOSTILE = '<img src=x onerror=alert(1)>.ts';

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

beforeEach(() => {
  h.hit = [];
  h.labels = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, key: string) => {
      if (key in t) return t[key];
      if (key === 'measureText') return (s: string) => ({ width: s.length * 10 });
      if (key === 'fillText') return (s: string) => h.labels.push(s);
      return () => {};
    },
    set: (t, key: string, v) => ((t[key] = v), true),
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

test('hostile names render as text in labels, tooltip, panel, search and code view', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const dispose = mountCity(root, arch(), env({
    selection: { file: HOSTILE, code: true },
    readSource: async () => 'const x = "<img src=w onerror=alert(4)>";',
  }));

  expect(h.labels).toContain('<b>role</b>');
  expect(h.labels).toContain('<img src=y onerror=alert(2)>');

  const panel = root.querySelector('[data-el="panel-body"]')!;
  expect(panel.textContent).toContain(HOSTILE);
  expect(panel.textContent).toContain('<img src=z onerror=alert(3)>');
  await waitFor(() => expect(root.querySelector('[data-el="code-src"]')!.textContent).toContain('<img src=w onerror=alert(4)>'));
  expect(root.querySelector('[data-el="code-name"]')!.textContent).toBe(HOSTILE);

  h.hit = [{ instanceId: 1 }];
  fireEvent.pointerMove(root.querySelector('canvas')!, { clientX: 10, clientY: 10 });
  const tip = root.querySelector('[data-el="tip"]')!;
  expect(tip.textContent).toContain(HOSTILE);
  expect(tip.textContent).toContain('<b>role</b>');

  const q = root.querySelector<HTMLInputElement>('[data-el="q"]')!;
  q.value = 'img';
  fireEvent.input(q);
  expect(root.querySelector('[data-el="results"]')!.textContent).toContain(HOSTILE);

  expect(root.querySelector('img')).toBeNull();
  expect(root.querySelector('h3 b, [data-el="roles"] b, [data-el="tip"] b b')).toBeNull();
  expect(root.textContent).toContain('<b>role</b>');
  dispose();
  expect(root.children).toHaveLength(0);
});
