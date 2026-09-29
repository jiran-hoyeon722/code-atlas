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
    w.emit({ type: 'done', architecture });
    await expect(result).resolves.toBe(architecture);
    expect(onProgress).toHaveBeenCalledWith({ phase: 'link' });
    expect(w.terminate).toHaveBeenCalledTimes(1);
  });

  test('unsupported error rejects with UnsupportedRepo', async () => {
    const w = new FakeWorker();
    const { result } = start(w);
    w.emit({ type: 'error', code: 'unsupported', message: 'no' });
    await expect(result).rejects.toBeInstanceOf(UnsupportedRepo);
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
