import type { Architecture } from '../../engine/architecture';
import type { Progress } from '../../engine/analyze';
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

const defaultWorker = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

export function startAnalysis(
  input: RepoInput,
  opts: { prefer?: Lang; onProgress: (p: Progress) => void; createWorker?: () => Worker },
): { result: Promise<Architecture>; cancel(): void } {
  const worker = (opts.createWorker ?? defaultWorker)();
  let settled = false;
  let fail!: (e: Error) => void;

  const result = new Promise<Architecture>((resolve, reject) => {
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
        resolve(m.architecture);
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
