import { expect, test } from 'vitest';
import type { Architecture, ArchNode } from '../../src/engine/architecture';
import type { Role } from '../../src/engine/presets';
import { LANE, layoutWalk, type WalkBuilding } from '../../src/features/walk/walkLayout';
import { routeBetween } from '../../src/features/walk/walkTraffic';

const node = (path: string, role: number, lines: number, fanIn: number): ArchNode => ({
  path, name: path.split('/').pop()!, kind: 'class', role, lines, functions: 2, complexity: 3, maxComplexity: 2,
  fanIn, fanOut: 0, instability: 0, centrality: 1, routeRefs: 0, routeFiles: [],
});

function fakeArch(): Architecture {
  const roles: Role[] = [
    { name: 'Page', layer: 0, patterns: ['p'], description: '화면' },
    { name: 'Feature', layer: 1, patterns: ['f'], description: '기능' },
    { name: 'Hook', layer: 1, patterns: ['h'], description: '훅' },
    { name: 'Service', layer: 2, patterns: ['s'], description: '서비스' },
    { name: 'Util', layer: 2, patterns: ['u'], description: '유틸' },
  ];
  const counts = [7, 15, 9, 17, 12];
  const nodes = counts.flatMap((n, role) => Array.from({ length: n }, (_, k) => node(`src/${roles[role].name}/f${k}.ts`, role, 10 + k * 37, (k * 7) % 30)));
  return {
    version: 1, name: 'fake', lang: 'ts', framework: 'react', sourceDir: 'src', generatedAt: '2026-01-01T00:00:00Z',
    layers: [
      { key: 'entry', label: '진입점', hint: '' },
      { key: 'application', label: '애플리케이션', hint: '' },
      { key: 'domain', label: '도메인', hint: '' },
    ],
    roles, nodes, edges: [], failed: [], unresolved: 0,
  };
}

const overlaps = (a: WalkBuilding, b: WalkBuilding) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;
const inside = (b: WalkBuilding, x: number, z: number, margin: number) => Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(z - b.z) < b.d / 2 + margin;

test('one building per file, none overlapping, every front door facing its lane', () => {
  const arch = fakeArch();
  const { buildings } = layoutWalk(arch);
  expect(buildings.map((b) => b.i).sort((p, q) => p - q)).toEqual(arch.nodes.map((_, i) => i));
  buildings.forEach((a, k) => buildings.slice(k + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
  for (const b of buildings) {
    const front = b.z + (b.face * b.d) / 2;
    expect(Math.sign(b.lane - b.z)).toBe(b.face);
    expect(Math.abs(b.lane - front)).toBeCloseTo(2 + LANE / 2);
  }
});

test('same input gives the same city', () => {
  expect(layoutWalk(fakeArch())).toEqual(layoutWalk(fakeArch()));
});

test('layer rows do not overlap and keep entry first (largest z)', () => {
  const { rows } = layoutWalk(fakeArch());
  expect(rows).toHaveLength(3);
  for (let r = 1; r < rows.length; r++) expect(rows[r].zMax).toBeLessThan(rows[r - 1].zMin);
});

test('traffic routes run on axis-aligned roads from one door lane to the other without entering a building', () => {
  const layout = layoutWalk(fakeArch());
  const bs = layout.buildings;
  const pairs = [[0, 1], [0, bs.length - 1], [5, 40], [30, 31], [12, 55], [bs.length - 1, 3]];
  for (const [p, q] of pairs) {
    const a = bs[p], b = bs[q];
    const route = routeBetween(layout, a, b);
    expect(route[0]).toEqual([a.x, a.lane]);
    expect(route[route.length - 1]).toEqual([b.x, b.lane]);
    for (let k = 1; k < route.length; k++) {
      const [x0, z0] = route[k - 1], [x1, z1] = route[k];
      expect(x0 === x1 || z0 === z1).toBe(true);
      const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0));
      for (let t = 0; t <= steps; t++) {
        const x = x0 + ((x1 - x0) * t) / Math.max(1, steps), z = z0 + ((z1 - z0) * t) / Math.max(1, steps);
        expect(bs.some((o) => inside(o, x, z, 0.5))).toBe(false);
      }
    }
  }
});
