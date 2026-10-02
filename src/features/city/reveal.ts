/** How long one building takes to rise, in ms. */
export const REVEAL_GROW = 600;

/** Front rows rise first, then the wave sweeps left to right inside each row. */
export const revealDelay = (layer: number, x: number, width: number) =>
  layer * 180 + Math.max(0, Math.min(1, x / Math.max(1, width) + 0.5)) * 250;

/** Height share at progress `p` (0–1): overshoots a little and settles, never quite zero so the mesh stays pickable. */
export function revealGrowth(p: number) {
  if (p <= 0) return 0.001;
  if (p >= 1) return 1;
  const c = 1.4;
  const q = p - 1;
  return Math.max(0.001, 1 + (c + 1) * q ** 3 + c * q ** 2);
}
