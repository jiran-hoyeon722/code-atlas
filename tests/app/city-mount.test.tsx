import { fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Architecture, ArchNode } from '../../src/engine/architecture';
import type { ViewerEnv } from '../../src/features/viewer-env';

// jsdom has no WebGL or 2D canvas: the renderer is faked, the raycaster reports a chosen hit, and label text is recorded
const h = vi.hoisted(() => ({ hit: [] as { instanceId: number }[], labels: [] as string[], loop: null as ((now: number) => void) | null }));
vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  class WebGLRenderer {
    domElement = document.createElement('canvas');
    shadowMap = { enabled: false, type: 0 };
    setPixelRatio() {}
    setSize() {}
    setAnimationLoop(cb: ((now: number) => void) | null) {
      if (cb) h.loop = cb;
    }
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

const blastArch = (): Architecture => ({
  ...arch(),
  nodes: [node('lib/core.ts', 1, { fanIn: 2 }), node(HOSTILE, 1, { fanIn: 1, routeRefs: 2 }), node('a/Page.ts', 0), node('types/only.ts', 1)],
  edges: [[1, 0, 1, { import: 1 }, 0], [2, 1, 1, { import: 1 }, 0], [3, 0, 1, { 'type-import': 1 }, 0]],
});
const mountBlast = (over: Partial<ViewerEnv> = {}, a = blastArch()) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const e = env({ selection: { file: 'lib/core.ts' }, ...over });
  const dispose = mountCity(root, a, e);
  const onSelect = e.onSelect as ReturnType<typeof vi.fn>;
  return { root, e, dispose, onSelect, last: () => onSelect.mock.calls.at(-1)?.[0], section: () => root.querySelector('[data-el="blast"]'), button: () => root.querySelector<HTMLElement>('[data-blast]')! };
};

test('blast button shows summary and levels', () => {
  const { root, section, button, last, dispose } = mountBlast();
  fireEvent.click(button());
  expect(root.querySelector('.blast-summary')!.textContent).toBe('직접 2 · 간접 1 · 도시의 100% · 최대 2단계');
  expect(root.querySelector('.blast-routes')!.textContent).toBe('영향권 중 라우트가 직접 쓰는 파일 1개');
  expect(section()!.textContent).toContain(HOSTILE);
  expect(root.querySelector('img')).toBeNull();
  expect(button().getAttribute('aria-pressed')).toBe('true');
  expect(last()).toEqual({ file: 'lib/core.ts', blast: true });
  dispose();
});

test('blast type toggle recomputes', () => {
  const { root, button, dispose } = mountBlast();
  fireEvent.click(button());
  const toggle = root.querySelector<HTMLInputElement>('input[data-blast-types]')!;
  toggle.focus();
  toggle.checked = true;
  fireEvent.change(toggle);
  expect(document.activeElement).toBe(root.querySelector('input[data-blast-types]'));
  expect(root.querySelector('.blast-summary')!.textContent).toBe('직접 1 · 간접 1 · 도시의 67% · 최대 2단계');
  expect(root.querySelector<HTMLInputElement>('input[data-blast-types]')!.checked).toBe(true);
  dispose();
});

test('blast pulse survives a frame timestamp earlier than the click', () => {
  const { button, dispose } = mountBlast();
  fireEvent.click(button());
  expect(() => h.loop!(-1000)).not.toThrow();
  dispose();
});

test('blast on an unused file says nothing is affected', () => {
  const { button, section, dispose } = mountBlast({ selection: { file: 'a/Page.ts' } });
  fireEvent.click(button());
  expect(section()!.textContent).toContain('이 파일을 쓰는 곳이 없습니다 — 고쳐도 다른 파일에 번지지 않습니다');
  dispose();
});

test('blast is released by the button, the close button and picking another file', () => {
  const { root, button, section, last, dispose } = mountBlast();
  fireEvent.click(button());
  fireEvent.click(button());
  expect(section()).toBeNull();
  expect(button().getAttribute('aria-pressed')).toBe('false');
  expect(last()).toEqual({ file: 'lib/core.ts' });

  fireEvent.click(button());
  fireEvent.click(root.querySelector('[data-el="close"]')!);
  expect(section()).toBeNull();

  fireEvent.click(root.querySelector('[data-el="panel-body"] .item')!);
  fireEvent.click(button());
  const target = section()!.querySelector<HTMLElement>('.item')!;
  fireEvent.click(target);
  expect(section()).toBeNull();
  expect(last()).toEqual({ file: expect.any(String) });
  dispose();
});

test('changing the color metric keeps blast on', () => {
  const { root, button, section, dispose } = mountBlast();
  fireEvent.click(button());
  const color = root.querySelector<HTMLSelectElement>('[data-el="color"]')!;
  color.value = 'maxComplexity';
  fireEvent.change(color);
  expect(section()).not.toBeNull();
  expect(button().getAttribute('aria-pressed')).toBe('true');
  dispose();
});

test('escape closes the code viewer first and keeps blast', async () => {
  const { root, section, last, dispose } = mountBlast({ selection: { file: 'lib/core.ts', code: true, blast: true }, readSource: async () => 'x' });
  await waitFor(() => expect(root.querySelector('[data-el="code-src"]')!.textContent).toBe('x'));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(root.querySelector('[data-el="code"]')!.classList.contains('open')).toBe(false);
  expect(section()).not.toBeNull();
  expect(last()).toEqual({ file: 'lib/core.ts', blast: true });
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(root.querySelector('[data-el="panel"]')!.classList.contains('open')).toBe(false);
  dispose();
});

test('deep link starts with blast on without echoing the selection', () => {
  const { section, onSelect, dispose } = mountBlast({ selection: { file: 'lib/core.ts', blast: true } });
  expect(section()).not.toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
  dispose();
});

test('deep link to a missing file with blast leaves the panel closed', () => {
  const { root, dispose } = mountBlast({ selection: { file: 'nope.ts', blast: true } });
  expect(root.querySelector('[data-el="panel"]')!.classList.contains('open')).toBe(false);
  dispose();
});

test('a hub level lists 40 files and counts the rest', () => {
  const users = Array.from({ length: 45 }, (_, k) => node(`u/U${k}.ts`, 0));
  const hub: Architecture = { ...arch(), nodes: [node('lib/core.ts', 1), ...users], edges: users.map((_, k) => [k + 1, 0, 1, { import: 1 }, 0]) };
  const { button, section, dispose } = mountBlast({}, hub);
  fireEvent.click(button());
  expect(section()!.querySelectorAll('.item')).toHaveLength(40);
  expect(section()!.textContent).toContain('외 5개');
  dispose();
});

test('reduced motion paints final state at once', () => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
  const { root, button, dispose } = mountBlast();
  fireEvent.click(button());
  expect(root.dataset.blastDone).toBe('1');
  fireEvent.click(button());
  expect(root.dataset.blastDone).toBeUndefined();
  dispose();
});

test('re-selecting the same building keeps blast on', () => {
  const { root, button, section, last, dispose } = mountBlast();
  fireEvent.click(button());
  const q = root.querySelector<HTMLInputElement>('[data-el="q"]')!;
  q.value = 'lib/core';
  fireEvent.input(q);
  fireEvent.keyDown(q, { key: 'Enter' });
  expect(section()).not.toBeNull();
  expect(button().getAttribute('aria-pressed')).toBe('true');
  expect(last()).toEqual({ file: 'lib/core.ts', blast: true });
  dispose();
});
