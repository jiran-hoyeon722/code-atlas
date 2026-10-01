import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { loadParsers, type Parsers } from '../../src/engine/parsers';
import { nodeLocate } from '../../src/engine/node';
import { isSourcePath, isConfigPath } from '../../src/engine/collect';
import { analyze, UnsupportedRepoError, type Progress } from '../../src/engine/analyze';
import { analyzeWithQuality } from '../../src/engine/battle/quality';
import { analyzeLangs } from '../../src/engine/analyzeLangs';
import type { RepoInput } from '../../src/engine/types';

function loadRepo(name: string, prefix = ''): RepoInput {
  const dir = join(__dirname, '../fixtures', name);
  const input: RepoInput = { name, files: [], configs: {} };
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else {
        const path = prefix + relative(dir, abs).split('\\').join('/');
        if (isSourcePath(path)) input.files.push({ path, text: readFileSync(abs, 'utf8') });
        else if (isConfigPath(path)) input.configs[path] = readFileSync(abs, 'utf8');
      }
    }
  };
  walk(dir);
  return input;
}

function mixed(): RepoInput {
  const py = loadRepo('py-mini', 'api/');
  const go = loadRepo('go-mini', 'svc/');
  return { name: 'mixed', files: [...py.files, ...go.files], configs: { ...py.configs, ...go.configs } };
}

const NOW = new Date('2026-01-01T00:00:00Z');
let parsers: Parsers;
beforeAll(async () => {
  parsers = await loadParsers(nodeLocate, ['py', 'go', 'kotlin', 'ts', 'shell']);
});

describe('analyzeLangs', () => {
  test('two languages become one architecture', () => {
    const input = mixed();
    expect(input.configs['svc/go.mod']).toBeDefined();
    const py = analyze(loadRepo('py-mini', 'api/'), parsers, { now: NOW });
    const go = analyze(loadRepo('go-mini', 'svc/'), parsers, { now: NOW });
    const { architecture: a } = analyzeLangs(input, parsers, ['py', 'go'], { now: NOW });
    expect(a.langs).toEqual(['py', 'go']);
    expect(a.lang).toBe('py');
    expect(a.nodes.length).toBe(py.nodes.length + go.nodes.length);
    expect(a.edges.length).toBe(py.edges.length + go.edges.length);
    expect(go.edges.length).toBeGreaterThan(0);
    expect(a.edges.every(([from, to]) => a.nodes[from].lang === a.nodes[to].lang)).toBe(true);
  });

  test('battle data is measured for the primary language only', () => {
    const small = analyzeLangs(mixed(), parsers, ['py', 'go'], { now: NOW });
    expect(small.qualityIssue).toBe(analyzeWithQuality(mixed(), parsers, { now: NOW, prefer: 'py' }).qualityIssue);
    const ts = loadRepo('battle-ts', 'web/');
    const go = loadRepo('go-mini', 'svc/');
    const input: RepoInput = { name: 'mixed', files: [...ts.files, ...go.files], configs: { ...ts.configs, ...go.configs } };
    const r = analyzeLangs(input, parsers, ['ts', 'go'], { now: NOW });
    expect(r.architecture.langs).toEqual(['ts', 'go']);
    expect(r.quality).not.toBeNull();
    expect(r.quality!.lang).toBe('ts');
    expect(r.quality).toEqual(analyzeWithQuality(input, parsers, { now: NOW, prefer: 'ts' }).quality);
    expect(r.quality!.files.every((f) => f.path.endsWith('.ts') || f.path.endsWith('.tsx'))).toBe(true);
  });

  test('a language with nothing to analyze is skipped', () => {
    const input = loadRepo('go-mini');
    input.files.push({ path: 'build.gradle.kts', text: 'plugins { kotlin("jvm") }\n' });
    const r = analyzeLangs(input, parsers, ['go', 'kotlin'], { now: NOW });
    expect(r).toEqual(analyzeWithQuality(input, parsers, { now: NOW, prefer: 'go' }));
    expect(r.architecture.langs).toBeUndefined();
    const k = analyzeLangs(input, parsers, ['kotlin', 'go'], { now: NOW });
    expect(k).toEqual(r);
  });

  test('a language that detect would swap for another is skipped', () => {
    const input = mixed();
    input.files.push({ path: 'scripts/run.sh', text: '#!/bin/sh\necho hi\n' });
    const r = analyzeLangs(input, parsers, ['py', 'shell', 'go'], { now: NOW });
    expect(r.architecture.langs).toEqual(['py', 'go']);
  });

  test('nothing to analyze in any language throws UnsupportedRepoError', () => {
    const input: RepoInput = { name: 'x', files: [{ path: 'build.gradle.kts', text: '' }], configs: {} };
    expect(() => analyzeLangs(input, parsers, ['kotlin', 'go'], { now: NOW })).toThrow(UnsupportedRepoError);
  });

  test('progress counts across languages', () => {
    const events: Progress[] = [];
    const { architecture: a } = analyzeLangs(mixed(), parsers, ['py', 'go'], { now: NOW, onProgress: (p) => events.push(p) });
    const parse = events.filter((p): p is Extract<Progress, { phase: 'parse' }> => p.phase === 'parse');
    expect(new Set(parse.map((p) => p.total)).size).toBe(1);
    expect(parse.map((p) => p.done)).toEqual(parse.map((_, i) => i + 1));
    expect(parse.at(-1)!.done).toBe(parse[0].total);
    const pyRoles = analyze(loadRepo('py-mini', 'api/'), parsers, { now: NOW }).roles.length;
    for (const p of parse) {
      expect(p.role).toBeLessThan(a.roles.length);
      if (p.path.startsWith('svc/')) expect(p.role).toBeGreaterThanOrEqual(pyRoles);
      else expect(p.role).toBeLessThan(pyRoles);
    }
    expect(events.filter((p) => p.phase === 'link').length).toBe(2);
    expect(events.filter((p) => p.phase === 'metrics').length).toBe(2);
  });

  test('one language is the same as analyzeWithQuality', () => {
    const input = loadRepo('go-mini');
    const events: Progress[] = [];
    const expected: Progress[] = [];
    const r = analyzeLangs(input, parsers, ['go'], { now: NOW, onProgress: (p) => events.push(p) });
    expect(r).toEqual(analyzeWithQuality(input, parsers, { now: NOW, prefer: 'go', onProgress: (p) => expected.push(p) }));
    expect(events).toEqual(expected);
  });
});
