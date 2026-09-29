import type { Architecture } from '../../engine/architecture';
import type { Edge } from '../../engine/types';
import { roleColors } from '../palette';

export interface GraphNode {
  id: number;
  path: string;
  name: string;
  role: number;
  layer: number;
  val: number;
  color: string;
}

export interface GraphLink {
  source: number;
  target: number;
  weight: number;
  upward: boolean;
  kinds: Edge['kinds'];
}

// index.ts -> "dir/index", otherwise the file stem
export function displayName(path: string): string {
  return path
    .replace(/(?:\.d)?\.[^./]+$/, '')
    .replace(/^(?:.*\/)?([^/]+)\/index$|^(?:.*\/)?/, (_m, dir) => (dir ? dir + '/index' : ''));
}

export function graphData(arch: Architecture): { nodes: GraphNode[]; links: GraphLink[] } {
  const colors = roleColors(arch);
  return {
    nodes: arch.nodes.map((n, i) => ({
      id: i,
      path: n.path,
      name: displayName(n.path),
      role: n.role,
      layer: arch.roles[n.role].layer,
      val: 1 + Math.sqrt(n.fanIn) * 1.6,
      color: colors[n.role],
    })),
    links: arch.edges.map(([source, target, weight, kinds, up]) => ({ source, target, weight, upward: up === 1, kinds })),
  };
}
