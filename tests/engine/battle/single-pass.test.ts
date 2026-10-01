import { beforeAll, describe, expect, test } from 'vitest';
import { analyze, UnsupportedRepoError } from '../../../src/engine/analyze';
import { detect } from '../../../src/engine/detect';
import { loadParsers, type Parsers } from '../../../src/engine/parsers';
import { nodeLocate } from '../../../src/engine/node';
import { sourcesFor } from '../../../src/engine/sources';
import { analyzeWithQuality, buildQuality, TooSmallRepoError } from '../../../src/engine/battle/quality';
import type { RepoInput } from '../../../src/engine/types';
import { loadFixture } from './fixture';

const NOW = new Date('2026-01-01T00:00:00Z');
let parsers: Parsers;
beforeAll(async () => {
  parsers = await loadParsers(nodeLocate, ['php', 'ts']);
});

const repo = (files: Record<string, string>): RepoInput => ({
  name: 'fake',
  files: Object.entries(files).map(([path, text]) => ({ path, text })),
  configs: {},
});

/** Wraps both parsers so every parse call is counted. */
function counting(p: Parsers) {
  const calls = { tsx: 0, php: 0 };
  type P = ReturnType<Parsers['get']>;
  const wrap = (parser: P, key: 'tsx' | 'php') =>
    new Proxy(parser, {
      get(target, prop) {
        if (prop === 'parse') return (...args: Parameters<P['parse']>) => (calls[key]++, target.parse(...args));
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  const wrapped = { ts: wrap(p.get('ts'), 'tsx'), php: wrap(p.get('php'), 'php') };
  return { parsers: { get: (lang) => wrapped[lang as 'ts' | 'php'] } as Parsers, calls };
}

describe('analyzeWithQuality', () => {
  test.each(['battle-ts', 'battle-php'])('%s: same Quality as buildQuality and same architecture as analyze', (name) => {
    const r = analyzeWithQuality(loadFixture(name), parsers, { now: NOW });
    expect(r.qualityIssue).toBeUndefined();
    expect(r.quality).toEqual(buildQuality(loadFixture(name), parsers));
    expect(r.architecture).toEqual(analyze(loadFixture(name), parsers, { now: NOW }));
  });

  test.each(['react-mini', 'laravel-mini'])('%s: small fixture keeps the analysis and reports too-small', (name) => {
    const r = analyzeWithQuality(loadFixture(name), parsers, { now: NOW });
    expect(r.architecture).toEqual(analyze(loadFixture(name), parsers, { now: NOW }));
    expect(r.quality).toBeNull();
    expect(r.qualityIssue).toBe('too-small');
    expect(() => buildQuality(loadFixture(name), parsers)).toThrow(TooSmallRepoError);
  });

  test('parses each TS source once', () => {
    const input = loadFixture('battle-ts');
    const sources = sourcesFor(detect(input)!, input.files).length;
    const c = counting(parsers);
    const r = analyzeWithQuality(input, c.parsers);
    expect(r.quality).not.toBeNull();
    expect(c.calls.tsx).toBe(sources);
  });

  test('parses PHP app files once (route files are read by the analysis only)', () => {
    const input = loadFixture('battle-php');
    const plain = counting(parsers);
    analyze(input, plain.parsers);
    const c = counting(parsers);
    analyzeWithQuality(input, c.parsers);
    expect(c.calls.php).toBe(plain.calls.php);
  });

  test('onTree sees each parsed source and nothing when absent', () => {
    const input = loadFixture('battle-ts');
    const seen: string[] = [];
    const withHook = analyze(input, parsers, { now: NOW, onTree: (path, root) => { expect(root.type).toBe('program'); seen.push(path); } });
    expect(seen).toEqual(sourcesFor(detect(input)!, input.files).map((f) => f.path));
    expect(withHook).toEqual(analyze(input, parsers, { now: NOW }));
  });

  test('files the extractor could not parse fall back to a separate parse', () => {
    const body = Array.from({ length: 320 }, (_, i) => `export function f${i}() { return ${i}; }`).join('\n');
    let n = 0;
    // First parse (the analysis) fails; the fallback parse succeeds.
    const flaky = new Proxy(parsers.get('ts'), {
      get(target, prop) {
        if (prop === 'parse') return (text: string) => (n++ === 0 ? null : target.parse(text));
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const r = analyzeWithQuality(repo({ 'a.ts': body }), { get: (lang) => (lang === 'ts' ? flaky : parsers.get(lang)) });
    expect(r.quality!.files[0].functions).toHaveLength(320);
    expect(r.architecture.failed).toEqual([{ path: 'a.ts', reason: 'syntax' }]);
  });

  test('too small and empty repos return no quality instead of throwing', () => {
    const tiny = analyzeWithQuality(repo({ 'a.ts': 'export const a = 1;\n' }), parsers);
    expect(tiny).toMatchObject({ quality: null, qualityIssue: 'too-small', prodLines: 1 });
    expect(tiny.architecture.nodes).toHaveLength(1);

    const onlyTests = analyzeWithQuality(repo({ 'src/a.test.ts': 'export const a = 1;\n' }), parsers);
    expect(onlyTests).toMatchObject({ quality: null, qualityIssue: 'no-production' });
    expect(() => buildQuality(repo({ 'src/a.test.ts': 'export const a = 1;\n' }), parsers)).toThrow(UnsupportedRepoError);
  });
});
