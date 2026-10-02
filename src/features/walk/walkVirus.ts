export interface VirusSite {
  x: number;
  z: number;
}

export type VirusState = 'off' | 'spreading' | 'healing';

/** Seconds for one building to go from clean to fully broken. */
export const RAMP = 3;
const HEAL_SPEED = 45;

const asList = (origin: number | readonly number[]) => (typeof origin === 'number' ? [origin] : [...origin]);
/** Per site, the distance to the nearest of `origins` (Infinity when there are none). */
const nearestOf = (sites: VirusSite[], origins: readonly number[]) =>
  sites.map((s) => origins.reduce((m, o) => Math.min(m, Math.hypot(s.x - sites[o].x, s.z - sites[o].z)), Infinity));
const jitterOf = (sites: VirusSite[], random: () => number) => Float32Array.from(sites, () => 0.85 + random() * 0.3);

/**
 * When each site catches the virus: distance from its nearest origin mapped onto `duration` seconds,
 * with some jitter so the front looks ragged instead of a perfect circle. Origins are 0.
 */
export function spreadSchedule(sites: VirusSite[], origin: number | readonly number[], duration: number, random: () => number): Float32Array {
  const dist = nearestOf(sites, asList(origin));
  const far = Math.max(1, ...dist);
  const jitter = jitterOf(sites, random);
  return Float32Array.from(dist, (d, k) => (d === 0 ? 0 : (d / far) * duration * jitter[k]));
}

/** A far-away origin keeps the hunt interesting; falls back to any site when the city is tiny. */
export function pickOrigin(sites: VirusSite[], from: VirusSite, random: () => number): number {
  const dist = sites.map((s) => Math.hypot(s.x - from.x, s.z - from.z));
  const far = Math.max(0, ...dist);
  const pool = sites.map((_, k) => k).filter((k) => dist[k] >= far * 0.35);
  const pick = pool.length ? pool : sites.map((_, k) => k);
  return pick[Math.floor(random() * pick.length)] ?? -1;
}

/**
 * `count` distinct origins spread across the city: the first away from the player, each next one among the sites
 * farthest from every origin so far (and not right next to the player), so the fronts do not merge into one.
 */
export function pickOrigins(sites: VirusSite[], from: VirusSite, count: number, random: () => number): number[] {
  const first = pickOrigin(sites, from, random);
  if (first < 0) return [];
  const out = [first];
  while (out.length < Math.min(count, sites.length)) {
    const reach = nearestOf(sites, out);
    const score = sites.map((s, k) => (out.includes(k) ? -1 : Math.min(reach[k], 1.5 * Math.hypot(s.x - from.x, s.z - from.z))));
    const best = Math.max(...score);
    const pool = score.map((_, k) => k).filter((k) => score[k] >= 0 && score[k] >= best * 0.75);
    out.push(pool[Math.floor(random() * pool.length)]);
  }
  return out;
}

export interface Virus {
  readonly state: VirusState;
  /** Every origin of this outbreak, cured or not. */
  readonly origins: readonly number[];
  /** The first origin still uncured, or -1. */
  readonly origin: number;
  /** Origins still spreading. */
  readonly active: readonly number[];
  /** Seconds since the outbreak started. */
  readonly elapsed: number;
  /** Per site, 0 = clean, 1 = fully broken. */
  readonly levels: Float32Array;
  readonly infected: number;
  /** Starts an outbreak at one or more origins that together take about `duration` seconds to reach every site. */
  start(origin: number | readonly number[], duration?: number): void;
  /** Vaccinates one origin: its front stops advancing. Returns true when that was the last one and the city starts healing. */
  cureOrigin(site: number): boolean;
  /** Vaccinates every origin at once. */
  cure(): void;
  /** Advances the clock; returns true when any level changed. */
  update(dt: number): boolean;
}

export function createVirus(sites: VirusSite[], duration: number, random: () => number): Virus {
  const levels = new Float32Array(sites.length);
  let infectAt: Float32Array = new Float32Array(sites.length);
  let healAt: Float32Array = new Float32Array(sites.length);
  let peak: Float32Array = new Float32Array(sites.length);
  let jitter: Float32Array = new Float32Array(sites.length);
  let perMetre = 0;
  let state: VirusState = 'off';
  let origins: number[] = [];
  let active: number[] = [];
  let clock = 0;
  let healClock = 0;
  let infected = 0;

  const heal = () => {
    state = 'healing';
    active = [];
    healClock = 0;
    peak = levels.slice();
    healAt = Float32Array.from(nearestOf(sites, origins), (d) => d / HEAL_SPEED);
  };

  return {
    get state() { return state; },
    get origins() { return origins; },
    get origin() { return active[0] ?? -1; },
    get active() { return active; },
    get elapsed() { return clock; },
    get infected() { return infected; },
    levels,
    start(o, spread = duration) {
      const list = [...new Set(asList(o))].filter((k) => k >= 0 && k < sites.length);
      if (!list.length) return;
      origins = list;
      active = [...list];
      state = 'spreading';
      clock = 0;
      infected = 0;
      levels.fill(0);
      jitter = jitterOf(sites, random);
      const dist = nearestOf(sites, list);
      perMetre = spread / Math.max(1, ...dist);
      infectAt = Float32Array.from(dist, (d, k) => (d === 0 ? 0 : d * perMetre * jitter[k]));
    },
    cureOrigin(site) {
      if (state !== 'spreading' || !active.includes(site)) return false;
      active = active.filter((k) => k !== site);
      if (!active.length) { heal(); return true; }
      // Buildings the cured front had not reached yet now wait for the remaining origins.
      const dist = nearestOf(sites, active);
      for (let k = 0; k < sites.length; k++) {
        if (infectAt[k] > clock) infectAt[k] = Math.max(infectAt[k], dist[k] * perMetre * jitter[k]);
      }
      return false;
    },
    cure() {
      if (state !== 'spreading') return;
      heal();
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
      if (!left) { state = 'off'; origins = []; }
      return true;
    },
  };
}

export type Difficulty = 'easy' | 'normal' | 'hard' | 'hell' | 'god';

/** Multipliers on a foe's base hp, hit damage and walking speed. */
export interface FoeScale {
  hp: number;
  damage: number;
  speed: number;
}

export interface DifficultyRule {
  label: string;
  /** Buildings the outbreak starts from at once; every one must be vaccinated. */
  origins: number;
  /** Seconds for the virus to reach every building. */
  spread: number;
  zombieEvery: number;
  zombieCap: number;
  eliteEvery: number;
  eliteCap: number;
  foe: FoeScale;
  /** Glowing arrows on the road lead to the origin. */
  guide: boolean;
  /** Reserved for a later task: zombies hunt the player across the city instead of waiting until they see them. */
  chase: boolean;
  /** Reserved for a later task: armoured tank foes join the outbreak. */
  tank: boolean;
}

/** Seconds the whole mode may take, from the outbreak to the giant's death, before the repo collapses. */
export const TIME_LIMIT = 600;

export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard', 'hell', 'god'];
export const DIFFICULTY: Record<Difficulty, DifficultyRule> = {
  easy: { label: '쉬움', origins: 1, spread: 420, zombieEvery: 2.4, zombieCap: 24, eliteEvery: 40, eliteCap: 3, foe: { hp: 1, damage: 1, speed: 1 }, guide: true, chase: false, tank: false },
  normal: { label: '보통', origins: 2, spread: 300, zombieEvery: 1.6, zombieCap: 32, eliteEvery: 30, eliteCap: 4, foe: { hp: 1.2, damage: 1.1, speed: 1.05 }, guide: false, chase: false, tank: false },
  hard: { label: '어려움', origins: 3, spread: 210, zombieEvery: 1, zombieCap: 45, eliteEvery: 22, eliteCap: 6, foe: { hp: 1.5, damage: 1.3, speed: 1.1 }, guide: false, chase: true, tank: false },
  hell: { label: '지옥', origins: 4, spread: 150, zombieEvery: 0.65, zombieCap: 60, eliteEvery: 15, eliteCap: 8, foe: { hp: 2, damage: 1.6, speed: 1.2 }, guide: false, chase: true, tank: true },
  god: { label: '신', origins: 5, spread: 100, zombieEvery: 0.4, zombieCap: 80, eliteEvery: 10, eliteCap: 12, foe: { hp: 2.6, damage: 2, speed: 1.3 }, guide: false, chase: true, tank: true },
};
export const MAX_ORIGINS = Math.max(...DIFFICULTIES.map((d) => DIFFICULTY[d].origins));
export const isDifficulty = (v: unknown): v is Difficulty => DIFFICULTIES.includes(v as Difficulty);
/** The difficulty saved in storage, or normal when it is missing or unknown. Older saves used easy/normal/hard, which are still valid. */
export const storedDifficulty = (v: unknown): Difficulty => (isDifficulty(v) ? v : 'normal');

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
/** Seconds the city takes to sink when the time limit runs out. */
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
  /** Seconds left on the mode's clock; at 0 the repo collapses whatever the phase. */
  readonly timeLeft: number;
  /** 0 → 1 through the forming and collapsing phases. */
  readonly progress: number;
  /** Once the giant has formed there is no backing out. */
  readonly cancellable: boolean;
  start(rule: DifficultyRule, limit?: number): void;
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
    start(r, limit = TIME_LIMIT) {
      rule = r;
      phase = 'outbreak';
      zombieClock = rule.zombieEvery * 0.5;
      eliteClock = rule.eliteEvery * 0.6;
      t = 0;
      timeLeft = limit;
    },
    stop() {
      if (phase === 'outbreak') phase = 'off';
    },
    update(dt, w) {
      const out: SiegeEvent[] = [];
      if (phase === 'boss' && w.bossDown) { phase = 'off'; out.push('won'); return out; }
      if (phase === 'outbreak' || phase === 'forming' || phase === 'boss') {
        timeLeft = Math.max(0, timeLeft - dt);
        if (timeLeft <= 0) { phase = 'collapsing'; t = 0; out.push('collapse'); return out; }
      }
      if (phase === 'outbreak') {
        if (w.allInfected) { phase = 'forming'; t = 0; out.push('form'); return out; }
        zombieClock = Math.min(rule.zombieEvery, zombieClock + dt);
        eliteClock = Math.min(rule.eliteEvery, eliteClock + dt);
        if (zombieClock >= rule.zombieEvery && w.zombies < rule.zombieCap) { zombieClock = 0; out.push('zombie'); }
        if (eliteClock >= rule.eliteEvery && w.elites < rule.eliteCap) { eliteClock = 0; out.push('elite'); }
      } else if (phase === 'forming') {
        t += dt;
        if (t >= FORM_TIME) { phase = 'boss'; out.push('boss'); }
      } else if (phase === 'collapsing') {
        t += dt;
        if (t >= COLLAPSE_TIME) { phase = 'over'; out.push('collapsed'); }
      }
      return out;
    },
  };
}
