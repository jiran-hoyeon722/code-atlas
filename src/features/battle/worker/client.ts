/// <reference types="vite/client" />
import workerUrl from './worker.ts?worker&url';
import type { QualityProgress } from '../../../engine/battle/quality';
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

export function startQuality(
  input: RepoInput,
  opts: { prefer?: Lang; onProgress: (p: QualityProgress) => void; createWorker?: () => Worker },
): { result: Promise<Quality>; cancel(): void } {
  const worker = (opts.createWorker ?? defaultWorker)();
  let settled = false;
  let fail!: (e: Error) => void;

  const result = new Promise<Quality>((resolve, reject) => {
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
        resolve(m.quality);
      } else fail(new QualityError(m.code, m.message));
    };
    worker.onerror = (e) => fail(new QualityError('failed', e.message || 'Quality worker crashed'));
  });

  const msg: ToWorker = {
    type: 'quality',
    input,
    prefer: opts.prefer,
    wasmBase: new URL('./', document.baseURI).href,
  };
  worker.postMessage(msg);

  return { result, cancel: () => fail(new QualityCancelled()) };
}
