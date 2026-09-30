import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Architecture } from '../../src/engine/architecture';
import type { Progress } from '../../src/engine/analyze';
import type { Lang, RepoInput } from '../../src/engine/types';
import type { CacheEntry, CacheSummary } from '../../src/storage/cache';
import { cacheKey } from '../../src/storage/cache';
import { AnalysisCancelled } from '../../src/app/analysis/client';
import type { ViewerShellProps } from '../../src/features/shell/ViewerShell';

const h = vi.hoisted(() => ({ shell: null as null | ViewerShellProps }));

const SHA = 'c'.repeat(40);
/** A fake GitHub + static host: set `files` to what the repo contains, `status` to make every API call fail. */
const github = {
  files: {} as Record<string, string>,
  status: 0,
  headers: {} as Record<string, string>,
  calls: [] as string[],
  /** API calls wait on this, so a test can act while the lookup is in flight */
  gate: Promise.resolve() as Promise<unknown>,
  handle(url: string): Response {
    this.calls.push(url);
    if (url === './samples/index.json') return Response.json({ generatedAt: '2026-09-30', repos: [SAMPLE] });
    if (url === './samples/acme-shop.json') return Response.json({ ...archBase('acme/shop'), nodes: [] });
    if (url.startsWith('https://api.github.com') && this.status) return new Response('{}', { status: this.status, headers: this.headers });
    if (url === 'https://api.github.com/repos/acme/shop') return Response.json({ name: 'shop', owner: { login: 'acme' }, default_branch: 'main' });
    if (url === 'https://api.github.com/repos/acme/shop/commits/main') return new Response(SHA);
    if (url === `https://api.github.com/repos/acme/shop/git/trees/${SHA}?recursive=1`) {
      return Response.json({ truncated: false, tree: Object.entries(this.files).map(([path, t]) => ({ path, type: 'blob', size: t.length })) });
    }
    const raw = `https://raw.githubusercontent.com/acme/shop/${SHA}/`;
    if (url.startsWith(raw) && url.slice(raw.length) in this.files) return new Response(this.files[url.slice(raw.length)]);
    return new Response('missing', { status: 404 });
  },
};

const SAMPLE = {
  id: 'acme-shop', owner: 'acme', repo: 'shop', sha: SHA, subdir: '', blurb: '가짜 쇼핑몰', lang: 'ts', framework: 'react',
  files: 2, edges: 1, stars: 12345, roles: [{ name: 'Page', layer: 0 }], roleCounts: [2],
};

vi.mock('../../src/features/loading/miniCity', () => ({ mountMiniCity: () => ({ add() {}, dispose() {} }) }));
vi.mock('../../src/features/shell/ViewerShell', () => ({
  ViewerShell: (p: ViewerShellProps) => {
    h.shell = p;
    return (
      <div data-testid="viewer">
        <span>{`viewer:${p.arch.name}:${p.arch.lang}`}</span>
        {p.canReconnect && <span>can-reconnect</span>}
      </div>
    );
  },
}));

import { App } from '../../src/app/App';
import { GITHUB_MAX_FILES, type SessionDeps } from '../../src/app/useRepoSession';

type Tree = { [name: string]: string | Tree };

function fileHandle(name: string, text: string, mtime: number) {
  return { kind: 'file' as const, name, getFile: async () => new File([text], name, { lastModified: mtime }) };
}

function dirHandle(name: string, tree: Tree, mtime = 1, perm: PermissionState = 'granted'): FileSystemDirectoryHandle {
  const self = {
    kind: 'directory' as const,
    name,
    permission: perm,
    async *values() {
      for (const [n, v] of Object.entries(tree)) yield typeof v === 'string' ? fileHandle(n, v, mtime) : dirHandle(n, v, mtime, perm);
    },
    async getDirectoryHandle(n: string) {
      const v = tree[n];
      if (!v || typeof v === 'string') throw new DOMException('missing', 'NotFoundError');
      return dirHandle(n, v, mtime, perm);
    },
    async getFileHandle(n: string) {
      const v = tree[n];
      if (typeof v !== 'string') throw new DOMException('missing', 'NotFoundError');
      return fileHandle(n, v, mtime);
    },
    queryPermission: async () => self.permission,
    requestPermission: async () => self.permission,
  };
  return self as unknown as FileSystemDirectoryHandle;
}

function items(...handles: unknown[]): DataTransferItemList {
  const list: Record<number | string, unknown> = { length: handles.length };
  handles.forEach((hd, i) => {
    list[i] = { kind: 'file', getAsFileSystemHandle: () => Promise.resolve(hd), webkitGetAsEntry: () => null };
  });
  return list as unknown as DataTransferItemList;
}

const archBase = (name: string, lang: Lang = 'ts') => ({
  version: 1 as const, name, lang, framework: null, sourceDir: '', generatedAt: '2026-09-29T01:02:03.000Z',
  layers: [], roles: [], edges: [], failed: [], unresolved: 0,
});

const archFor = (input: RepoInput, lang: Lang = 'ts'): Architecture => ({
  ...archBase(input.name, lang),
  nodes: input.files.map((f) => ({
    path: f.path, name: f.path, kind: 'module', role: 0, lines: 1, functions: 0, complexity: 0, maxComplexity: 0,
    fanIn: 0, fanOut: 0, instability: 0, centrality: 0, routeRefs: 0, routeFiles: [],
  })),
});

interface Run {
  input: RepoInput;
  prefer?: Lang;
  onProgress(p: Progress): void;
  resolve(a: Architecture): void;
  cancel: ReturnType<typeof vi.fn>;
}

function fakes() {
  const store = new Map<string, CacheEntry>();
  const runs: Run[] = [];
  const saved: CacheEntry[] = [];
  const summary = ({ key, name, framework, lang, files, analyzedAt }: CacheEntry): CacheSummary => ({ key, name, framework, lang, files, analyzedAt });
  const deps: SessionDeps = {
    startAnalysis: vi.fn((input: RepoInput, opts: { prefer?: Lang; onProgress(p: Progress): void }) => {
      let resolve!: (a: Architecture) => void;
      let reject!: (e: Error) => void;
      const result = new Promise<Architecture>((ok, err) => { resolve = ok; reject = err; });
      const cancel = vi.fn(() => reject(new AnalysisCancelled()));
      runs.push({ input, prefer: opts.prefer, onProgress: opts.onProgress, resolve, cancel });
      return { result, cancel };
    }),
    cache: {
      cacheKey,
      saveAnalysis: vi.fn(async (e: CacheEntry) => {
        saved.push(e);
        for (const [k, v] of store) if (v.name === e.name && k !== e.key) store.delete(k);
        store.set(e.key, e);
      }),
      listAnalyses: vi.fn(async () => [...store.values()].map(summary).sort((a, b) => (a.analyzedAt < b.analyzedAt ? 1 : -1))),
      loadAnalysis: vi.fn(async (k: string) => store.get(k)),
      deleteAnalysis: vi.fn(async (k: string) => { store.delete(k); }),
      clearAnalyses: vi.fn(async () => { store.clear(); }),
    },
    pickDirectory: null,
    fetch: vi.fn(async (url: string) => {
      if (url.startsWith('https://api.github.com')) await github.gate;
      return github.handle(url);
    }) as unknown as typeof fetch,
  };
  return { deps, store, runs, saved };
}

const LANG_QUESTION = '이 폴더에는 여러 언어가 함께 있어요. 어느 쪽으로 볼까요?';

const zone = () => screen.getByRole('region', { name: '레포 폴더를 여기에 끌어다 놓으세요' });
const drop = (list: DataTransferItemList) => fireEvent.drop(zone(), { dataTransfer: { items: list, types: ['Files'] } });

const tsRepo: Tree = { 'package.json': '{"dependencies":{}}', src: { 'a.ts': 'export const a = 1;', 'b.ts': 'import { a } from "./a";' } };

async function finish(run: Run, lang: Lang = 'ts') {
  await act(async () => {
    run.onProgress({ phase: 'parse', done: 1, total: 2, path: 'src/a.ts', role: 0 });
  });
  await act(async () => {
    run.resolve(archFor(run.input, lang));
  });
}

beforeEach(() => {
  h.shell = null;
  history.replaceState(null, '', '/');
  Object.assign(github, { files: {}, status: 0, headers: {}, calls: [], gate: Promise.resolve() });
});
afterEach(cleanup);

test('dropping a single file shows notice', async () => {
  const { deps } = fakes();
  render(<App deps={deps} />);
  expect(screen.getByRole('heading', { name: 'Code Atlas' })).toBeTruthy();
  drop(items(fileHandle('notes.txt', 'hi', 1)));
  expect(await screen.findByText('폴더를 끌어다 놓아 주세요. 파일 하나로는 분석할 수 없어요.')).toBeTruthy();
  expect(deps.startAnalysis).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '폴더 선택' })).toBeTruthy();
});

test('folder without supported files shows notice', async () => {
  const { deps } = fakes();
  render(<App deps={deps} />);
  drop(items(dirHandle('docs', { 'README.md': '# hi', img: { 'a.png': 'x' } })));
  expect(await screen.findByText('분석할 수 있는 소스 파일을 찾지 못했어요.')).toBeTruthy();
  expect(deps.startAnalysis).not.toHaveBeenCalled();
  expect(zone()).toBeTruthy();
});

test('fresh folder: listing → loading screen → viewer, result cached', async () => {
  const { deps, runs, saved, store } = fakes();
  const root = dirHandle('demo-repo', { ...tsRepo, 'huge.js': 'x'.repeat(2 * 1024 * 1024 + 1) });
  render(<App deps={deps} />);
  drop(items(root));
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(screen.getByText('코드 읽기')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'demo-repo' })).toBeTruthy();
  expect(runs[0].input.files.map((f) => f.path).sort()).toEqual(['src/a.ts', 'src/b.ts']);
  expect(runs[0].prefer).toBeUndefined();
  await act(async () => {
    runs[0].onProgress({ phase: 'parse', done: 1, total: 2, path: 'src/<b>a</b>.ts', role: 0 });
  });
  expect(screen.getByText('src/<b>a</b>.ts')).toBeTruthy();
  expect(screen.getByText('1 / 2')).toBeTruthy();
  await act(async () => {
    runs[0].resolve(archFor(runs[0].input));
  });
  expect(await screen.findByText('viewer:demo-repo:ts')).toBeTruthy();
  expect(screen.getByText('2MB 가 넘는 파일 1개는 건너뛰었어요.')).toBeTruthy();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ name: 'demo-repo', lang: 'ts', files: 2, handle: root });
  expect(JSON.stringify(saved[0].architecture)).not.toContain('export const a');
  expect(store.size).toBe(1);
  expect(h.shell!.canReconnect).toBe(false);
  expect(await h.shell!.readSource('src/a.ts')).toBe('export const a = 1;');
  expect(await h.shell!.readSource('src/missing.ts')).toBeNull();
});

test('same folder again opens from cache without analysing', async () => {
  const { deps, runs } = fakes();
  render(<App deps={deps} />);
  drop(items(dirHandle('demo-repo', tsRepo)));
  await waitFor(() => expect(runs).toHaveLength(1));
  await finish(runs[0]);
  await screen.findByText('viewer:demo-repo:ts');
  await act(async () => h.shell!.onOpenOther());
  await screen.findByRole('button', { name: '폴더 선택' });
  drop(items(dirHandle('demo-repo', tsRepo)));
  expect(await screen.findByText('viewer:demo-repo:ts')).toBeTruthy();
  expect(deps.startAnalysis).toHaveBeenCalledTimes(1);
  expect(await h.shell!.readSource('src/b.ts')).toBe('import { a } from "./a";');
});

test('changed folder re-analyses', async () => {
  const { deps, runs, store } = fakes();
  render(<App deps={deps} />);
  drop(items(dirHandle('demo-repo', tsRepo, 1)));
  await waitFor(() => expect(runs).toHaveLength(1));
  await finish(runs[0]);
  await screen.findByText('viewer:demo-repo:ts');
  const firstKey = [...store.keys()][0];
  await act(async () => h.shell!.onOpenOther());
  drop(items(dirHandle('demo-repo', { ...tsRepo, src: { ...(tsRepo.src as Tree), 'c.ts': 'export {};' } }, 2)));
  await waitFor(() => expect(runs).toHaveLength(2));
  expect(runs[1].input.files.map((f) => f.path).sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  await finish(runs[1]);
  await screen.findByText('viewer:demo-repo:ts');
  expect(store.size).toBe(1);
  expect([...store.keys()][0]).not.toBe(firstKey);
  expect([...store.values()][0].files).toBe(3);
});

test('mixed php+ts folder asks which language and passes prefer', async () => {
  const { deps, runs } = fakes();
  render(<App deps={deps} />);
  drop(items(dirHandle('mixed', { app: { 'A.php': '<?php', 'B.php': '<?php' }, 'vite.config.js': 'export default {}' })));
  const dialog = await screen.findByRole('dialog', { name: LANG_QUESTION });
  expect(runs).toHaveLength(0);
  const php = within(dialog).getByRole('button', { name: /PHP/ });
  const ts = within(dialog).getByRole('button', { name: /TypeScript/ });
  expect(php.textContent).toContain('2');
  expect(ts.textContent).toContain('1');
  expect(document.activeElement).toBe(php);
  fireEvent.click(ts);
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(runs[0].prefer).toBe('ts');
  await finish(runs[0]);
  expect(await screen.findByText('viewer:mixed:ts')).toBeTruthy();
});

test('cancel during analysis returns to landing', async () => {
  const { deps, runs, saved } = fakes();
  render(<App deps={deps} />);
  drop(items(dirHandle('demo-repo', tsRepo)));
  await waitFor(() => expect(runs).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(runs[0].cancel).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole('button', { name: '폴더 선택' })).toBeTruthy();
  expect(screen.queryByText('코드 읽기')).toBeNull();
  expect(screen.queryByTestId('viewer')).toBeNull();
  expect(saved).toHaveLength(0);
});

test('a recent entry in a language this build does not know still renders', async () => {
  const { deps, store } = fakes();
  const lang = 'rust' as Lang;
  const arch = { ...archFor({ name: 'future', files: [], configs: {} }), lang };
  store.set('k1', { key: 'k1', name: 'future', framework: null, lang, files: 3, analyzedAt: '2026-09-28T10:00:00.000Z', architecture: arch });
  render(<App deps={deps} />);
  const card = await screen.findByRole('button', { name: /^future(?!.*삭제)/ });
  expect(card.textContent).toContain('rust · 3 파일 · ');
});

test('recent card opens cached analysis; delete and clear update the list', async () => {
  const { deps, store } = fakes();
  const base = archFor({ name: 'x', files: [{ path: 'app/A.php', text: '' }], configs: {} }, 'php');
  const seed = (key: string, name: string, at: string, handle?: FileSystemDirectoryHandle) =>
    store.set(key, { key, name, framework: 'laravel', lang: 'php', files: 1234, analyzedAt: at, architecture: { ...base, name }, handle });
  seed('k1', 'shop-api', '2026-09-28T10:00:00.000Z', dirHandle('shop-api', { app: { 'A.php': '<?php // A' } }, 1, 'denied'));
  seed('k2', '<img src=x onerror=alert(1)>', '2026-09-27T10:00:00.000Z');
  seed('k3', 'old-site', '2026-09-26T10:00:00.000Z');
  render(<App deps={deps} />);

  const card = await screen.findByRole('button', { name: /^shop-api(?!.*삭제)/ });
  expect(card.textContent).toContain('Laravel · 1,234 파일 · ');
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  expect(document.querySelector('img')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '<img src=x onerror=alert(1)> 삭제' }));
  await waitFor(() => expect(screen.queryByText('<img src=x onerror=alert(1)>')).toBeNull());
  expect(deps.cache.deleteAnalysis).toHaveBeenCalledWith('k2');
  expect(screen.getByText('old-site')).toBeTruthy();

  fireEvent.click(card);
  expect(await screen.findByText('viewer:shop-api:php')).toBeTruthy();
  expect(deps.startAnalysis).not.toHaveBeenCalled();
  expect(h.shell!.canReconnect).toBe(true);
  expect(await h.shell!.readSource('app/A.php')).toBeNull();

  await act(async () => h.shell!.onOpenOther());
  fireEvent.click(await screen.findByRole('button', { name: '캐시 지우기' }));
  await waitFor(() => expect(screen.queryByText('old-site')).toBeNull());
  expect(screen.queryByText('shop-api')).toBeNull();
  expect(deps.cache.clearAnalyses).toHaveBeenCalledTimes(1);
});

test('cached analysis with a granted handle reads source from the stored folder', async () => {
  const { deps, store } = fakes();
  const base = archFor({ name: 'x', files: [{ path: 'app/Http/A.php', text: '' }], configs: {} }, 'php');
  store.set('k1', {
    key: 'k1', name: 'shop-api', framework: 'laravel', lang: 'php', files: 1, analyzedAt: '2026-09-28T10:00:00.000Z',
    architecture: { ...base, name: 'shop-api' }, handle: dirHandle('shop-api', { app: { Http: { 'A.php': '<?php // A' } } }),
  });
  render(<App deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: /^shop-api(?!.*삭제)/ }));
  await screen.findByText('viewer:shop-api:php');
  expect(await h.shell!.readSource('app/Http/A.php')).toBe('<?php // A');
  expect(await h.shell!.readSource('app/Http/Nope.php')).toBeNull();
  await waitFor(() => expect(h.shell!.canReconnect).toBe(false));
});

test('reconnect with the same folder keeps the analysis and attaches source access', async () => {
  const { deps, runs, store } = fakes();
  const repo: Tree = { app: { 'A.php': '<?php // A' } };
  render(<App deps={deps} />);
  drop(items(dirHandle('shop-api', repo)));
  await waitFor(() => expect(runs).toHaveLength(1));
  await finish(runs[0], 'php');
  await screen.findByText('viewer:shop-api:php');
  const key = [...store.keys()][0];
  store.get(key)!.handle = undefined;

  await act(async () => h.shell!.onOpenOther());
  fireEvent.click(await screen.findByRole('button', { name: /^shop-api(?!.*삭제)/ }));
  await screen.findByText('can-reconnect');
  expect(await h.shell!.readSource('app/A.php')).toBeNull();

  const picked = dirHandle('shop-api', repo);
  deps.pickDirectory = vi.fn(async () => picked);
  await act(async () => h.shell!.onReconnect());
  await waitFor(() => expect(screen.queryByText('can-reconnect')).toBeNull());
  expect(deps.startAnalysis).toHaveBeenCalledTimes(1);
  expect(await h.shell!.readSource('app/A.php')).toBe('<?php // A');
  expect(store.get(key)!.handle).toBe(picked);
});

test('failed reconnects keep the viewer and show why', async () => {
  const { deps, store } = fakes();
  const base = archFor({ name: 'x', files: [{ path: 'app/A.php', text: '' }], configs: {} }, 'php');
  store.set('k1', {
    key: 'k1', name: 'shop-api', framework: null, lang: 'php', files: 1, analyzedAt: '2026-09-28T10:00:00.000Z',
    architecture: { ...base, name: 'shop-api' },
  });
  render(<App deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: /^shop-api(?!.*삭제)/ }));
  await screen.findByText('can-reconnect');

  deps.pickDirectory = vi.fn(async () => dirHandle('shop-api', { 'README.md': 'x' }));
  await act(async () => h.shell!.onReconnect());
  expect((await screen.findByRole('alert')).textContent).toContain('폴더를 다시 연결하지 못했어요. 분석할 수 있는 소스 파일을 찾지 못했어요.');
  expect(screen.getByTestId('viewer')).toBeTruthy();
  fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '닫기' }));
  expect(screen.queryByRole('alert')).toBeNull();

  const broken = { kind: 'directory', name: 'shop-api', values: () => { throw new Error('gone'); } } as unknown as FileSystemDirectoryHandle;
  deps.pickDirectory = vi.fn(async () => broken);
  await act(async () => h.shell!.onReconnect());
  expect((await screen.findByRole('alert')).textContent).toContain('폴더를 다시 연결하지 못했어요. 폴더를 읽지 못했어요.');
  fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '닫기' }));

  deps.pickDirectory = vi.fn(async () => { throw new DOMException('denied', 'SecurityError'); });
  await act(async () => h.shell!.onReconnect());
  expect((await screen.findByRole('alert')).textContent).toContain('폴더를 다시 연결하지 못했어요. 폴더를 읽지 못했어요.');
  expect(screen.getByText('can-reconnect')).toBeTruthy();
  expect(deps.startAnalysis).not.toHaveBeenCalled();
});

test('too many files asks before analysing; declining returns to landing', async () => {
  const { deps, runs } = fakes();
  const src: Tree = {};
  for (let i = 0; i <= 20000; i++) src[`f${i}.ts`] = '';
  render(<App deps={deps} />);
  drop(items(dirHandle('big', { src })));
  const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
  expect(dialog.textContent).toContain('파일이 20,001개예요. 소스 폴더(예: src)만 골라서 다시 열면 더 빨라요. 그대로 진행할까요?');
  fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(runs).toHaveLength(0);
  expect(zone()).toBeTruthy();
});

test('folder input picks a folder when showDirectoryPicker is missing', async () => {
  const { deps, runs } = fakes();
  render(<App deps={deps} />);
  expect(screen.getByText('이 브라우저에서는 폴더를 끌어다 놓거나 "폴더 선택"으로 골라 주세요. 다시 열 때 코드 보기는 폴더를 한 번 더 넣어야 해요.')).toBeTruthy();
  const input = screen.getByTestId('folder-input') as HTMLInputElement;
  const click = vi.spyOn(input, 'click');
  fireEvent.click(screen.getByRole('button', { name: '폴더 선택' }));
  expect(click).toHaveBeenCalledTimes(1);
  const f = (path: string, text: string) => {
    const file = new File([text], path.split('/').pop()!, { lastModified: 1 });
    Object.defineProperty(file, 'webkitRelativePath', { value: path });
    return file;
  };
  Object.defineProperty(input, 'files', { configurable: true, value: [f('web/src/a.ts', 'export const a = 1;')] });
  fireEvent.change(input);
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(runs[0].input.name).toBe('web');
  await finish(runs[0]);
  expect(await screen.findByText('viewer:web:ts')).toBeTruthy();
});

test('laravel folder with front-end js opens as php without asking', async () => {
  const { deps, runs } = fakes();
  render(<App deps={deps} />);
  drop(items(dirHandle('shop', {
    'composer.json': '{"require":{"laravel/framework":"^11.0"}}',
    'vite.config.js': 'export default {}',
    app: { 'User.php': '<?php' },
    resources: { js: { 'app.ts': '', 'b.ts': '' } },
  })));
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(runs[0].prefer).toBe('php');
});

test('react folder with stray php files opens as ts without asking', async () => {
  const { deps, runs } = fakes();
  render(<App deps={deps} />);
  drop(items(dirHandle('web', {
    'package.json': '{"dependencies":{"react":"^19.0.0"}}',
    src: { 'main.tsx': '' },
    api: { 'a.php': '<?php', 'b.php': '<?php' },
  })));
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(runs[0].prefer).toBe('ts');
});

test('java+kotlin folder asks with the bigger language first and focused', async () => {
  const { deps, runs } = fakes();
  render(<App deps={deps} />);
  drop(items(dirHandle('mobile', {
    'build.gradle.kts': 'plugins {}',
    'settings.gradle.kts': '',
    src: { 'A.java': 'class A {}', 'B.kt': 'class B', 'C.kt': 'class C', 'D.kt': 'class D' },
  })));
  const dialog = await screen.findByRole('dialog', { name: LANG_QUESTION });
  expect(runs).toHaveLength(0);
  const labels = within(dialog).getAllByRole('button').map((b) => b.textContent).filter((t) => t?.includes('개'));
  expect(labels).toEqual(['Kotlin · 3개', 'Java · 1개']);
  expect(document.activeElement?.textContent).toBe('Kotlin · 3개');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Java · 1개' }));
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(runs[0].prefer).toBe('java');
});

test('go folder with helper shell scripts opens as go without asking', async () => {
  const { deps, runs } = fakes();
  render(<App deps={deps} />);
  drop(items(dirHandle('svc', {
    'go.mod': 'module example.com/svc',
    'main.go': 'package main',
    scripts: { 'build.sh': 'echo hi', 'test.sh': 'echo hi', 'lint.sh': 'echo hi' },
  })));
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(runs[0].input.configs['go.mod']).toBe('module example.com/svc');
  expect(runs[0].input.files.map((f) => f.path)).toEqual(['main.go']);
  await finish(runs[0], 'go');
  expect(await screen.findByText('viewer:svc:go')).toBeTruthy();
});

test('folder with both laravel and react still asks', async () => {
  const { deps, runs } = fakes();
  render(<App deps={deps} />);
  drop(items(dirHandle('full', {
    'composer.json': '{"require":{"laravel/framework":"^11.0"}}',
    'package.json': '{"devDependencies":{"react":"^19.0.0"}}',
    app: { 'User.php': '<?php' },
    resources: { js: { 'App.tsx': '' } },
  })));
  const dialog = await screen.findByRole('dialog', { name: LANG_QUESTION });
  expect(runs).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole('button', { name: /PHP/ }));
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(runs[0].prefer).toBe('php');
  expect(runs[0].input.files.map((f) => f.path).sort()).toEqual(['app/User.php', 'resources/js/App.tsx']);
});

test('a ts folder with python files reads only the chosen language', async () => {
  const { deps, runs } = fakes();
  render(<App deps={deps} />);
  drop(items(dirHandle('web', {
    ...tsRepo,
    tools: { 'gen.py': 'print(1)', 'sync.py': 'print(2)', 'lint.py': 'print(3)' },
  })));
  const dialog = await screen.findByRole('dialog', { name: LANG_QUESTION });
  fireEvent.click(within(dialog).getByRole('button', { name: /TypeScript/ }));
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(runs[0].input.files.map((f) => f.path).sort()).toEqual(['src/a.ts', 'src/b.ts']);
});

test('while the language dialog is open the landing is inert and ignores drops', async () => {
  const { deps, runs } = fakes();
  render(<App deps={deps} />);
  drop(items(dirHandle('mixed', { app: { 'A.php': '<?php' }, 'x.ts': '' })));
  const dialog = await screen.findByRole('dialog');
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(zone().closest('[inert]')).not.toBeNull();
  expect(dialog.closest('[inert]')).toBeNull();
  const dropping = fireEvent.drop(zone(), { dataTransfer: { items: items(dirHandle('other', tsRepo)), types: ['Files'] } });
  expect(dropping).toBe(false);
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(screen.getByRole('dialog')).toBe(dialog);
  fireEvent.click(within(dialog).getByRole('button', { name: /TypeScript/ }));
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(runs[0].input.name).toBe('mixed');
  expect(runs[0].prefer).toBe('ts');
});

test('unmounting during analysis cancels the worker', async () => {
  const { deps, runs } = fakes();
  const { unmount } = render(<App deps={deps} />);
  drop(items(dirHandle('demo-repo', tsRepo)));
  await waitFor(() => expect(runs).toHaveLength(1));
  unmount();
  expect(runs[0].cancel).toHaveBeenCalledTimes(1);
});

test('stray drops anywhere are prevented while the app is mounted', async () => {
  const { deps, runs } = fakes();
  const { unmount } = render(<App deps={deps} />);
  drop(items(dirHandle('demo-repo', tsRepo)));
  await waitFor(() => expect(runs).toHaveLength(1));
  await finish(runs[0]);
  await screen.findByText('viewer:demo-repo:ts');
  const ev = createEvent.drop(document);
  fireEvent(document, ev);
  expect(ev.defaultPrevented).toBe(true);
  const over = createEvent.dragOver(document);
  fireEvent(document, over);
  expect(over.defaultPrevented).toBe(true);
  unmount();
  const after = createEvent.drop(document);
  fireEvent(document, after);
  expect(after.defaultPrevented).toBe(false);
});

const ghInput = () => screen.getByRole('textbox', { name: 'GitHub 레포 주소' });
const openGithub = (url: string) => {
  fireEvent.change(ghInput(), { target: { value: url } });
  fireEvent.click(screen.getByRole('button', { name: '분석하기' }));
};

test('github url: previews the parse, downloads, analyses, caches, and reads code from the pinned commit', async () => {
  github.files = { 'package.json': '{"dependencies":{}}', 'src/a.ts': 'export const a = 1;', 'src/b.ts': 'import { a } from "./a";', 'README.md': '# x' };
  const { deps, runs, saved } = fakes();
  render(<App deps={deps} />);
  const button = screen.getByRole('button', { name: '분석하기' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(ghInput(), { target: { value: 'nonsense' } });
  expect(screen.getByText('owner/repo 형식이나 GitHub 주소를 넣어 주세요')).toBeTruthy();
  fireEvent.change(ghInput(), { target: { value: 'https://github.com/acme/shop' } });
  expect(screen.getByText('✓ acme/shop · 기본 브랜치')).toBeTruthy();
  openGithub('https://github.com/acme/shop');
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(screen.getByText('GitHub 에서 코드 받기')).toBeTruthy();
  expect(runs[0].input.name).toBe('acme/shop');
  expect(runs[0].input.files.map((f) => f.path).sort()).toEqual(['src/a.ts', 'src/b.ts']);
  await finish(runs[0]);
  expect(await screen.findByText('viewer:acme/shop:ts')).toBeTruthy();
  expect(saved[0]).toMatchObject({ key: `gh:acme/shop@${SHA}/`, name: 'acme/shop', origin: { kind: 'github', owner: 'acme', repo: 'shop', sha: SHA } });
  expect(JSON.stringify(saved[0])).not.toContain('export const a');
  expect(h.shell!.origin?.sha).toBe(SHA);
  expect(h.shell!.canReconnect).toBe(false);

  // back on the landing the recent card reopens it, and code still comes from GitHub
  await act(async () => h.shell!.onOpenOther());
  fireEvent.click(await screen.findByRole('button', { name: /^acme\/shop TypeScript/ }));
  await screen.findByText('viewer:acme/shop:ts');
  expect(h.shell!.canReconnect).toBe(false);
  expect(await h.shell!.readSource('src/b.ts')).toBe('import { a } from "./a";');
  expect(github.calls.at(-1)).toBe(`https://raw.githubusercontent.com/acme/shop/${SHA}/src/b.ts`);
});

test('github rate limit returns to landing with the reset time and a ZIP fallback', async () => {
  github.status = 403;
  github.headers = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' };
  const { deps, runs } = fakes();
  render(<App deps={deps} />);
  openGithub('acme/shop');
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('GitHub 요청 한도(시간당 60회)를 다 썼어요.');
  const zip = within(alert).getByRole('link', { name: /ZIP 내려받기/ });
  expect(zip.getAttribute('href')).toBe('https://github.com/acme/shop/archive/HEAD.zip');
  expect(runs).toHaveLength(0);
});

test('a github repo that does not exist says so without a ZIP link', async () => {
  github.status = 404;
  const { deps } = fakes();
  render(<App deps={deps} />);
  openGithub('acme/shop');
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('레포를 찾지 못했어요.');
  expect(within(alert).queryByRole('link')).toBeNull();
});

test('a huge github repo asks for a subfolder instead of downloading', async () => {
  for (let i = 0; i <= GITHUB_MAX_FILES; i++) github.files[`src/f${i}.ts`] = '';
  const { deps, runs } = fakes();
  render(<App deps={deps} />);
  openGithub('acme/shop');
  const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
  expect(alert.textContent).toContain('하위 폴더 주소');
  expect(github.calls.filter((u) => u.startsWith('https://raw.githubusercontent.com')).length).toBeLessThanOrEqual(1);
  expect(runs).toHaveLength(0);
});

test('a github repo opens when its language is under the cap even if other files push it over', async () => {
  github.files = { 'src/a.ts': 'export const a = 1;', 'src/b.ts': 'import { a } from "./a";' };
  for (let i = 0; i < GITHUB_MAX_FILES; i++) github.files[`scripts/s${i}.sh`] = 'echo hi';
  const { deps, runs } = fakes();
  render(<App deps={deps} />);
  openGithub('acme/shop');
  await waitFor(() => expect(runs).toHaveLength(1), { timeout: 5000 });
  expect(runs[0].input.files.map((f) => f.path).sort()).toEqual(['src/a.ts', 'src/b.ts']);
  expect(github.calls.filter((u) => u.startsWith('https://raw.githubusercontent.com') && u.endsWith('.sh'))).toEqual([]);
});

test('cancelling while GitHub resolves drops the result', async () => {
  github.files = { 'src/a.ts': 'export const a = 1;' };
  let release!: () => void;
  github.gate = new Promise<void>((ok) => { release = ok; });
  const { deps, runs } = fakes();
  render(<App deps={deps} />);
  openGithub('acme/shop');
  expect(await screen.findByRole('heading', { name: 'acme/shop' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  await screen.findByRole('button', { name: '분석하기' });
  await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)); });
  expect(runs).toHaveLength(0);
  expect(screen.queryByTestId('viewer')).toBeNull();
});

test('sample card opens the bundled analysis instantly and reads code from GitHub', async () => {
  github.files = { 'src/a.ts': 'export const a = 1;' };
  const { deps, runs, saved } = fakes();
  render(<App deps={deps} />);
  const card = await screen.findByRole('button', { name: /acme \/\s*shop/ });
  expect(card.textContent).toContain('가짜 쇼핑몰');
  expect(card.textContent).toContain('★ 12.3K');
  fireEvent.click(card);
  expect(await screen.findByText('viewer:acme/shop:ts')).toBeTruthy();
  expect(runs).toHaveLength(0);
  expect(saved).toHaveLength(0);
  expect(await h.shell!.readSource('src/a.ts')).toBe('export const a = 1;');
});
