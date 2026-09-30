import { describe, expect, test } from 'vitest';
import { loadParsers } from '../../../src/engine/parsers';
import { nodeLocate } from '../../../src/engine/node';
import { measureFunctions, readabilityScores } from '../../../src/engine/battle/functions';
import type { FnInfo } from '../../../src/engine/battle/types';

async function ts(src: string) {
  const { tsx } = await loadParsers(nodeLocate);
  return measureFunctions(tsx.parse(src)!.rootNode, 'ts', src);
}

async function php(src: string) {
  const { php: parser } = await loadParsers(nodeLocate);
  return measureFunctions(parser.parse(src)!.rootNode, 'php', src);
}

describe('measureFunctions', () => {
  test('ts nested function owns its own lines and branches', async () => {
    const src = [
      'function outer(a) {',
      '  if (a) {}',
      '  const inner = () => {',
      '    return a ? 1 : 2;',
      '  };',
      '  return inner;',
      '}',
    ].join('\n');
    const r = await ts(src);
    expect(r.lines).toBe(7);
    expect(r.functions).toEqual([
      { start: 0, end: 6, nloc: 4, ccn: 2 },
      { start: 2, end: 4, nloc: 3, ccn: 2 },
    ]);
  });

  test('blank lines are skipped in coordinates and nloc', async () => {
    const src = ['const x = 1;', '', 'function f() {', '', '  return 1;', '', '}', ''].join('\n');
    const r = await ts(src);
    expect(r.lines).toBe(4);
    expect(r.functions).toEqual([{ start: 1, end: 3, nloc: 3, ccn: 1 }]);
    expect(r.ccnTier).toHaveLength(4);
    expect(r.lenTier).toHaveLength(4);
  });

  test('php methods and closures', async () => {
    const src = [
      '<?php',
      'class A {',
      '  function f($a) {',
      '    if ($a && $b) {}',
      '    $g = function () { foreach ($x as $y) {} };',
      '  }',
      '}',
    ].join('\n');
    const r = await php(src);
    expect(r.lines).toBe(7);
    expect(r.functions).toEqual([
      { start: 2, end: 5, nloc: 3, ccn: 3 },
      { start: 4, end: 4, nloc: 1, ccn: 2 },
    ]);
  });

  test('tiers follow the innermost function and are 0 outside functions', async () => {
    const branches = Array.from({ length: 6 }, (_, i) => `  if (a${i}) {}`);
    const body = Array.from({ length: 16 }, (_, i) => `  const v${i} = ${i};`);
    const src = [
      'const top = 1;',
      'function complex(a) {',
      ...branches,
      '  const small = () => {',
      '    return 1;',
      '  };',
      '}',
      'function long() {',
      ...body,
      '}',
      'const bottom = 2;',
    ].join('\n');
    const r = await ts(src);
    expect(r.functions.map((f) => [f.ccn, f.nloc])).toEqual([
      [7, 8],
      [1, 3],
      [1, 18],
    ]);
    const ccn = r.ccnTier;
    const len = r.lenTier;
    expect(ccn[0]).toBe(0);
    expect(ccn[1]).toBe(1);
    expect(ccn.slice(8, 11)).toEqual([0, 0, 0]);
    expect(ccn[11]).toBe(1);
    expect(len.slice(12, 30)).toEqual(Array(18).fill(1));
    expect(ccn.slice(12, 30)).toEqual(Array(18).fill(0));
    expect(ccn[30]).toBe(0);
    expect(len[30]).toBe(0);
    expect(ccn).toHaveLength(r.lines);
  });

  test('deeply nested functions do not overflow the stack', async () => {
    const depth = 3000;
    const src = 'const f = ' + Array.from({ length: depth }, () => '() =>\n').join('') + '1;';
    const r = await ts(src);
    expect(r.functions).toHaveLength(depth);
    expect(r.functions.slice(0, -1).every((f) => f.nloc === 1 && f.ccn === 1 && f.end === depth)).toBe(true);
    expect(r.functions[depth - 1]).toEqual({ start: depth - 1, end: depth, nloc: 2, ccn: 1 });
  }, 60_000);

  test('huge files stay linear', async () => {
    const src = Array.from({ length: 100_000 }, (_, i) => `function f${i}(){}`).join('\n');
    const r = await ts(src);
    expect(r.functions).toHaveLength(100_000);
    expect(r.lines).toBe(100_000);
    expect(r.ccnTier.every((t) => t === 0)).toBe(true);
  }, 60_000);
});

const fn = (nloc: number, ccn: number): FnInfo => ({ start: 0, end: nloc - 1, nloc, ccn });

describe('readabilityScores', () => {
  test('the worst band decides each excess', () => {
    // ccn 11 falls in the >10 and >5 bands; >10 is stricter (10/1000 ÷ 0.1 = 0.1 vs ÷ 0.252).
    // ccn 30: 30/1000 ÷ 0.015 = 2 in the >25 band.
    const files = [{ functions: [fn(10, 11), fn(30, 30)] }, { functions: [fn(5, 1)] }];
    const r = readabilityScores(files, 1000);
    expect(r.complexityExcess).toBeCloseTo(2, 10);
    // nloc 30 is only above 15: 30/1000 ÷ 0.437; nothing above 30 or 60.
    expect(r.lengthExcess).toBeCloseTo(0.03 / 0.437, 10);
    expect(r.readability).toBeCloseTo((r.complexityExcess + r.lengthExcess) / 2, 10);
  });

  test('thresholds are strict', () => {
    const r = readabilityScores([{ functions: [fn(15, 5)] }], 100);
    expect(r).toEqual({ complexityExcess: 0, lengthExcess: 0, readability: 0 });
  });

  test('length bands pick the maximum', () => {
    const r = readabilityScores([{ functions: [fn(61, 1)] }], 1000);
    expect(r.lengthExcess).toBeCloseTo(Math.max(0.061 / 0.069, 0.061 / 0.223, 0.061 / 0.437), 10);
  });

  test('zero production lines is safe', () => {
    expect(readabilityScores([{ functions: [fn(40, 40)] }], 0)).toEqual({ complexityExcess: 0, lengthExcess: 0, readability: 0 });
    expect(readabilityScores([], 0)).toEqual({ complexityExcess: 0, lengthExcess: 0, readability: 0 });
  });
});
