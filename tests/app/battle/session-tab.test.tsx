import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AnalysisResult } from '../../../src/app/analysis/client';
import type { Architecture } from '../../../src/engine/architecture';
import { packQuality, unpackQuality } from '../../../src/engine/battle/pack';
import type { RepoInput } from '../../../src/engine/types';
import { battleState, cacheKey, type CacheEntry, type CacheSummary } from '../../../src/storage/cache';
import { quality } from './fakes';

const h = vi.hoisted(() => {
  const mounted: string[] = [];
  const stub = (tab: string) => (root: HTMLElement) => {
    mounted.push(tab);
    root.append(`view:${tab}`);
    return () => undefined;
  };
  return { mounted, stub };
});
vi.mock('../../../src/features/city/mountCity', () => ({ mountCity: h.stub('city') }));
vi.mock('../../../src/features/graph/mountGraph', () => ({ mountGraph: h.stub('graph') }));
vi.mock('../../../src/features/explorer/mountExplorer', () => ({ mountExplorer: h.stub('explorer') }));
vi.mock('../../../src/features/walk/mountWalk', () => ({ mountWalk: h.stub('walk') }));
vi.mock('../../../src/features/loading/miniCity', () => ({ mountMiniCity: () => ({ add() {}, dispose() {} }) }));
vi.mock('../../../src/features/shell/webgl', () => ({ hasWebGL: () => false }));

import { App } from '../../../src/app/App';
import type { SessionDeps } from '../../../src/app/useRepoSession';

const archFor = (input: RepoInput): Architecture => ({
  version: 1, name: input.name, lang: 'ts', framework: null, sourceDir: '', generatedAt: '2026-09-29T01:02:03.000Z',
  layers: [], roles: [], edges: [], failed: [], unresolved: 0,
  nodes: input.files.map((f) => ({
    path: f.path, name: f.path, kind: 'module', role: 0, lines: 1, functions: 0, complexity: 0, maxComplexity: 0,
    fanIn: 0, fanOut: 0, instability: 0, centrality: 0, routeRefs: 0, routeFiles: [],
  })),
});

function fakes(seed: CacheEntry[]) {
  const store = new Map(seed.map((e) => [e.key, e]));
  const summary = (e: CacheEntry): CacheSummary => ({
    key: e.key, name: e.name, framework: e.framework, lang: e.lang, files: e.files, analyzedAt: e.analyzedAt,
    battle: battleState(e), hasHandle: !!e.handle,
  });
  const deps: SessionDeps = {
    startAnalysis: vi.fn((input: RepoInput) => ({
      result: Promise.resolve<AnalysisResult>({ architecture: archFor(input), quality: packQuality(quality(input.name)) }),
      cancel: vi.fn(),
    })),
    cache: {
      cacheKey,
      saveAnalysis: vi.fn(async (e: CacheEntry) => {
        store.set(e.key, e);
      }),
      listAnalyses: vi.fn(async () => [...store.values()].map(summary).sort((a, b) => (a.analyzedAt < b.analyzedAt ? 1 : -1))),
      loadAnalysis: vi.fn(async (k: string) => store.get(k)),
      deleteAnalysis: vi.fn(async (k: string) => {
        store.delete(k);
      }),
      clearAnalyses: vi.fn(async () => store.clear()),
    },
    pickDirectory: null,
    fetch: vi.fn(async () => new Response('missing', { status: 404 })) as unknown as typeof fetch,
    measureQuality: vi.fn(async () => {
      throw new Error('not expected');
    }),
  };
  return { deps, store };
}

const other = (key: string, name: string, over: Partial<CacheEntry> = {}): CacheEntry => ({
  key, name, framework: null, lang: 'ts', files: 7, analyzedAt: '2026-09-10T00:00:00.000Z',
  architecture: archFor({ name, files: [], configs: {} }), quality: packQuality(quality(name)), ...over,
});

function folder(name: string, files: Record<string, unknown>): FileSystemDirectoryHandle {
  const fileHandle = (n: string, text: string) => ({ kind: 'file' as const, name: n, getFile: async () => new File([text], n, { lastModified: 1 }) });
  const dir = (n: string, tree: Record<string, unknown>): unknown => ({
    kind: 'directory' as const,
    name: n,
    async *values() {
      for (const [k, v] of Object.entries(tree)) yield typeof v === 'string' ? fileHandle(k, v) : dir(k, v as Record<string, unknown>);
    },
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
  });
  return dir(name, files) as FileSystemDirectoryHandle;
}

beforeEach(() => {
  h.mounted.length = 0;
  history.replaceState(null, '', '/#battle');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('a fresh analysis saves its battle data and the battle tab opens on the pick screen with the open repo', async () => {
  const { deps, store } = fakes([other('k-beta', 'beta')]);
  render(<App deps={deps} />);
  const zone = screen.getByRole('region', { name: '레포 폴더를 여기에 끌어다 놓으세요' });
  const handle = folder('alpha', { 'package.json': '{}', src: { 'a.ts': 'export const a = 1;' } });
  const items = { length: 1, 0: { kind: 'file', getAsFileSystemHandle: () => Promise.resolve(handle), webkitGetAsEntry: () => null } };
  fireEvent.drop(zone, { dataTransfer: { items, types: ['Files'] } });

  expect(await screen.findByRole('heading', { name: '레포 전쟁' }, { timeout: 5000 })).toBeTruthy();
  const selfCard = screen.getByRole('region', { name: 'A · 지금 연 레포' });
  expect(within(selfCard).getByText('alpha')).toBeTruthy();
  await waitFor(() => expect(selfCard.getAttribute('data-state')).toBe('ready'));

  const list = screen.getByRole('region', { name: 'B · 상대 고르기' });
  const beta = await within(list).findByRole('button', { name: /beta/ });
  expect(beta.textContent).toContain('바로 싸울 수 있어요');
  expect(within(list).queryByRole('button', { name: /^alpha/ })).toBeNull();

  const saved = [...store.values()].find((e) => e.name === 'alpha')!;
  expect(unpackQuality(saved.quality!).name).toBe('alpha');
  expect(JSON.stringify(saved.quality)).not.toContain('export const a');
  expect(deps.measureQuality).not.toHaveBeenCalled();
  expect(h.mounted).toEqual([]);
});

test('an old cached entry without battle data still opens, and the tab says how to get it', async () => {
  const old = other('k-old', 'legacy', { quality: undefined, analyzedAt: '2026-09-20T00:00:00.000Z' });
  const { deps } = fakes([old, other('k-beta', 'beta')]);
  render(<App deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: /^legacy(?!.*삭제)/ }));

  expect(await screen.findByRole('heading', { name: '레포 전쟁' }, { timeout: 5000 })).toBeTruthy();
  const selfCard = screen.getByRole('region', { name: 'A · 지금 연 레포' });
  expect(within(selfCard).getByText('legacy')).toBeTruthy();
  expect(await within(selfCard).findByRole('alert')).toBeTruthy();
  expect(selfCard.textContent).toContain('다시 분석');
  expect(await screen.findByRole('button', { name: /beta/ })).toBeTruthy();
  expect(deps.startAnalysis).not.toHaveBeenCalled();
});
