import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { nodeLocate } from '../../../src/engine/node';
import type { RepoInput } from '../../../src/engine/types';
import type { FromWorker } from '../../../src/features/battle/worker/protocol';
import { handle } from '../../../src/features/battle/worker/worker';
import { startFixes, startPredict, startQuality, QualityCancelled, QualityError } from '../../../src/features/battle/worker/client';
import { fixCandidates } from '../../../src/engine/battle/fixes';
import { predict } from '../../../src/engine/battle/sim';
import { qfile, quality } from './fakes';
import { loadFixture } from '../../engine/battle/fixture';

const locate = () => nodeLocate;

class FakeWorker {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminate = vi.fn();
  posted: unknown[] = [];
  postMessage(m: unknown) {
    this.posted.push(m);
  }
  emit(m: FromWorker) {
    this.onmessage?.({ data: m } as MessageEvent<FromWorker>);
  }
}

describe('battle worker handle', () => {
  test('posts progress then done with the quality', async () => {
    const msgs: FromWorker[] = [];
    await handle({ type: 'quality', input: loadFixture('battle-php'), wasmBase: '' }, (m) => msgs.push(m), locate);
    const phases = msgs.flatMap((m) => (m.type === 'progress' ? [m.progress.phase] : []));
    expect(phases[0]).toBe('analyze');
    expect(phases.at(-1)).toBe('graph');
    const last = msgs.at(-1)!;
    expect(last.type).toBe('done');
    if (last.type === 'done') expect(last.quality.lang).toBe('php');
  });

  test('maps errors to codes', async () => {
    const run = async (input: RepoInput) => {
      const msgs: FromWorker[] = [];
      await handle({ type: 'quality', input, wasmBase: '' }, (m) => msgs.push(m), locate);
      return msgs.at(-1);
    };
    expect(await run({ name: 'x', files: [], configs: {} })).toMatchObject({ type: 'error', code: 'unsupported' });
    expect(await run({ name: 'x', files: [{ path: 'a.ts', text: 'export {};\n' }], configs: {} })).toMatchObject({ type: 'error', code: 'too-small' });
    expect(await run({ name: 'x', files: null, configs: {} } as unknown as RepoInput)).toMatchObject({ type: 'error', code: 'failed' });
  });
});

describe('battle worker client', () => {
  beforeEach(() => vi.stubGlobal('document', { baseURI: 'http://localhost/app/index.html' }));
  afterEach(() => vi.unstubAllGlobals());

  const input: RepoInput = { name: 'x', files: [], configs: {} };
  const start = (w: FakeWorker, onProgress = vi.fn()) =>
    startQuality(input, { onProgress, createWorker: () => w as unknown as Worker });

  test('progress then done resolves and terminates', async () => {
    const w = new FakeWorker();
    const onProgress = vi.fn();
    const { result } = start(w, onProgress);
    expect(w.posted[0]).toMatchObject({ type: 'quality', input, wasmBase: 'http://localhost/app/' });
    w.emit({ type: 'progress', progress: { phase: 'clones' } });
    const quality = { name: 'x' } as never;
    w.emit({ type: 'done', quality });
    await expect(result).resolves.toBe(quality);
    expect(onProgress).toHaveBeenCalledWith({ phase: 'clones' });
    expect(w.terminate).toHaveBeenCalledTimes(1);
  });

  test('cancel terminates worker and rejects', async () => {
    const w = new FakeWorker();
    const { result, cancel } = start(w);
    cancel();
    await expect(result).rejects.toBeInstanceOf(QualityCancelled);
    expect(w.terminate).toHaveBeenCalledTimes(1);
  });

  test('error messages reject with their code, a crash rejects as failed', async () => {
    const w = new FakeWorker();
    const { result } = start(w);
    w.emit({ type: 'error', code: 'too-small', message: 'small' });
    await expect(result).rejects.toMatchObject({ name: 'QualityError', code: 'too-small', message: 'small' });
    const w2 = new FakeWorker();
    const r2 = start(w2).result;
    w2.onerror?.({ message: 'crash' } as ErrorEvent);
    await expect(r2).rejects.toBeInstanceOf(QualityError);
    await expect(r2).rejects.toMatchObject({ code: 'failed', message: 'crash' });
  });

  test('default worker is a blob: module worker that imports the real worker script', async () => {
    const calls: { url: string; opts: WorkerOptions }[] = [];
    const blobs: Blob[] = [];
    vi.stubGlobal(
      'Worker',
      class extends FakeWorker {
        constructor(url: string | URL, opts: WorkerOptions) {
          super();
          calls.push({ url: String(url), opts });
        }
        addEventListener() {}
      },
    );
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blobs.push(b as Blob);
      return 'blob:http://localhost/1';
    });
    try {
      startQuality(input, { onProgress: vi.fn() });
      expect(calls).toEqual([{ url: 'blob:http://localhost/1', opts: { type: 'module' } }]);
      const src = await blobs[0].text();
      expect(src).toMatch(/^import "[^"]+";$/);
      expect(src).toMatch(/worker/);
    } finally {
      createObjectURL.mockRestore();
    }
  });
});

describe('battle worker predict', () => {
  const pair = () => {
    const a = quality('alpha', { totals: { prodLines: 1200, testLines: 0, testFiles: 0 }, files: [qfile('src/a.ts', 1200, { ccnTier: new Array(1200).fill(2) })] });
    const b = quality('beta', { totals: { prodLines: 1200, testLines: 0, testFiles: 0 }, files: [qfile('src/b.ts', 1200)] });
    return { a, b };
  };

  test('posts one progress per finished match, then the same counts as the engine', async () => {
    const { a, b } = pair();
    const msgs: FromWorker[] = [];
    await handle({ type: 'predict', a, b, runs: 6 }, (m) => msgs.push(m));
    const progress = msgs.filter((m) => m.type === 'predict-progress');
    expect(progress).toEqual([1, 2, 3, 4, 5, 6].map((done) => ({ type: 'predict-progress', done, runs: 6 })));
    const last = msgs.at(-1)!;
    expect(last).toEqual({ type: 'predict-done', prediction: predict(a, b, 6) });
    if (last.type === 'predict-done') expect(last.prediction.aWins + last.prediction.bWins + last.prediction.draws).toBe(6);
  });

  test('an army that cannot be built reports an error', async () => {
    const { b } = pair();
    const tiny = quality('tiny', { files: [qfile('a.ts', 10)] });
    const msgs: FromWorker[] = [];
    await handle({ type: 'predict', a: tiny, b, runs: 3 }, (m) => msgs.push(m));
    expect(msgs).toEqual([expect.objectContaining({ type: 'error', code: 'failed' })]);
  });

  describe('client', () => {
    beforeEach(() => vi.stubGlobal('document', { baseURI: 'http://localhost/app/index.html' }));
    afterEach(() => vi.unstubAllGlobals());

    test('startPredict posts the pair with 100 runs, reports progress and resolves', async () => {
      const { a, b } = pair();
      const w = new FakeWorker();
      const onProgress = vi.fn();
      const { result } = startPredict(a, b, { onProgress, createWorker: () => w as unknown as Worker });
      expect(w.posted[0]).toEqual({ type: 'predict', a, b, runs: 100 });
      w.emit({ type: 'predict-progress', done: 1, runs: 100 });
      expect(onProgress).toHaveBeenCalledWith(1, 100);
      const prediction = { runs: 100, aWins: 60, bWins: 40, draws: 0 };
      w.emit({ type: 'predict-done', prediction });
      await expect(result).resolves.toEqual(prediction);
      expect(w.terminate).toHaveBeenCalledTimes(1);
    });

    test('startPredict cancel and errors reject', async () => {
      const { a, b } = pair();
      const w = new FakeWorker();
      const job = startPredict(a, b, { runs: 5, onProgress: vi.fn(), createWorker: () => w as unknown as Worker });
      expect(w.posted[0]).toMatchObject({ runs: 5 });
      job.cancel();
      await expect(job.result).rejects.toBeInstanceOf(QualityCancelled);
      const w2 = new FakeWorker();
      const job2 = startPredict(a, b, { onProgress: vi.fn(), createWorker: () => w2 as unknown as Worker });
      w2.emit({ type: 'error', code: 'failed', message: 'boom' });
      await expect(job2.result).rejects.toMatchObject({ code: 'failed', message: 'boom' });
    });
  });
});

describe('battle worker fixes', () => {
  const pair = () => {
    const loser = quality('loser', {
      totals: { prodLines: 1200, testLines: 0, testFiles: 0 },
      files: [qfile('src/bad.ts', 600, { ccnTier: new Array(600).fill(3) }), qfile('src/ok.ts', 600, { lenTier: new Array(600).fill(1) })],
    });
    const winner = quality('winner', { totals: { prodLines: 1200, testLines: 0, testFiles: 0 }, files: [qfile('src/w.ts', 1200)] });
    return { loser, winner };
  };

  test('posts the same candidates as the engine, in one done message', async () => {
    const { loser, winner } = pair();
    const msgs: FromWorker[] = [];
    await handle({ type: 'fixes', loser, winner, loserSide: 'b', seeds: 4, count: 5 }, (m) => msgs.push(m));
    expect(msgs).toEqual([{ type: 'fixes-done', fixes: fixCandidates(loser, winner, 'b', { seeds: 4, count: 5 }) }]);
    if (msgs[0].type === 'fixes-done') expect(msgs[0].fixes.map((f) => f.path)).toEqual(['src/bad.ts', 'src/ok.ts']);
  });

  test('an army that cannot be built reports an error', async () => {
    const { winner } = pair();
    const tiny = quality('tiny', { files: [qfile('a.ts', 10, { ccnTier: new Array(10).fill(3) })] });
    const msgs: FromWorker[] = [];
    await handle({ type: 'fixes', loser: tiny, winner, loserSide: 'a', seeds: 2, count: 5 }, (m) => msgs.push(m));
    expect(msgs).toEqual([expect.objectContaining({ type: 'error', code: 'failed' })]);
  });

  describe('client', () => {
    beforeEach(() => vi.stubGlobal('document', { baseURI: 'http://localhost/app/index.html' }));
    afterEach(() => vi.unstubAllGlobals());

    test('startFixes posts seeds 20 and count 5, resolves with the list and terminates', async () => {
      const { loser, winner } = pair();
      const w = new FakeWorker();
      const { result } = startFixes(loser, winner, 'a', { createWorker: () => w as unknown as Worker });
      expect(w.posted[0]).toEqual({ type: 'fixes', loser, winner, loserSide: 'a', seeds: 20, count: 5 });
      const fixes = [{ path: 'src/bad.ts', penalty: 1, reasons: ['complexity'], baseline: 0.1, improved: 0.2, delta: 0.1 }] as never;
      w.emit({ type: 'fixes-done', fixes });
      await expect(result).resolves.toBe(fixes);
      expect(w.terminate).toHaveBeenCalledTimes(1);
    });

    test('startFixes cancel and errors reject', async () => {
      const { loser, winner } = pair();
      const w = new FakeWorker();
      const job = startFixes(loser, winner, 'b', { createWorker: () => w as unknown as Worker });
      job.cancel();
      await expect(job.result).rejects.toBeInstanceOf(QualityCancelled);
      expect(w.terminate).toHaveBeenCalledTimes(1);
      const w2 = new FakeWorker();
      const job2 = startFixes(loser, winner, 'b', { createWorker: () => w2 as unknown as Worker });
      w2.emit({ type: 'error', code: 'failed', message: 'boom' });
      await expect(job2.result).rejects.toMatchObject({ code: 'failed', message: 'boom' });
    });
  });
});
