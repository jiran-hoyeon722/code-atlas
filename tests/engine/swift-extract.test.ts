import { beforeAll, describe, expect, test } from 'vitest';
import type { Parser } from 'web-tree-sitter';
import { loadParsers } from '../../src/engine/parsers';
import { nodeLocate } from '../../src/engine/node';
import { extractProject } from '../../src/engine/link';
import { swiftModule } from '../../src/engine/swift/module';

let parser: Parser;
beforeAll(async () => {
  parser = (await loadParsers(nodeLocate, ['swift'])).get('swift');
});

const facts = (text: string, path = 'Sources/Kit/A.swift') => swiftModule.extractFile(parser, { path, text });

describe('swiftModule.extractFile', () => {
  test('imports make no specifiers', () => {
    const f = facts('import UIKit\n@testable import Kit\nimport struct Foundation.Date\nstruct A {}\n');
    expect(f.imports).toEqual([]);
    expect(f.wildcards).toEqual([]);
  });

  test('scope is the SwiftPM target folder, else the whole project', () => {
    expect(facts('struct A {}', 'Sources/Kit/Models/A.swift').scope).toBe('Sources/Kit/');
    expect(facts('struct A {}', 'Tests/KitTests/ATests.swift').scope).toBe('Tests/KitTests/');
    expect(facts('struct A {}', 'Packages/Core/Sources/Core/A.swift').scope).toBe('Packages/Core/Sources/Core/');
    expect(facts('struct A {}', 'App/Models/A.swift').scope).toBe('');
    expect(facts('struct A {}', 'Sources/A.swift').scope).toBe('');
    expect(facts('struct A {}', 'Package.swift').scope).toBe('');
  });

  test('declares top-level classes, structs, enums, protocols, actors, type aliases and functions, not extensions or members', () => {
    const f = facts(
      'class A { class Nested {}; func member() {} }\nstruct S<X> {}\nenum E { case a }\nprotocol P { func req() }\nactor Act {}\ntypealias T = Int\nfunc top() {}\nextension A {}\nlet k = 1\n',
    );
    expect(f.declares).toEqual(['A', 'S', 'E', 'P', 'Act', 'T', 'top']);
  });

  test('mentions every type name, extended type, capitalised call and receiver, every occurrence', () => {
    const f = facts(
      [
        'import Kit',
        'extension Note: Printable {}',
        'final class A: Base, Api {',
        '  let m: [Key: [Item]] = [:]',
        '  var o: Outer.Inner? = Outer.Inner()',
        '  func f(r: Repo) -> Box<Item> {',
        '    Util.run(); let n = Const.max; local.go(); helper(); Util.stop()',
        '    let w = Widget(); let c = x as? Cell',
        '    return Box()',
        '  }',
        '}',
      ].join('\n'),
    );
    expect([...f.mentions].sort()).toEqual([
      'Api', 'Base', 'Box', 'Box', 'Cell', 'Const', 'Inner', 'Item', 'Item', 'Key', 'Note', 'Outer', 'Outer', 'Printable', 'Repo', 'Util', 'Util', 'Widget',
    ]);
  });

  test('names come from the file, kinds from the path and name', () => {
    expect(facts('struct Note {}', 'Sources/Kit/Models/Note.swift')).toMatchObject({ name: 'Note', kind: 'type' });
    expect(facts('extension Note {}', 'Sources/Kit/Note+Display.swift')).toMatchObject({ name: 'Note+Display', kind: 'type' });
    expect(facts('struct HomeView {}', 'App/Views/HomeView.swift')).toMatchObject({ name: 'HomeView', kind: 'view' });
    expect(facts('class HomeViewController {}', 'App/HomeViewController.swift').kind).toBe('view');
    expect(facts('class Review {}', 'App/Review.swift').kind).toBe('type');
    expect(facts('class Helper {}', 'Tests/KitTests/Helper.swift').kind).toBe('test');
    expect(facts('class Helper {}', 'App/Tests/Helper.swift').kind).toBe('test');
    expect(facts('class HomeViewTests {}', 'AppTests/HomeViewTests.swift').kind).toBe('test');
    expect(facts('class Contest {}', 'App/Contest.swift').kind).toBe('type');
  });

  test('metrics and syntax errors', () => {
    const f = facts(
      [
        'final class A {',
        '  init() {}',
        '  func f(a: Bool, b: Bool, o: Int?) -> Int {',
        '    if a && b { return 1 } else if a || b { return 2 }',
        '    guard let x = o else { return 0 }',
        '    for i in 0..<x { print(i) }',
        '    while a { break }',
        '    repeat {} while b',
        '    switch x {',
        '    case 1: return 1',
        '    default: return 3',
        '    }',
        '    do { try g() } catch { }',
        '    let t = a ? 1 : (o ?? 2)',
        '    let c = { (y: Int) in y }',
        '    return t + c(1)',
        '  }',
        '}',
      ].join('\n'),
    );
    expect(f).toMatchObject({ functions: 3, complexity: 16, maxComplexity: 14, hasError: false, lines: 18 });
    expect(facts('func f( {').hasError).toBe(true);
  });

  test('symbol links are on and imports never resolve', () => {
    expect(swiftModule.symbolLinks).toBe(true);
    expect(swiftModule.resolveImport('Sources/App/Main.swift', 'Kit', {} as never)).toEqual([]);
  });
});

describe('swift project linking', () => {
  const run = (files: Record<string, string>) => {
    const input = { name: 'toy', configs: {}, files: Object.entries(files).map(([path, text]) => ({ path, text })) };
    return extractProject('swift', swiftModule, input, { lang: 'swift', framework: null, sourceDir: '', routeDirs: [] }, { get: () => parser });
  };

  test('mentions link inside one target only; imports add nothing', () => {
    const x = run({
      'Sources/Kit/Note.swift': 'public struct Note {}\n',
      'Sources/Kit/Store.swift': 'import Foundation\npublic final class Store { var notes: [Note] = []; func add() { notes.append(Note()) } }\n',
      'Sources/App/Main.swift': 'import Kit\nlet store = Store()\nlet n: Note? = nil\n',
      'Tests/KitTests/StoreTests.swift': '@testable import Kit\nfinal class StoreTests { let s = Store() }\n',
      'App/Screen.swift': 'struct Screen { let h = Helper() }\n',
      'App/Helper.swift': 'struct Helper {}\n',
    });
    const got = x.edges.map((e) => [`${e.from}→${e.to}`, e.kinds]).sort();
    expect(got).toEqual([
      ['App/Screen.swift→App/Helper.swift', { 'class-ref': 1 }],
      ['Sources/Kit/Store.swift→Sources/Kit/Note.swift', { 'class-ref': 2 }],
    ]);
    expect(x.unresolved).toBe(0);
  });
});
