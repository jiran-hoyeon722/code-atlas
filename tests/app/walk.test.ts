import { describe, expect, test, vi } from 'vitest';
import { forLang, forLangs, listRepo, loadRepo, isTooMany } from '../../src/app/files/walk';
import { fromDirectoryHandle, fromEntry, fromFileList } from '../../src/app/files/sources';
import type { FsDir, FsFile, Listing, Entry } from '../../src/app/files/types';

type Spec = Record<string, string | number>;

function tree(spec: Spec, spies: Record<string, () => void> = {}): FsDir {
  interface N { dirs: Map<string, N>; files: Map<string, string | number> }
  const root: N = { dirs: new Map(), files: new Map() };
  for (const [p, v] of Object.entries(spec)) {
    const parts = p.split('/');
    let n = root;
    for (const d of parts.slice(0, -1)) {
      if (!n.dirs.has(d)) n.dirs.set(d, { dirs: new Map(), files: new Map() });
      n = n.dirs.get(d)!;
    }
    n.files.set(parts[parts.length - 1], v);
  }
  const mk = (name: string, n: N): FsDir => ({
    name,
    kind: 'directory',
    async *children() {
      spies[name]?.();
      for (const [d, c] of n.dirs) yield mk(d, c);
      for (const [f, v] of n.files) {
        yield {
          name: f,
          kind: 'file',
          size: typeof v === 'number' ? v : v.length,
          lastModified: 1,
          text: async () => (typeof v === 'number' ? 'x'.repeat(0) : v),
        } satisfies FsFile;
      }
    },
  });
  return mk('repo', root);
}

describe('listRepo', () => {
  const spec: Spec = {
    'src/a.ts': 'x', 'node_modules/p/i.js': 'y', '.gitignore': 'gen/\n', 'gen/b.ts': 'z', 'big.js': 3_000_000,
  };
  test('skips vendor dirs, gitignored dirs and records too-large files', async () => {
    const l = await listRepo(tree(spec));
    expect(l.name).toBe('repo');
    expect(l.sources.map((e) => e.path)).toEqual(['src/a.ts']);
    expect(l.tooLarge).toEqual(['big.js']);
  });
  test('ignored dirs are never descended', async () => {
    const spies = { node_modules: vi.fn(), gen: vi.fn(), src: vi.fn() };
    await listRepo(tree(spec, spies));
    expect(spies.node_modules).not.toHaveBeenCalled();
    expect(spies.gen).not.toHaveBeenCalled();
    expect(spies.src).toHaveBeenCalled();
  });
  test('classifies configs and honours nested gitignore path', async () => {
    const l = await listRepo(tree({ 'package.json': '{}', 'a/tsconfig.json': '{}', 'a/b.php': 'p', 'a/readme.md': 'r' }));
    expect(l.configs.map((e) => e.path).sort()).toEqual(['a/tsconfig.json', 'package.json']);
    expect(l.sources.map((e) => e.path)).toEqual(['a/b.php']);
  });
});

describe('forLang', () => {
  test('keeps only the chosen language, drops gradle scripts, keeps Package.swift and the php/ts pair', async () => {
    const listing = await listRepo(tree({
      'Package.swift': '', 'Sources/A.swift': '', 'app/B.kt': '', 'build.gradle.kts': '', 'x.php': '', 'y.ts': '', 'z.py': '',
    }));
    const paths = (lang: Parameters<typeof forLang>[1]) => forLang(listing, lang).sources.map((e) => e.path).sort();
    expect(paths('swift')).toEqual(['Package.swift', 'Sources/A.swift']);
    expect(paths('kotlin')).toEqual(['app/B.kt']);
    expect(paths('ts')).toEqual(['x.php', 'y.ts']);
    expect(paths('php')).toEqual(['x.php', 'y.ts']);
  });
});

describe('forLangs', () => {
  test('keeps every listed language, drops gradle scripts, and keeps the php/ts pair', async () => {
    const listing = await listRepo(tree({
      'build.gradle.kts': '', 'app/B.kt': '', 'a.py': '', 'b.go': '', 'x.php': '', 'y.ts': '', 'run.sh': '',
    }));
    const paths = (langs: Parameters<typeof forLangs>[1]) => forLangs(listing, langs).sources.map((e) => e.path).sort();
    expect(paths(['py', 'go'])).toEqual(['a.py', 'b.go']);
    expect(paths(['php'])).toEqual(['x.php', 'y.ts']);
    expect(paths(['kotlin'])).toEqual(['app/B.kt']);
  });
});

describe('adapters', () => {
  test('readEntries batching', async () => {
    const mkFile = (name: string) => ({
      name, isFile: true, isDirectory: false,
      file: (ok: (f: File) => void) => ok(new File(['x'], name)),
    });
    const all = Array.from({ length: 250 }, (_, i) => mkFile(`f${i}.ts`));
    const dir = {
      name: 'r', isFile: false, isDirectory: true,
      createReader: () => {
        let pos = 0;
        return {
        readEntries(ok: (e: unknown[]) => void) {
          const batch = all.slice(pos, pos + 100);
          pos += 100;
          ok(batch);
        },
        };
      },
    };
    const l = await listRepo(fromEntry(dir as never));
    expect(l.sources).toHaveLength(250);
  });

  test('fromDirectoryHandle wraps handles', async () => {
    const fileHandle = (name: string) => ({ kind: 'file', name, getFile: async () => new File(['hi'], name) });
    const h = {
      kind: 'directory', name: 'proj',
      async *values() {
        yield fileHandle('a.ts');
        yield { kind: 'directory', name: 'sub', async *values() { yield fileHandle('b.php'); } };
      },
    };
    const l = await listRepo(fromDirectoryHandle(h as never));
    expect(l.name).toBe('proj');
    expect(l.sources.map((e) => e.path).sort()).toEqual(['a.ts', 'sub/b.php']);
    expect(await l.sources[0].file.text()).toBe('hi');
  });

  test('a file whose getFile/file throws does not abort listing', async () => {
    const boom = { kind: 'file', name: 'bad.ts', getFile: async () => { throw new Error('denied'); } };
    const ok = { kind: 'file', name: 'ok.ts', getFile: async () => new File(['1'], 'ok.ts') };
    const h = { kind: 'directory', name: 'p', async *values() { yield boom; yield ok; } };
    const l = await listRepo(fromDirectoryHandle(h as never));
    expect(l.sources.map((e) => e.path)).toEqual(['bad.ts', 'ok.ts']);
    const r = await loadRepo(l);
    expect(r.files.map((f) => f.path)).toEqual(['ok.ts']);

    const badEntry = { name: 'bad.ts', isFile: true, isDirectory: false, file: (_: unknown, err: (e: Error) => void) => err(new Error('x')) };
    const dir = { name: 'r', isFile: false, isDirectory: true, createReader: () => { let d = false; return { readEntries: (cb: (e: unknown[]) => void) => { cb(d ? [] : [badEntry]); d = true; } }; } };
    const l2 = await listRepo(fromEntry(dir as never));
    expect(l2.sources).toHaveLength(1);
  });

  test('fromFileList builds tree from webkitRelativePath', async () => {
    const f = (p: string) => {
      const file = new File(['c'], p.split('/').pop()!);
      Object.defineProperty(file, 'webkitRelativePath', { value: p });
      return file;
    };
    const l = await listRepo(fromFileList([f('repo/src/a.ts'), f('repo/package.json')]));
    expect(l.name).toBe('repo');
    expect(l.sources.map((e) => e.path)).toEqual(['src/a.ts']);
    expect(l.configs.map((e) => e.path)).toEqual(['package.json']);
  });
});

describe('loadRepo', () => {
  const entry = (path: string, text: () => Promise<string>): Entry => ({
    path, size: 1, lastModified: 1,
    file: { name: path, kind: 'file', size: 1, lastModified: 1, text },
  });
  test('skips unreadable files and reports progress', async () => {
    const listing: Listing = {
      name: 'r', tooLarge: [],
      sources: [entry('a.ts', async () => 'A'), entry('b.ts', async () => { throw new Error('no'); })],
      configs: [entry('package.json', async () => '{}')],
    };
    const calls: [number, number][] = [];
    const r = await loadRepo(listing, (d, t) => calls.push([d, t]));
    expect(r.name).toBe('r');
    expect(r.files).toEqual([{ path: 'a.ts', text: 'A' }]);
    expect(r.configs).toEqual({ 'package.json': '{}' });
    expect(calls[calls.length - 1]).toEqual([3, 3]);
  });
});

test('isTooMany', () => {
  const mk = (n: number): Listing => ({ name: 'r', configs: [], tooLarge: [], sources: new Array(n).fill(null) });
  expect(isTooMany(mk(20001))).toBe(true);
  expect(isTooMany(mk(20000))).toBe(false);
});
