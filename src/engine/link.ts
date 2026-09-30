import type { Parser } from 'web-tree-sitter';
import type { Detection } from './detect';
import type { Parsers } from './parsers';
import { sourcesFor } from './sources';
import type { Edge, Extraction, FileNode, Lang, RefKind, RepoInput, SourceFile } from './types';

export interface FileFacts {
  name: string;
  kind: string;
  imports: { specifier: string; kind: RefKind }[];
  scope: string;
  declares: string[];
  mentions: string[];
  wildcards: string[];
  hasError: boolean;
  lines: number;
  functions: number;
  complexity: number;
  maxComplexity: number;
}

export interface ProjectIndex {
  paths: ReadonlySet<string>;
  configs: Record<string, string>;
  byDir: ReadonlyMap<string, string[]>;
  bySymbol: ReadonlyMap<string, string[]>;
  facts: ReadonlyMap<string, FileFacts>;
}

export interface LangModule {
  extractFile(parser: Parser, file: SourceFile): FileFacts;
  /** 대상 파일 목록. [] = 프로젝트 밖(무시), null = 프로젝트 안인데 못 찾음(미해결 +1). */
  resolveImport(from: string, specifier: string, index: ProjectIndex): string[] | null;
  symbolLinks: boolean;
}

const dirOf = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
};

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function extractProject(
  lang: Lang,
  mod: LangModule,
  input: RepoInput,
  detection: Detection,
  parsers: Parsers,
  onFile?: (path: string) => void,
  onLink?: () => void,
): Extraction {
  const sources = sourcesFor(detection, input.files);
  const parser = parsers.get(lang);
  const nodes: FileNode[] = [];
  const failed: Extraction['failed'] = [];
  const facts = new Map<string, FileFacts>();
  const byDir = new Map<string, string[]>();
  const bySymbol = new Map<string, string[]>();

  for (const file of sources) {
    push(byDir, dirOf(file.path), file.path);
    let f: FileFacts;
    try {
      f = mod.extractFile(parser, file);
    } catch {
      failed.push({ path: file.path, reason: 'read' });
      nodes.push({ id: file.path, name: baseName(file.path), kind: 'module', lines: file.text.split('\n').length, functions: 0, complexity: 0, maxComplexity: 0 });
      onFile?.(file.path);
      continue;
    }
    if (f.hasError) failed.push({ path: file.path, reason: 'syntax' });
    facts.set(file.path, f);
    for (const name of f.declares) push(bySymbol, name, file.path);
    nodes.push({ id: file.path, name: f.name, kind: f.kind, lines: f.lines, functions: f.functions, complexity: f.complexity, maxComplexity: f.maxComplexity });
    onFile?.(file.path);
  }

  onLink?.();
  const index: ProjectIndex = { paths: new Set(sources.map((f) => f.path)), configs: input.configs, byDir, bySymbol, facts };
  const edges = new Map<string, Edge>();
  let unresolved = 0;
  const link = (from: string, to: string, kind: RefKind) => {
    if (to === from || !index.paths.has(to)) return;
    const key = `${from}\0${to}`;
    let edge = edges.get(key);
    if (!edge) edges.set(key, (edge = { from, to, weight: 0, kinds: {} }));
    edge.weight++;
    edge.kinds[kind] = (edge.kinds[kind] ?? 0) + 1;
  };

  for (const [path, f] of facts) {
    for (const imp of f.imports) {
      const targets = mod.resolveImport(path, imp.specifier, index);
      if (targets === null) unresolved++;
      else for (const to of targets) link(path, to, imp.kind);
    }
    if (!mod.symbolLinks) continue;
    for (const name of f.mentions) {
      for (const to of bySymbol.get(name) ?? []) {
        const scope = facts.get(to)!.scope;
        if (scope === f.scope || f.wildcards.includes(scope)) link(path, to, 'class-ref');
      }
    }
  }

  return { nodes, edges: [...edges.values()], routeRefs: {}, failed, unresolved };
}
