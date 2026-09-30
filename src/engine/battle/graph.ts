import type { Architecture } from '../architecture';
import type { Lang, RefKind } from '../types';
import { ARMY } from './rules';
import type { Cycle } from './types';

const TYPE_ONLY: Partial<Record<Lang, ReadonlySet<RefKind>>> = {
  ts: new Set<RefKind>(['type-import']),
  php: new Set<RefKind>(['type', 'binds', 'triggers']),
};

/** Strongly connected groups of 2+ production files over runtime references (iterative Tarjan). */
export function findCycles(arch: Architecture, prodPaths: Set<string>): Cycle[] {
  const ignored = TYPE_ONLY[arch.lang] ?? new Set<RefKind>();
  const n = arch.nodes.length;
  const keep = arch.nodes.map((node) => prodPaths.has(node.path));
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [from, to, , kinds] of arch.edges) {
    if (from === to || !keep[from] || !keep[to]) continue;
    const runtime = (Object.keys(kinds) as RefKind[]).some((k) => !ignored.has(k) && (kinds[k] ?? 0) > 0);
    if (runtime) adj[from].push(to);
  }

  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const groups: string[][] = [];
  let counter = 0;

  for (let root = 0; root < n; root++) {
    if (!keep[root] || index[root] !== -1) continue;
    const work: [node: number, next: number][] = [[root, 0]];
    index[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = 1;
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const v = frame[0];
      if (frame[1] < adj[v].length) {
        const w = adj[v][frame[1]++];
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = 1;
          work.push([w, 0]);
        } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1][0];
        low[parent] = Math.min(low[parent], low[v]);
      }
      if (low[v] !== index[v]) continue;
      const group: string[] = [];
      let w: number;
      do {
        w = stack.pop()!;
        onStack[w] = 0;
        group.push(arch.nodes[w].path);
      } while (w !== v);
      if (group.length >= 2) groups.push(group.sort());
    }
  }

  groups.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return groups.map((files, id) => ({ id, files }));
}

/** Most central files until they hold 5% of the code and number at least five (or every file, if fewer). */
export function pickCommander(files: readonly { path: string; lines: number; centrality: number }[], prodLines: number): { files: string[]; display: string } {
  const ranked = [...files].sort((a, b) => b.centrality - a.centrality || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const need = prodLines * ARMY.commanderShare;
  const picked: string[] = [];
  let lines = 0;
  for (const f of ranked) {
    if (lines >= need && picked.length >= ARMY.commanderMinFiles) break;
    picked.push(f.path);
    lines += f.lines;
  }
  const top = picked[0] ?? '';
  return { files: picked, display: top.slice(top.lastIndexOf('/') + 1) };
}

export function tangleScore(files: readonly { lines: number; cycle: number }[], prodLines: number): number {
  if (prodLines === 0) return 0;
  let tangled = 0;
  for (const f of files) if (f.cycle >= 0) tangled += f.lines;
  return tangled / prodLines;
}

export function testsScore(testLines: number, prodLines: number): number {
  return prodLines === 0 ? 0 : Math.min(1, testLines / prodLines);
}
