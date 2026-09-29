import { expect, test } from 'vitest';
import { estimateRemaining } from '../../src/features/loading/eta';

test('null with fewer than 2 samples', () => {
  expect(estimateRemaining([], 100)).toBeNull();
  expect(estimateRemaining([{ t: 0, done: 5 }], 100)).toBeNull();
});

test('uses the average speed and returns seconds', () => {
  const s = [{ t: 0, done: 0 }, { t: 1000, done: 10 }];
  expect(estimateRemaining(s, 100)).toBe(9);
});

test('only the latest 5 samples count', () => {
  const s = [
    { t: 0, done: 0 }, { t: 10000, done: 1 },
    { t: 11000, done: 11 }, { t: 12000, done: 21 }, { t: 13000, done: 31 }, { t: 14000, done: 41 }, { t: 15000, done: 51 },
  ];
  expect(estimateRemaining(s, 101)).toBe(5);
});

test('null when no progress or time has not advanced', () => {
  expect(estimateRemaining([{ t: 0, done: 3 }, { t: 1000, done: 3 }], 10)).toBeNull();
  expect(estimateRemaining([{ t: 5, done: 3 }, { t: 5, done: 4 }], 10)).toBeNull();
});

test('0 when already complete', () => {
  expect(estimateRemaining([{ t: 0, done: 0 }, { t: 1000, done: 10 }], 10)).toBe(0);
});

test('rounds up partial seconds', () => {
  expect(estimateRemaining([{ t: 0, done: 0 }, { t: 1000, done: 3 }], 10)).toBe(3);
});
