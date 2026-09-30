import { UnsupportedRepoError } from '../../../engine/analyze';
import { buildQuality, TooSmallRepoError } from '../../../engine/battle/quality';
import { loadParsers, type WasmFile } from '../../../engine/parsers';
import { wasmLocate } from '../../../app/analysis/wasm';
import type { ErrorCode, FromWorker, ToWorker } from './protocol';

const codeOf = (e: unknown): ErrorCode =>
  e instanceof UnsupportedRepoError ? 'unsupported' : e instanceof TooSmallRepoError ? 'too-small' : 'failed';

export async function handle(
  msg: ToWorker,
  post: (m: FromWorker) => void,
  locate: (base: string) => (f: WasmFile) => string = wasmLocate,
): Promise<void> {
  try {
    const parsers = await loadParsers(locate(msg.wasmBase));
    const quality = buildQuality(msg.input, parsers, {
      prefer: msg.prefer,
      onProgress: (progress) => post({ type: 'progress', progress }),
    });
    post({ type: 'done', quality });
  } catch (e) {
    post({ type: 'error', code: codeOf(e), message: e instanceof Error ? e.message : String(e) });
  }
}

// Only true inside a real Worker, so importing this module from tests is side-effect free.
if (typeof self !== 'undefined' && typeof (self as { importScripts?: unknown }).importScripts === 'function') {
  self.onmessage = (e: MessageEvent<ToWorker>) => {
    void handle(e.data, (m) => (self as unknown as Worker).postMessage(m));
  };
}
