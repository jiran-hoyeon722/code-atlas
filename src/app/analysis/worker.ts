import { analyze, UnsupportedRepoError, type AnalyzeOptions } from '../../engine/analyze';
import { packQuality, type PackedQuality } from '../../engine/battle/pack';
import { analyzeWithQuality, type AnalysisWithQuality, type QualityIssue } from '../../engine/battle/quality';
import { detect } from '../../engine/detect';
import { loadParsers, type Parsers, type WasmFile } from '../../engine/parsers';
import type { RepoInput } from '../../engine/types';
import type { FromWorker, ToWorker } from './protocol';
import { wasmLocate } from './wasm';

/** Battle data rides along with the analysis; any failure there falls back to the plain analysis. */
function analyzeBoth(input: RepoInput, parsers: Parsers, opts: AnalyzeOptions): AnalysisWithQuality {
  try {
    return analyzeWithQuality(input, parsers, opts);
  } catch (e) {
    if (e instanceof UnsupportedRepoError) throw e;
    return { architecture: analyze(input, parsers, opts), quality: null, qualityIssue: 'failed' };
  }
}

export async function handle(
  msg: ToWorker,
  post: (m: FromWorker) => void,
  locate: (base: string) => (f: WasmFile) => string = wasmLocate,
): Promise<void> {
  try {
    const detection = detect(msg.input, msg.prefer);
    if (!detection) throw new UnsupportedRepoError();
    const parsers = await loadParsers(locate(msg.wasmBase), [detection.lang]);
    const r = analyzeBoth(msg.input, parsers, {
      prefer: msg.prefer,
      onProgress: (progress) => post({ type: 'progress', progress }),
    });
    let quality: PackedQuality | null = null;
    let qualityIssue: QualityIssue | undefined = r.qualityIssue;
    if (r.quality) {
      try {
        quality = packQuality(r.quality);
      } catch {
        qualityIssue = 'failed';
      }
    }
    post({ type: 'done', architecture: r.architecture, quality, ...(qualityIssue && { qualityIssue }) });
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
