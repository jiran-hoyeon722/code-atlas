export interface RoofRect { x: number; z: number; w: number; d: number }

/** Keeps (x, z) on the rectangle, `margin` in from every edge; a roof thinner than two margins pins to its centre line. */
export function clampToRoof(r: RoofRect, x: number, z: number, margin: number) {
  const hx = Math.max(0, r.w / 2 - margin), hz = Math.max(0, r.d / 2 - margin);
  return { x: Math.min(r.x + hx, Math.max(r.x - hx, x)), z: Math.min(r.z + hz, Math.max(r.z - hz, z)) };
}

export const overRoof = (r: RoofRect, x: number, z: number) => Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.d / 2;

/** The closest point `pad` outside the rectangle's nearest side, for someone who landed inside a footprint. */
export function streetExit(r: RoofRect, x: number, z: number, pad: number) {
  const sides = [
    { d: r.x + r.w / 2 - x, x: r.x + r.w / 2 + pad, z },
    { d: x - (r.x - r.w / 2), x: r.x - r.w / 2 - pad, z },
    { d: r.z + r.d / 2 - z, x, z: r.z + r.d / 2 + pad },
    { d: z - (r.z - r.d / 2), x, z: r.z - r.d / 2 - pad },
  ];
  const best = sides.reduce((a, b) => (b.d < a.d ? b : a));
  return { x: best.x, z: best.z };
}

/** Height of a gable roof above its eaves at `dz` from the ridge line, for a roof `depth` deep that peaks at `ridge`. */
export const gableLift = (ridge: number, depth: number, dz: number) => ridge * Math.max(0, 1 - (2 * Math.abs(dz)) / depth);

/** Where the climb is at time `t` (0..1): straight up the wall first, then across onto the roof (or the reverse going down). */
export function climbPath(t: number, from: { x: number; z: number; y: number }, to: { x: number; z: number; y: number }, up: boolean) {
  const k = Math.min(1, Math.max(0, t));
  const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
  const split = 0.6;
  const vertical = up ? Math.min(1, k / split) : Math.max(0, (k - (1 - split)) / split);
  const across = up ? Math.max(0, (k - split) / (1 - split)) : Math.min(1, k / (1 - split));
  const a = ease(across), v = ease(vertical);
  return { x: from.x + (to.x - from.x) * a, z: from.z + (to.z - from.z) * a, y: from.y + (to.y - from.y) * v };
}
