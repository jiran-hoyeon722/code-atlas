export interface VirusSite {
  x: number;
  z: number;
}

export type VirusState = 'off' | 'spreading' | 'healing';

/** Seconds for one building to go from clean to fully broken. */
export const RAMP = 3;
const HEAL_SPEED = 45;

/**
 * When each site catches the virus: distance from the origin mapped onto `duration` seconds,
 * with some jitter so the front looks ragged instead of a perfect circle. The origin is 0.
 */
export function spreadSchedule(sites: VirusSite[], origin: number, duration: number, random: () => number): Float32Array {
  const o = sites[origin];
  const dist = sites.map((s) => Math.hypot(s.x - o.x, s.z - o.z));
  const far = Math.max(1, ...dist);
  return Float32Array.from(dist, (d, k) => (k === origin ? 0 : (d / far) * duration * (0.85 + random() * 0.3)));
}

/** A far-away origin keeps the hunt interesting; falls back to any site when the city is tiny. */
export function pickOrigin(sites: VirusSite[], from: VirusSite, random: () => number): number {
  const dist = sites.map((s) => Math.hypot(s.x - from.x, s.z - from.z));
  const far = Math.max(0, ...dist);
  const pool = sites.map((_, k) => k).filter((k) => dist[k] >= far * 0.35);
  const pick = pool.length ? pool : sites.map((_, k) => k);
  return pick[Math.floor(random() * pick.length)] ?? -1;
}

export interface Virus {
  readonly state: VirusState;
  readonly origin: number;
  /** Seconds since the outbreak started. */
  readonly elapsed: number;
  /** Per site, 0 = clean, 1 = fully broken. */
  readonly levels: Float32Array;
  readonly infected: number;
  start(origin: number): void;
  cure(): void;
  /** Advances the clock; returns true when any level changed. */
  update(dt: number): boolean;
}

export function createVirus(sites: VirusSite[], duration: number, random: () => number): Virus {
  const levels = new Float32Array(sites.length);
  let infectAt: Float32Array = new Float32Array(sites.length);
  let healAt: Float32Array = new Float32Array(sites.length);
  let peak: Float32Array = new Float32Array(sites.length);
  let state: VirusState = 'off';
  let origin = -1;
  let clock = 0;
  let healClock = 0;
  let infected = 0;

  return {
    get state() { return state; },
    get origin() { return origin; },
    get elapsed() { return clock; },
    get infected() { return infected; },
    levels,
    start(o) {
      if (o < 0 || o >= sites.length) return;
      origin = o;
      state = 'spreading';
      clock = 0;
      infected = 0;
      levels.fill(0);
      infectAt = spreadSchedule(sites, o, duration, random);
    },
    cure() {
      if (state !== 'spreading') return;
      state = 'healing';
      healClock = 0;
      peak = levels.slice();
      const o = sites[origin];
      healAt = Float32Array.from(sites, (s) => Math.hypot(s.x - o.x, s.z - o.z) / HEAL_SPEED);
    },
    update(dt) {
      if (state === 'off') return false;
      if (state === 'spreading') {
        clock += dt;
        let count = 0;
        for (let k = 0; k < sites.length; k++) {
          levels[k] = Math.min(1, Math.max(0, (clock - infectAt[k]) / RAMP));
          if (levels[k] > 0) count++;
        }
        infected = count;
        return true;
      }
      healClock += dt;
      let left = 0;
      for (let k = 0; k < sites.length; k++) {
        levels[k] = Math.min(peak[k], Math.max(0, 1 - (healClock - healAt[k]) / 1.2));
        if (levels[k] > 0) left++;
      }
      infected = left;
      if (!left) { state = 'off'; origin = -1; }
      return true;
    },
  };
}
