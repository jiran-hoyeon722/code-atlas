import { expect, test } from 'vitest';
import { DIFFICULTY, createVirus, type VirusSite } from '../../src/features/walk/walkVirus';
import { TERRITORY, createTerritory, heldShare, nearestInfected, screenBearing } from '../../src/features/walk/walkTerritory';
import { preyOf, DECOY_SIGHT, type Decoy } from '../../src/features/walk/walkHorde';

const line: VirusSite[] = Array.from({ length: 10 }, (_, k) => ({ x: k * 10, z: 0 }));

test('only 지옥 and 신 play the land grab', () => {
  expect(Object.entries(DIFFICULTY).filter(([, r]) => r.territory).map(([d]) => d)).toEqual(['hell', 'god']);
});

test('a vaccinated building stays clean while the front passes, and breaks again once retaken', () => {
  const v = createVirus(line, 10, () => 0.5);
  v.start(0, 10);
  expect(v.vaccinate(0)).toBe(false);
  expect(v.vaccinate(5)).toBe(true);
  expect(v.vaccinate(5)).toBe(false);
  v.update(20);
  expect(v.levels[5]).toBe(0);
  expect(v.levels[6]).toBe(1);
  expect(v.infected).toBe(9);
  v.reinfect(5);
  v.update(0.1);
  expect(v.vaccinated[5]).toBe(0);
  expect(v.levels[5]).toBe(1);
});

test('vaccines start at three, refill with kills and stop at the cap', () => {
  const t = createTerritory();
  t.start(DIFFICULTY.hell);
  expect(t.charges).toBe(TERRITORY.start);
  expect(t.toNext).toBe(DIFFICULTY.hell.vaccineEvery);
  for (let k = 1; k < DIFFICULTY.hell.vaccineEvery; k++) expect(t.kill()).toBe(false);
  expect(t.kill()).toBe(true);
  expect(t.charges).toBe(TERRITORY.start + 1);
  while (t.spend());
  expect(t.charges).toBe(0);
  expect(t.spend()).toBe(false);
  t.start(DIFFICULTY.normal);
  expect(t.charges).toBe(0);
  expect(t.kill()).toBe(false);
});

test('a building is lost only when no soldier is left and foes stay at the door', () => {
  const t = createTerritory();
  t.start(DIFFICULTY.god);
  expect(t.update(10, [{ site: 1, soldiers: 1, threats: 5 }, { site: 2, soldiers: 0, threats: 0 }])).toEqual([]);
  expect(t.update(TERRITORY.exposed - 0.5, [{ site: 1, soldiers: 0, threats: 2 }])).toEqual([]);
  expect(t.update(1, [{ site: 1, soldiers: 0, threats: 2 }])).toEqual([1]);
  // A soldier coming back resets the clock.
  t.update(TERRITORY.exposed - 0.5, [{ site: 3, soldiers: 0, threats: 1 }]);
  t.update(0.1, [{ site: 3, soldiers: 1, threats: 1 }]);
  expect(t.update(1, [{ site: 3, soldiers: 0, threats: 1 }])).toEqual([]);
});

test('the share leaves origins out, so a tiny city can still be won', () => {
  const held = new Uint8Array(9);
  held.set([1, 1, 1], 0);
  expect(heldShare(held, 5)).toBeCloseTo(0.75);
  expect(heldShare(held)).toBeCloseTo(1 / 3);
  expect(heldShare(new Uint8Array(3), 3)).toBe(0);
});

test('the vaccine spreads to the nearest infected building, never an origin or a held one', () => {
  const levels = Float32Array.from(line, () => 1);
  const held = new Uint8Array(10);
  held[3] = 1;
  held[4] = 1;
  expect(nearestInfected(line, 3, levels, held, [2], 30)).toBe(5);
  levels[5] = 0.2;
  expect(nearestInfected(line, 3, levels, held, [2], 30)).toBe(1);
  expect(nearestInfected(line, 3, levels, held, [2, 1], 15)).toBe(-1);
});

test('origin arrows point the way the camera sees it', () => {
  // Looking down -Z: ahead is 0, the right (+X) is a quarter turn clockwise, behind is half a turn.
  expect(screenBearing(0, -1, 0, -5)).toBeCloseTo(0);
  expect(screenBearing(0, -1, 5, 0)).toBeCloseTo(Math.PI / 2);
  expect(Math.abs(screenBearing(0, -1, 0, 5))).toBeCloseTo(Math.PI);
});

test('foes go for a soldier only when it is nearer than the player and in sight', () => {
  const near: Decoy = { x: 3, z: 0, hit() {} };
  const far: Decoy = { x: DECOY_SIGHT + 2, z: 0, hit() {} };
  expect(preyOf([near, far], 0, 0, 20)).toBe(near);
  expect(preyOf([near], 0, 0, 2)).toBeNull();
  expect(preyOf([far], 0, 0, 40)).toBeNull();
  expect(preyOf(undefined, 0, 0, 40)).toBeNull();
});
