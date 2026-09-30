import type { QualityProgress } from '../../../engine/battle/quality';
import type { Quality } from '../../../engine/battle/types';
import type { Lang, RepoInput } from '../../../engine/types';

export type QualityRequest = { type: 'quality'; input: RepoInput; prefer?: Lang; wasmBase: string };

export type ToWorker = QualityRequest;

export type ErrorCode = 'unsupported' | 'too-small' | 'failed';

export type FromWorker =
  | { type: 'progress'; progress: QualityProgress }
  | { type: 'done'; quality: Quality }
  | { type: 'error'; code: ErrorCode; message: string };
