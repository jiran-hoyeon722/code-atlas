import type { FixCandidate } from '../../engine/battle/fixes';
import { LIMITS } from '../../engine/battle/rules';
import type { Prediction, Side } from '../../engine/battle/sim/types';
import type { Quality } from '../../engine/battle/types';
import { QualityError } from './worker/client';

export interface PredictJob {
  result: Promise<Prediction>;
  cancel(): void;
}

export interface FixesJob {
  result: Promise<FixCandidate[]>;
  cancel(): void;
}

export interface BattleDeps {
  /** Runs the pre-battle simulations; `onProgress` gets finished runs out of the total */
  predict(a: Quality, b: Quality, onProgress: (done: number, runs: number) => void): PredictJob;
  /** The loser's files most worth fixing; `loserSide` keeps the replayed matches in the real side order */
  fixes(loser: Quality, winner: Quality, loserSide: Side): FixesJob;
}

/** A failure whose message is already plain Korean for the person, not a debugging string. */
export class MeasureError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = 'MeasureError';
  }
}

export const MEASURE_MSG = {
  tooSmall: `코드가 ${LIMITS.minLines}줄보다 적어서 대결할 수 없어요`,
  unsupported: 'PHP 나 TypeScript 코드를 찾지 못했어요',
  failed: '품질을 재지 못했어요',
} as const;

export function measureError(e: unknown): Error {
  if (!(e instanceof QualityError)) return e instanceof Error ? e : new Error(String(e));
  if (e.code === 'too-small') return new MeasureError(MEASURE_MSG.tooSmall);
  if (e.code === 'unsupported') return new MeasureError(MEASURE_MSG.unsupported);
  return new MeasureError(MEASURE_MSG.failed, e.message || undefined);
}
