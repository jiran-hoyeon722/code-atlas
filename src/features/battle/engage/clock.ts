import type { Battle } from '../../../engine/battle/sim';

/** Seconds of battle per sim tick at 1×. */
export const TICK_SECONDS = 0.1;

export type Speed = 1 | 2;

export interface Clock {
  /** Playback position in ticks (fractional between ticks). */
  t: number;
  end: number;
  speed: Speed;
  paused: boolean;
}

export function createClock(end: number): Clock {
  return { t: 0, end, speed: 1, paused: false };
}

export const isDone = (c: Clock) => c.t >= c.end;

export function advance(c: Clock, dtSeconds: number): Clock {
  if (c.paused || isDone(c) || dtSeconds <= 0) return c;
  // A background tab can hand back a huge dt; cap it so playback never lurches ahead.
  const dt = Math.min(dtSeconds, 0.25);
  return { ...c, t: Math.min(c.end, c.t + (dt / TICK_SECONDS) * c.speed) };
}

export const togglePause = (c: Clock): Clock => (isDone(c) ? c : { ...c, paused: !c.paused });

export const setSpeed = (c: Clock, speed: Speed): Clock => ({ ...c, speed });

/** Jumps forward only; never rewinds past what was already shown. */
export function seek(c: Clock, tick: number): Clock {
  return { ...c, t: Math.max(c.t, Math.min(c.end, tick)) };
}

/** Sim tick the stepper must sit on to draw playback position `t` (it interpolates from the tick before). */
export const targetTick = (c: Clock) => Math.max(0, Math.min(c.end, Math.ceil(c.t - 1e-9)));

/** Blend factor between the previous tick and `targetTick`. */
export function blend(c: Clock): number {
  const k = targetTick(c);
  if (k <= 0) return 1;
  return Math.max(0, Math.min(1, c.t - (k - 1)));
}

/** Steps `battle` up to `tick`; calls `beforeStep` ahead of each step so callers can keep the previous frame. */
export function syncBattle(battle: Battle, tick: number, beforeStep?: () => void): number {
  let steps = 0;
  while (battle.tick < tick && !battle.done) {
    beforeStep?.();
    battle.step();
    steps++;
  }
  return steps;
}

/** Cubic-bezier easing (x1, y1, x2, y2) solved for y at progress x in [0, 1]. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const bx = (s: number) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
  const by = (s: number) => 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (bx(mid) < x) lo = mid;
      else hi = mid;
    }
    return by((lo + hi) / 2);
  };
}

export const ease = cubicBezier(0.2, 0.8, 0.2, 1);
