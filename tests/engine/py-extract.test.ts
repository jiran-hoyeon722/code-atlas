import { beforeAll, describe, expect, test } from 'vitest';
import type { Parser } from 'web-tree-sitter';
import { loadParsers } from '../../src/engine/parsers';
import { nodeLocate } from '../../src/engine/node';
import type { ProjectIndex } from '../../src/engine/link';
import { pyModule } from '../../src/engine/py/module';

let parser: Parser;
beforeAll(async () => {
  parser = (await loadParsers(nodeLocate, ['py'])).get('py');
});

const facts = (text: string, path = 'pkg/mod.py') => pyModule.extractFile(parser, { path, text });
const specs = (text: string) => facts(text).imports.map((i) => i.specifier);

function index(paths: string[]): ProjectIndex {
  return { paths: new Set(paths), configs: {}, byDir: new Map(), bySymbol: new Map(), facts: new Map() };
}

describe('pyModule.extractFile', () => {
  test('import statements keep dotted names and aliases drop out', () => {
    expect(specs('import a.b\nimport c.d as e, f')).toEqual(['a.b', 'c.d', 'f']);
  });

  test('from-imports join the module and each name, star keeps the module', () => {
    expect(specs('from x.y import n1, n2 as m\nfrom z import (p, q)\nfrom w import *')).toEqual([
      'x.y.n1', 'x.y.n2', 'z.p', 'z.q', 'w',
    ]);
  });

  test('relative imports keep their leading dots', () => {
    expect(specs('from . import a\nfrom .pkg import b\nfrom .. import c\nfrom ..core import d\nfrom . import *')).toEqual([
      '.a', '.pkg.b', '..c', '..core.d', '.',
    ]);
  });

  test('imports nested in functions count, __future__ does not', () => {
    expect(specs('from __future__ import annotations\ndef f():\n    import lazy\n')).toEqual(['lazy']);
  });

  test('every import is an import edge', () => {
    expect(facts('import a\nfrom b import c').imports.every((i) => i.kind === 'import')).toBe(true);
  });

  test('names and kinds', () => {
    expect(facts('', 'pkg/mod.py')).toMatchObject({ name: 'mod', kind: 'module' });
    expect(facts('', 'pkg/api/__init__.py')).toMatchObject({ name: 'api/__init__', kind: 'module' });
    expect(facts('', '__init__.py').name).toBe('__init__');
    expect(facts('', 'pkg/test_mod.py').kind).toBe('test');
    expect(facts('', 'pkg/mod_test.py').kind).toBe('test');
    expect(facts('', 'tests/helpers.py').kind).toBe('test');
    expect(facts('', 'pkg/tests/unit/helpers.py').kind).toBe('test');
    expect(facts('', 'pkg/contest.py').kind).toBe('module');
  });

  test('metrics and syntax errors', () => {
    const f = facts('def f(a):\n    if a and b:\n        return 1\n    g = lambda q: q\n    return 2 if a else 3\n');
    expect(f).toMatchObject({ functions: 2, complexity: 5, maxComplexity: 4, hasError: false, lines: 6 });
    expect(facts('def oops(:\n    pass\n').hasError).toBe(true);
  });

  test('no symbol links', () => {
    expect(pyModule.symbolLinks).toBe(false);
    expect(facts('import a')).toMatchObject({ scope: '', declares: [], mentions: [], wildcards: [] });
  });
});

describe('pyModule.resolveImport', () => {
  const idx = index([
    'app/__init__.py',
    'app/api/__init__.py',
    'app/api/views.py',
    'app/api/sibling.py',
    'app/core/__init__.py',
    'app/core/config.py',
    'app/models.py',
    'src/lib/__init__.py',
    'src/lib/tools.py',
  ]);
  const resolve = (spec: string, from = 'app/api/views.py') => pyModule.resolveImport(from, spec, idx);

  test('relative from-import picks the module file, else the package __init__', () => {
    expect(resolve('.sibling')).toEqual(['app/api/sibling.py']);
    expect(resolve('.helper_fn')).toEqual(['app/api/__init__.py']);
    expect(resolve('.')).toEqual(['app/api/__init__.py']);
  });

  test('each extra dot climbs one folder', () => {
    expect(resolve('..core.x')).toEqual(['app/core/__init__.py']);
    expect(resolve('..core.config')).toEqual(['app/core/config.py']);
    expect(resolve('..models.Item')).toEqual(['app/models.py']);
    expect(resolve('..')).toEqual(['app/__init__.py']);
  });

  test('missing relative modules are unresolved', () => {
    expect(resolve('.missing.thing')).toBeNull();
    expect(resolve('....too.far')).toBeNull();
  });

  test('absolute imports try the repo root, then src/', () => {
    expect(resolve('app.api.views')).toEqual(['app/api/views.py']);
    expect(resolve('app.api')).toEqual(['app/api/__init__.py']);
    expect(resolve('app.models.Item')).toEqual(['app/models.py']);
    expect(resolve('lib.tools.run')).toEqual(['src/lib/tools.py']);
    expect(resolve('lib')).toEqual(['src/lib/__init__.py']);
  });

  test('absolute imports that are not in the repo are external', () => {
    expect(resolve('requests')).toEqual([]);
    expect(resolve('os.path.join')).toEqual([]);
    expect(resolve('app.nothere.deep')).toEqual([]);
  });
});
