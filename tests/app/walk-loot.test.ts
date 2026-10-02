import { expect, test } from 'vitest';
import { DROP_BLINK, DROP_CAP, DROP_CHANCE, DROP_LIFE, RARITY, RARITY_ODDS, RESPAWN_MAX, RESPAWN_MIN, autoWeapon, createDropField, createInventory, createLootField, dropShown, lootCount, placeLoot, rarityOf, rollDrop, rollLoot, type Point } from '../../src/features/walk/walkLoot';
import { RIVAL_WEAPONS, WEAPONS, dealWeapons, inBeam, segmentGap, weaponById } from '../../src/features/walk/walkWeapons';

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

test('auto hunt with no rule puts explosives away for the best plain weapon', () => {
  const inv = createInventory();
  inv.pickup('rocket');
  inv.pickup('pistol');
  expect(autoWeapon(inv, null, 'rocket')).toBe('pistol');
  expect(autoWeapon(inv, null, 'grenade')).toBe('pistol');
  expect(autoWeapon(inv, null, 'fist')).toBe('fist');
  expect(autoWeapon(inv, 'shotgun', 'rocket')).toBe('pistol');
  expect(autoWeapon(inv, 'rocket', 'fist')).toBe('rocket');
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

test('a beam only catches what is ahead of the shooter', () => {
  expect(inBeam(5, 1, 0, 0, 10, 0, 1.2)).toBe(true);
  expect(inBeam(5, 2, 0, 0, 10, 0, 1.2)).toBe(false);
  expect(inBeam(-0.5, 0, 0, 0, 10, 0, 1.2)).toBe(false);
  expect(inBeam(0, 1, 0, 0, 10, 0, 1.2)).toBe(false);
  expect(inBeam(0.3, 0.5, 0, 0, 10, 0, 1.2)).toBe(true);
});

test('foes drop loot at their rates, with legendaries twice as likely as in the street', () => {
  const random = seeded(21);
  const n = 40000;
  const owned = ['fist', 'pistol', 'laser', 'rocket'] as const;
  for (const kind of ['zombie', 'elite'] as const) {
    const rolls = Array.from({ length: n }, () => rollDrop(kind, owned, random));
    const hits = rolls.filter((r) => r !== null);
    expect(Math.abs(hits.length / n - DROP_CHANCE[kind])).toBeLessThan(0.01);
    const weapons = hits.filter((r) => !r!.ammo);
    const ammo = hits.filter((r) => r!.ammo);
    expect(ammo.length).toBeGreaterThan(hits.length * 0.4);
    ammo.forEach((r) => expect(r!.ammo).toBe(Math.ceil(weaponById(r!.id).ammo! / 2)));
    if (kind === 'zombie') {
      const legend = weapons.filter((r) => rarityOf(r!.id) === 'legendary').length / weapons.length;
      expect(Math.abs(legend - RARITY_ODDS.legendary * 2 / (1 + RARITY_ODDS.legendary))).toBeLessThan(0.015);
    }
  }
});

test('elites never drop common loot, not even ammo for a common gun', () => {
  const random = seeded(5);
  for (let k = 0; k < 5000; k++) {
    const r = rollDrop('elite', ['fist', 'bat', 'pistol', 'flamer'], random);
    if (r) expect(rarityOf(r.id)).not.toBe('common');
  }
});

test('until the player owns a gun every drop is a gun, pistol or better', () => {
  const random = seeded(9);
  for (let k = 0; k < 5000; k++) {
    const r = rollDrop('zombie', ['fist', 'bat', 'pipe'], random);
    if (!r) continue;
    expect(r.ammo).toBe(0);
    expect(weaponById(r.id).kind).not.toBe('melee');
  }
});

test('drops expire after their life, blinking at the end, and the oldest gives way at the cap', () => {
  const field = createDropField();
  expect(field.drops).toHaveLength(DROP_CAP);
  const first = field.add(0, 0, { id: 'pistol', ammo: 0 });
  field.update(1, 100, 100);
  for (let k = 1; k < DROP_CAP; k++) field.add(k * 10, 0, { id: 'smg', ammo: 0 });
  expect(field.drops.every((d) => d.live)).toBe(true);
  expect(field.add(500, 0, { id: 'rocket', ammo: 0 })).toBe(first);
  expect(field.drops[first]).toMatchObject({ x: 500, id: 'rocket', wait: DROP_LIFE });

  const one = createDropField();
  const k = one.add(0, 0, { id: 'laser', ammo: 6 });
  one.update(DROP_LIFE - DROP_BLINK - 0.5, 100, 100);
  expect(dropShown(one.drops[k])).toBe(true);
  const seen = new Set<boolean>();
  for (let t = 0; t < 16; t++) { one.update(0.25, 100, 100); if (one.drops[k].live) seen.add(dropShown(one.drops[k])); }
  expect(seen).toEqual(new Set([true, false]));
  one.update(2, 100, 100);
  expect(one.drops[k].live).toBe(false);
});

test('walking over a drop picks it up once; clear removes the rest', () => {
  const field = createDropField();
  field.add(0, 0, { id: 'laser', ammo: 6 });
  field.add(30, 0, { id: 'smg', ammo: 0 });
  expect(field.update(0.1, 1, 0)).toMatchObject([{ id: 'laser', ammo: 6 }]);
  expect(field.update(0.1, 1, 0)).toEqual([]);
  field.clear();
  expect(field.drops.some((d) => d.live)).toBe(false);
});

test('refill adds rounds to an owned gun', () => {
  const inv = createInventory();
  inv.pickup('laser');
  expect(inv.refill('laser', 6)).toBe(weaponById('laser').ammo! + 6);
});
