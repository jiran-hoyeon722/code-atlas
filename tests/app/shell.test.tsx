import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Architecture, ArchNode } from '../../src/engine/architecture';
import type { TabId, ViewerEnv } from '../../src/features/viewer-env';

const h = vi.hoisted(() => {
  const make = (tab: string) => {
    const dispose = vi.fn();
    const mount = vi.fn((root: HTMLElement, _arch: unknown, env: unknown) => {
      const el = document.createElement('div');
      el.textContent = `view:${tab}`;
      root.appendChild(el);
      h.envs[tab] = env;
      return dispose;
    });
    return { mount, dispose };
  };
  return {
    webgl: true,
    cityGate: Promise.resolve() as Promise<void>,
    envs: {} as Record<string, unknown>,
    city: make('city'),
    graph: make('graph'),
    explorer: make('explorer'),
  };
});

vi.mock('../../src/features/city/mountCity', async () => {
  await h.cityGate;
  return { mountCity: h.city.mount };
});
vi.mock('../../src/features/graph/mountGraph', () => ({ mountGraph: h.graph.mount }));
vi.mock('../../src/features/explorer/mountExplorer', () => ({ mountExplorer: h.explorer.mount }));
vi.mock('../../src/features/shell/webgl', () => ({ hasWebGL: () => h.webgl }));

import { ViewerShell } from '../../src/features/shell/ViewerShell';

const node = (path: string): ArchNode => ({
  path, name: path, kind: 'class', role: 0, lines: 10, functions: 1, complexity: 1, maxComplexity: 1,
  fanIn: 0, fanOut: 0, instability: 0, centrality: 1, routeRefs: 0, routeFiles: [],
});

const arch = (extra: Partial<Architecture> = {}): Architecture => ({
  version: 1, name: 'demo-repo', lang: 'ts', framework: 'react', sourceDir: 'src', generatedAt: '2026-01-01T00:00:00Z',
  layers: [], roles: [], nodes: [node('src/a.ts'), node('src/b.ts')], edges: [[0, 1, 1, { import: 1 }, 0]],
  failed: [], unresolved: 0, ...extra,
});

const props = (extra: Record<string, unknown> = {}) => ({
  arch: arch(),
  readSource: vi.fn(async () => null),
  canReconnect: false,
  onReconnect: vi.fn(),
  onReanalyze: vi.fn(),
  onOpenOther: vi.fn(),
  ...extra,
});

const envOf = (tab: TabId) => h.envs[tab] as ViewerEnv;

beforeEach(() => {
  h.webgl = true;
  h.envs = {};
  for (const t of ['city', 'graph', 'explorer'] as const) {
    h[t].mount.mockClear();
    h[t].dispose.mockClear();
  }
  localStorage.clear();
  history.replaceState(null, '', '/');
});
afterEach(cleanup);

describe('ViewerShell', () => {
  test('top bar shows repo info and actions', async () => {
    const p = props({ arch: arch({ failed: [{ path: 'src/<bad>.ts', reason: 'syntax' }], unresolved: 3 }) });
    render(<ViewerShell {...p} />);
    expect(screen.getByText('demo-repo')).toBeTruthy();
    expect(screen.getByText(/파일 2개/)).toBeTruthy();
    for (const name of ['도시', '그래프', '탐색기']) expect(screen.getByRole('tab', { name })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다시 분석' }));
    expect(p.onReanalyze).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '다른 레포 열기' }));
    expect(p.onOpenOther).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '폴더 다시 연결' })).toBeNull();
    expect(screen.getByText('1개 파일을 읽지 못했어요')).toBeTruthy();
    expect(screen.getByText('src/<bad>.ts', { exact: false })).toBeTruthy();
    expect(screen.getByText('해석하지 못한 import 3개')).toBeTruthy();
    await screen.findByText('view:city');
  });

  test('default tab is city and hash is written', async () => {
    render(<ViewerShell {...props()} />);
    await screen.findByText('view:city');
    expect(h.city.mount).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe('#city');
  });

  test('tab click disposes previous mount and mounts the new one', async () => {
    render(<ViewerShell {...props()} />);
    await screen.findByText('view:city');
    fireEvent.click(screen.getByRole('tab', { name: '그래프' }));
    await screen.findByText('view:graph');
    expect(h.city.dispose).toHaveBeenCalledTimes(1);
    expect(h.graph.mount).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('view:city')).toBeNull();
    expect(location.hash).toBe('#graph');
  });

  test('a view whose mount throws shows the load-error note instead of a blank tab', async () => {
    h.graph.mount.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    render(<ViewerShell {...props()} />);
    await screen.findByText('view:city');
    fireEvent.click(screen.getByRole('tab', { name: '그래프' }));
    expect(await screen.findByText('화면을 불러오지 못했어요. 새로고침해 주세요.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '탐색기' }));
    await screen.findByText('view:explorer');
    expect(screen.queryByText('화면을 불러오지 못했어요. 새로고침해 주세요.')).toBeNull();
  });

  test('onSelect from the mounted view updates the hash without remounting', async () => {
    render(<ViewerShell {...props()} />);
    await screen.findByText('view:city');
    act(() => envOf('city').onSelect({ file: 'src/a b&c.ts', code: true }));
    expect(location.hash).toBe('#city&file=src%2Fa%20b%26c.ts&code');
    expect(h.city.mount).toHaveBeenCalledTimes(1);
    expect(h.city.dispose).not.toHaveBeenCalled();
  });

  test('goto another tab remounts there with the selection', async () => {
    render(<ViewerShell {...props()} />);
    await screen.findByText('view:city');
    act(() => envOf('city').goto('explorer', { file: 'src/b.ts' }));
    await screen.findByText('view:explorer');
    expect(h.city.dispose).toHaveBeenCalledTimes(1);
    expect(envOf('explorer').selection).toEqual({ file: 'src/b.ts' });
    expect(location.hash).toBe('#explorer&file=src%2Fb.ts');
  });

  test('restores tab and selection from the hash', async () => {
    history.replaceState(null, '', '/#graph&file=src%2Fa.ts');
    render(<ViewerShell {...props()} />);
    await screen.findByText('view:graph');
    expect(envOf('graph').selection).toEqual({ file: 'src/a.ts' });
    expect(h.city.mount).not.toHaveBeenCalled();
  });

  test('without WebGL the explorer is default and 3D tabs show a notice', async () => {
    h.webgl = false;
    render(<ViewerShell {...props()} />);
    await screen.findByText('view:explorer');
    fireEvent.click(screen.getByRole('tab', { name: '도시' }));
    expect(screen.getByText('이 브라우저에서는 3D 화면을 쓸 수 없어요. 탐색기에서 같은 정보를 볼 수 있어요.')).toBeTruthy();
    expect(h.city.mount).not.toHaveBeenCalled();
    expect(h.explorer.dispose).toHaveBeenCalledTimes(1);
  });

  test('vscodeHref is null until the repo path is set via the dialog', async () => {
    render(<ViewerShell {...props()} />);
    await screen.findByText('view:city');
    expect(envOf('city').vscodeHref('src/a.ts')).toBeNull();
    act(() => envOf('city').requestVscodeSetup());
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('브라우저는 보안상 폴더의 실제 경로를 알 수 없어요');
    fireEvent.change(screen.getByLabelText('레포 폴더의 절대 경로'), { target: { value: '/Users/me/demo-repo/' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(envOf('city').vscodeHref('src/a.ts')).toBe('vscode://file/Users/me/demo-repo/src/a.ts');
    expect(localStorage.getItem('code-atlas:vscode:demo-repo')).toBe('/Users/me/demo-repo/');
  });

  test('Esc closes the dialog without reaching window listeners', async () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    render(<ViewerShell {...props()} />);
    await screen.findByText('view:city');
    act(() => envOf('city').requestVscodeSetup());
    fireEvent.keyDown(screen.getByLabelText('레포 폴더의 절대 경로'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowKey);
  });

  test('reconnect button calls onReconnect while sources are unavailable', async () => {
    const p = props({ canReconnect: true });
    render(<ViewerShell {...p} />);
    await screen.findByText('view:city');
    expect(await envOf('city').readSource('src/a.ts')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '폴더 다시 연결' }));
    expect(p.onReconnect).toHaveBeenCalledTimes(1);
  });

  test('a slow view import resolving after a tab switch never mounts over the new tab', async () => {
    let release!: () => void;
    h.cityGate = new Promise<void>((r) => { release = r; });
    vi.resetModules();
    const { ViewerShell: Fresh } = await import('../../src/features/shell/ViewerShell');
    render(<Fresh {...props()} />);
    expect(screen.getByText('불러오는 중…')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '탐색기' }));
    await screen.findByText('view:explorer');
    await act(async () => {
      release();
      await h.cityGate;
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(h.city.mount).not.toHaveBeenCalled();
    expect(h.explorer.mount).toHaveBeenCalledTimes(1);
    expect(h.explorer.dispose).not.toHaveBeenCalled();
    expect(screen.getByText('view:explorer')).toBeTruthy();
    expect(screen.queryByText('불러오는 중…')).toBeNull();
    expect(location.hash).toBe('#explorer');
    h.cityGate = Promise.resolve();
  });

  test('cc.json download creates a blob named after the repo', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicks: string[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { clicks.push(this.download); };
    render(<ViewerShell {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'cc.json 내려받기' }));
    HTMLAnchorElement.prototype.click = orig;
    expect(clicks).toEqual(['demo-repo.cc.json']);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:x'));
  });
});
