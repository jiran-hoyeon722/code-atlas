import type { Prediction } from '../../engine/battle/sim/types';

/** Win shares out of the prediction runs, the shape the replay and result screens read. */
export function priorShares(p: Prediction): { a: number; b: number } {
  const runs = Math.max(1, p.runs);
  return { a: p.aWins / runs, b: p.bWins / runs };
}
