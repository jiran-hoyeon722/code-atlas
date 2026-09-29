export type Lang = 'php' | 'ts';

export interface SourceFile {
  path: string;
  text: string;
}

export interface RepoInput {
  name: string;
  files: SourceFile[];
  /** keys are paths of composer.json, package.json, tsconfig*.json, jsconfig.json */
  configs: Record<string, string>;
}

export type RefKind =
  | 'inject' | 'type' | 'static-call' | 'new' | 'const' | 'class-ref'
  | 'extends' | 'implements' | 'trait' | 'catch' | 'instanceof' | 'attribute'
  | 'other' | 'triggers' | 'binds'
  | 'import' | 'type-import' | 'dynamic-import' | 're-export' | 'require';

export interface FileNode {
  id: string;
  name: string;
  kind: string;
  lines: number;
  functions: number;
  complexity: number;
  maxComplexity: number;
}

export interface Edge {
  from: string;
  to: string;
  weight: number;
  kinds: Partial<Record<RefKind, number>>;
}

export interface Extraction {
  nodes: FileNode[];
  edges: Edge[];
  routeRefs: Record<string, Record<string, number>>;
  failed: { path: string; reason: 'syntax' | 'read' }[];
  unresolved: number;
}
