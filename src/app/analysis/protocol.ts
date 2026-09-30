import type { Architecture } from '../../engine/architecture';
import type { Progress } from '../../engine/analyze';
import type { PackedQuality } from '../../engine/battle/pack';
import type { QualityIssue } from '../../engine/battle/quality';
import type { Lang, RepoInput } from '../../engine/types';

export type ToWorker = { type: 'analyze'; input: RepoInput; prefer?: Lang; wasmBase: string };

export type FromWorker =
  | { type: 'progress'; progress: Progress }
  | { type: 'done'; architecture: Architecture; quality: PackedQuality | null; qualityIssue?: QualityIssue }
  | { type: 'error'; code: 'unsupported' | 'failed'; message: string };
