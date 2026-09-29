import type { Detection } from '../detect';
import { isSourcePath } from '../collect';
import type { Parsers } from '../parsers';
import type { Edge, Extraction, FileNode, RepoInput } from '../types';
import { extractTsFile } from './extract';
import { createTsResolver } from './resolve';

const ASSET_EXT = /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|ico|json|woff2?|ttf|md|html)$/i;

const isGenerated = (path: string): boolean => /\.gen\.tsx?$/.test(path);

function moduleKind(path: string): string {
  if (/\.d\.[cm]?ts$/.test(path)) return 'types';
  if (/\.(test|spec)\.[^.]+$/.test(path)) return 'test';
  return /\.[jt]sx$/.test(path) ? 'component' : 'module';
}

function moduleName(path: string): string {
  const parts = path.split('/');
  const base = parts[parts.length - 1].replace(/\.d\.[cm]?ts$/, '').replace(/\.[^.]+$/, '');
  return base === 'index' && parts.length > 1 ? `${parts[parts.length - 2]}/index` : base;
}

/** Alias prefixes from `compilerOptions.paths` keys (crude text scan; the resolver owns real resolution). */
function aliasPrefixes(configs: Record<string, string>): string[] {
  const out = new Set(['@/', '~/']);
  for (const [path, text] of Object.entries(configs)) {
    if (!/(^|\/)(tsconfig[^/]*|jsconfig)\.json$/.test(path)) continue;
    const block = /"paths"\s*:\s*\{([^}]*)\}/.exec(text);
    if (!block) continue;
    for (const m of block[1].matchAll(/"([^"]+)"\s*:\s*\[/g)) {
      const prefix = m[1].split('*')[0];
      if (prefix) out.add(prefix);
    }
  }
  return [...out];
}

export function extractTsProject(
  input: RepoInput,
  detection: Detection,
  parsers: Parsers,
  onFile?: (path: string) => void,
): Extraction {
  const dir = detection.sourceDir;
  const inSource = (p: string) => dir === '' || p.startsWith(dir + '/');
  const sources = input.files
    .filter((f) => isSourcePath(f.path) === 'ts' && inSource(f.path) && !isGenerated(f.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const known = new Set(sources.map((f) => f.path));
  // Resolve against every input file so generated/asset targets resolve and are then dropped, not "unresolved".
  const resolve = createTsResolver(new Set(input.files.map((f) => f.path)), input.configs);
  const aliases = aliasPrefixes(input.configs);
  const isLocal = (s: string) => s.startsWith('.') || s.startsWith('/') || aliases.some((a) => s.startsWith(a));
  const inRoutes = (p: string) => detection.routeDirs.some((r) => p.startsWith(r + '/'));

  const nodes: FileNode[] = [];
  const edges = new Map<string, Edge>();
  const routeRefs: Extraction['routeRefs'] = {};
  const failed: Extraction['failed'] = [];
  let unresolved = 0;

  for (const file of sources) {
    let r;
    try {
      r = extractTsFile(parsers.tsx, file);
    } catch {
      failed.push({ path: file.path, reason: 'read' });
      nodes.push({ id: file.path, name: moduleName(file.path), kind: moduleKind(file.path), lines: file.text.split('\n').length, functions: 0, complexity: 0, maxComplexity: 0 });
      onFile?.(file.path);
      continue;
    }
    if (r.hasError) failed.push({ path: file.path, reason: 'syntax' });
    nodes.push({
      id: file.path,
      name: moduleName(file.path),
      kind: moduleKind(file.path),
      lines: r.lines,
      functions: r.functions,
      complexity: r.complexity,
      maxComplexity: r.maxComplexity,
    });
    for (const imp of r.imports) {
      const to = resolve(file.path, imp.specifier);
      if (to === null) {
        if (isLocal(imp.specifier) && !ASSET_EXT.test(imp.specifier.replace(/[?#].*$/, ''))) unresolved++;
        continue;
      }
      if (to === file.path || !known.has(to)) continue;
      const key = `${file.path}\0${to}`;
      let edge = edges.get(key);
      if (!edge) edges.set(key, (edge = { from: file.path, to, weight: 0, kinds: {} }));
      edge.weight++;
      edge.kinds[imp.kind] = (edge.kinds[imp.kind] ?? 0) + 1;
      if (inRoutes(file.path)) {
        const byRoute = (routeRefs[to] ??= {});
        byRoute[file.path] = (byRoute[file.path] ?? 0) + 1;
      }
    }
    onFile?.(file.path);
  }

  return { nodes, edges: [...edges.values()], routeRefs, failed, unresolved };
}
