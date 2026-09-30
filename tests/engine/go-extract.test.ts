import { beforeAll, describe, expect, test } from 'vitest';
import type { Parser } from 'web-tree-sitter';
import { loadParsers } from '../../src/engine/parsers';
import { nodeLocate } from '../../src/engine/node';
import type { ProjectIndex } from '../../src/engine/link';
import { goModule } from '../../src/engine/go/module';

let parser: Parser;
beforeAll(async () => {
  parser = (await loadParsers(nodeLocate, ['go'])).get('go');
});

const facts = (text: string, path = 'pkg/a/a.go') => goModule.extractFile(parser, { path, text });
const specs = (text: string) => facts(text).imports.map((i) => i.specifier);

function index(paths: string[], configs: Record<string, string>): ProjectIndex {
  const byDir = new Map<string, string[]>();
  for (const p of paths) {
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    byDir.set(dir, [...(byDir.get(dir) ?? []), p]);
  }
  return { paths: new Set(paths), configs, byDir, bySymbol: new Map(), facts: new Map() };
}

describe('goModule.extractFile', () => {
  test('single, grouped, aliased, blank, dot and raw-string imports keep only the path', () => {
    const text = 'package a\n\nimport "fmt"\nimport (\n\tx "ex.com/m/b"\n\t_ "ex.com/m/c"\n\t. "ex.com/m/d"\n\t`ex.com/m/e`\n)\n';
    expect(specs(text)).toEqual(['fmt', 'ex.com/m/b', 'ex.com/m/c', 'ex.com/m/d', 'ex.com/m/e']);
  });

  test('every import is an import edge', () => {
    expect(facts('package a\nimport ("a"; "b")').imports.every((i) => i.kind === 'import')).toBe(true);
  });

  test('names and kinds', () => {
    expect(facts('package a', 'pkg/a/order.go')).toMatchObject({ name: 'order', kind: 'module' });
    expect(facts('package main', 'cmd/app/main.go')).toMatchObject({ name: 'main', kind: 'main' });
    expect(facts('package a', 'pkg/a/order_test.go')).toMatchObject({ name: 'order_test', kind: 'test' });
    expect(facts('package main', 'cmd/app/main_test.go').kind).toBe('test');
    expect(facts('package mainly', 'x/y.go').kind).toBe('module');
  });

  test('metrics and syntax errors', () => {
    const f = facts('package a\n\nfunc f(a, b bool) int {\n\tif a && b {\n\t\treturn 1\n\t}\n\tg := func() {}\n\tg()\n\treturn 2\n}\n');
    expect(f).toMatchObject({ functions: 2, complexity: 4, maxComplexity: 3, hasError: false, lines: 11 });
    expect(facts('package a\nfunc oops( {\n').hasError).toBe(true);
  });

  test('no symbol links', () => {
    expect(goModule.symbolLinks).toBe(false);
    expect(facts('package a\nimport "b"')).toMatchObject({ scope: '', declares: [], mentions: [], wildcards: [] });
  });
});

describe('goModule.resolveImport', () => {
  const idx = index(
    [
      'main.go',
      'internal/svc/a.go',
      'internal/svc/b.go',
      'internal/svc/a_test.go',
      'internal/only/x_test.go',
      'hack/tools/lint/lint.go',
      'hack/lint/wrong.go',
    ],
    {
      'go.mod': '// root\nmodule example.com/mini // trailing\n\ngo 1.22\n',
      'hack/tools/go.mod': 'module "example.com/mini/tools"\n',
      'package.json': '{}',
    },
  );
  const resolve = (spec: string, from = 'main.go') => goModule.resolveImport(from, spec, idx);

  test('a module import points at every non-test file in the package folder', () => {
    expect(resolve('example.com/mini/internal/svc')).toEqual(['internal/svc/a.go', 'internal/svc/b.go']);
    expect(resolve('example.com/mini')).toEqual(['main.go']);
  });

  test('external and std imports are not unresolved; the longest module path wins', () => {
    expect(resolve('fmt')).toEqual([]);
    expect(resolve('net/http')).toEqual([]);
    expect(resolve('github.com/x/y')).toEqual([]);
    expect(resolve('example.com/minimal/z')).toEqual([]);
    expect(resolve('example.com/mini/tools/lint')).toEqual(['hack/tools/lint/lint.go']);
  });

  test('a folder inside a module with no non-test files is unresolved', () => {
    expect(resolve('example.com/mini/internal/missing')).toBeNull();
    expect(resolve('example.com/mini/internal/only')).toBeNull();
    expect(resolve('example.com/mini/tools/nope')).toBeNull();
  });

  test('without go.mod every import is outside the project', () => {
    expect(goModule.resolveImport('main.go', 'example.com/mini/internal/svc', index(['internal/svc/a.go'], {}))).toEqual([]);
  });
});
