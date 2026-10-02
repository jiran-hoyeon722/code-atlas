import { expect, test } from 'vitest';
import { REVEAL_GROW, revealDelay, revealGrowth } from '../../src/features/city/reveal';

test('the front row rises before the back rows, left before right', () => {
  expect(revealDelay(0, 50, 200)).toBeLessThan(revealDelay(1, 50, 200));
  expect(revealDelay(2, -100, 200)).toBeLessThan(revealDelay(2, 100, 200));
  expect(revealDelay(0, -100, 200)).toBe(0);
});

test('a building grows from flat to its full height with a small overshoot', () => {
  expect(revealGrowth(-1)).toBeGreaterThan(0);
  expect(revealGrowth(0)).toBeLessThan(0.01);
  expect(revealGrowth(1)).toBe(1);
  expect(revealGrowth(2)).toBe(1);
  const peak = Math.max(...Array.from({ length: 100 }, (_, k) => revealGrowth(k / 100)));
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThan(1.15);
  expect(REVEAL_GROW).toBeGreaterThan(0);
});
