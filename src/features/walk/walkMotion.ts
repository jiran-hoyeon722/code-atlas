export type Gait = 'Idle' | 'Walking' | 'Running';

// Separate on/off speeds so a speed hovering near one threshold does not restart the cross-fade every frame.
export const GAIT = { walkOn: 0.6, walkOff: 0.25, runOn: 6.4, runOff: 5.4 };

export function nextGait(prev: Gait, speed: number): Gait {
  if (speed > (prev === 'Running' ? GAIT.runOff : GAIT.runOn)) return 'Running';
  return speed > (prev === 'Idle' ? GAIT.walkOn : GAIT.walkOff) ? 'Walking' : 'Idle';
}

/** A state that turns on below `enter` and stays on until `value` passes `exit`. */
export const within = (on: boolean, value: number, enter: number, exit: number) => value < (on ? exit : enter);

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Eases `from` toward `to` the short way round, never faster than `maxSpeed` rad/s. */
export function turnToward(from: number, to: number, dt: number, rate: number, maxSpeed: number) {
  const step = wrapAngle(to - from) * Math.min(1, dt * rate);
  const cap = maxSpeed * dt;
  return from + Math.max(-cap, Math.min(cap, step));
}

export const decay = (v: number, rate: number, dt: number) => v * Math.exp(-rate * dt);

/** How far (a) must move to sit at least `min` from (b); `fallback` is the direction when both share a spot. */
export function separation(ax: number, az: number, bx: number, bz: number, min: number, fallback: number): [number, number] {
  const dx = ax - bx, dz = az - bz;
  const d = Math.hypot(dx, dz);
  if (d >= min) return [0, 0];
  if (d < 1e-4) return [Math.sin(fallback) * min, Math.cos(fallback) * min];
  const k = (min - d) / d;
  return [dx * k, dz * k];
}
