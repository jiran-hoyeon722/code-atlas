import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { loadParsers, type Parsers } from '../../src/engine/parsers';
import { nodeLocate } from '../../src/engine/node';
import { detect } from '../../src/engine/detect';
import { isConfigPath, isSourcePath } from '../../src/engine/collect';
import { extractTsFile } from '../../src/engine/ts/extract';
import { extractTsProject } from '../../src/engine/ts/project';
import type { Extraction, RepoInput } from '../../src/engine/types';

const ROOT = join(__dirname, '../fixtures/react-mini');

function walk(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel)).flatMap((n) => {
    const r = rel ? `${rel}/${n}` : n;
    return statSync(join(dir, r)).isDirectory() ? walk(dir, r) : [r];
  });
}

function loadFixture(): RepoInput {
  const input: RepoInput = { name: 'react-mini', files: [], configs: {} };
  for (const p of walk(ROOT)) {
    const text = readFileSync(join(ROOT, p), 'utf8');
    if (isConfigPath(p)) input.configs[p] = text;
    else if (isSourcePath(p)) input.files.push({ path: p, text });
  }
  return input;
}

let parsers: Parsers;
let result: Extraction;
const seen: string[] = [];

beforeAll(async () => {
  parsers = await loadParsers(nodeLocate, ['php', 'ts']);
  const input = loadFixture();
  const detection = detect(input)!;
  result = extractTsProject(input, detection, parsers, (p) => seen.push(p));
});

test('import kinds', () => {
  const src =
    "import type {A} from './a'; import {type B} from './b'; import C from './c'; export * from './d'; export type {E} from './e'; import('./f'); require('./g');";
  const r = extractTsFile(parsers.get('ts'), { path: 'x.ts', text: src });
  expect(r.imports.map((i) => i.kind)).toEqual([
    'type-import', 'type-import', 'import', 're-export', 'type-import', 'dynamic-import', 'require',
  ]);
  expect(r.imports.map((i) => i.specifier)).toEqual(['./a', './b', './c', './d', './e', './f', './g']);
  expect(r.hasError).toBe(false);
});

test('other import shapes', () => {
  const src =
    "import D, {type X} from './d'; import {type P, type Q} from './pq'; import './side'; export {x} from './y'; export * as ns from './n'; import r = require('./r'); import(`./${a}`); import(v); import {} from './empty';";
  const r = extractTsFile(parsers.get('ts'), { path: 'x.ts', text: src });
  expect(r.imports).toEqual([
    { specifier: './d', kind: 'import' },
    { specifier: './pq', kind: 'type-import' },
    { specifier: './side', kind: 'import' },
    { specifier: './y', kind: 're-export' },
    { specifier: './n', kind: 're-export' },
    { specifier: './r', kind: 'require' },
    { specifier: './empty', kind: 'import' },
  ]);
});

test('import() in type positions is a type import', () => {
  const src = [
    "type Shape = { size: Map<string, import('./size').Size>; tint?: import('./tint').Tint | null };",
    "interface Box { list: (x: import('./list').Item) => void }",
    "const later = import('./later');",
    "import('./then').then((m) => m.run());",
    "const v = await import('./awaited');",
  ].join('\n');
  const r = extractTsFile(parsers.get('ts'), { path: 'x.ts', text: src });
  expect(r.imports).toEqual([
    { specifier: './size', kind: 'type-import' },
    { specifier: './tint', kind: 'type-import' },
    { specifier: './list', kind: 'type-import' },
    { specifier: './later', kind: 'dynamic-import' },
    { specifier: './then', kind: 'dynamic-import' },
    { specifier: './awaited', kind: 'dynamic-import' },
  ]);
});

test('import() type followed by [] still counts as a type import', () => {
  const src = "export interface Store {\n  rows: import('./row').Row[]\n  pick: (r: import('./row').Row | null) => void\n}\n";
  const r = extractTsFile(parsers.get('ts'), { path: 'x.ts', text: src });
  expect(r.imports.map((i) => i.kind)).toEqual(['type-import', 'type-import']);
});

test('lines and complexity', () => {
  const r = extractTsFile(parsers.get('ts'), { path: 'x.ts', text: 'function f(a){\n if(a){}\n}\n' });
  expect(r).toMatchObject({ lines: 4, functions: 1, complexity: 2, maxComplexity: 2 });
});

test('alias edges in fixture', () => {
  const edge = (from: string, to: string) => result.edges.find((e) => e.from === from && e.to === to);
  expect(edge('src/components/users/hooks/useUsers.ts', 'src/services/userService.ts')).toEqual({
    from: 'src/components/users/hooks/useUsers.ts',
    to: 'src/services/userService.ts',
    weight: 1,
    kinds: { import: 1 },
  });
  expect(edge('src/components/users/UserList.tsx', 'src/types/user.ts')?.kinds).toEqual({ 'type-import': 1 });
  expect(edge('src/services/userService.ts', 'src/types/user.ts')?.kinds).toEqual({ 'type-import': 1 });
});

test('nodes: kinds, names, no css or package targets', () => {
  const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
  expect(byId['src/components/ui/button.tsx']).toMatchObject({ kind: 'component', name: 'button' });
  expect(byId['src/services/userService.ts']).toMatchObject({ kind: 'module', name: 'userService' });
  expect(result.edges.every((e) => e.to in byId && e.from !== e.to)).toBe(true);
  expect(result.edges.some((e) => e.to.endsWith('.css'))).toBe(false);
});

test('generated files excluded', () => {
  expect(result.nodes.some((n) => n.id === 'src/routeTree.gen.ts')).toBe(false);
  expect(result.edges.some((e) => e.from === 'src/routeTree.gen.ts' || e.to === 'src/routeTree.gen.ts')).toBe(false);
});

test('route refs', () => {
  expect(result.routeRefs['src/components/users/UserList.tsx']['src/routes/index.tsx']).toBe(1);
});

test('unresolved counts only local specifiers', () => {
  // './missing' counts; 'react', 'jotai' and './styles.css' (asset) do not.
  expect(result.unresolved).toBe(1);
});

test('asset imports with a query or hash are not unresolved', () => {
  const input: RepoInput = {
    name: 'q',
    files: [{ path: 'src/a.ts', text: "import Logo from './logo.svg?react'; import u from './pic.png?url'; import f from './font.woff2#x'; import m from './gone';" }],
    configs: { 'package.json': '{"dependencies":{"react":"1"}}' },
  };
  expect(extractTsProject(input, detect(input)!, parsers).unresolved).toBe(1);
});

test('syntax error recorded', () => {
  expect(result.failed).toContainEqual({ path: 'src/broken.js', reason: 'syntax' });
});

test('onFile is called once per processed file', () => {
  expect(seen.sort()).toEqual(result.nodes.map((n) => n.id).sort());
});

describe('naming', () => {
  test('index, d.ts and test kinds', () => {
    const input: RepoInput = {
      name: 't',
      configs: {},
      files: [
        { path: 'src/ui/index.ts', text: '' },
        { path: 'src/types.d.ts', text: '' },
        { path: 'src/a.test.ts', text: '' },
        { path: 'src/gen.gen.tsx', text: '' },
        { path: 'other/z.ts', text: '' },
      ],
    };
    const r = extractTsProject(input, { lang: 'ts', framework: 'react', sourceDir: 'src', routeDirs: [] }, parsers);
    expect(r.nodes.map((n) => [n.id, n.name, n.kind])).toEqual([
      ['src/a.test.ts', 'a.test', 'test'],
      ['src/types.d.ts', 'types', 'types'],
      ['src/ui/index.ts', 'ui/index', 'module'],
    ]);
  });
});
