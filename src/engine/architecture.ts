import type { Detection } from './detect';
import { compileRoles, type Layer, type Preset, type Role } from './presets';
import type { Edge, Extraction, Lang } from './types';

export interface ArchNode {
  path: string;
  name: string;
  kind: string;
  role: number;
  lines: number;
  functions: number;
  complexity: number;
  maxComplexity: number;
  fanIn: number;
  fanOut: number;
  instability: number;
  centrality: number;
  routeRefs: number;
  routeFiles: string[];
  lang?: Lang;
}

export interface Architecture {
  version: 1;
  name: string;
  lang: Lang;
  framework: Detection['framework'];
  sourceDir: string;
  generatedAt: string;
  layers: Layer[];
  roles: Role[];
  nodes: ArchNode[];
  edges: [from: number, to: number, weight: number, kinds: Edge['kinds'], upward: 0 | 1][];
  failed: Extraction['failed'];
  unresolved: number;
  langs?: Lang[];
}

const CONCEPTUAL_KINDS = new Set(['binds', 'triggers']);
const round2 = (v: number) => Math.round(v * 100) / 100;

function pageRank(count: number, edges: [number, number][], damping = 0.85, iterations = 80): number[] {
  const outDegree = new Array<number>(count).fill(0);
  edges.forEach(([from]) => outDegree[from]++);
  let rank = new Array<number>(count).fill(1 / count);
  for (let i = 0; i < iterations; i++) {
    const next = new Array<number>(count).fill(0);
    let dangling = 0;
    rank.forEach((value, node) => {
      if (outDegree[node] === 0) dangling += value;
    });
    edges.forEach(([from, to]) => {
      next[to] += (damping * rank[from]) / outDegree[from];
    });
    const base = (1 - damping + damping * dangling) / count;
    rank = next.map((value) => value + base);
  }
  return rank.map((value) => value * count);
}

export function buildArchitecture(ex: Extraction, detection: Detection, preset: Preset, name: string, now: Date): Architecture {
  const index = new Map(ex.nodes.map((n, i) => [n.id, i]));
  const edges = ex.edges.flatMap((e) => {
    const from = index.get(e.from);
    const to = index.get(e.to);
    return from === undefined || to === undefined ? [] : [{ from, to, weight: e.weight, kinds: e.kinds }];
  });

  const n = ex.nodes.length;
  const fanIn = new Array<number>(n).fill(0);
  const fanOut = new Array<number>(n).fill(0);
  edges.forEach(({ from, to }) => {
    fanOut[from]++;
    fanIn[to]++;
  });
  const rank = n ? pageRank(n, edges.map(({ from, to }) => [from, to])) : [];

  const match = compileRoles(preset.roles);
  const prefix = detection.sourceDir === '' ? '' : detection.sourceDir + '/';
  const fallback = preset.roles.length - 1;

  const nodes: ArchNode[] = ex.nodes.map((node, i) => {
    const innerPath = prefix && node.id.startsWith(prefix) ? node.id.slice(prefix.length) : node.id;
    const found = match(innerPath);
    const refs = ex.routeRefs[node.id] ?? {};
    const total = fanIn[i] + fanOut[i];
    return {
      path: node.id,
      name: node.name,
      kind: node.kind,
      role: found === -1 ? fallback : found,
      lines: node.lines,
      functions: node.functions,
      complexity: node.complexity,
      maxComplexity: node.maxComplexity,
      fanIn: fanIn[i],
      fanOut: fanOut[i],
      instability: total ? round2(fanOut[i] / total) : 0,
      centrality: round2(rank[i]),
      routeRefs: Object.values(refs).reduce((s, c) => s + c, 0),
      routeFiles: Object.keys(refs),
    };
  });

  const layerOf = (i: number) => preset.roles[nodes[i].role]?.layer ?? 3;
  const isUpward = (e: (typeof edges)[number]): 0 | 1 =>
    !Object.keys(e.kinds).every((k) => CONCEPTUAL_KINDS.has(k)) && layerOf(e.from) > layerOf(e.to) ? 1 : 0;

  return {
    version: 1,
    name,
    lang: detection.lang,
    framework: detection.framework,
    sourceDir: detection.sourceDir,
    generatedAt: now.toISOString(),
    layers: preset.layers,
    roles: preset.roles.map((r) => ({ ...r, patterns: [...r.patterns] })),
    nodes,
    edges: edges.map((e) => [e.from, e.to, e.weight, e.kinds, isUpward(e)]),
    failed: ex.failed,
    unresolved: ex.unresolved,
  };
}
