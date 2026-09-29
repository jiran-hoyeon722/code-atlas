import { analyze, UnsupportedRepoError } from '../../engine/analyze';
import { loadParsers, type WasmFile } from '../../engine/parsers';
import type { FromWorker, ToWorker } from './protocol';
import { wasmLocate } from './wasm';

export async function handle(
  msg: ToWorker,
  post: (m: FromWorker) => void,
  locate: (base: string) => (f: WasmFile) => string = wasmLocate,
): Promise<void> {
  try {
    const parsers = await loadParsers(locate(msg.wasmBase));
    const architecture = analyze(msg.input, parsers, {
      prefer: msg.prefer,
      onProgress: (progress) => post({ type: 'progress', progress }),
    });
    post({ type: 'done', architecture });
  } catch (e) {
    post({
      type: 'error',
      code: e instanceof UnsupportedRepoError ? 'unsupported' : 'failed',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

// Only true inside a real Worker, so importing this module from tests is side-effect free.
if (typeof self !== 'undefined' && typeof (self as { importScripts?: unknown }).importScripts === 'function') {
  self.onmessage = (e: MessageEvent<ToWorker>) => {
    void handle(e.data, (m) => (self as unknown as Worker).postMessage(m));
  };
}
