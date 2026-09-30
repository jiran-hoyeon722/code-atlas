import { describe, expect, test, vi } from 'vitest';
import { BATTLE_MSG, createBattleAccess, type BattleAccessDeps, type SelfSource } from '../../src/app/battleAccess';
import { GithubError, type GithubOrigin } from '../../src/app/files/github';
import type { FsDir, FsFile } from '../../src/app/files/types';
import { listRepo } from '../../src/app/files/walk';
import type { Architecture } from '../../src/engine/architecture';
import { packQuality, unpackQuality } from '../../src/engine/battle/pack';
import type { Quality } from '../../src/engine/battle/types';
import type { Lang, RepoInput } from '../../src/engine/types';
import { MEASURE_MSG } from '../../src/features/battle/deps';
import { loadErrorText } from '../../src/features/battle/tab/loadError';
import { QualityError } from '../../src/features/battle/worker/client';
import type { BattleLoadStep } from '../../src/features/viewer-env';
import { battleState, type CacheEntry, type CacheSummary } from '../../src/storage/cache';
import { quality } from './battle/fakes';

type Tree = { [name: string]: string | Tree };

const SECRET = 'ZZ_SOURCE_TEXT_7c21';
const repoTree: Tree = { 'package.json': '{"dependencies":{}}', src: { 'a.ts': `export const a = '${SECRET}';` } };
const SHA = 'd'.repeat(40);
const ORIGIN: GithubOrigin = { kind: 'github', owner: 'acme', repo: 'shop', sha: SHA, ref: '', subdir: '' };

function memDir(name: string, tree: Tree): FsDir {
  return {
    name,
    kind: 'directory',
    async *children() {
      for (const [n, v] of Object.entries(tree)) {
        if (typeof v === 'string') yield { name: n, kind: 'file', size: v.length, lastModified: 1, text: async () => v } satisfies FsFile;
        else yield memDir(n, v);
      }
    },
  };
}

function dirHandle(name: string, tree: Tree, perm: { query: PermissionState; request: PermissionState }) {
  const fileHandle = (n: string, text: string) => ({ kind: 'file' as const, name: n, getFile: async () => new File([text], n, { lastModified: 1 }) });
  const make = (n: string, t: Tree): unknown => ({
    kind: 'directory' as const,
    name: n,
    async *values() {
      for (const [k, v] of Object.entries(t)) yield typeof v === 'string' ? fileHandle(k, v) : make(k, v);
    },
  });
  const root = make(name, tree) as Record<string, unknown>;
  const queryPermission = vi.fn(async () => perm.query);
  const requestPermission = vi.fn(async () => perm.request);
  Object.assign(root, { queryPermission, requestPermission });
  return { handle: root as unknown as FileSystemDirectoryHandle, queryPermission, requestPermission };
}

const arch = (name: string, lang: Lang = 'ts'): Architecture => ({
  version: 1, name, lang, framework: null, sourceDir: '', generatedAt: '2026-09-01T00:00:00.000Z',
  layers: [], roles: [], nodes: [], edges: [], failed: [], unresolved: 0,
});

const entry = (key: string, analyzedAt: string, over: Partial<CacheEntry> = {}): CacheEntry => ({
  key, name: key, framework: null, lang: 'ts', files: 3, analyzedAt, architecture: arch(key), ...over,
});

function fakeCache(entries: CacheEntry[]) {
  const store = new Map(entries.map((e) => [e.key, e]));
  const cache: BattleAccessDeps['cache'] = {
    listAnalyses: vi.fn(async () =>
      // deliberately unsorted: the access sorts newest first itself
      [...store.values()].map((e): CacheSummary => ({
        key: e.key, name: e.name, framework: e.framework, lang: e.lang, files: e.files, analyzedAt: e.analyzedAt,
        ...(e.origin && { origin: e.origin }), battle: battleState(e), hasHandle: !!e.handle,
      })),
    ),
    loadAnalysis: vi.fn(async (k: string) => store.get(k)),
    saveAnalysis: vi.fn(async (e: CacheEntry) => {
      store.set(e.key, e);
    }),
  };
  return { store, cache };
}

function setup(self: Partial<SelfSource>, entries: CacheEntry[] = []) {
  const { store, cache } = fakeCache(entries);
  const measured: { input: RepoInput; prefer: Lang }[] = [];
  let next: () => Promise<Quality> = async () => quality(measured.at(-1)!.input.name);
  const deps: BattleAccessDeps = {
    cache,
    measure: vi.fn(async (input: RepoInput, prefer: Lang) => {
      measured.push({ input, prefer });
      return next();
    }),
    readGithub: vi.fn(async () => memDir('acme/shop', repoTree)),
  };
  const selfSource: SelfSource = { key: 'self', name: 'alpha', lang: 'ts', ...self };
  const access = createBattleAccess(() => selfSource, deps);
  return { access, deps, store, measured, setNext: (f: () => Promise<Quality>) => (next = f) };
}

const steps = () => {
  const seen: BattleLoadStep[] = [];
  return { seen, onStep: (s: BattleLoadStep) => seen.push(s) };
};

describe('self', () => {
  test('uses the battle data measured with the analysis', async () => {
    const q = quality('alpha');
    const { access, deps } = setup({ quality: packQuality(q) });
    expect(access.self).toEqual({ key: 'self', name: 'alpha' });
    await expect(access.loadSelf()).resolves.toEqual(q);
    expect(deps.measure).not.toHaveBeenCalled();
  });

  test('too small: rejects with the too-small code the tab words for the person', async () => {
    const { access, deps } = setup({ quality: null, qualityIssue: 'too-small' });
    const e = await access.loadSelf().catch((x: unknown) => x);
    expect(loadErrorText(e)).toBe(MEASURE_MSG.tooSmall);
    expect(deps.measure).not.toHaveBeenCalled();
  });

  test('missing but the folder is still in memory: measures it, saves into the cache entry, and remembers it', async () => {
    const listing = await listRepo(memDir('alpha', repoTree));
    const { access, deps, store, measured } = setup({ quality: null, listing }, [entry('self', '2026-09-01T00:00:00Z')]);
    const q = await access.loadSelf();
    expect(measured).toHaveLength(1);
    expect(measured[0].prefer).toBe('ts');
    expect(measured[0].input.files.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(Object.keys(measured[0].input.configs)).toEqual(['package.json']);
    expect(unpackQuality(store.get('self')!.quality!)).toEqual(q);
    expect(JSON.stringify(store.get('self'))).not.toContain(SECRET);
    await access.loadSelf();
    expect(deps.measure).toHaveBeenCalledTimes(1);
  });

  test('missing, GitHub origin: reads the same commit again', async () => {
    const { access, deps, store } = setup({ origin: ORIGIN }, [entry('self', '2026-09-01T00:00:00Z', { origin: ORIGIN })]);
    await access.loadSelf();
    expect(deps.readGithub).toHaveBeenCalledWith(ORIGIN);
    expect(store.get('self')!.quality).toBeTruthy();
  });

  test('missing, stored handle: reads only when permission is already granted (no prompt without a click)', async () => {
    const granted = dirHandle('alpha', repoTree, { query: 'granted', request: 'granted' });
    const a = setup({ handle: granted.handle });
    await a.access.loadSelf();
    expect(a.deps.measure).toHaveBeenCalledTimes(1);

    const prompt = dirHandle('alpha', repoTree, { query: 'prompt', request: 'granted' });
    const b = setup({ handle: prompt.handle });
    await expect(b.access.loadSelf()).rejects.toThrow(BATTLE_MSG.selfMissing);
    expect(prompt.requestPermission).not.toHaveBeenCalled();
    expect(b.deps.measure).not.toHaveBeenCalled();
  });

  test('nothing to measure from: a Korean reason', async () => {
    const { access } = setup({});
    const e = await access.loadSelf().catch((x: unknown) => x);
    expect(loadErrorText(e)).toBe(BATTLE_MSG.selfMissing);
  });

  test('a failed measurement is not remembered, so 다시 시도 measures again', async () => {
    const listing = await listRepo(memDir('alpha', repoTree));
    const s = setup({ listing });
    s.setNext(async () => {
      throw new QualityError('failed', 'boom');
    });
    await expect(s.access.loadSelf()).rejects.toBeInstanceOf(QualityError);
    s.setNext(async () => quality('alpha'));
    await expect(s.access.loadSelf()).resolves.toMatchObject({ name: 'alpha' });
    expect(s.deps.measure).toHaveBeenCalledTimes(2);
  });
});

describe('listOpponents', () => {
  test('every other cached analysis, newest first, with how its battle data can be had; unfit repos left out', async () => {
    const { handle } = dirHandle('p', repoTree, { query: 'prompt', request: 'granted' });
    const { access } = setup({}, [
      entry('self', '2026-09-30T00:00:00Z', { quality: packQuality(quality('self')) }),
      entry('old', '2026-01-01T00:00:00Z'),
      entry('ready', '2026-09-20T00:00:00Z', { quality: packQuality(quality('ready')), handle }),
      entry('gh', '2026-09-10T00:00:00Z', { origin: ORIGIN }),
      entry('perm', '2026-09-15T00:00:00Z', { handle, qualityIssue: 'failed', lang: 'php', files: 42 }),
      entry('tiny', '2026-09-25T00:00:00Z', { qualityIssue: 'too-small', handle }),
      entry('empty', '2026-09-26T00:00:00Z', { qualityIssue: 'no-production' }),
    ]);
    const list = await access.listOpponents();
    expect(list.map((o) => [o.key, o.readiness, o.source])).toEqual([
      ['ready', 'ready', 'local'],
      ['perm', 'needs-permission', 'local'],
      ['gh', 'refetch', 'github'],
      ['old', 'reanalyze', 'local'],
    ]);
    expect(list[1]).toEqual({ key: 'perm', name: 'perm', lang: 'php', files: 42, analyzedAt: '2026-09-15T00:00:00Z', source: 'local', readiness: 'needs-permission' });
  });
});

describe('loadOpponent', () => {
  test('ready: unpacks the cached data without measuring', async () => {
    const q = quality('beta');
    const { access, deps } = setup({}, [entry('beta', '2026-09-01T00:00:00Z', { quality: packQuality(q) })]);
    const st = steps();
    await expect(access.loadOpponent('beta', st.onStep)).resolves.toEqual(q);
    expect(st.seen).toEqual([]);
    expect(deps.measure).not.toHaveBeenCalled();
  });

  test('needs permission: asks on the stored folder, reads it, measures, and saves back keeping the rest of the entry', async () => {
    const h = dirHandle('beta', repoTree, { query: 'prompt', request: 'granted' });
    const base = entry('beta', '2026-09-01T00:00:00Z', { handle: h.handle, lang: 'ts' });
    const { access, store, measured } = setup({}, [base]);
    const st = steps();
    const q = await access.loadOpponent('beta', st.onStep);
    expect(st.seen).toEqual(['permission', 'reading', 'measuring']);
    expect(h.requestPermission).toHaveBeenCalledWith({ mode: 'read' });
    expect(measured[0].input.files.map((f) => f.path)).toEqual(['src/a.ts']);
    const saved = store.get('beta')!;
    expect(saved.handle).toBe(h.handle);
    expect(saved.architecture).toBe(base.architecture);
    expect(saved.analyzedAt).toBe(base.analyzedAt);
    expect(unpackQuality(saved.quality!)).toEqual(q);
    expect(JSON.stringify({ ...saved, handle: undefined })).not.toContain(SECRET);
    expect((await access.listOpponents()).find((o) => o.key === 'beta')?.readiness).toBe('ready');
  });

  test('needs permission, denied: rejects with a plain reason and measures nothing', async () => {
    const h = dirHandle('beta', repoTree, { query: 'prompt', request: 'denied' });
    const { access, deps } = setup({}, [entry('beta', '2026-09-01T00:00:00Z', { handle: h.handle })]);
    const st = steps();
    const e = await access.loadOpponent('beta', st.onStep).catch((x: unknown) => x);
    expect(loadErrorText(e)).toBe(BATTLE_MSG.denied);
    expect(st.seen).toEqual(['permission']);
    expect(deps.measure).not.toHaveBeenCalled();
  });

  test('refetch: reads the same GitHub commit again and saves the result', async () => {
    const { access, deps, store } = setup({}, [entry('gh', '2026-09-01T00:00:00Z', { origin: ORIGIN, lang: 'ts' })]);
    const st = steps();
    await access.loadOpponent('gh', st.onStep);
    expect(deps.readGithub).toHaveBeenCalledWith(ORIGIN);
    expect(st.seen).toEqual(['reading', 'measuring']);
    expect(store.get('gh')!.quality).toBeTruthy();
    expect(store.get('gh')!.origin).toEqual(ORIGIN);
  });

  test('refetch hitting the GitHub rate limit says so in Korean', async () => {
    const { access, deps } = setup({}, [entry('gh', '2026-09-01T00:00:00Z', { origin: ORIGIN })]);
    vi.mocked(deps.readGithub).mockRejectedValueOnce(new GithubError('rateLimit'));
    const e = await access.loadOpponent('gh').catch((x: unknown) => x);
    expect(loadErrorText(e)).toBe(BATTLE_MSG.githubRate);
    expect(deps.measure).not.toHaveBeenCalled();
  });

  test('reanalyze: nothing to read from, so it rejects', async () => {
    const { access, deps } = setup({}, [entry('old', '2026-09-01T00:00:00Z')]);
    await expect(access.loadOpponent('old')).rejects.toThrow(BATTLE_MSG.reanalyze);
    await expect(access.loadOpponent('gone')).rejects.toThrow(BATTLE_MSG.missing);
    expect(deps.measure).not.toHaveBeenCalled();
  });

  test('too small once measured: the reason is saved so the repo leaves the list', async () => {
    const { access, store, setNext } = setup({}, [entry('gh', '2026-09-01T00:00:00Z', { origin: ORIGIN })]);
    setNext(async () => {
      throw new QualityError('too-small', 'small');
    });
    const e = await access.loadOpponent('gh').catch((x: unknown) => x);
    expect(loadErrorText(e)).toBe(MEASURE_MSG.tooSmall);
    expect(store.get('gh')!.qualityIssue).toBe('too-small');
    expect(store.get('gh')!.quality).toBeUndefined();
    expect(await access.listOpponents()).toEqual([]);
  });

  test('a failing cache write does not fail the battle', async () => {
    const { access, deps } = setup({}, [entry('gh', '2026-09-01T00:00:00Z', { origin: ORIGIN })]);
    vi.mocked(deps.cache.saveAnalysis).mockRejectedValueOnce(new Error('quota'));
    await expect(access.loadOpponent('gh')).resolves.toMatchObject({ name: 'acme/shop' });
  });
});
