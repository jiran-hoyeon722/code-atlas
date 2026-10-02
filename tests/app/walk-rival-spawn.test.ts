import { expect, test } from 'vitest';
import { edgeSpots } from '../../src/features/walk/walkBattle';

const bounds = { minX: -100, maxX: 300, minZ: -50, maxZ: 350 };
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const quarter = (p: { x: number; z: number }) => {
  const nx = (p.x - bounds.minX) / 400 - 0.5, nz = (p.z - bounds.minZ) / 400 - 0.5;
  return Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? 'E' : 'W') : nz > 0 ? 'S' : 'N';
};

test('four rivals get one spot per compass quarter, near the outer edge', () => {
  for (let s = 1; s <= 20; s++) {
    const spots = edgeSpots(bounds, 4, seeded(s), () => false);
    expect(spots.map(quarter).sort()).toEqual(['E', 'N', 'S', 'W']);
    for (const p of spots) {
      const edge = Math.min(p.x - bounds.minX, bounds.maxX - p.x, p.z - bounds.minZ, bounds.maxZ - p.z);
      expect(edge).toBeLessThanOrEqual(400 * 0.25);
    }
  }
});

test('spots are spread far apart', () => {
  const spots = edgeSpots(bounds, 4, seeded(7), () => false);
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    expect(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z)).toBeGreaterThan(150);
  }
});

test('blocked ground is never used', () => {
  const blocked = (x: number) => Math.floor(x / 10) % 2 === 0;
  for (const p of edgeSpots(bounds, 4, seeded(3), blocked)) expect(blocked(p.x)).toBe(false);
});

test('when every edge is blocked a rival falls back to open ground elsewhere in the city', () => {
  const inner = (x: number, z: number) => Math.min(x - bounds.minX, bounds.maxX - x, z - bounds.minZ, bounds.maxZ - z) < 100;
  const spots = edgeSpots(bounds, 4, seeded(5), inner);
  for (const p of spots) {
    expect(inner(p.x, p.z)).toBe(false);
    expect(p.x).toBeGreaterThanOrEqual(bounds.minX);
    expect(p.x).toBeLessThanOrEqual(bounds.maxX);
  }
});

test('which rival takes which quarter changes between visits', () => {
  const firsts = new Set<string>();
  for (let s = 1; s <= 30; s++) firsts.add(quarter(edgeSpots(bounds, 4, seeded(s), () => false)[0]));
  expect(firsts.size).toBeGreaterThan(1);
});
