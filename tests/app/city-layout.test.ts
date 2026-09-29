import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { loadParsers } from '../../src/engine/parsers';
import { nodeLocate } from '../../src/engine/node';
import { isConfigPath, isSourcePath } from '../../src/engine/collect';
import { analyze } from '../../src/engine/analyze';
import type { Architecture } from '../../src/engine/architecture';
import type { RepoInput } from '../../src/engine/types';
import { layoutCity } from '../../src/features/city/layout';

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

let a: Architecture;
beforeAll(async () => {
  a = analyze(loadRepo('laravel-mini'), await loadParsers(nodeLocate));
});

test('one building per node, inside bounds, no overlaps', () => {
  const { buildings, bounds } = layoutCity(a);
  expect(buildings.map((b) => b.i).sort((x, y) => x - y)).toEqual(a.nodes.map((_, i) => i));
  for (const b of buildings) {
    expect(Math.abs(b.x) + b.w / 2).toBeLessThanOrEqual(bounds.w / 2);
    expect(Math.abs(b.z) + b.d / 2).toBeLessThanOrEqual(bounds.d / 2);
  }
  for (let p = 0; p < buildings.length; p++) {
    for (let q = p + 1; q < buildings.length; q++) {
      const [s, t] = [buildings[p], buildings[q]];
      const apart = Math.abs(s.x - t.x) >= (s.w + t.w) / 2 || Math.abs(s.z - t.z) >= (s.d + t.d) / 2;
      expect(apart).toBe(true);
    }
  }
});

test('blocks ordered by layer rows (entry row first)', () => {
  const { blocks } = layoutCity(a);
  expect(blocks.length).toBe(a.roles.length);
  const layers = blocks.map((b) => a.roles[b.role].layer);
  expect(layers).toEqual([...layers].sort((x, y) => x - y));
  expect(new Set(layers).size).toBeGreaterThan(1);
  const front = (b: (typeof blocks)[number]) => b.z + b.d / 2;
  for (const s of blocks) {
    for (const t of blocks) {
      const [ls, lt] = [a.roles[s.role].layer, a.roles[t.role].layer];
      if (ls === lt) expect(front(s)).toBe(front(t));
      if (ls < lt) expect(s.z - s.d / 2).toBeGreaterThan(front(t));
    }
  }
});

test('layout is deterministic', () => {
  expect(layoutCity(a)).toEqual(layoutCity(a));
});
