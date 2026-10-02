import { expect, test } from 'vitest';
import { RAMP, createVirus, pickOrigin, pickOrigins, spreadSchedule, type VirusSite } from '../../src/features/walk/walkVirus';
import { dealWeapons, damageAt, weaponById, WEAPONS } from '../../src/features/walk/walkWeapons';
import { CHARACTERS, characterById, dealCharacters } from '../../src/features/walk/walkCharacters';

const line: VirusSite[] = Array.from({ length: 10 }, (_, k) => ({ x: k * 10, z: 0 }));
const fixed = () => 0.5;

test('the virus reaches nearer buildings first and the origin at once', () => {
  const at = spreadSchedule(line, 3, 100, fixed);
  expect(at[3]).toBe(0);
  expect(at[2]).toBeLessThan(at[0]);
  expect(at[4]).toBeLessThan(at[9]);
  expect(Math.max(...at)).toBeCloseTo(100);
});

test('the origin is picked away from the player when possible', () => {
  for (let k = 0; k < 20; k++) {
    const o = pickOrigin(line, { x: 0, z: 0 }, () => k / 20);
    expect(line[o].x).toBeGreaterThanOrEqual(30);
  }
  expect(pickOrigin([{ x: 0, z: 0 }], { x: 0, z: 0 }, Math.random)).toBe(0);
});

test('an outbreak spreads over time and curing heals every building', () => {
  const v = createVirus(line, 60, fixed);
  expect(v.state).toBe('off');
  v.start(0);
  v.update(RAMP);
  expect(v.levels[0]).toBe(1);
  expect(v.levels[9]).toBe(0);
  for (let t = 0; t < 70; t++) v.update(1);
  expect(v.infected).toBe(line.length);
  expect(v.levels[9]).toBe(1);
  v.cure();
  expect(v.state).toBe('healing');
  for (let t = 0; t < 20 && v.state !== 'off'; t++) v.update(0.5);
  expect(v.state).toBe('off');
  expect([...v.levels].every((l) => l === 0)).toBe(true);
});

test('curing does nothing unless an outbreak is running', () => {
  const v = createVirus(line, 60, fixed);
  v.cure();
  expect(v.state).toBe('off');
  expect(v.update(1)).toBe(false);
});

test('with several origins each building is reached from its nearest one', () => {
  const at = spreadSchedule(line, [0, 9], 100, fixed);
  expect(at[0]).toBe(0);
  expect(at[9]).toBe(0);
  expect(at[1]).toBeCloseTo(at[8]);
  expect(at[2]).toBeLessThan(at[4]);
  expect(at[7]).toBeLessThan(at[5]);
  expect(Math.max(...at)).toBeCloseTo(100);
  const one = spreadSchedule(line, [0], 100, fixed);
  expect(at[8]).toBeLessThan(one[8]);
});

test('origins are picked distinct and far apart, the first away from the player', () => {
  const grid: VirusSite[] = Array.from({ length: 100 }, (_, k) => ({ x: (k % 10) * 10, z: Math.floor(k / 10) * 10 }));
  for (let seed = 0; seed < 20; seed++) {
    let r = seed / 20;
    const random = () => (r = (r * 9301 + 0.49297) % 1);
    const picked = pickOrigins(grid, { x: 0, z: 0 }, 4, random);
    expect(new Set(picked).size).toBe(4);
    for (let i = 0; i < picked.length; i++)
      for (let j = i + 1; j < picked.length; j++)
        expect(Math.hypot(grid[picked[i]].x - grid[picked[j]].x, grid[picked[i]].z - grid[picked[j]].z)).toBeGreaterThanOrEqual(30);
    expect(Math.hypot(grid[picked[0]].x, grid[picked[0]].z)).toBeGreaterThanOrEqual(0.35 * Math.hypot(90, 90));
  }
  expect(pickOrigins(line.slice(0, 2), { x: 0, z: 0 }, 5, Math.random)).toHaveLength(2);
  expect(pickOrigins([], { x: 0, z: 0 }, 3, Math.random)).toEqual([]);
});

test('the city heals only once every origin is vaccinated, and a cured front stops advancing', () => {
  const v = createVirus(line, 60, fixed);
  v.start([0, 9], 40);
  expect(v.origins).toEqual([0, 9]);
  expect(v.origin).toBe(0);
  v.update(RAMP);
  expect(v.levels[0]).toBe(1);
  expect(v.levels[9]).toBe(1);
  expect(v.cureOrigin(9)).toBe(false);
  expect(v.cureOrigin(9)).toBe(false);
  expect(v.cureOrigin(4)).toBe(false);
  expect(v.state).toBe('spreading');
  expect(v.active).toEqual([0]);
  expect(v.origin).toBe(0);
  for (let t = 0; t < 20; t++) v.update(1);
  // Only the front from 0 is left, so the far end now waits for it instead of catching it from 9.
  expect(v.levels[8]).toBe(0);
  expect(v.levels[9]).toBe(1);
  expect(v.cureOrigin(0)).toBe(true);
  expect(v.state).toBe('healing');
  expect(v.origin).toBe(-1);
  for (let t = 0; t < 40 && v.state !== 'off'; t++) v.update(0.5);
  expect(v.state).toBe('off');
  expect([...v.levels].every((l) => l === 0)).toBe(true);
});

test('rivals get different weapons and never bare fists', () => {
  const dealt = dealWeapons(4, Math.random);
  expect(new Set(dealt.map((w) => w.id)).size).toBe(4);
  expect(dealt.some((w) => w.id === 'fist')).toBe(false);
  expect(WEAPONS.some((w) => w.kind === 'melee' && w.id !== 'fist')).toBe(true);
  expect(WEAPONS.some((w) => w.kind === 'gun')).toBe(true);
});

test('shotgun damage falls off with distance, other weapons do not', () => {
  const shotgun = weaponById('shotgun');
  expect(damageAt(shotgun, 1)).toBeGreaterThan(damageAt(shotgun, shotgun.range));
  const pistol = weaponById('pistol');
  expect(damageAt(pistol, 1)).toBe(damageAt(pistol, 30));
});

test('rivals wear every design the player did not pick, each a different one', () => {
  for (const player of CHARACTERS) {
    for (let k = 0; k < 10; k++) {
      const dealt = dealCharacters(player.id, 4, () => k / 10);
      expect(new Set(dealt.map((c) => c.id)).size).toBe(4);
      expect(dealt.some((c) => c.id === player.id)).toBe(false);
    }
  }
  expect(characterById('nope')).toBe(CHARACTERS[0]);
});
