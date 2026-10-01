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
  /** Starts an outbreak at `origin` that takes about `duration` seconds to reach every site. */
  start(origin: number, duration?: number): void;
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
    start(o, spread = duration) {
      if (o < 0 || o >= sites.length) return;
      origin = o;
      state = 'spreading';
      clock = 0;
      infected = 0;
      levels.fill(0);
      infectAt = spreadSchedule(sites, o, spread, random);
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

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DifficultyRule {
  label: string;
  /** Seconds for the virus to reach the farthest building. */
  spread: number;
  zombieEvery: number;
  zombieCap: number;
  eliteEvery: number;
  eliteCap: number;
  /** Glowing arrows on the road lead to the origin. */
  guide: boolean;
  /** Seconds the player has to kill the giant before the repo collapses. */
  bossTime: number;
}

export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
export const DIFFICULTY: Record<Difficulty, DifficultyRule> = {
  easy: { label: '하', spread: 150, zombieEvery: 3.5, zombieCap: 18, eliteEvery: 45, eliteCap: 3, guide: true, bossTime: 90 },
  normal: { label: '중', spread: 150, zombieEvery: 3.5, zombieCap: 18, eliteEvery: 45, eliteCap: 3, guide: false, bossTime: 90 },
  hard: { label: '상', spread: 82, zombieEvery: 1.8, zombieCap: 24, eliteEvery: 25, eliteCap: 4, guide: false, bossTime: 60 },
};
export const isDifficulty = (v: unknown): v is Difficulty => DIFFICULTIES.includes(v as Difficulty);

/** Level from which a building counts as taken over: its code is sealed and its cars stop. */
export const INFECTED_AT = 0.5;
export const isInfected = (level: number) => level >= INFECTED_AT;

/**
 * An infected site to raise a zombie at: close enough to the player that the fight is on screen,
 * but not so close that it pops up in their face. -1 when none qualifies.
 */
export function pickSpawnSite(sites: VirusSite[], levels: ArrayLike<number>, player: VirusSite, random: () => number, min = 14, max = 60): number {
  const pool: number[] = [];
  sites.forEach((s, k) => {
    const d = Math.hypot(s.x - player.x, s.z - player.z);
    if (isInfected(levels[k] ?? 0) && d >= min && d <= max) pool.push(k);
  });
  return pool.length ? pool[Math.floor(random() * pool.length)] : -1;
}

export type SiegePhase = 'off' | 'outbreak' | 'forming' | 'boss' | 'collapsing' | 'over';
export type SiegeEvent = 'zombie' | 'elite' | 'form' | 'boss' | 'won' | 'collapse' | 'collapsed';
/** Seconds the giant takes to form once the whole city is infected. */
export const FORM_TIME = 4.5;
/** Seconds the city takes to sink when the boss timer runs out. */
export const COLLAPSE_TIME = 7;

export interface SiegeWorld {
  allInfected: boolean;
  bossDown: boolean;
  zombies: number;
  elites: number;
}

export interface Siege {
  readonly phase: SiegePhase;
  readonly rule: DifficultyRule;
  /** Boss countdown in seconds. */
  readonly timeLeft: number;
  /** 0 → 1 through the forming and collapsing phases. */
  readonly progress: number;
  /** Once the giant has formed there is no backing out. */
  readonly cancellable: boolean;
  start(rule: DifficultyRule): void;
  /** Ends a cancellable outbreak (cured or called off); does nothing once the giant is forming. */
  stop(): void;
  update(dt: number, world: SiegeWorld): SiegeEvent[];
}

// The virus clock drives the spread; this drives what happens around it: spawns, the giant and the collapse.
export function createSiege(): Siege {
  let phase: SiegePhase = 'off';
  let rule = DIFFICULTY.normal;
  let zombieClock = 0;
  let eliteClock = 0;
  let t = 0;
  let timeLeft = 0;
  return {
    get phase() { return phase; },
    get rule() { return rule; },
    get timeLeft() { return timeLeft; },
    get progress() { return phase === 'forming' ? Math.min(1, t / FORM_TIME) : phase === 'collapsing' ? Math.min(1, t / COLLAPSE_TIME) : phase === 'over' ? 1 : 0; },
    get cancellable() { return phase === 'outbreak'; },
    start(r) {
      rule = r;
      phase = 'outbreak';
      zombieClock = rule.zombieEvery * 0.5;
      eliteClock = rule.eliteEvery * 0.6;
      t = 0;
      timeLeft = rule.bossTime;
    },
    stop() {
      if (phase === 'outbreak') phase = 'off';
    },
    update(dt, w) {
      const out: SiegeEvent[] = [];
      if (phase === 'outbreak') {
        if (w.allInfected) { phase = 'forming'; t = 0; out.push('form'); return out; }
        zombieClock = Math.min(rule.zombieEvery, zombieClock + dt);
        eliteClock = Math.min(rule.eliteEvery, eliteClock + dt);
        if (zombieClock >= rule.zombieEvery && w.zombies < rule.zombieCap) { zombieClock = 0; out.push('zombie'); }
        if (eliteClock >= rule.eliteEvery && w.elites < rule.eliteCap) { eliteClock = 0; out.push('elite'); }
      } else if (phase === 'forming') {
        t += dt;
        if (t >= FORM_TIME) { phase = 'boss'; timeLeft = rule.bossTime; out.push('boss'); }
      } else if (phase === 'boss') {
        if (w.bossDown) { phase = 'off'; out.push('won'); return out; }
        timeLeft = Math.max(0, timeLeft - dt);
        if (timeLeft <= 0) { phase = 'collapsing'; t = 0; out.push('collapse'); }
      } else if (phase === 'collapsing') {
        t += dt;
        if (t >= COLLAPSE_TIME) { phase = 'over'; out.push('collapsed'); }
      }
      return out;
    },
  };
}
