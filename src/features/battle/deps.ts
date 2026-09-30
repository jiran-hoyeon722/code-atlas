import type { QualityProgress } from '../../engine/battle/quality';
import { LIMITS } from '../../engine/battle/rules';
import type { Prediction } from '../../engine/battle/sim/types';
import type { Quality } from '../../engine/battle/types';
import type { RepoInput } from '../../engine/types';
import { QualityError, startPredict, startQuality } from './worker/client';

export interface MeasureJob {
  result: Promise<Quality>;
  cancel(): void;
}

export interface PredictJob {
  result: Promise<Prediction>;
  cancel(): void;
}

export interface BattleDeps {
  /** null when the browser has no `showDirectoryPicker`: the hidden folder input is used instead */
  pickDirectory: (() => Promise<FileSystemDirectoryHandle>) | null;
  /** `onProgress` receives a plain Korean line describing the current step */
  measure(input: RepoInput, onProgress: (step: string) => void): MeasureJob;
  /** Runs the pre-battle simulations; `onProgress` gets finished runs out of the total */
  predict(a: Quality, b: Quality, onProgress: (done: number, runs: number) => void): PredictJob;
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

export function measureStep(p: QualityProgress): string {
  switch (p.phase) {
    case 'analyze':
      return '구조를 읽는 중';
    case 'functions':
      return `함수 재는 중 · 파일 ${p.done.toLocaleString('ko-KR')}/${p.total.toLocaleString('ko-KR')}개`;
    case 'clones':
      return '복붙한 코드 찾는 중';
    case 'graph':
      return '얽힌 코드 찾는 중';
  }
}

export function measureError(e: unknown): Error {
  if (!(e instanceof QualityError)) return e instanceof Error ? e : new Error(String(e));
  if (e.code === 'too-small') return new MeasureError(MEASURE_MSG.tooSmall);
  if (e.code === 'unsupported') return new MeasureError(MEASURE_MSG.unsupported);
  return new MeasureError(MEASURE_MSG.failed, e.message || undefined);
}

function nativePicker(): BattleDeps['pickDirectory'] {
  const w = globalThis as unknown as { showDirectoryPicker?: (o: { mode: 'read' }) => Promise<FileSystemDirectoryHandle> };
  return typeof w.showDirectoryPicker === 'function' ? () => w.showDirectoryPicker!({ mode: 'read' }) : null;
}

/** The single wiring point. `createWorker` lets tests swap the real worker for a fake one. */
export function defaultDeps(opts: { createWorker?: () => Worker } = {}): BattleDeps {
  const { createWorker } = opts;
  return {
    pickDirectory: nativePicker(),
    measure(input, onProgress) {
      let last = '';
      let lastPhase = '';
      let at = 0;
      const job = startQuality(input, {
        createWorker,
        onProgress(p) {
          const text = measureStep(p);
          const now = Date.now();
          // per-file progress on big repos would re-render thousands of times; ~10 a second looks alive
          if (text === last || (p.phase === lastPhase && now - at < 100)) return;
          last = text;
          lastPhase = p.phase;
          at = now;
          onProgress(text);
        },
      });
      return { result: job.result.catch((e: unknown) => Promise.reject(measureError(e))), cancel: job.cancel };
    },
    predict(a, b, onProgress) {
      return startPredict(a, b, { createWorker, onProgress });
    },
  };
}
