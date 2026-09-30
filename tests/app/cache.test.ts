import 'fake-indexeddb/auto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { analyze } from '../../src/engine/analyze';
import { isConfigPath, isSourcePath } from '../../src/engine/collect';
import { nodeLocate } from '../../src/engine/node';
import { loadParsers } from '../../src/engine/parsers';
import type { Architecture } from '../../src/engine/architecture';
import type { RepoInput } from '../../src/engine/types';
import type { Entry, Listing } from '../../src/app/files/types';
import {
  cacheKey,
  clearAnalyses,
  deleteAnalysis,
  listAnalyses,
  loadAnalysis,
  saveAnalysis,
  type CacheEntry,
} from '../../src/storage/cache';

const entry = (path: string, size: number, lastModified: number): Entry => ({
  path,
  size,
  lastModified,
  file: { name: path, kind: 'file', size, lastModified, text: async () => '' },
});

const listing = (mtime: number): Listing => ({
  name: 'demo',
  sources: [entry('b.ts', 2, mtime), entry('a.ts', 1, 1)],
  configs: [entry('package.json', 3, 1)],
  tooLarge: [],
});

function loadRepo(name: string, marker: string): RepoInput {
  const dir = join(__dirname, '../fixtures', name);
  const input: RepoInput = { name, files: [], configs: {} };
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else {
        const path = relative(dir, abs).split('\\').join('/');
        const text = readFileSync(abs, 'utf8');
        if (isSourcePath(path)) input.files.push({ path, text: `${text}\nconst secret = '${marker}';\n` });
        else if (isConfigPath(path)) input.configs[path] = text;
      }
    }
  };
  walk(dir);
  return input;
}

const summary = (key: string, analyzedAt: string, arch: Architecture): CacheEntry => ({
  key,
  name: arch.name,
  framework: arch.framework,
  lang: arch.lang,
  files: arch.nodes.length,
  analyzedAt,
  architecture: arch,
});

let arch: Architecture;
const MARKER = 'ZZ_SECRET_MARKER_4f9a1c';

beforeAll(async () => {
  const parsers = await loadParsers(nodeLocate, ['php', 'ts']);
  arch = analyze(loadRepo('react-mini', MARKER), parsers, { now: new Date('2026-01-01T00:00:00Z') });
});

beforeEach(async () => {
  await clearAnalyses();
});

describe('cache', () => {
  test('same listing → same key; changed mtime → different key', async () => {
    const a = await cacheKey(listing(5));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await cacheKey(listing(5))).toBe(a);
    expect(await cacheKey(listing(6))).not.toBe(a);
  });

  test('save/list/load/delete/clear roundtrip, newest first', async () => {
    await saveAnalysis({ ...summary('k1', '2026-01-01T00:00:00Z', arch), name: 'repo-k1' });
    await saveAnalysis({ ...summary('k2', '2026-03-01T00:00:00Z', arch), name: 'repo-k2' });
    await saveAnalysis({ ...summary('k3', '2026-02-01T00:00:00Z', arch), name: 'repo-k3' });

    const list = await listAnalyses();
    expect(list.map((s) => s.key)).toEqual(['k2', 'k3', 'k1']);
    expect(list[0]).not.toHaveProperty('architecture');
    expect(list[0]).toMatchObject({ name: 'repo-k2', framework: 'react', lang: arch.lang, files: arch.nodes.length });

    const loaded = await loadAnalysis('k1');
    expect(loaded?.architecture).toEqual(arch);
    expect(await loadAnalysis('nope')).toBeUndefined();

    await deleteAnalysis('k1');
    expect(await loadAnalysis('k1')).toBeUndefined();
    expect((await listAnalyses()).length).toBe(2);

    await clearAnalyses();
    expect(await listAnalyses()).toEqual([]);
  });

  test('saving a changed folder replaces its old entry; other folders untouched', async () => {
    const at = '2026-01-01T00:00:00Z';
    await saveAnalysis({ ...summary('x1', at, arch), name: 'x' });
    await saveAnalysis({ ...summary('y1', at, arch), name: 'y' });
    await saveAnalysis({ ...summary('x2', '2026-02-01T00:00:00Z', arch), name: 'x' });
    const list = await listAnalyses();
    expect(list.map((s) => s.key).sort()).toEqual(['x2', 'y1']);
    expect(await loadAnalysis('x1')).toBeUndefined();
    await saveAnalysis({ ...summary('x2', '2026-03-01T00:00:00Z', arch), name: 'x' });
    expect((await listAnalyses()).length).toBe(2);
  });

  test('cached php/ts entries still open', async () => {
    const old = (key: string, lang: 'php' | 'ts', framework: string) => ({
      key, name: `old-${lang}`, framework, lang, files: arch.nodes.length, analyzedAt: '2026-01-01T00:00:00Z',
      architecture: { ...arch, lang, framework },
    });
    const records = [old('old-php', 'php', 'laravel'), old('old-ts', 'ts', 'react')];
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('code-atlas', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('analyses', { keyPath: 'key' });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('analyses', 'readwrite');
        for (const r of records) tx.objectStore('analyses').put(r);
        tx.oncomplete = () => { open.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    const list = await listAnalyses();
    expect(list.map((s) => [s.key, s.lang, s.framework]).sort()).toEqual([['old-php', 'php', 'laravel'], ['old-ts', 'ts', 'react']]);
    expect(await loadAnalysis('old-php')).toEqual(records[0]);
    expect(await loadAnalysis('old-ts')).toEqual(records[1]);
  });

  test('stored record never contains source text', async () => {
    expect(JSON.stringify(arch)).not.toContain(MARKER);
    await saveAnalysis(summary('k1', '2026-01-01T00:00:00Z', arch));
    const raw = await new Promise<unknown>((resolve, reject) => {
      const open = indexedDB.open('code-atlas', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const get = open.result.transaction('analyses').objectStore('analyses').get('k1');
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      };
    });
    expect(raw).toBeTruthy();
    expect(JSON.stringify(raw)).not.toContain(MARKER);
  });
});
