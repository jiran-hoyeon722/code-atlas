import type { Architecture, ArchNode } from '../../engine/architecture';

interface CCFile { name: string; type: 'File'; attributes: Record<string, number> }
interface CCFolder { name: string; type: 'Folder'; attributes: Record<string, number>; children: (CCFolder | CCFile)[] }

const fileAttributes = (n: ArchNode) => ({
  rloc: n.lines,
  fan_in: n.fanIn,
  fan_out: n.fanOut,
  instability: Math.round(n.instability * 100),
  centrality: Math.round(n.centrality * 100),
  max_complexity_per_function: n.maxComplexity,
  functions: n.functions,
});

export function toCodeCharta(arch: Architecture): object {
  const root: CCFolder = { name: 'root', type: 'Folder', attributes: {}, children: [] };
  for (const n of arch.nodes) {
    const parts = n.path.split('/').filter(Boolean);
    const fileName = parts.pop()!;
    let dir = root;
    for (const part of parts) {
      let next = dir.children.find((c): c is CCFolder => c.type === 'Folder' && c.name === part);
      if (!next) {
        next = { name: part, type: 'Folder', attributes: {}, children: [] };
        dir.children.push(next);
      }
      dir = next;
    }
    dir.children.push({ name: fileName, type: 'File', attributes: fileAttributes(n) });
  }
  const full = (i: number) => `/root/${arch.nodes[i].path}`;
  return {
    projectName: arch.name,
    apiVersion: '1.3',
    nodes: [root],
    edges: arch.edges.map(([from, to, weight]) => ({
      fromNodeName: full(from),
      toNodeName: full(to),
      attributes: { code_dependency: weight },
    })),
    attributeTypes: {
      nodes: {
        rloc: 'absolute', fan_in: 'absolute', fan_out: 'absolute', instability: 'relative', centrality: 'absolute',
        max_complexity_per_function: 'absolute', functions: 'absolute',
      },
      edges: { code_dependency: 'absolute' },
    },
  };
}

export function downloadCodeCharta(arch: Architecture): void {
  const blob = new Blob([JSON.stringify(toCodeCharta(arch))], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${arch.name}.cc.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
