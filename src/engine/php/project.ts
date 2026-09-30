import type { OnTree, Parsers } from '../parsers';
import type { Detection } from '../detect';
import type { Edge, Extraction, FileNode, RefKind, RepoInput, SourceFile } from '../types';
import { sourcesFor } from '../sources';
import { extractPhpFile, type PhpFacts } from './extract';

const isPhp = (path: string) => path.endsWith('.php');
const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const shortName = (fqcn: string) => fqcn.slice(fqcn.lastIndexOf('\\') + 1);
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export function extractPhpProject(
  input: RepoInput,
  detection: Detection,
  parsers: Parsers,
  onFile?: (path: string) => void,
  onLink?: () => void,
  onTree?: OnTree,
): Extraction {
  const srcPrefix = detection.sourceDir ? `${detection.sourceDir}/` : '';
  const providersPrefix = `${srcPrefix}Providers/`;
  const appFiles = sourcesFor(detection, input.files);

  const nodes: FileNode[] = [];
  const failed: Extraction['failed'] = [];
  const facts = new Map<string, PhpFacts>();
  const exact = new Map<string, string>();
  const lower = new Map<string, string>();

  for (const file of appFiles) {
    let f: PhpFacts;
    try {
      f = extractPhpFile(parsers.php, file, file.path.startsWith(providersPrefix), onTree);
    } catch {
      failed.push({ path: file.path, reason: 'read' });
      nodes.push({ id: file.path, name: baseName(file.path), kind: 'script', lines: file.text.split('\n').length, functions: 0, complexity: 0, maxComplexity: 0 });
      onFile?.(file.path);
      continue;
    }
    facts.set(file.path, f);
    if (f.hasError) failed.push({ path: file.path, reason: 'syntax' });
    // Later files win on duplicate class names, like deps.php's plain map assignment.
    for (const d of f.declarations) {
      exact.set(d.fqcn, file.path);
      lower.set(d.fqcn.toLowerCase(), file.path);
    }
    const primary = f.declarations[0];
    nodes.push({
      id: file.path,
      name: primary ? shortName(primary.fqcn) : baseName(file.path),
      kind: primary?.kind ?? 'script',
      lines: f.lines,
      functions: f.functions,
      complexity: f.complexity,
      maxComplexity: f.maxComplexity,
    });
    onFile?.(file.path);
  }

  onLink?.();

  // PHP class names are case-insensitive; exact spelling wins when both exist.
  const fileOf = (fqcn: string) => exact.get(fqcn) ?? lower.get(fqcn.toLowerCase());

  const edges = new Map<string, Edge>();
  const addEdge = (from: string, to: string, kind: RefKind) => {
    if (from === to) return;
    const key = `${from}\0${to}`;
    let e = edges.get(key);
    if (!e) edges.set(key, (e = { from, to, weight: 0, kinds: {} }));
    e.weight++;
    e.kinds[kind] = (e.kinds[kind] ?? 0) + 1;
  };

  for (const [path, f] of facts) {
    for (const r of f.refs) {
      const target = fileOf(r.fqcn);
      if (target) addEdge(path, target, r.kind);
    }
    for (const [event, listener] of f.listen) {
      const from = fileOf(event);
      const to = fileOf(listener);
      if (from && to) addEdge(from, to, 'triggers');
    }
    for (const [abstract, concrete] of f.binds) {
      const from = fileOf(abstract);
      const to = fileOf(concrete);
      if (from && to) addEdge(from, to, 'binds');
    }
  }

  const routeRefs: Extraction['routeRefs'] = {};
  const routePrefixes = detection.routeDirs.map((d) => `${d}/`);
  const routeFiles = input.files
    .filter((f) => isPhp(f.path) && routePrefixes.some((p) => f.path.startsWith(p)))
    .sort(byPath);
  for (const file of routeFiles) {
    let refs: PhpFacts['refs'];
    try {
      refs = extractPhpFile(parsers.php, file, false).refs;
    } catch {
      failed.push({ path: file.path, reason: 'read' });
      continue;
    }
    for (const r of refs) {
      const target = fileOf(r.fqcn);
      if (!target) continue;
      const perRoute = (routeRefs[target] ??= {});
      perRoute[file.path] = (perRoute[file.path] ?? 0) + 1;
    }
  }

  return { nodes, edges: [...edges.values()], routeRefs, failed, unresolved: 0 };
}
