import type { DifficultyRule, VirusSite } from './walkVirus';

export const TERRITORY = {
  /** Share of all buildings the player must hold at once to win. */
  goal: 0.6,
  /** Vaccines in hand at the start, and the most that can be carried. */
  start: 3,
  max: 9,
  /** Seconds the player stands at the door with E held to vaccinate. */
  inject: 1.5,
  /** Soldiers each vaccinated building keeps on its doorstep. */
  squad: 2,
  /** Seconds between new soldiers at a building that is short of its squad. */
  respawn: 10,
  /** Seconds a building with no soldiers left can stand foes at its door before the virus takes it back. */
  exposed: 4,
  /** Foes this close to the door count as besieging it. */
  threat: 12,
  /** Seconds between a held building passing the vaccine on to its nearest infected neighbour. */
  grow: 20,
  /** How far a held building reaches when it passes the vaccine on. */
  reach: 30,
  /** Foes sent at a held building in one raid. */
  raid: 3,
} as const;

export interface Post {
  site: number;
  /** Soldiers standing at the building right now. */
  soldiers: number;
  /** Foes within TERRITORY.threat of the door. */
  threats: number;
}

export interface Territory {
  readonly charges: number;
  /** Viruses still to kill for the next vaccine; 0 when the hands are full. */
  readonly toNext: number;
  start(rule: DifficultyRule): void;
  /** Counts a kill; true when it earned a vaccine. */
  kill(): boolean;
  /** Uses one vaccine; false when there is none. */
  spend(): boolean;
  /**
   * Advances the siege clocks. A post with soldiers is safe; one with none but foes at the door is lost after
   * TERRITORY.exposed seconds. Returns the sites lost this tick.
   */
  update(dt: number, posts: readonly Post[]): number[];
  /** Forgets the clock of a site that changed hands. */
  forget(site: number): void;
}

export function createTerritory(): Territory {
  let charges = 0;
  let every = 0;
  let counted = 0;
  const exposed = new Map<number, number>();
  return {
    get charges() { return charges; },
    get toNext() { return charges >= TERRITORY.max || every <= 0 ? 0 : every - counted; },
    start(rule) {
      charges = rule.territory ? TERRITORY.start : 0;
      every = rule.territory ? rule.vaccineEvery : 0;
      counted = 0;
      exposed.clear();
    },
    kill() {
      if (every <= 0 || charges >= TERRITORY.max) return false;
      counted++;
      if (counted < every) return false;
      counted = 0;
      charges++;
      return true;
    },
    spend() {
      if (charges <= 0) return false;
      charges--;
      return true;
    },
    update(dt, posts) {
      const lost: number[] = [];
      posts.forEach(({ site, soldiers, threats }) => {
        if (soldiers > 0 || threats <= 0) { exposed.delete(site); return; }
        const t = (exposed.get(site) ?? 0) + dt;
        if (t >= TERRITORY.exposed) { exposed.delete(site); lost.push(site); } else exposed.set(site, t);
      });
      return lost;
    },
    forget(site) {
      exposed.delete(site);
    },
  };
}

/** Share of the city held: vaccinated buildings over every building that can be vaccinated (origins never can). */
export const heldShare = (vaccinated: ArrayLike<number>, origins = 0) => {
  let n = 0;
  for (let k = 0; k < vaccinated.length; k++) n += vaccinated[k] ? 1 : 0;
  const pool = vaccinated.length - origins;
  return pool > 0 ? Math.min(1, n / pool) : 0;
};

/** The infected, non-origin, unheld building nearest to `from` within `reach`, or -1. */
export function nearestInfected(sites: VirusSite[], from: number, levels: ArrayLike<number>, vaccinated: ArrayLike<number>, origins: readonly number[], reach: number, infectedAt = 0.5): number {
  let best = -1;
  let bestD = reach;
  const o = sites[from];
  sites.forEach((s, k) => {
    if (k === from || vaccinated[k] || origins.includes(k) || (levels[k] ?? 0) < infectedAt) return;
    const d = Math.hypot(s.x - o.x, s.z - o.z);
    if (d <= bestD) { bestD = d; best = k; }
  });
  return best;
}

/** Clockwise angle (radians, 0 = straight ahead on screen) from a camera looking along (fx, fz) to the point (dx, dz) away. */
export function screenBearing(fx: number, fz: number, dx: number, dz: number): number {
  const ahead = dx * fx + dz * fz;
  const side = dx * -fz + dz * fx;
  return Math.atan2(side, ahead);
}
