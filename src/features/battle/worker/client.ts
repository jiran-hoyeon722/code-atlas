/// <reference types="vite/client" />
import workerUrl from './worker.ts?worker&url';
import type { FixCandidate } from '../../../engine/battle/fixes';
import type { QualityProgress } from '../../../engine/battle/quality';
import { PREDICTION_RUNS } from '../../../engine/battle/rules';
import type { Prediction, Side } from '../../../engine/battle/sim/types';
import type { Quality } from '../../../engine/battle/types';
import type { Lang, RepoInput } from '../../../engine/types';
import type { ErrorCode, FromWorker, ToWorker } from './protocol';

export class QualityCancelled extends Error {
  constructor() {
    super('Quality measurement cancelled');
    this.name = 'QualityCancelled';
  }
}

export class QualityError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'QualityError';
  }
}

export interface WorkerJob<T> {
  result: Promise<T>;
  cancel(): void;
}

// Same blob: wrapper as the analysis client: a blob: worker inherits the document's meta CSP.
const defaultWorker = () => {
  const src = `import ${JSON.stringify(new URL(workerUrl, document.baseURI).href)};`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const worker = new Worker(url, { type: 'module' });
  const revoke = () => URL.revokeObjectURL(url);
  worker.addEventListener('message', revoke, { once: true });
  worker.addEventListener('error', revoke, { once: true });
  return worker;
};

/** One worker per job: posts `msg`, feeds replies to `onMessage` until it resolves, then terminates. */
function run<T>(
  msg: ToWorker,
  createWorker: (() => Worker) | undefined,
  onMessage: (m: FromWorker, resolve: (v: T) => void) => void,
): WorkerJob<T> {
  const worker = (createWorker ?? defaultWorker)();
  let settled = false;
  let fail!: (e: Error) => void;

  const result = new Promise<T>((resolve, reject) => {
    const finish = () => {
      settled = true;
      worker.terminate();
    };
    fail = (e) => {
      if (settled) return;
      finish();
      reject(e);
    };
    const ok = (v: T) => {
      finish();
      resolve(v);
    };
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      if (settled) return;
      const m = e.data;
      if (m.type === 'error') fail(new QualityError(m.code, m.message));
      else onMessage(m, ok);
    };
    worker.onerror = (e) => fail(new QualityError('failed', e.message || 'Battle worker crashed'));
  });

  worker.postMessage(msg);
  return { result, cancel: () => fail(new QualityCancelled()) };
}

export function startQuality(
  input: RepoInput,
  opts: { prefer?: Lang; onProgress: (p: QualityProgress) => void; createWorker?: () => Worker },
): WorkerJob<Quality> {
  const msg: ToWorker = { type: 'quality', input, prefer: opts.prefer, wasmBase: new URL('./', document.baseURI).href };
  return run<Quality>(msg, opts.createWorker, (m, resolve) => {
    if (m.type === 'progress') opts.onProgress(m.progress);
    else if (m.type === 'done') resolve(m.quality);
  });
}

export function startPredict(
  a: Quality,
  b: Quality,
  opts: { runs?: number; onProgress: (done: number, runs: number) => void; createWorker?: () => Worker },
): WorkerJob<Prediction> {
  const msg: ToWorker = { type: 'predict', a, b, runs: opts.runs ?? PREDICTION_RUNS };
  return run<Prediction>(msg, opts.createWorker, (m, resolve) => {
    if (m.type === 'predict-progress') opts.onProgress(m.done, m.runs);
    else if (m.type === 'predict-done') resolve(m.prediction);
  });
}

export const FIX_SEEDS = 20;
export const FIX_COUNT = 5;

export function startFixes(
  loser: Quality,
  winner: Quality,
  loserSide: Side,
  opts: { seeds?: number; count?: number; createWorker?: () => Worker } = {},
): WorkerJob<FixCandidate[]> {
  const msg: ToWorker = { type: 'fixes', loser, winner, loserSide, seeds: opts.seeds ?? FIX_SEEDS, count: opts.count ?? FIX_COUNT };
  return run<FixCandidate[]>(msg, opts.createWorker, (m, resolve) => {
    if (m.type === 'fixes-done') resolve(m.fixes);
  });
}
