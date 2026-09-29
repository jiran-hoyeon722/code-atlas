import { beforeAll, describe, expect, test } from 'vitest';
import type { Node } from 'web-tree-sitter';
import { loadParsers, type Parsers } from '../../src/engine/parsers';
import { nodeLocate } from '../../src/engine/node';
import { resolveClassName, scopeAt } from '../../src/engine/php/names';
import { extractPhpFile } from '../../src/engine/php/extract';

let parsers: Parsers;
beforeAll(async () => {
  parsers = await loadParsers(nodeLocate);
});

function find(n: Node, type: string, text?: string): Node {
  const stack = [n];
  while (stack.length) {
    const c = stack.shift()!;
    if (c.type === type && (text === undefined || c.childForFieldName('name')?.text === text)) return c;
    stack.push(...(c.children.filter(Boolean) as Node[]));
  }
  throw new Error(`no ${type}`);
}

function scopeOf(src: string, className: string) {
  const root = parsers.php.parse(src)!.rootNode;
  return scopeAt(root, find(root, 'class_declaration', className));
}

const src =
  '<?php namespace App\\X; use App\\Models\\User; use App\\Data\\{A, B as Bee}; use function App\\h; class C {}';

describe('resolveClassName', () => {
  test.each([
    ['User', 'App\\Models\\User'],
    ['Bee', 'App\\Data\\B'],
    ['A', 'App\\Data\\A'],
    ['\\Other\\Z', 'Other\\Z'],
    ['namespace\\Y', 'App\\X\\Y'],
    ['Local', 'App\\X\\Local'],
    ['User\\Sub', 'App\\Models\\User\\Sub'],
    ['user', 'App\\Models\\User'],
    ['self', ''],
    ['Static', ''],
    ['parent', ''],
  ])('resolves %s', (raw, fq) => {
    expect(resolveClassName(raw, scopeOf(src, 'C'))).toBe(fq);
  });
});

describe('scope building', () => {
  test('use function / use const go to their own maps', () => {
    const s = scopeOf('<?php namespace N; use function A\\h; use const A\\K as Q; use A\\{function f, const G, H}; class C {}', 'C');
    expect(s.functions.get('h')).toBe('A\\h');
    expect(s.functions.get('f')).toBe('A\\f');
    expect(s.consts.get('Q')).toBe('A\\K');
    expect(s.consts.get('G')).toBe('A\\G');
    expect([...s.classes.entries()]).toEqual([['h', 'A\\H']]);
  });

  test('leading backslash in use is ignored', () => {
    expect(resolveClassName('Bar', scopeOf('<?php use \\Foo\\Bar; class C {}', 'C'))).toBe('Foo\\Bar');
  });

  test('global namespace', () => {
    const s = scopeOf('<?php use Foo\\Bar; class C {}', 'C');
    expect(s.namespace).toBe('');
    expect(resolveClassName('Baz', s)).toBe('Baz');
    expect(resolveClassName('Bar', s)).toBe('Foo\\Bar');
    expect(resolveClassName('namespace\\Q', s)).toBe('Q');
  });

  test('bracketed namespaces keep separate scopes', () => {
    const code = '<?php namespace A { use X\\Y; class InA {} } namespace B { class C {} }';
    const inB = scopeOf(code, 'C');
    expect(inB.namespace).toBe('B');
    expect(resolveClassName('Y', inB)).toBe('B\\Y');
    const inA = scopeOf(code, 'InA');
    expect(resolveClassName('Y', inA)).toBe('X\\Y');
  });

  test('unbracketed namespaces scope uses until the next namespace', () => {
    const code = '<?php namespace A; use X\\Y; class InA {} namespace B; class InB {}';
    expect(resolveClassName('Y', scopeOf(code, 'InA'))).toBe('X\\Y');
    expect(resolveClassName('Y', scopeOf(code, 'InB'))).toBe('B\\Y');
  });
});

describe('scopeAt performance', () => {
  const bigFile = (n: number) => {
    const body = Array.from({ length: n }, (_, i) => `$v${i} = new Thing${i % 7}();`).join('\n');
    return { path: 'big.php', text: `<?php\nuse Lib\\Thing0;\n${body}\n` };
  };

  test('3,000-statement unnamespaced file extracts quickly', () => {
    const start = performance.now();
    const facts = extractPhpFile(parsers.php, bigFile(3000), false);
    expect(performance.now() - start).toBeLessThan(500);
    expect(facts.refs.filter((r) => r.fqcn === 'Lib\\Thing0')).toHaveLength(429);
    expect(facts.refs.some((r) => r.fqcn === 'Thing1')).toBe(true);
  });

  // 3,000 statements fit in 500ms even when quadratic; 12,000 separates O(n²) (~5s) from linear (~0.3s).
  test('12,000-statement unnamespaced file stays linear', () => {
    const start = performance.now();
    extractPhpFile(parsers.php, bigFile(12000), false);
    expect(performance.now() - start).toBeLessThan(1500);
  }, 30_000);
});
