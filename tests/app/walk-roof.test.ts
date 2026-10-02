import { expect, test } from 'vitest';
import { rocketDir } from '../../src/features/walk/walkArsenal';
import { clampToRoof, climbPath, deckUnder, gableLift, overRoof, streetExit } from '../../src/features/walk/walkRoof';

const roof = { x: 10, z: -4, w: 8, d: 6 };

test('a step past the roof edge stops a margin inside it', () => {
  expect(clampToRoof(roof, 30, -4, 0.5)).toEqual({ x: 13.5, z: -4 });
  expect(clampToRoof(roof, 0, 10, 0.5)).toEqual({ x: 6.5, z: -1.5 });
  expect(clampToRoof(roof, 11, -3, 0.5)).toEqual({ x: 11, z: -3 });
});

test('a roof thinner than two margins pins to its centre line', () => {
  expect(clampToRoof({ x: 0, z: 0, w: 0.6, d: 10 }, 3, 2, 0.5)).toEqual({ x: 0, z: 2 });
});

test('overRoof tells whether a point is above the rectangle', () => {
  expect(overRoof(roof, 14, -1)).toBe(true);
  expect(overRoof(roof, 14.1, -1)).toBe(false);
  expect(overRoof(roof, 10, -7.5)).toBe(false);
});

test('landing inside a footprint steps out through the nearest wall', () => {
  expect(streetExit(roof, 13, -4, 0.6)).toEqual({ x: 14.6, z: -4 });
  expect(streetExit(roof, 7, -4, 0.6)).toEqual({ x: 5.4, z: -4 });
  expect(streetExit(roof, 10, -1.5, 0.6)).toEqual({ x: 10, z: -0.4 });
  expect(streetExit(roof, 10, -6.8, 0.6)).toEqual({ x: 10, z: -7.6 });
});

test('a gable is highest on its ridge and flat at the eaves', () => {
  expect(gableLift(3, 10, 0)).toBe(3);
  expect(gableLift(3, 10, 2.5)).toBeCloseTo(1.5);
  expect(gableLift(3, 10, -5)).toBe(0);
  expect(gableLift(3, 10, 8)).toBe(0);
});

test('climbing goes up the wall first, then across onto the roof', () => {
  const from = { x: 0, z: 0, y: 0 }, to = { x: 4, z: 2, y: 20 };
  expect(climbPath(0, from, to, true)).toEqual(from);
  const mid = climbPath(0.5, from, to, true);
  expect(mid.x).toBe(0);
  expect(mid.y).toBeGreaterThan(10);
  expect(climbPath(0.6, from, to, true)).toEqual({ x: 0, z: 0, y: 20 });
  expect(climbPath(1, from, to, true)).toEqual(to);
  expect(climbPath(2, from, to, true)).toEqual(to);
});

test('coming down crosses past the edge first, then drops to the street', () => {
  const from = { x: 4, z: 2, y: 20 }, to = { x: 0, z: 9, y: 0 };
  expect(climbPath(0.4, from, to, false)).toEqual({ x: 0, z: 9, y: 20 });
  expect(climbPath(0.2, from, to, false).y).toBe(20);
  expect(climbPath(1, from, to, false)).toEqual(to);
});

test('a fall comes down on the highest deck under the feet: a tower terrace, then the street beside it', () => {
  const terrace = { x: 0, z: 0, w: 20, d: 20, top: 12 }, tier = { x: 0, z: -2, w: 12, d: 12, top: 30 };
  const top = (d: { top: number }) => d.top;
  expect(deckUnder([terrace, tier], 8, 8, 25, top)).toEqual({ deck: terrace, top: 12 });
  expect(deckUnder([terrace, tier], 0, 0, 30, top)).toEqual({ deck: tier, top: 30 });
  expect(deckUnder([terrace, tier], 0, 0, 20, top)).toBeNull();
  expect(deckUnder([terrace, tier], 11, 0, 25, top)).toBeNull();
  expect(deckUnder([], 0, 0, 25, top)).toBeNull();
});

test('a rocket from a roof dives at a target below; from the street it flies level', () => {
  const level = rocketDir(0, { x: 0, y: 1.3, z: 0 }, { x: 0, y: 1, z: 10 });
  expect(level).toEqual({ dx: 0, dy: 0, dz: 1 });
  expect(rocketDir(Math.PI / 2, { x: 0, y: 20, z: 0 }, null)).toEqual({ dx: 1, dy: 0, dz: expect.closeTo(0) });
  const dive = rocketDir(0, { x: 0, y: 21, z: 0 }, { x: 0, y: 1, z: 20 });
  expect(dive.dx).toBeCloseTo(0);
  expect(dive.dy).toBeCloseTo(-Math.SQRT1_2);
  expect(dive.dz).toBeCloseTo(Math.SQRT1_2);
  expect(Math.hypot(dive.dx, dive.dy, dive.dz)).toBeCloseTo(1);
});
