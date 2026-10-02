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
  return separationInto([0, 0], ax, az, bx, bz, min, fallback);
}

/** `separation` written into `out`, so a crowd can run it for every pair without allocating. */
export function separationInto(out: [number, number], ax: number, az: number, bx: number, bz: number, min: number, fallback: number): [number, number] {
  const dx = ax - bx, dz = az - bz;
  const d = Math.hypot(dx, dz);
  if (d >= min) { out[0] = 0; out[1] = 0; }
  else if (d < 1e-4) { out[0] = Math.sin(fallback) * min; out[1] = Math.cos(fallback) * min; }
  else { const k = (min - d) / d; out[0] = dx * k; out[1] = dz * k; }
  return out;
}

/** Whether (a) and (b) are certainly at least `min` apart, without a square root; a cheap reject before `separation`. */
export const apart = (ax: number, az: number, bx: number, bz: number, min: number) => {
  const dx = ax - bx, dz = az - bz;
  // A hair of slack so a pair right on the edge still goes through the exact check.
  return dx * dx + dz * dz > min * min * (1 + 1e-9);
};

/**
 * How far along a line a beam gets before the first wall, probing whole `step`s: the result is the first step whose
 * farthest interior sample (as a 0.8 m `clearLine` from the origin would place it) is solid, else `range`. One probe
 * per step instead of re-walking the whole line each time; same answer for walls thicker than a sample gap.
 */
export function reachAlong(range: number, solid: (d: number) => boolean, step = 0.75, spacing = 0.8): number {
  for (let t = step; t <= range; t += step) {
    const n = Math.ceil(t / spacing);
    if (n > 1 && solid((t * (n - 1)) / n)) return t;
  }
  return range;
}

/** Share of the gap to close this frame; unlike `dt * rate` it feels the same at 60 Hz and 144 Hz. */
export const follow = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

// Sums of sines at unrelated frequencies: smooth like noise, but cheap and repeatable.
const wobble = (t: number, a: number, b: number, c: number) => (Math.sin(t * a) + Math.sin(t * b + 1.7) * 0.6 + Math.sin(t * c + 4.1) * 0.3) / 1.9;

/** Camera offset for a shake of `amount` (0–1). Squared so small hits stay subtle and big ones land hard. */
export function shakeOffset(time: number, amount: number) {
  const k = Math.min(1, Math.max(0, amount)) ** 2;
  return {
    x: wobble(time, 17, 26, 39) * 0.45 * k,
    y: wobble(time, 19, 29, 43) * 0.3 * k,
    roll: wobble(time, 13, 22, 35) * 0.05 * k,
  };
}
