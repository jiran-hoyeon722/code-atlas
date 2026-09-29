import { expect, test } from 'vitest';
import { spiral } from '../../src/features/loading/miniCity';

test('spiral starts at the centre and fills each ring before the next, no cell twice', () => {
  expect(spiral(0)).toEqual([0, 0]);
  const seen = new Set<string>();
  for (let i = 0; i < 600; i++) {
    const [x, z] = spiral(i);
    seen.add(`${x},${z}`);
    expect(Math.max(Math.abs(x), Math.abs(z))).toBe(Math.ceil((Math.sqrt(i + 1) - 1) / 2));
  }
  expect(seen.size).toBe(600);
});
