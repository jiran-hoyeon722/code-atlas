import { vi } from 'vitest';
import type { FixCandidate } from '../../../src/engine/battle/fixes';
import type { Prediction, Side } from '../../../src/engine/battle/sim/types';
import type { Quality, QualityFile } from '../../../src/engine/battle/types';
import type { RepoInput } from '../../../src/engine/types';
import type { BattleDeps } from '../../../src/features/battle/deps';
import type { FromWorker } from '../../../src/features/battle/worker/protocol';

export function qfile(path: string, lines: number, over: Partial<QualityFile> = {}): QualityFile {
  return { path, lines, functions: [], ccnTier: [], lenTier: [], clone: [], removable: [], cycle: -1, centrality: 0, ...over };
}

/** A synthetic measured repo; `files` defaults to one file holding all production lines. */
export function quality(name: string, over: Partial<Quality> = {}): Quality {
  const prodLines = over.totals?.prodLines ?? 184_321;
  return {
    ruleVersion: '1.4',
    name,
    lang: 'ts',
    fingerprint: 'f',
    config: { sourceDir: '', exclude: [], testPatterns: [], excludedLines: 0 },
    totals: { prodLines, testLines: 0, testFiles: 0 },
    files: [qfile('src/app/main.ts', Math.max(prodLines, 300))],
    clones: [],
    cycles: [],
    commander: { files: ['src/app/main.ts'], display: 'main.ts' },
    scores: { readability: 0, complexityExcess: 0, lengthExcess: 0, tangle: 0, duplication: 0, duplicationExcess: 0, tests: 0, hotspot: null },
    warnings: [],
    ...over,
  };
}

interface Deferred<T> {
  resolve(v: T): void;
  reject(e: unknown): void;
  cancel: ReturnType<typeof vi.fn>;
}

export interface MeasureRun extends Deferred<Quality> {
  input: RepoInput;
  progress(step: string): void;
}

export interface PredictRun extends Deferred<Prediction> {
  a: Quality;
  b: Quality;
  progress(done: number, runs: number): void;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const result = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { result, resolve, reject, cancel: vi.fn() };
}

export interface FixesRun extends Deferred<FixCandidate[]> {
  loser: Quality;
  winner: Quality;
  loserSide: Side;
}

export function fakes(pickDirectory: BattleDeps['pickDirectory'] = null) {
  const runs: MeasureRun[] = [];
  const predictions: PredictRun[] = [];
  const fixes: FixesRun[] = [];
  const deps: BattleDeps = {
    pickDirectory,
    measure(input, onProgress) {
      const d = deferred<Quality>();
      runs.push({ input, progress: onProgress, resolve: d.resolve, reject: d.reject, cancel: d.cancel });
      return { result: d.result, cancel: d.cancel };
    },
    predict(a, b, onProgress) {
      const d = deferred<Prediction>();
      predictions.push({ a, b, progress: onProgress, resolve: d.resolve, reject: d.reject, cancel: d.cancel });
      return { result: d.result, cancel: d.cancel };
    },
    fixes(loser, winner, loserSide) {
      const d = deferred<FixCandidate[]>();
      fixes.push({ loser, winner, loserSide, resolve: d.resolve, reject: d.reject, cancel: d.cancel });
      return { result: d.result, cancel: d.cancel };
    },
  };
  return { deps, runs, predictions, fixes };
}

export class FakeWorker {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminate = vi.fn();
  posted: unknown[] = [];
  constructor(private readonly reply?: (m: unknown, w: FakeWorker) => void) {}
  postMessage(m: unknown) {
    this.posted.push(m);
    if (this.reply) queueMicrotask(() => this.reply!(m, this));
  }
  addEventListener() {}
  emit(m: FromWorker) {
    this.onmessage?.({ data: m } as MessageEvent<FromWorker>);
  }
}
