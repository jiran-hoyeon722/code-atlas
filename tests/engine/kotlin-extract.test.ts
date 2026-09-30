import { beforeAll, describe, expect, test } from 'vitest';
import type { Parser } from 'web-tree-sitter';
import { loadParsers } from '../../src/engine/parsers';
import { nodeLocate } from '../../src/engine/node';
import { extractProject } from '../../src/engine/link';
import { kotlinModule } from '../../src/engine/kotlin/module';

let parser: Parser;
beforeAll(async () => {
  parser = (await loadParsers(nodeLocate, ['kotlin'])).get('kotlin');
});

const facts = (text: string, path = 'src/main/kotlin/a/b/A.kt') => kotlinModule.extractFile(parser, { path, text });

describe('kotlinModule.extractFile', () => {
  test('package, imports, aliases and wildcards', () => {
    const f = facts(
      '@file:JvmName("X")\npackage a.b\n\nimport x.y.C\nimport x.y.foo as bar\nimport x.z.*\nimport x.y.Outer.Inner\nimport kotlin.collections.List\n\nclass A\n',
    );
    expect(f.scope).toBe('a.b');
    expect(f.imports).toEqual([
      { specifier: 'x.y.C', kind: 'import' },
      { specifier: 'x.y.foo', kind: 'import' },
      { specifier: 'x.z.*', kind: 'import' },
      { specifier: 'x.y.Outer.Inner', kind: 'import' },
      { specifier: 'kotlin.collections.List', kind: 'import' },
    ]);
    expect(f.wildcards).toEqual(['x.z']);
  });

  test('no package means the default scope', () => {
    expect(facts('fun f() = 1').scope).toBe('');
  });

  test('declares top-level classes, objects, interfaces, type aliases and functions, not members or properties', () => {
    const f = facts(
      'package a\nclass A { class Nested; fun member() {} }\ndata class D(val x: Int)\nenum class E { X }\nsealed interface S\nfun interface F { fun f() }\nobject O { fun inObject() {} }\ntypealias T = Int\nfun topLevel() {}\nfun String.ext() = 1\nval prop = 1\n',
    );
    expect(f.declares).toEqual(['A', 'D', 'E', 'S', 'F', 'O', 'T', 'topLevel', 'ext']);
  });

  test('mentions every type name, call name and capitalised receiver, every occurrence', () => {
    const f = facts(
      'package a\nclass A(val r: Repo?) : Base(), Api {\n  val m: Map<Key, List<Item>> = mapOf()\n  val o: x.Outer.Inner = Outer.Inner()\n  fun f() { Util.run(); val n = Const.MAX; local.go(); x.y.Z.go(); Util.stop(); helper(); val c = Widget() }\n}\n',
    );
    expect([...f.mentions].sort()).toEqual([
      'Api', 'Base', 'Const', 'Inner', 'Item', 'Key', 'List', 'Map', 'Outer', 'Outer', 'Repo', 'Util', 'Util', 'Widget', 'helper', 'mapOf', 'x',
    ]);
  });

  test('names come from the file, kinds from what it declares', () => {
    expect(facts('class Note\nclass Tag\nfun empty() = Note()', 'src/main/kotlin/a/Models.kt')).toMatchObject({ name: 'Models', kind: 'class' });
    expect(facts('interface Repo', 'src/main/kotlin/a/Repo.kt')).toMatchObject({ name: 'Repo', kind: 'interface' });
    expect(facts('interface A\nclass B', 'A.kt').kind).toBe('class');
    expect(facts('object O', 'O.kt').kind).toBe('class');
    expect(facts('fun f() = 1', 'src/main/kotlin/a/Strings.kt')).toMatchObject({ name: 'Strings', kind: 'module' });
    expect(facts('println(1)', 'tools/run.main.kts')).toMatchObject({ name: 'run.main', kind: 'module' });
    expect(facts('class Helper', 'src/test/kotlin/a/Helper.kt').kind).toBe('test');
    expect(facts('class Helper', 'app/src/androidTest/kotlin/a/Helper.kt').kind).toBe('test');
    expect(facts('class NoteTest', 'src/main/kotlin/a/NoteTest.kt')).toMatchObject({ name: 'NoteTest', kind: 'test' });
    expect(facts('class NoteTests', 'NoteTests.kt').kind).toBe('test');
    expect(facts('class Contest', 'src/main/kotlin/a/Contest.kt').kind).toBe('class');
  });

  test('metrics and syntax errors', () => {
    const f = facts(
      'class A {\n  constructor(x: Int)\n  fun f(a: Boolean, b: Boolean?): Int {\n    if (a && b == true) return 1\n    val g = { x: Int -> x }\n    return when { a -> 1; else -> (b ?: false).hashCode() }\n  }\n}\n',
    );
    expect(f).toMatchObject({ functions: 3, complexity: 8, maxComplexity: 6, hasError: false, lines: 9 });
    expect(facts('fun f( {').hasError).toBe(true);
  });

  test('symbol links are on', () => {
    expect(kotlinModule.symbolLinks).toBe(true);
  });
});

describe('kotlin project linking', () => {
  const run = (files: Record<string, string>) => {
    const input = { name: 'toy', configs: {}, files: Object.entries(files).map(([path, text]) => ({ path, text })) };
    return extractProject('kotlin', kotlinModule, input, { lang: 'kotlin', framework: null, sourceDir: '', routeDirs: [] }, { get: () => parser });
  };

  test('top-level function imports, aliases, wildcards and same-package calls reach the declaring file', () => {
    const x = run({
      'a/b/Util.kt': 'package a.b\nfun helper() = 1\nclass Box\n',
      'a/b/Shapes.kt': 'package a.b\nclass Circle\nclass Square\nfun unit() = Square()\n',
      'a/c/Other.kt': 'package a.c\nclass Other\n',
      'a/b/Same.kt': 'package a.b\nfun same() = unit()\n',
      'x/User.kt': 'package x\nimport a.b.helper\nimport a.c.Other as O\nimport a.b.*\nimport a.b.Missing\nimport kotlin.collections.List\nclass User { val c: Circle = Circle(); val o = O() }\n',
    });
    const got = x.edges.map((e) => [`${e.from}→${e.to}`, e.kinds]).sort();
    expect(got).toEqual([
      ['a/b/Same.kt→a/b/Shapes.kt', { 'class-ref': 1 }],
      ['x/User.kt→a/b/Shapes.kt', { 'class-ref': 2 }],
      ['x/User.kt→a/b/Util.kt', { import: 1 }],
      ['x/User.kt→a/c/Other.kt', { import: 1 }],
    ]);
    expect(x.unresolved).toBe(1);
  });

  test('gradle build scripts are not analysed', () => {
    const x = run({ 'build.gradle.kts': 'plugins { }\n', 'settings.gradle.kts': '', 'lib/deps.gradle.kts': '', 'a/A.kt': 'class A\n', 'tools/gen.main.kts': 'println(1)\n' });
    expect(x.nodes.map((n) => n.id)).toEqual(['a/A.kt', 'tools/gen.main.kts']);
  });
});
