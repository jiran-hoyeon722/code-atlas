import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { analyze } from '../../src/engine/analyze';
import type { Architecture, ArchNode } from '../../src/engine/architecture';
import { isConfigPath, isSourcePath } from '../../src/engine/collect';
import { nodeLocate } from '../../src/engine/node';
import { loadParsers, type Parsers } from '../../src/engine/parsers';
import type { RepoInput } from '../../src/engine/types';
import type { ViewerEnv } from '../../src/features/viewer-env';
import { mountExplorer } from '../../src/features/explorer/mountExplorer';

function loadRepo(name: string): RepoInput {
  const dir = join(__dirname, '../fixtures', name);
  const input: RepoInput = { name, files: [], configs: {} };
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else {
        const path = relative(dir, abs).split('\\').join('/');
        if (isSourcePath(path)) input.files.push({ path, text: readFileSync(abs, 'utf8') });
        else if (isConfigPath(path)) input.configs[path] = readFileSync(abs, 'utf8');
      }
    }
  };
  walk(dir);
  return input;
}

const node = (path: string, role: number, extra: Partial<ArchNode> = {}): ArchNode => ({
  path, name: path.replace(/\.ts$/, ''), kind: 'class', role, lines: 40, functions: 3, complexity: 5, maxComplexity: 2,
  fanIn: 0, fanOut: 0, instability: 0, centrality: 1, routeRefs: 0, routeFiles: [], ...extra,
});

const HOSTILE = '<img src=x onerror=alert(1)>.ts';

function handMade(): Architecture {
  return {
    version: 1, name: 'demo', lang: 'ts', framework: 'react', sourceDir: 'src', generatedAt: '2026-01-01T00:00:00Z',
    layers: [
      { key: 'entry', label: '진입점', hint: '요청이 들어오는 곳' },
      { key: 'application', label: '애플리케이션', hint: '작업 흐름' },
      { key: 'domain', label: '도메인', hint: '핵심 데이터' },
      { key: 'foundation', label: '기반', hint: '공용 코드' },
    ],
    roles: [
      { name: 'Page', layer: 0, patterns: ['a'], description: '화면' },
      { name: 'Service', layer: 1, patterns: ['b'], description: '서비스' },
      { name: 'Model', layer: 2, patterns: ['c'], description: '모델' },
      { name: 'Data', layer: 3, patterns: ['d'], description: '데이터', warning: '데이터 경고' },
    ],
    nodes: [
      node('a/Home.ts', 0, { fanOut: 2, routeRefs: 1, routeFiles: ['routes/web.ts'] }),
      node('b/Auth.ts', 1, { fanIn: 1, fanOut: 1 }),
      node('c/User.ts', 2, { fanIn: 2, fanOut: 1 }),
      node(HOSTILE, 3, { fanIn: 1 }),
      node('c/Orphan.ts', 2),
    ],
    edges: [[0, 1, 2, { inject: 2 }, 0], [0, 2, 1, { import: 1 }, 0], [1, 2, 1, { import: 1 }, 0], [2, 3, 1, { import: 1 }, 0]],
    failed: [], unresolved: 0,
  };
}

function makeEnv(over: Partial<ViewerEnv> = {}): ViewerEnv {
  return {
    readSource: async () => null,
    vscodeHref: () => null,
    requestVscodeSetup: vi.fn(),
    selection: {},
    onSelect: vi.fn(),
    goto: vi.fn(),
    ...over,
  };
}

let disposers: (() => void)[] = [];
function mount(arch: Architecture, env: ViewerEnv) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const dispose = mountExplorer(root, arch, env);
  disposers.push(() => { dispose(); root.remove(); });
  return { root, dispose };
}
afterEach(() => { disposers.forEach((d) => d()); disposers = []; });

let parsers: Parsers;
beforeAll(async () => { parsers = await loadParsers(nodeLocate); });

const fileButton = (root: HTMLElement, text: string) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-open]')).find((b) => b.textContent?.includes(text))!;

describe('explorer', () => {
  test('renders summary cards from architecture (laravel-mini)', () => {
    const arch = analyze(loadRepo('laravel-mini'), parsers);
    const { root } = mount(arch, makeEnv());
    const first = root.querySelector('.card b')!;
    expect(first.textContent).toBe(arch.nodes.length.toLocaleString('ko-KR'));
    expect(root.classList.contains('cc-explorer')).toBe(true);
    expect(root.querySelectorAll('.role-box').length).toBe(arch.roles.length);
    expect(root.textContent).toContain(`${arch.name} 아키텍처 탐색기`);
  });

  test('selection opens file detail and reports back', () => {
    const env = makeEnv({ selection: { file: 'b/Auth.ts' } });
    const { root } = mount(handMade(), env);
    const drawer = root.querySelector('.drawer')!;
    expect(drawer.classList.contains('open')).toBe(true);
    expect(drawer.querySelector('h3')!.textContent).toBe('b/Auth');
    fireEvent.click(fileButton(root as HTMLElement, 'c/User'));
    expect(env.onSelect).toHaveBeenCalledWith({ file: 'c/User.ts' });
    expect(drawer.querySelector('h3')!.textContent).toBe('c/User');
  });

  test('file detail uses functions instead of commits and route files instead of routesDir', () => {
    const { root } = mount(handMade(), makeEnv({ selection: { file: 'a/Home.ts' } }));
    const text = root.querySelector('.drawer')!.textContent!;
    expect(text).toContain('함수 수');
    expect(text).toContain('함수 3개');
    expect(text).not.toContain('최근 커밋');
    expect(text).toContain('routes/web.ts');
  });

  test('vscode link when available, setup button otherwise', () => {
    const a = mount(handMade(), makeEnv({ selection: { file: 'a/Home.ts' }, vscodeHref: (p) => `vscode://file/x/${p}` }));
    expect(a.root.querySelector('a[href="vscode://file/x/a/Home.ts"]')).not.toBeNull();
    const env = makeEnv({ selection: { file: 'a/Home.ts' } });
    const b = mount(handMade(), env);
    const btn = Array.from(b.root.querySelectorAll('.drawer button')).find((x) => x.textContent?.includes('VS Code'))!;
    fireEvent.click(btn);
    expect(env.requestVscodeSetup).toHaveBeenCalled();
  });

  test('city link goes through env.goto', () => {
    const env = makeEnv({ selection: { file: 'a/Home.ts' } });
    const { root } = mount(handMade(), env);
    fireEvent.click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('코드 시티'))!);
    expect(env.goto).toHaveBeenCalledWith('city', { file: 'a/Home.ts' });
  });

  test('hostile file names render as text', () => {
    const arch = handMade();
    arch.roles[3].name = '<b>role</b>';
    const { root } = mount(arch, makeEnv({ selection: { file: HOSTILE } }));
    // exercise ranking, search, role and edge views too
    fireEvent.click(root.querySelector('[data-tab="fanIn"]')!);
    const input = root.querySelector('input[type=search]') as HTMLInputElement;
    input.value = 'img';
    fireEvent.input(input);
    fireEvent.click(root.querySelector('td[data-key="2>3"]')!);
    fireEvent.click(root.querySelector('.role-box')!);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('b')?.textContent).not.toBe('role');
    expect(root.textContent).toContain(HOSTILE);
    expect(root.textContent).toContain('<b>role</b>');
  });

  test('ranking tabs switch and rows open the detail', () => {
    const env = makeEnv();
    const { root } = mount(handMade(), env);
    fireEvent.click(root.querySelector('[data-tab="fanOut"]')!);
    const rows = root.querySelectorAll('tbody[data-r="rank-body"] tr');
    expect(rows[0].textContent).toContain('a/Home');
    fireEvent.click(rows[0]);
    expect(env.onSelect).toHaveBeenCalledWith({ file: 'a/Home.ts' });
  });

  test('dispose removes listeners and DOM', () => {
    const { root, dispose } = mount(handMade(), makeEnv());
    dispose();
    expect(root.innerHTML).toBe('');
    expect(root.classList.contains('cc-explorer')).toBe(false);
    fireEvent.keyDown(document, { key: '/' });
    expect(document.activeElement).toBe(document.body);
  });

  test('slash focuses search while mounted', () => {
    const { root } = mount(handMade(), makeEnv());
    fireEvent.keyDown(document, { key: '/' });
    expect(document.activeElement).toBe(root.querySelector('input[type=search]'));
  });
});
