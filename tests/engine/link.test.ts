import { describe, expect, test } from 'vitest';
import type { Parser } from 'web-tree-sitter';
import type { Detection } from '../../src/engine/detect';
import type { Parsers } from '../../src/engine/parsers';
import { extractProject, type FileFacts, type LangModule } from '../../src/engine/link';
import type { RepoInput } from '../../src/engine/types';

// Toy language (.py paths): `import X`, `scope S`, `open S`, `decl N`, `use N`, `boom`, `broken`.
function toyFacts(path: string, text: string): FileFacts {
  const facts: FileFacts = {
    name: path.split('/').pop()!.replace(/\.[^.]+$/, ''), kind: 'module',
    imports: [], scope: '', declares: [], mentions: [], wildcards: [],
    hasError: false, lines: text.split('\n').length, functions: 0, complexity: 0, maxComplexity: 0,
  };
  for (const line of text.split('\n')) {
    const [word, arg] = line.trim().split(/\s+/);
    if (word === 'boom') throw new Error('boom');
    if (word === 'broken') facts.hasError = true;
    if (word === 'import') facts.imports.push({ specifier: arg, kind: 'import' });
    if (word === 'scope') facts.scope = arg;
    if (word === 'open') facts.wildcards.push(arg);
    if (word === 'decl') facts.declares.push(arg);
    if (word === 'use') facts.mentions.push(arg);
  }
  return facts;
}

const toy = (symbolLinks = true): LangModule => ({
  extractFile: (_parser, file) => toyFacts(file.path, file.text),
  resolveImport(_from, specifier, index) {
    if (specifier.startsWith('ext:')) return [];
    if (specifier.startsWith('dir:')) return index.byDir.get(specifier.slice(4)) ?? null;
    const path = `${specifier}.py`;
    return index.paths.has(path) ? [path] : null;
  },
  symbolLinks,
});

const detection: Detection = { lang: 'py', framework: null, sourceDir: '', routeDirs: [] };
const parsers: Parsers = { get: () => ({}) as Parser };

function repo(files: Record<string, string>): RepoInput {
  return { name: 'toy', configs: {}, files: Object.entries(files).map(([path, text]) => ({ path, text })) };
}

const run = (files: Record<string, string>, mod = toy()) => extractProject('py', mod, repo(files), detection, parsers);
const pairs = (x: ReturnType<typeof run>) => x.edges.map((e) => `${e.from}→${e.to}`).sort();

describe('extractProject', () => {
  test('imports become weighted edges and self-imports are dropped', () => {
    const x = run({ 'a.py': 'import b\nimport b\nimport a', 'b.py': '' });
    expect(x.edges).toEqual([{ from: 'a.py', to: 'b.py', weight: 2, kinds: { import: 2 } }]);
    expect(x.unresolved).toBe(0);
    expect(x.routeRefs).toEqual({});
    expect(x.nodes.map((n) => n.id)).toEqual(['a.py', 'b.py']);
  });

  test('null counts as unresolved, [] is ignored', () => {
    const x = run({ 'a.py': 'import missing\nimport ext:lib' });
    expect(x.unresolved).toBe(1);
    expect(x.edges).toEqual([]);
  });

  test('one import can fan out to several files', () => {
    const x = run({ 'a.py': 'import dir:p', 'p/x.py': '', 'p/y.py': '' });
    expect(pairs(x)).toEqual(['a.py→p/x.py', 'a.py→p/y.py']);
  });

  test('mentions link only inside the same scope or an opened wildcard', () => {
    const files = {
      'a.py': 'scope app\nopen lib\nuse Same\nuse Same\nuse Lib\nuse Far\nuse Self\ndecl Self',
      'same.py': 'scope app\ndecl Same',
      'lib.py': 'scope lib\ndecl Lib',
      'far.py': 'scope far\ndecl Far',
    };
    const x = run(files);
    expect(pairs(x)).toEqual(['a.py→lib.py', 'a.py→same.py']);
    expect(x.edges.find((e) => e.to === 'same.py')).toMatchObject({ weight: 2, kinds: { 'class-ref': 2 } });
    expect(run(files, toy(false)).edges).toEqual([]);
  });

  test('a name declared twice in one file is indexed once', () => {
    const x = run({ 'a.py': 'use X', 'b.py': 'decl X\ndecl X' });
    expect(x.edges).toEqual([{ from: 'a.py', to: 'b.py', weight: 1, kinds: { 'class-ref': 1 } }]);
  });

  test('a file that throws is kept as a node and reported as read failure', () => {
    const seen: string[] = [];
    let linked = 0;
    const x = extractProject('py', toy(), repo({ 'a.py': 'boom\nx', 'b.py': 'broken\nimport a' }), detection, parsers, (p) => seen.push(p), () => linked++);
    expect(x.nodes).toEqual([
      { id: 'a.py', name: 'a', kind: 'module', lines: 2, functions: 0, complexity: 0, maxComplexity: 0 },
      { id: 'b.py', name: 'b', kind: 'module', lines: 2, functions: 0, complexity: 0, maxComplexity: 0 },
    ]);
    expect(x.failed).toEqual([{ path: 'a.py', reason: 'read' }, { path: 'b.py', reason: 'syntax' }]);
    expect(pairs(x)).toEqual(['b.py→a.py']);
    expect(seen).toEqual(['a.py', 'b.py']);
    expect(linked).toBe(1);
  });
});
