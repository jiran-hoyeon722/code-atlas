import { expect, test } from 'vitest';
import type { Architecture } from '../../src/engine/architecture';
import { blastPercent, blastRadius } from '../../src/features/city/blast';

type Edges = Architecture['edges'];
const e = (from: number, to: number, kinds: Record<string, number> = { import: 1 }): Edges[number] => [from, to, 1, kinds, 0];
const off = { skipTypeOnly: false };

test('chain', () => {
  const r = blastRadius(3, [e(1, 0), e(2, 1)], 0, [], off);
  expect(r.levels).toEqual([[1], [2]]);
  expect(r.maxDepth).toBe(2);
  expect(r.affected).toBe(2);
  expect(Array.from(r.depth)).toEqual([0, 1, 2]);
});

test('cycle terminates and counts once', () => {
  const r = blastRadius(3, [e(1, 0), e(2, 1), e(0, 2)], 0, [], off);
  expect(r.affected).toBe(2);
  expect(Array.from(r.depth)).toEqual([0, 1, 2]);
  expect(r.levels).toEqual([[1], [2]]);
});

test('nearest level wins', () => {
  const r = blastRadius(3, [e(1, 0), e(2, 1), e(2, 0)], 0, [], off);
  expect(r.depth[2]).toBe(1);
  expect(r.levels).toEqual([[1, 2]]);
});

test('type-only skipped when asked', () => {
  const edges = [e(1, 0, { type: 1 }), e(2, 0, { 'type-import': 2 })];
  expect(blastRadius(3, edges, 0, [], off).affected).toBe(2);
  const r = blastRadius(3, edges, 0, [], { skipTypeOnly: true });
  expect(r.affected).toBe(0);
  expect(r.levels).toEqual([]);
  expect(r.maxDepth).toBe(0);
});

test('mixed kinds kept', () => {
  const r = blastRadius(2, [e(1, 0, { type: 1, new: 1 })], 0, [], { skipTypeOnly: true });
  expect(r.affected).toBe(1);
});

test('unused file', () => {
  const r = blastRadius(2, [e(0, 1)], 0, [], off);
  expect(r.affected).toBe(0);
  expect(r.maxDepth).toBe(0);
  expect(r.depth[1]).toBe(-1);
});

test('routeFiles excludes the start file', () => {
  const r = blastRadius(3, [e(1, 0), e(2, 1)], 0, [5, 0, 3], off);
  expect(r.routeFiles).toBe(1);
});

test('blastPercent', () => {
  expect(blastPercent(2, 3)).toBe(100);
  expect(blastPercent(1, 4)).toBe(33);
  expect(blastPercent(0, 1)).toBe(0);
});
