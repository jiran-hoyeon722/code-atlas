import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { nodeLocate } from '../../src/engine/node';
import { isSourcePath, isConfigPath } from '../../src/engine/collect';
import type { RepoInput } from '../../src/engine/types';
import type { FromWorker } from '../../src/app/analysis/protocol';
import { handle } from '../../src/app/analysis/worker';
import { startAnalysis, AnalysisCancelled, UnsupportedRepo } from '../../src/app/analysis/client';
import { wasmLocate } from '../../src/app/analysis/wasm';
import { PACK_VERSION, unpackQuality } from '../../src/engine/battle/pack';

function loadRepo(name: string): RepoInput {
  const dir = join(__dirname, '../fixtures', name);
  const input: RepoInput = { name, files: [], configs: {} };
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else {
        const path = relative(dir, abs).split('\\').join('/');
        if (isSourcePath(path)) input.files.push({ path, text: readFileSync(abs, 'utf8') });
        else if (isConfigPath(path)) input.configs[path] = readFileSync(abs, 'utf8');
      }
    }
  };
  walk(dir);
  return input;
}

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

describe('worker handle', () => {
  test('posts progress then done for laravel fixture', async () => {
    const msgs: FromWorker[] = [];
    await handle({ type: 'analyze', input: loadRepo('laravel-mini'), wasmBase: '' }, (m) => msgs.push(m), locate);
    const phases = msgs.filter((m) => m.type === 'progress').map((m) => (m as Extract<FromWorker, { type: 'progress' }>).progress.phase);
    expect(phases[0]).toBe('parse');
    const lastParse = phases.lastIndexOf('parse');
    expect(phases[lastParse + 1]).toBe('link');
    const last = msgs.at(-1)!;
    expect(last.type).toBe('done');
    if (last.type === 'done') expect(last.architecture.framework).toBe('laravel');
  });

  test('done carries battle data already packed for the cache', async () => {
    const msgs: FromWorker[] = [];
    await handle({ type: 'analyze', input: loadRepo('battle-ts'), wasmBase: '' }, (m) => msgs.push(m), locate);
    const last = msgs.at(-1)!;
    expect(last.type).toBe('done');
    if (last.type !== 'done') return;
    expect(last.qualityIssue).toBeUndefined();
    expect(last.quality).not.toBeNull();
    expect(last.quality!.packVersion).toBe(PACK_VERSION);
    expect(last.quality!.name).toBe('battle-ts');
    expect(unpackQuality(last.quality!).files.length).toBeGreaterThan(0);
    expect(last.architecture.nodes.length).toBeGreaterThan(0);
  });

  test('too small for battle: the analysis still succeeds, with the reason instead of battle data', async () => {
    const msgs: FromWorker[] = [];
    await handle({ type: 'analyze', input: loadRepo('laravel-mini'), wasmBase: '' }, (m) => msgs.push(m), locate);
    expect(msgs.at(-1)).toMatchObject({ type: 'done', quality: null, qualityIssue: 'too-small' });
  });

  test('client passes the battle issue through', async () => {
    vi.stubGlobal('document', { baseURI: 'http://localhost/app/index.html' });
    try {
      const w = new FakeWorker();
      const { result } = startAnalysis({ name: 'x', files: [], configs: {} }, { onProgress: vi.fn(), createWorker: () => w as unknown as Worker });
      w.emit({ type: 'done', architecture: { name: 'x' } as never, quality: null, qualityIssue: 'too-small' });
      await expect(result).resolves.toMatchObject({ quality: null, qualityIssue: 'too-small' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('maps UnsupportedRepoError', async () => {
    const msgs: FromWorker[] = [];
    await handle({ type: 'analyze', input: { name: 'x', files: [], configs: {} }, wasmBase: '' }, (m) => msgs.push(m), locate);
    expect(msgs.at(-1)).toMatchObject({ type: 'error', code: 'unsupported' });
  });

  test('maps other failures to failed', async () => {
    const msgs: FromWorker[] = [];
    const broken = { name: 'x', files: null, configs: {} } as unknown as RepoInput;
    await handle({ type: 'analyze', input: broken, wasmBase: '' }, (m) => msgs.push(m), locate);
    expect(msgs.at(-1)).toMatchObject({ type: 'error', code: 'failed' });
  });
});

describe('wasmLocate', () => {
  test('joins base and wasm dir', () => {
    expect(wasmLocate('http://x/app/')('tree-sitter-php.wasm')).toBe('http://x/app/wasm/tree-sitter-php.wasm');
  });
});

describe('client', () => {
  beforeEach(() => vi.stubGlobal('document', { baseURI: 'http://localhost/app/index.html' }));
  afterEach(() => vi.unstubAllGlobals());

  const input: RepoInput = { name: 'x', files: [], configs: {} };
  const start = (w: FakeWorker, onProgress = vi.fn()) =>
    startAnalysis(input, { onProgress, createWorker: () => w as unknown as Worker });

  test('cancel terminates worker and rejects', async () => {
    const w = new FakeWorker();
    const { result, cancel } = start(w);
    cancel();
    await expect(result).rejects.toBeInstanceOf(AnalysisCancelled);
    expect(w.terminate).toHaveBeenCalledTimes(1);
  });

  test('progress then done resolves and terminates', async () => {
    const w = new FakeWorker();
    const onProgress = vi.fn();
    const { result } = start(w, onProgress);
    expect(w.posted[0]).toMatchObject({ type: 'analyze', input, wasmBase: 'http://localhost/app/' });
    w.emit({ type: 'progress', progress: { phase: 'link' } });
    const architecture = { name: 'x' } as never;
    const quality = { name: 'x' } as never;
    w.emit({ type: 'done', architecture, quality, qualityIssue: undefined });
    const r = await result;
    expect(r.architecture).toBe(architecture);
    expect(r.quality).toBe(quality);
    expect(r).not.toHaveProperty('qualityIssue');
    expect(onProgress).toHaveBeenCalledWith({ phase: 'link' });
    expect(w.terminate).toHaveBeenCalledTimes(1);
  });

  test('unsupported error rejects with UnsupportedRepo', async () => {
    const w = new FakeWorker();
    const { result } = start(w);
    w.emit({ type: 'error', code: 'unsupported', message: 'no' });
    await expect(result).rejects.toBeInstanceOf(UnsupportedRepo);
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
      startAnalysis(input, { onProgress: vi.fn() });
      expect(calls).toEqual([{ url: 'blob:http://localhost/1', opts: { type: 'module' } }]);
      const src = await blobs[0].text();
      expect(src).toMatch(/^import "[^"]+";$/);
      expect(src).toMatch(/worker/);
      expect(blobs[0].type).toBe('text/javascript');
    } finally {
      createObjectURL.mockRestore();
    }
  });

  test('failed error and worker onerror reject with Error', async () => {
    const w = new FakeWorker();
    const { result } = start(w);
    w.emit({ type: 'error', code: 'failed', message: 'bad' });
    await expect(result).rejects.toThrow('bad');
    const w2 = new FakeWorker();
    const r2 = start(w2).result;
    w2.onerror?.({ message: 'crash' } as ErrorEvent);
    await expect(r2).rejects.toThrow('crash');
  });
});
