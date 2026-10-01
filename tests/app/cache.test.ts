import 'fake-indexeddb/auto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { analyze } from '../../src/engine/analyze';
import { isConfigPath, isSourcePath } from '../../src/engine/collect';
import { nodeLocate } from '../../src/engine/node';
import { loadParsers } from '../../src/engine/parsers';
import type { Architecture } from '../../src/engine/architecture';
import { packQuality, unpackQuality, type PackedQuality } from '../../src/engine/battle/pack';
import { buildQuality } from '../../src/engine/battle/quality';
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
let packed: PackedQuality;
const MARKER = 'ZZ_SECRET_MARKER_4f9a1c';

beforeAll(async () => {
  const parsers = await loadParsers(nodeLocate, ['php', 'ts']);
  arch = analyze(loadRepo('react-mini', MARKER), parsers, { now: new Date('2026-01-01T00:00:00Z') });
  packed = packQuality(buildQuality(loadRepo('battle-ts', MARKER), parsers));
});

function rawRecord(key: string): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open('code-atlas', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const get = open.result.transaction('analyses').objectStore('analyses').get(key);
      get.onsuccess = () => {
        open.result.close();
        resolve(get.result);
      };
      get.onerror = () => reject(get.error);
    };
  });
}

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

  test('merged languages survive the round trip; single-language entries carry none', async () => {
    await saveAnalysis({ ...summary('m1', '2026-01-01T00:00:00Z', arch), name: 'mixed', langs: ['py', 'go'] });
    await saveAnalysis({ ...summary('s1', '2026-01-02T00:00:00Z', arch), name: 'single' });
    const list = await listAnalyses();
    expect(list.find((s) => s.key === 'm1')!.langs).toEqual(['py', 'go']);
    expect(list.find((s) => s.key === 's1')).not.toHaveProperty('langs');
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

  test('battle data round-trips with the analysis; summaries say which entries can battle', async () => {
    const handle = { kind: 'directory', name: 'folder' } as unknown as FileSystemDirectoryHandle;
    await saveAnalysis({ ...summary('ready', '2026-04-01T00:00:00Z', arch), name: 'r', quality: packed });
    await saveAnalysis({ ...summary('small', '2026-03-01T00:00:00Z', arch), name: 's', qualityIssue: 'too-small' });
    await saveAnalysis({ ...summary('failed', '2026-02-01T00:00:00Z', arch), name: 'f', qualityIssue: 'failed', handle });
    await saveAnalysis({ ...summary('none', '2026-01-01T00:00:00Z', arch), name: 'n', qualityIssue: 'no-production' });

    const list = await listAnalyses();
    expect(list.map((s) => [s.key, s.battle, s.hasHandle])).toEqual([
      ['ready', 'ready', false],
      ['small', 'too-small', false],
      ['failed', 'missing', true],
      ['none', 'no-production', false],
    ]);
    expect(list[0]).not.toHaveProperty('quality');
    const loaded = await loadAnalysis('ready');
    expect(loaded?.quality).toEqual(packed);
    expect(unpackQuality(loaded!.quality!).name).toBe('battle-ts');
  });

  test('an entry saved before battle data existed loads exactly as before and reads as missing', async () => {
    const old = { ...summary('old', '2026-01-01T00:00:00Z', arch), name: 'old-repo' };
    await saveAnalysis(old);
    expect(await loadAnalysis('old')).toEqual(old);
    expect(await listAnalyses()).toEqual([
      { key: 'old', name: 'old-repo', framework: arch.framework, lang: arch.lang, files: arch.nodes.length, analyzedAt: '2026-01-01T00:00:00Z', battle: 'missing', hasHandle: false },
    ]);
  });

  test('stored battle data never contains source text', async () => {
    expect(JSON.stringify(packed)).not.toContain(MARKER);
    await saveAnalysis({ ...summary('k1', '2026-01-01T00:00:00Z', arch), quality: packed });
    const raw = await rawRecord('k1');
    expect(raw).toMatchObject({ quality: { packVersion: packed.packVersion } });
    expect(JSON.stringify(raw)).not.toContain(MARKER);
  });
});
