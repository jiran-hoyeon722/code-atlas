import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { loadParsers, type Parsers } from '../../src/engine/parsers';
import { nodeLocate } from '../../src/engine/node';
import { isSourcePath, isConfigPath } from '../../src/engine/collect';
import { analyze, UnsupportedRepoError, type Progress } from '../../src/engine/analyze';
import type { RepoInput } from '../../src/engine/types';

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

const NOW = new Date('2026-01-01T00:00:00Z');
let parsers: Parsers;
beforeAll(async () => {
  parsers = await loadParsers(nodeLocate);
});

describe('analyze', () => {
  test('laravel fixture end to end', () => {
    const input = loadRepo('laravel-mini');
    const phpUnderApp = input.files.filter((f) => f.path.startsWith('app/')).length;
    const a = analyze(input, parsers, { now: NOW });
    expect(a.framework).toBe('laravel');
    expect(a.lang).toBe('php');
    expect(a.nodes.length).toBe(phpUnderApp);
    const controller = a.nodes.find((n) => n.path === 'app/Http/Controllers/PostController.php')!;
    expect(a.roles[controller.role].name).toBe('Controller');
  });

  test('react fixture end to end', () => {
    const a = analyze(loadRepo('react-mini'), parsers, { now: NOW });
    expect(a.framework).toBe('react');
    expect(a.nodes.some((n) => n.path.endsWith('routeTree.gen.ts'))).toBe(false);
    expect(a.nodes.length).toBe(9);
  });

  test('progress events', () => {
    const input = loadRepo('laravel-mini');
    const events: Progress[] = [];
    analyze(input, parsers, { onProgress: (p) => events.push(p), now: NOW });
    const parse = events.filter((e): e is Extract<Progress, { phase: 'parse' }> => e.phase === 'parse');
    const total = input.files.filter((f) => f.path.startsWith('app/')).length;
    expect(parse.length).toBe(total);
    expect(parse.map((e) => e.done)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(parse.every((e) => e.total === total)).toBe(true);
    expect(parse.at(-1)!.done).toBe(parse.at(-1)!.total);
    const ctrl = parse.find((e) => e.path === 'app/Http/Controllers/PostController.php')!;
    expect(ctrl.role).toBeGreaterThanOrEqual(0);
    expect(events.slice(total).map((e) => e.phase)).toEqual(['link', 'metrics']);
  });

  test('react progress excludes generated files', () => {
    const events: Progress[] = [];
    analyze(loadRepo('react-mini'), parsers, { onProgress: (p) => events.push(p), now: NOW });
    const parse = events.filter((e) => e.phase === 'parse');
    expect(parse.length).toBe(9);
    expect(parse.some((e) => e.phase === 'parse' && e.path.endsWith('.gen.ts'))).toBe(false);
  });

  test('unsupported repo', () => {
    const input: RepoInput = { name: 'x', files: [], configs: {} };
    expect(() => analyze(input, parsers, { now: NOW })).toThrow(UnsupportedRepoError);
  });

  test('output is JSON-serializable and stable', () => {
    const input = loadRepo('react-mini');
    const a = analyze(input, parsers, { now: NOW });
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(analyze(input, parsers, { now: NOW })).toEqual(a);
  });

  test('options object: prefer picks the language on mixed input', () => {
    const input: RepoInput = {
      name: 'mixed',
      files: [
        { path: 'a.php', text: '<?php class A {}' },
        { path: 'b.php', text: '<?php class B {}' },
        { path: 'c.ts', text: 'export const c = 1;' },
      ],
      configs: {},
    };
    expect(analyze(input, parsers, { now: NOW }).lang).toBe('php');
    expect(analyze(input, parsers, { prefer: 'ts', now: NOW }).lang).toBe('ts');
  });
});
