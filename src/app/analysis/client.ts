/// <reference types="vite/client" />
import workerUrl from './worker.ts?worker&url';
import type { Architecture } from '../../engine/architecture';
import type { Progress } from '../../engine/analyze';
import type { PackedQuality } from '../../engine/battle/pack';
import type { QualityIssue } from '../../engine/battle/quality';
import type { Lang, RepoInput } from '../../engine/types';
import type { FromWorker, ToWorker } from './protocol';

export class AnalysisCancelled extends Error {
  constructor() {
    super('Analysis cancelled');
    this.name = 'AnalysisCancelled';
  }
}

export class UnsupportedRepo extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedRepo';
  }
}

// A worker loaded from its own URL takes CSP from response headers (none on static hosting);
// a blob: worker inherits the document's meta CSP, so the repo sources stay behind connect-src 'self'.
const defaultWorker = () => {
  const src = `import ${JSON.stringify(new URL(workerUrl, document.baseURI).href)};`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const worker = new Worker(url, { type: 'module' });
  const revoke = () => URL.revokeObjectURL(url);
  worker.addEventListener('message', revoke, { once: true });
  worker.addEventListener('error', revoke, { once: true });
  return worker;
};

export interface AnalysisResult {
  architecture: Architecture;
  /** battle data, already packed for the cache; null when it could not be measured */
  quality: PackedQuality | null;
  qualityIssue?: QualityIssue;
}

export function startAnalysis(
  input: RepoInput,
  opts: { prefer?: Lang; onProgress: (p: Progress) => void; createWorker?: () => Worker },
): { result: Promise<AnalysisResult>; cancel(): void } {
  const worker = (opts.createWorker ?? defaultWorker)();
  let settled = false;
  let fail!: (e: Error) => void;

  const result = new Promise<AnalysisResult>((resolve, reject) => {
    const finish = () => {
      settled = true;
      worker.terminate();
    };
    fail = (e) => {
      if (settled) return;
      finish();
      reject(e);
    };
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      if (settled) return;
      const m = e.data;
      if (m.type === 'progress') opts.onProgress(m.progress);
      else if (m.type === 'done') {
        finish();
        resolve({ architecture: m.architecture, quality: m.quality ?? null, ...(m.qualityIssue && { qualityIssue: m.qualityIssue }) });
      } else fail(m.code === 'unsupported' ? new UnsupportedRepo(m.message) : new Error(m.message));
    };
    worker.onerror = (e) => fail(new Error(e.message || 'Analysis worker crashed'));
  });

  const msg: ToWorker = {
    type: 'analyze',
    input,
    prefer: opts.prefer,
    wasmBase: new URL('./', document.baseURI).href,
  };
  worker.postMessage(msg);

  return { result, cancel: () => fail(new AnalysisCancelled()) };
}
