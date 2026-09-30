import * as THREE from 'three';
import { expect, test, vi } from 'vitest';
import type { Architecture, ArchNode } from '../../src/engine/architecture';
import { layoutWalk } from '../../src/features/walk/walkLayout';
import { createTraffic } from '../../src/features/walk/walkTraffic';

vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

const node = (k: number): ArchNode => ({
  path: `src/f${k}.ts`, name: `f${k}.ts`, kind: 'module', role: k % 2, lines: 40, functions: 2, complexity: 3, maxComplexity: 2,
  fanIn: k, fanOut: 1, instability: 0, centrality: 1, routeRefs: 0, routeFiles: [],
});

const arch: Architecture = {
  version: 1, name: 'fake', lang: 'ts', framework: null, sourceDir: 'src', generatedAt: '2026-01-01T00:00:00Z',
  layers: [{ key: 'entry', label: '진입점', hint: '' }],
  roles: [{ name: 'A', layer: 0, patterns: ['a'], description: '' }, { name: 'B', layer: 0, patterns: ['b'], description: '' }],
  nodes: Array.from({ length: 12 }, (_, k) => node(k)),
  edges: Array.from({ length: 11 }, (_, k) => [k, k + 1, 12 - k, { import: 1 }, 0] as Architecture['edges'][number]),
  failed: [], unresolved: 0,
};

const carCount = (scene: THREE.Scene) => Math.max(...scene.children.filter((o): o is THREE.InstancedMesh => (o as THREE.InstancedMesh).isInstancedMesh).map((m) => m.count));

test('cars to or from a closed building vanish and come back when it reopens', () => {
  const scene = new THREE.Scene();
  const traffic = createTraffic(scene, layoutWalk(arch), arch, () => '#888888', () => 0.5);
  const player = new THREE.Vector3();
  traffic.setFocus(3, player);
  const open = carCount(scene);
  expect(open).toBeGreaterThan(0);

  traffic.setClosed((n) => n === 3);
  const without3 = carCount(scene);
  expect(without3).toBeLessThan(open);
  traffic.setFocus(4, player);
  expect(carCount(scene)).toBeLessThanOrEqual(without3);

  traffic.setClosed(() => true);
  expect(carCount(scene)).toBe(0);
  expect(traffic.nearest(0, 0, 1e6)).toBeNull();

  traffic.setClosed(null);
  expect(carCount(scene)).toBeGreaterThan(0);
  traffic.dispose();
});
