import type { Architecture } from '../../engine/architecture';

export interface BlastResult { depth: Int32Array; levels: number[][]; maxDepth: number; affected: number; routeFiles: number }

export const TYPE_ONLY_KINDS: ReadonlySet<string> = new Set(['type', 'type-import']);

export function blastRadius(count: number, edges: Architecture['edges'], start: number, routeRefs: ArrayLike<number>, opts: { skipTypeOnly: boolean }): BlastResult {
  const users: number[][] = Array.from({ length: count }, () => []);
  for (const [from, to, , kinds] of edges) {
    if (opts.skipTypeOnly && Object.keys(kinds).every((k) => TYPE_ONLY_KINDS.has(k))) continue;
    users[to].push(from);
  }
  const depth = new Int32Array(count).fill(-1);
  const levels: number[][] = [];
  depth[start] = 0;
  const queue = [start];
  let routeFiles = 0;
  for (let h = 0; h < queue.length; h++) {
    const cur = queue[h];
    for (const u of users[cur]) {
      if (depth[u] >= 0) continue;
      depth[u] = depth[cur] + 1;
      (levels[depth[u] - 1] ??= []).push(u);
      if (routeRefs[u] > 0) routeFiles++;
      queue.push(u);
    }
  }
  return { depth, levels, maxDepth: levels.length, affected: queue.length - 1, routeFiles };
}

export function blastPercent(affected: number, count: number): number {
  return count <= 1 ? 0 : Math.round((affected / (count - 1)) * 100);
}
