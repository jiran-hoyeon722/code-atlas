import type { QualityProgress } from '../../../engine/battle/quality';
import type { Prediction } from '../../../engine/battle/sim/types';
import type { Quality } from '../../../engine/battle/types';
import type { Lang, RepoInput } from '../../../engine/types';

export type QualityRequest = { type: 'quality'; input: RepoInput; prefer?: Lang; wasmBase: string };

export type PredictRequest = { type: 'predict'; a: Quality; b: Quality; runs: number };

export type ToWorker = QualityRequest | PredictRequest;

export type ErrorCode = 'unsupported' | 'too-small' | 'failed';

export type FromWorker =
  | { type: 'progress'; progress: QualityProgress }
  | { type: 'done'; quality: Quality }
  | { type: 'predict-progress'; done: number; runs: number }
  | { type: 'predict-done'; prediction: Prediction }
  | { type: 'error'; code: ErrorCode; message: string };
