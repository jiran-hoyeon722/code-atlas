import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { nodeLocate } from '../../../src/engine/node';
import type { RepoInput } from '../../../src/engine/types';
import type { FromWorker } from '../../../src/features/battle/worker/protocol';
import { handle } from '../../../src/features/battle/worker/worker';
import { startQuality, QualityCancelled, QualityError } from '../../../src/features/battle/worker/client';
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
