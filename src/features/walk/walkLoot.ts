import { weaponById, type WeaponId } from './walkWeapons';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export type Point = [number, number];

export const RARITY: Record<Exclude<WeaponId, 'fist'>, Rarity> = {
  bat: 'common', pipe: 'common', pistol: 'common',
  smg: 'uncommon', shotgun: 'uncommon', flamer: 'uncommon',
  laser: 'rare', grenade: 'rare',
  rocket: 'legendary',
};
export const RARITY_ODDS: Record<Rarity, number> = { common: 0.5, uncommon: 0.3, rare: 0.15, legendary: 0.05 };
export const RARITY_COLOR: Record<Rarity, string> = { common: '#d0d6e0', uncommon: '#4dabf7', rare: '#c18cff', legendary: '#ffa94d' };
export const rarityOf = (id: WeaponId): Rarity => (id === 'fist' ? 'common' : RARITY[id]);

/** Rolls the rarity first, then one weapon of that rarity, so adding a weapon never dilutes the rocket's odds. */
export function rollLoot(random: () => number): WeaponId {
  let r = random();
  let tier: Rarity = 'legendary';
  for (const t of Object.keys(RARITY_ODDS) as Rarity[]) {
    if (r < RARITY_ODDS[t]) { tier = t; break; }
    r -= RARITY_ODDS[t];
  }
  const pool = (Object.keys(RARITY) as Exclude<WeaponId, 'fist'>[]).filter((id) => RARITY[id] === tier);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** About one pickup per three buildings, never fewer than 10 nor more than 80. */
export const lootCount = (buildings: number) => Math.max(10, Math.min(80, Math.round(buildings / 3)));

export const RESPAWN_MIN = 30;
export const RESPAWN_MAX = 40;
const SPACING = 6;
const TRIES = 14;

/**
 * Half the pickups wait at building doors (the buildings themselves are not enterable), the rest lie on open ground
 * a few steps out into the street. `blocked` is the walker's collision test, so nothing lands inside a wall or a prop.
 */
export function placeLoot(doors: Point[], count: number, random: () => number, blocked: (x: number, z: number) => boolean, taken: Point[] = []): Point[] {
  const out: Point[] = [];
  if (!doors.length) return out;
  const free = (x: number, z: number) => !blocked(x, z) && ![...taken, ...out].some(([px, pz]) => Math.hypot(px - x, pz - z) < SPACING);
  for (let k = 0; k < count; k++) {
    for (let t = 0; t < TRIES; t++) {
      const [dx, dz] = doors[Math.floor(random() * doors.length)];
      const atDoor = k % 2 === 0 && t < TRIES / 2;
      const a = random() * Math.PI * 2, r = atDoor ? 0 : 4 + random() * 10;
      const x = dx + Math.cos(a) * r, z = dz + Math.sin(a) * r;
      if (free(x, z)) { out.push([x, z]); break; }
    }
  }
  return out;
}

/** Ammo per weapon: Infinity for melee, a count for the rest; a weapon missing from the map is not owned yet. */
export interface Inventory {
  owns(id: WeaponId): boolean;
  /** Rounds left, Infinity for melee, 0 when empty or not owned. */
  left(id: WeaponId): number;
  /** Owned and loaded. */
  usable(id: WeaponId): boolean;
  /** Grants the weapon with a pickup's worth of ammo, or tops up the ammo of one already owned. */
  pickup(id: WeaponId): { fresh: boolean; left: number };
  /** Uses one round; false when there was nothing to fire. */
  spend(id: WeaponId): boolean;
  /** `want` when it can be used, otherwise the first loaded fallback (fists at worst). */
  best(want: WeaponId): WeaponId;
}

// What the auto-hunt pilot reaches for when it lacks the weapon its rule asks for; the scarce explosives stay with the player.
const FALLBACK: WeaponId[] = ['laser', 'shotgun', 'smg', 'pistol', 'flamer', 'pipe', 'bat', 'fist'];

export function createInventory(): Inventory {
  const ammo = new Map<WeaponId, number>([['fist', Infinity]]);
  const self: Inventory = {
    owns: (id) => ammo.has(id),
    left: (id) => ammo.get(id) ?? 0,
    usable: (id) => (ammo.get(id) ?? 0) > 0,
    pickup(id) {
      const fresh = !ammo.has(id);
      const add = weaponById(id).ammo ?? Infinity;
      const left = (ammo.get(id) ?? 0) + add;
      ammo.set(id, left);
      return { fresh, left };
    },
    spend(id) {
      const n = ammo.get(id) ?? 0;
      if (n <= 0) return false;
      if (Number.isFinite(n)) ammo.set(id, n - 1);
      return true;
    },
    best(want) {
      if (self.usable(want)) return want;
      return FALLBACK.find((id) => self.usable(id)) ?? 'fist';
    },
  };
  return self;
}

/** What the auto-hunt pilot should hold: the rule's weapon (or its fallback), or with no rule the current one unless it is an explosive. */
export function autoWeapon(inv: Inventory, want: WeaponId | null, current: WeaponId): WeaponId {
  if (want) return inv.best(want);
  return FALLBACK.includes(current) ? current : inv.best(FALLBACK[0]);
}

export interface LootDrop { x: number; z: number; id: WeaponId; live: boolean; wait: number }

export interface LootField {
  readonly drops: readonly LootDrop[];
  /** Picks up every live drop within `reach` of (x, z) and counts down taken ones; returns what was picked up and what came back. */
  update(dt: number, x: number, z: number): { picked: LootDrop[]; back: LootDrop[] };
}

export const PICKUP_REACH = 1.6;

/** Taken drops come back after 30–40 s somewhere else, from `place`, so the city never runs dry. */
export function createLootField(spots: Point[], random: () => number, place: (taken: Point[]) => Point | null): LootField {
  const drops: LootDrop[] = spots.map(([x, z]) => ({ x, z, id: rollLoot(random), live: true, wait: 0 }));
  return {
    drops,
    update(dt, x, z) {
      const picked: LootDrop[] = [];
      const back: LootDrop[] = [];
      drops.forEach((d) => {
        if (d.live) {
          if (Math.hypot(d.x - x, d.z - z) > PICKUP_REACH) return;
          d.live = false;
          d.wait = RESPAWN_MIN + random() * (RESPAWN_MAX - RESPAWN_MIN);
          picked.push({ ...d });
          return;
        }
        d.wait -= dt;
        if (d.wait > 0) return;
        const at = place([...drops.filter((o) => o.live).map((o): Point => [o.x, o.z]), [x, z]]);
        if (!at) { d.wait = 5; return; }
        [d.x, d.z] = at;
        d.id = rollLoot(random);
        d.live = true;
        back.push(d);
      });
      return { picked, back };
    },
  };
}

/** The live drop closest to (x, z), or null when every drop is taken. */
export function nearestDrop(drops: readonly LootDrop[], x: number, z: number): LootDrop | null {
  let best: LootDrop | null = null;
  let bestGap = Infinity;
  for (const d of drops) {
    if (!d.live) continue;
    const g = Math.hypot(d.x - x, d.z - z);
    if (g < bestGap) { bestGap = g; best = d; }
  }
  return best;
}

/** Screen angle (radians, clockwise from straight up) of the world offset (dx, dz) for a camera looking along (-sin yaw, -cos yaw). */
export function finderAngle(dx: number, dz: number, yaw: number): number {
  const ahead = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
  const side = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  return Math.atan2(side, ahead);
}
