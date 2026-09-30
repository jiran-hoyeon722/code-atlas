import { describe, expect, test } from 'vitest';
import { duplicationScores, findClones } from '../../../src/engine/battle/clones';
import { FOUR_STAR } from '../../../src/engine/battle/rules';

const block = (tag: string, n = 6) =>
  Array.from({ length: n }, (_, i) => `const ${tag}Value${i} = compute${tag}(input${i}, option${i});`);

const unique = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `let ${tag}_${i} = ${i};`);

const text = (...parts: string[][]) => parts.flat().join('\n');

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('findClones', () => {
  test('a 6-line block copied into two files is removable only in the second', () => {
    const shared = block('Shared');
    const r = findClones([
      { path: 'a.ts', text: text(unique('a', 2), shared) },
      { path: 'b.ts', text: text(shared, unique('b', 3)) },
    ]);
    const a = r.perFile.get('a.ts')!;
    const b = r.perFile.get('b.ts')!;
    expect(a.removable).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(b.removable).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0]);
    expect(a.clone).toEqual([0, 0, 1, 1, 1, 1, 1, 1]);
    expect(b.clone).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0]);
    expect(r.groups).toEqual([
      {
        id: 0,
        fragments: [
          { path: 'a.ts', start: 2, end: 7 },
          { path: 'b.ts', start: 0, end: 5 },
        ],
      },
    ]);
  });

  test('k copies leave k-1 copies removable', () => {
    const shared = block('Many', 8);
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((path, i) => ({
      path,
      text: text(unique(`f${i}`, 1), shared),
    }));
    const r = findClones(files);
    const removable = sum([...r.perFile.values()].map((f) => sum(f.removable)));
    expect(removable).toBe(3 * 8);
    expect(sum(r.perFile.get('a.ts')!.removable)).toBe(0);
  });

  test('5-line copies are not clones', () => {
    const shared = block('Short', 5);
    const r = findClones([
      { path: 'a.ts', text: text(shared) },
      { path: 'b.ts', text: text(shared) },
    ]);
    expect(r.groups).toEqual([]);
    expect(r.perFile.get('b.ts')!.removable).toEqual([0, 0, 0, 0, 0]);
    expect(r.perFile.get('b.ts')!.clone).toEqual([0, 0, 0, 0, 0]);
  });

  test('whitespace differences are normalized', () => {
    const shared = block('Ws');
    const messy = shared.map((l, i) => (i % 2 ? `\t\t${l.replace(/ /g, '   ')}  ` : `    ${l}`));
    const r = findClones([
      { path: 'a.ts', text: text(shared) },
      { path: 'b.ts', text: text(messy) },
    ]);
    expect(r.perFile.get('b.ts')!.removable).toEqual([1, 1, 1, 1, 1, 1]);
  });

  test('windows with fewer than 30 alphanumeric characters are ignored', () => {
    const noise = ['}', '}', '})', '};', '}', ']', '}', '}'];
    const r = findClones([
      { path: 'a.ts', text: text(noise) },
      { path: 'b.ts', text: text(noise) },
    ]);
    expect(r.groups).toEqual([]);
    expect(sum(r.perFile.get('b.ts')!.removable)).toBe(0);
  });

  test('blank lines do not break a clone and coordinates are code lines', () => {
    const shared = block('Gap');
    const gapped = [...shared.slice(0, 3), '', '   ', ...shared.slice(3)];
    const r = findClones([
      { path: 'a.ts', text: text(shared) },
      { path: 'b.ts', text: text([''], gapped, ['']) },
    ]);
    const b = r.perFile.get('b.ts')!;
    expect(b.removable).toEqual([1, 1, 1, 1, 1, 1]);
    expect(r.groups[0].fragments[1]).toEqual({ path: 'b.ts', start: 0, end: 5 });
  });

  test('a copy longer than one window is a single group spanning the whole copy', () => {
    const shared = block('Long', 8);
    const r = findClones([
      { path: 'a.ts', text: text(shared) },
      { path: 'b.ts', text: text(unique('b', 1), shared) },
    ]);
    expect(r.groups).toEqual([
      {
        id: 0,
        fragments: [
          { path: 'a.ts', start: 0, end: 7 },
          { path: 'b.ts', start: 1, end: 8 },
        ],
      },
    ]);
    expect(r.perFile.get('a.ts')!.clone).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(r.perFile.get('b.ts')!.removable).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  test('two separate copies are two groups, numbered by first appearance, none empty', () => {
    const first = block('First', 7);
    const second = block('Second', 9);
    const r = findClones([
      { path: 'a.ts', text: text(second, unique('a', 2), first) },
      { path: 'b.ts', text: text(first, unique('b', 2), second) },
    ]);
    expect(r.groups.map((g) => g.id)).toEqual([0, 1]);
    expect(r.groups.every((g) => g.fragments.length > 0)).toBe(true);
    expect(r.groups[0].fragments).toEqual([
      { path: 'a.ts', start: 0, end: 8 },
      { path: 'b.ts', start: 9, end: 17 },
    ]);
    expect(r.groups[1].fragments).toEqual([
      { path: 'a.ts', start: 11, end: 17 },
      { path: 'b.ts', start: 0, end: 6 },
    ]);
  });

  test('a repeat inside one file overlapping its first occurrence follows the same rule', () => {
    const line = 'total = accumulate(total, nextValueFromStream);';
    const r = findClones([{ path: 'a.ts', text: text(Array(8).fill(line)) }]);
    expect(r.perFile.get('a.ts')!.removable).toEqual([0, 1, 1, 1, 1, 1, 1, 1]);
    expect(r.perFile.get('a.ts')!.clone).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(r.groups).toEqual([{ id: 0, fragments: [{ path: 'a.ts', start: 0, end: 7 }] }]);
  });

  test('files without clones still get zero arrays; empty files are empty', () => {
    const r = findClones([
      { path: 'a.ts', text: text(unique('x', 3)) },
      { path: 'e.ts', text: '\n\n' },
    ]);
    expect(r.perFile.get('a.ts')).toEqual({ clone: [0, 0, 0], removable: [0, 0, 0] });
    expect(r.perFile.get('e.ts')).toEqual({ clone: [], removable: [] });
  });

  test('200k lines finish in a few seconds', () => {
    const files = [];
    for (let f = 0; f < 200; f++) {
      const rows: string[] = [];
      for (let i = 0; i < 1000; i++) {
        rows.push(i % 100 < 10 ? `shared.helper${i % 10}(alpha, beta, gamma);` : `file${f}.statement${i}(value${i});`);
      }
      files.push({ path: `src/f${String(f).padStart(3, '0')}.ts`, text: rows.join('\n') });
    }
    const t0 = performance.now();
    const r = findClones(files);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(5000);
    expect(r.perFile.size).toBe(200);
    expect(sum(r.perFile.get('src/f000.ts')!.removable)).toBe(90);
  }, 20_000);
});

describe('duplicationScores', () => {
  test('ratio of removable lines against the four-star limit', () => {
    const s = duplicationScores(46, 1000);
    expect(s.duplication).toBeCloseTo(0.046);
    expect(s.duplicationExcess).toBeCloseTo(0.046 / FOUR_STAR.duplication);
  });

  test('no production lines scores zero', () => {
    expect(duplicationScores(0, 0)).toEqual({ duplication: 0, duplicationExcess: 0 });
  });
});
