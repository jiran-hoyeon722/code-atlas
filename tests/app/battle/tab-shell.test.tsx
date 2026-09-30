import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Architecture, ArchNode } from '../../../src/engine/architecture';

const h = vi.hoisted(() => {
  const make = (tab: string) =>
    vi.fn((root: HTMLElement) => {
      const el = document.createElement('div');
      el.textContent = `view:${tab}`;
      root.appendChild(el);
      return () => undefined;
    });
  return { webgl: true, city: make('city'), explorer: make('explorer'), battle: make('battle') };
});

vi.mock('../../../src/features/city/mountCity', () => ({ mountCity: h.city }));
vi.mock('../../../src/features/explorer/mountExplorer', () => ({ mountExplorer: h.explorer }));
vi.mock('../../../src/features/battle/tab/mountBattle', () => ({ mountBattle: h.battle }));
vi.mock('../../../src/features/shell/webgl', () => ({ hasWebGL: () => h.webgl }));

import { ViewerShell } from '../../../src/features/shell/ViewerShell';

const node = (path: string): ArchNode => ({
  path, name: path, kind: 'class', role: 0, lines: 10, functions: 1, complexity: 1, maxComplexity: 1,
  fanIn: 0, fanOut: 0, instability: 0, centrality: 1, routeRefs: 0, routeFiles: [],
});

const arch: Architecture = {
  version: 1, name: 'demo-repo', lang: 'ts', framework: 'react', sourceDir: 'src', generatedAt: '2026-01-01T00:00:00Z',
  layers: [], roles: [], nodes: [node('src/a.ts')], edges: [], failed: [], unresolved: 0,
};

const props = () => ({
  arch,
  readSource: vi.fn(async () => null),
  canReconnect: false,
  onReconnect: vi.fn(),
  onReanalyze: vi.fn(),
  onOpenOther: vi.fn(),
  onCollapse: vi.fn(),
});

beforeEach(() => {
  h.webgl = true;
  h.battle.mockClear();
  history.replaceState(null, '', '/');
});
afterEach(cleanup);

test('the 대결 tab sits between 탐색기 and 코드시티GTA and mounts the battle view', async () => {
  render(<ViewerShell {...props()} />);
  await screen.findByText('view:city');
  const names = screen.getAllByRole('tab').map((t) => t.textContent);
  expect(names.indexOf('대결')).toBe(names.indexOf('탐색기') + 1);
  expect(names[names.indexOf('대결') + 1]).toBe('코드시티GTA');
  fireEvent.click(screen.getByRole('tab', { name: '대결' }));
  await screen.findByText('view:battle');
  expect(location.hash).toBe('#battle');
});

test('#battle selects the battle tab on load', async () => {
  history.replaceState(null, '', '/#battle');
  render(<ViewerShell {...props()} />);
  await screen.findByText('view:battle');
  expect(screen.getByRole('tab', { name: '대결' }).getAttribute('aria-selected')).toBe('true');
  expect(h.city).not.toHaveBeenCalled();
});

test('without WebGL the battle tab still mounts while 3D tabs keep their note', async () => {
  h.webgl = false;
  history.replaceState(null, '', '/#battle');
  render(<ViewerShell {...props()} />);
  await screen.findByText('view:battle');
  expect(screen.queryByText(/3D 화면을 쓸 수 없어요/)).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: '도시' }));
  expect(await screen.findByText(/3D 화면을 쓸 수 없어요/)).toBeTruthy();
});
