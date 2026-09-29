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

  test('3,000-statement unnamespaced file extracts correctly', () => {
    const facts = extractPhpFile(parsers.php, bigFile(3000), false);
    expect(facts.refs.filter((r) => r.fqcn === 'Lib\\Thing0')).toHaveLength(429);
    expect(facts.refs.some((r) => r.fqcn === 'Thing1')).toBe(true);
  }, 30_000);

  // Absolute thresholds flake under machine load, so assert growth instead: 4x the input must cost
  // well under 16x (quadratic) the time. The 30s test timeout is only a hang guard.
  test('extraction time grows ~linearly with file size', () => {
    const small = bigFile(3000);
    const large = bigFile(12000);
    const minMs = (file: { path: string; text: string }) => {
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        extractPhpFile(parsers.php, file, false);
        best = Math.min(best, performance.now() - start);
      }
      return best;
    };
    extractPhpFile(parsers.php, small, false); // warm-up
    const t3k = minMs(small);
    const t12k = minMs(large);
    expect(t12k / t3k).toBeLessThan(8);
  }, 30_000);
});
