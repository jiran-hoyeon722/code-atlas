import { beforeAll, describe, expect, test } from 'vitest';
import type { Parser } from 'web-tree-sitter';
import { loadParsers } from '../../src/engine/parsers';
import { nodeLocate } from '../../src/engine/node';
import type { FileFacts, ProjectIndex } from '../../src/engine/link';
import { javaModule } from '../../src/engine/java/module';
import { resolveJvmImport } from '../../src/engine/jvm/resolve';

let parser: Parser;
beforeAll(async () => {
  parser = (await loadParsers(nodeLocate, ['java'])).get('java');
});

const facts = (text: string, path = 'src/main/java/a/b/A.java') => javaModule.extractFile(parser, { path, text });

function index(files: Record<string, { scope: string; declares: string[] }>, threw: string[] = []): ProjectIndex {
  const bySymbol = new Map<string, string[]>();
  const all = new Map<string, FileFacts>();
  for (const [path, f] of Object.entries(files)) {
    all.set(path, { name: '', kind: 'class', imports: [], mentions: [], wildcards: [], hasError: false, lines: 1, functions: 0, complexity: 0, maxComplexity: 0, ...f });
    for (const name of f.declares) bySymbol.set(name, [...(bySymbol.get(name) ?? []), path]);
  }
  const paths = [...Object.keys(files), ...threw];
  return { paths: new Set(paths), configs: {}, byDir: new Map(), bySymbol, facts: all };
}

describe('javaModule.extractFile', () => {
  test('package, imports, static and wildcard imports', () => {
    const f = facts(
      'package a.b;\n\nimport x.y.C;\nimport x.y.Outer.Inner;\nimport x.z.*;\nimport static x.y.C.run;\nimport static x.y.D.*;\nimport java.util.List;\n\nclass A {}\n',
    );
    expect(f.scope).toBe('a.b');
    expect(f.imports).toEqual([
      { specifier: 'x.y.C', kind: 'import' },
      { specifier: 'x.y.Outer.Inner', kind: 'import' },
      { specifier: 'x.z.*', kind: 'import' },
      { specifier: 'x.y.C.run', kind: 'import' },
      { specifier: 'x.y.D', kind: 'import' },
      { specifier: 'java.util.List', kind: 'import' },
    ]);
    expect(f.wildcards).toEqual(['x.z']);
  });

  test('no package means the default scope', () => {
    expect(facts('class A {}').scope).toBe('');
  });

  test('declares only top-level types of every kind', () => {
    const f = facts('package a;\nclass A { class Nested {} }\ninterface I {}\nenum E { X }\nrecord R(int x) {}\n@interface Ann {}\n');
    expect(f.declares).toEqual(['A', 'I', 'E', 'R', 'Ann']);
  });

  test('mentions every type name and capitalised call/field receivers, once each', () => {
    const f = facts(
      'package a;\nclass A extends Base implements Api {\n  Map<Key, List<Item>> m;\n  Outer.Inner x = new Outer.Inner();\n  void f() { Util.run(); int n = Const.MAX; local.go(); x.y.Z.go(); Util.stop(); }\n}\n',
    );
    expect([...f.mentions].sort()).toEqual(['Api', 'Base', 'Const', 'Inner', 'Item', 'Key', 'List', 'Map', 'Outer', 'Util']);
  });

  test('names and kinds', () => {
    expect(facts('class Order {}', 'src/main/java/a/Order.java')).toMatchObject({ name: 'Order', kind: 'class' });
    expect(facts('interface Repo {}', 'src/main/java/a/Repo.java')).toMatchObject({ name: 'Repo', kind: 'interface' });
    expect(facts('interface A {}\nclass B {}', 'src/main/java/a/A.java').kind).toBe('class');
    expect(facts('enum E { X }', 'E.java').kind).toBe('class');
    expect(facts('interface Fixture {}', 'src/test/java/a/Fixture.java').kind).toBe('test');
    expect(facts('class Helper {}', 'mod/src/test/java/a/Helper.java').kind).toBe('test');
    expect(facts('class OrderTest {}', 'src/main/java/a/OrderTest.java')).toMatchObject({ name: 'OrderTest', kind: 'test' });
    expect(facts('class OrderTests {}', 'OrderTests.java').kind).toBe('test');
    expect(facts('class Contest {}', 'src/main/java/a/Contest.java').kind).toBe('class');
  });

  test('metrics and syntax errors', () => {
    const f = facts('class A {\n  int f(boolean a, boolean b) {\n    if (a && b) return 1;\n    Runnable r = () -> {};\n    return a ? 1 : 2;\n  }\n}\n');
    expect(f).toMatchObject({ functions: 2, complexity: 5, maxComplexity: 4, hasError: false, lines: 8 });
    expect(facts('class A { void f( }').hasError).toBe(true);
  });

  test('symbol links are on', () => {
    expect(javaModule.symbolLinks).toBe(true);
  });
});

describe('resolveJvmImport', () => {
  const idx = index(
    {
      'shop/Order.java': { scope: 'com.acme.shop', declares: ['Order'] },
      'shop/Money.java': { scope: 'com.acme.shop', declares: ['Money'] },
      'other/Order.java': { scope: 'com.acme.other', declares: ['Order'] },
      'Loose.java': { scope: '', declares: ['Loose'] },
    },
    ['shop/Broken.java'],
  );
  (idx.bySymbol as Map<string, string[]>).set('Broken', ['shop/Broken.java']);
  const resolve = (spec: string) => resolveJvmImport(spec, idx);

  test('wildcard, static and nested-class imports all reach the declaring file', () => {
    expect(resolve('com.acme.shop.Order')).toEqual(['shop/Order.java']);
    expect(resolve('com.acme.shop.Money.round')).toEqual(['shop/Money.java']);
    expect(resolve('com.acme.shop.Order.Line')).toEqual(['shop/Order.java']);
    expect(resolve('com.acme.shop.Order.Line.Part')).toEqual(['shop/Order.java']);
    expect(resolve('com.acme.other.Order')).toEqual(['other/Order.java']);
    expect(resolve('com.acme.shop.*')).toEqual([]);
  });

  test('missing classes under a project package are unresolved; JDK and libraries are outside', () => {
    expect(resolve('com.acme.shop.Missing')).toBeNull();
    expect(resolve('com.acme.shop.sub.Deep')).toBeNull();
    expect(resolve('java.util.List')).toEqual([]);
    expect(resolve('com.acme.shopping.Cart')).toEqual([]);
    expect(resolve('org.lib.Order')).toEqual([]);
  });

  test('files that threw are skipped; the default package opens no scope', () => {
    expect(resolve('com.acme.shop.Broken')).toBeNull();
    expect(resolve('Loose')).toEqual([]);
    expect(resolve('x.Loose')).toEqual([]);
  });
});
