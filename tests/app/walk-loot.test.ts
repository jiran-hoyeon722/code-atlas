import { expect, test } from 'vitest';
import { RARITY, RARITY_ODDS, RESPAWN_MAX, RESPAWN_MIN, createInventory, createLootField, lootCount, placeLoot, rollLoot, type Point } from '../../src/features/walk/walkLoot';
import { RIVAL_WEAPONS, WEAPONS, dealWeapons, segmentGap, weaponById } from '../../src/features/walk/walkWeapons';

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

test('the player starts with fists only', () => {
  const inv = createInventory();
  expect(WEAPONS.filter((w) => inv.owns(w.id)).map((w) => w.id)).toEqual(['fist']);
  expect(inv.left('fist')).toBe(Infinity);
  expect(inv.usable('rocket')).toBe(false);
  expect(inv.spend('pistol')).toBe(false);
});

test('a pickup grants the weapon with its ammo, a second one tops the ammo up', () => {
  const inv = createInventory();
  const rocket = weaponById('rocket');
  expect(inv.pickup('rocket')).toEqual({ fresh: true, left: rocket.ammo });
  expect(inv.pickup('rocket')).toEqual({ fresh: false, left: rocket.ammo! * 2 });
  expect(inv.pickup('bat').left).toBe(Infinity);
});

test('an empty weapon stays owned but unusable, and the fallback is fists', () => {
  const inv = createInventory();
  inv.pickup('grenade');
  for (let k = 0; k < weaponById('grenade').ammo!; k++) expect(inv.spend('grenade')).toBe(true);
  expect(inv.spend('grenade')).toBe(false);
  expect(inv.owns('grenade')).toBe(true);
  expect(inv.usable('grenade')).toBe(false);
  expect(inv.best('grenade')).toBe('fist');
});

test('auto hunt falls back to what the player owns', () => {
  const inv = createInventory();
  expect(inv.best('smg')).toBe('fist');
  inv.pickup('pipe');
  expect(inv.best('shotgun')).toBe('pipe');
  inv.pickup('shotgun');
  expect(inv.best('shotgun')).toBe('shotgun');
  expect(inv.best('smg')).toBe('shotgun');
});

test('melee and the pistol are common, the rocket launcher very rare', () => {
  const random = seeded(7);
  const counts = new Map<string, number>();
  const n = 20000;
  for (let k = 0; k < n; k++) {
    const id = rollLoot(random);
    counts.set(RARITY[id as keyof typeof RARITY], (counts.get(RARITY[id as keyof typeof RARITY]) ?? 0) + 1);
  }
  for (const [tier, odds] of Object.entries(RARITY_ODDS)) expect(Math.abs((counts.get(tier) ?? 0) / n - odds)).toBeLessThan(0.02);
  expect(RARITY.rocket).toBe('legendary');
  expect(RARITY.pistol).toBe('common');
});

test('roughly one pickup per five buildings, between 8 and 40', () => {
  expect(lootCount(10)).toBe(8);
  expect(lootCount(100)).toBe(20);
  expect(lootCount(1000)).toBe(40);
});

test('placement avoids blocked ground and keeps pickups apart', () => {
  const doors: Point[] = Array.from({ length: 30 }, (_, k) => [k * 10, 0]);
  const blocked = (x: number, z: number) => z > 0 && z < 6;
  const spots = placeLoot(doors, 12, seeded(3), blocked, [[0, 0]]);
  expect(spots.length).toBeGreaterThan(8);
  spots.forEach(([x, z]) => expect(blocked(x, z)).toBe(false));
  spots.forEach(([x, z], k) => spots.slice(k + 1).forEach(([px, pz]) => expect(Math.hypot(px - x, pz - z)).toBeGreaterThanOrEqual(6)));
  spots.forEach(([x, z]) => expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(6));
});

test('walking over a drop picks it up, and it comes back elsewhere after 45-60 s', () => {
  const field = createLootField([[0, 0], [50, 0]], seeded(1), () => [100, 100]);
  expect(field.update(0.1, 30, 30).picked).toEqual([]);
  const { picked } = field.update(0.1, 0.5, 0.5);
  expect(picked.length).toBe(1);
  expect(field.drops[0].live).toBe(false);
  expect(field.update(RESPAWN_MIN - 1, 30, 30).back).toEqual([]);
  const { back } = field.update(RESPAWN_MAX - RESPAWN_MIN + 2, 30, 30);
  expect(back.length).toBe(1);
  expect([back[0].x, back[0].z]).toEqual([100, 100]);
});

test('rivals only carry the old street weapons', () => {
  for (let k = 0; k < 20; k++) dealWeapons(4, seeded(k)).forEach((w) => expect(RIVAL_WEAPONS).toContain(w.id));
});

test('segment distance for beams', () => {
  expect(segmentGap(5, 1, 0, 0, 10, 0)).toBeCloseTo(1);
  expect(segmentGap(-3, 4, 0, 0, 10, 0)).toBeCloseTo(5);
});
