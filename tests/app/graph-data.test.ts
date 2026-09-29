import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { loadParsers } from '../../src/engine/parsers';
import { nodeLocate } from '../../src/engine/node';
import { isSourcePath, isConfigPath } from '../../src/engine/collect';
import { analyze } from '../../src/engine/analyze';
import type { RepoInput } from '../../src/engine/types';
import type { Architecture } from '../../src/engine/architecture';
import { roleColors } from '../../src/features/palette';
import { graphData } from '../../src/features/graph/data';

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

let arch: Architecture;
beforeAll(async () => {
  arch = analyze(loadRepo('react-mini'), await loadParsers(nodeLocate));
});

describe('graphData', () => {
  test('one node per file and one link per edge', () => {
    const g = graphData(arch);
    expect(g.nodes.length).toBe(arch.nodes.length);
    expect(g.links.length).toBe(arch.edges.length);
    expect(g.nodes.length).toBeGreaterThan(0);
  });

  test('upward flag, weight, kinds and endpoints mirror the edges', () => {
    const g = graphData(arch);
    arch.edges.forEach((e, i) => {
      expect(g.links[i].upward).toBe(e[4] === 1);
      expect(g.links[i].source).toBe(e[0]);
      expect(g.links[i].target).toBe(e[1]);
      expect(g.links[i].weight).toBe(e[2]);
      expect(g.links[i].kinds).toBe(e[3]);
    });
  });

  test('colors come from roleColors and size grows with fan-in', () => {
    const g = graphData(arch);
    const colors = roleColors(arch);
    g.nodes.forEach((n, i) => {
      expect(n.id).toBe(i);
      expect(n.color).toBe(colors[n.role]);
      expect(n.layer).toBe(arch.roles[n.role].layer);
      expect(n.val).toBeCloseTo(1 + Math.sqrt(arch.nodes[i].fanIn) * 1.6);
    });
  });
});
