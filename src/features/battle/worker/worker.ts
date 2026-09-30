import { UnsupportedRepoError } from '../../../engine/analyze';
import { fixCandidates } from '../../../engine/battle/fixes';
import { buildQuality, TooSmallRepoError } from '../../../engine/battle/quality';
import { buildArmy, createBattleFromArmies } from '../../../engine/battle/sim';
import type { Prediction } from '../../../engine/battle/sim/types';
import { loadParsers, type WasmFile } from '../../../engine/parsers';
import { wasmLocate } from '../../../app/analysis/wasm';
import type { ErrorCode, FromWorker, PredictRequest, QualityRequest, ToWorker } from './protocol';

const codeOf = (e: unknown): ErrorCode =>
  e instanceof UnsupportedRepoError ? 'unsupported' : e instanceof TooSmallRepoError ? 'too-small' : 'failed';

async function measure(msg: QualityRequest, post: (m: FromWorker) => void, locate: (base: string) => (f: WasmFile) => string) {
  const parsers = await loadParsers(locate(msg.wasmBase));
  const quality = buildQuality(msg.input, parsers, {
    prefer: msg.prefer,
    onProgress: (progress) => post({ type: 'progress', progress }),
  });
  post({ type: 'done', quality });
}

// Same loop as the engine's predict(), unrolled here so every finished match can report progress.
function predictRuns(msg: PredictRequest, post: (m: FromWorker) => void) {
  const armyA = buildArmy(msg.a);
  const armyB = buildArmy(msg.b);
  const prediction: Prediction = { runs: msg.runs, aWins: 0, bWins: 0, draws: 0 };
  for (let match = 1; match <= msg.runs; match++) {
    const { winner } = createBattleFromArmies(armyA, armyB, match).run();
    if (winner === 'a') prediction.aWins++;
    else if (winner === 'b') prediction.bWins++;
    else prediction.draws++;
    post({ type: 'predict-progress', done: match, runs: msg.runs });
  }
  post({ type: 'predict-done', prediction });
}

export async function handle(
  msg: ToWorker,
  post: (m: FromWorker) => void,
  locate: (base: string) => (f: WasmFile) => string = wasmLocate,
): Promise<void> {
  try {
    if (msg.type === 'predict') predictRuns(msg, post);
    else if (msg.type === 'fixes')
      post({ type: 'fixes-done', fixes: fixCandidates(msg.loser, msg.winner, msg.loserSide, { seeds: msg.seeds, count: msg.count }) });
    else await measure(msg, post, locate);
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
