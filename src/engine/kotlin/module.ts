import type { Node, Parser } from 'web-tree-sitter';
import { measure } from '../complexity';
import { resolveJvmImport } from '../jvm/resolve';
import type { FileFacts, LangModule, ProjectIndex } from '../link';
import type { SourceFile } from '../types';

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.kts?$/, '');

const TEST_DIRS = ['src/test/', 'src/androidTest/'];

const isTest = (path: string): boolean =>
  TEST_DIRS.some((d) => path.startsWith(d) || path.includes('/' + d)) || /Tests?$/.test(nameOf(path));

const TYPES = new Set(['class_declaration', 'object_declaration']);

const DECLARATIONS = new Set([...TYPES, 'type_alias', 'function_declaration']);

interface Header {
  scope: string;
  imports: string[];
  wildcards: string[];
  declares: string[];
  kind: 'class' | 'interface' | 'module';
}

const identifierOf = (node: Node): string | undefined => node.namedChildren.find((n) => n?.type === 'identifier')?.text;

/** `import a.b.C as D` → `a.b.C` (aliases only rename); `import a.b.*` → `a.b.*` (+ wildcard `a.b`). */
function headerOf(root: Node): Header {
  const h: Header = { scope: '', imports: [], wildcards: [], declares: [], kind: 'module' };
  let types = 0;
  let interfaces = 0;
  for (const c of root.namedChildren) {
    if (!c) continue;
    if (c.type === 'package_header') {
      h.scope = c.namedChildren.find((n) => n?.type === 'qualified_identifier')?.text ?? '';
    } else if (c.type === 'import') {
      const name = c.namedChildren.find((n) => n?.type === 'qualified_identifier')?.text;
      if (!name) continue;
      if (c.children.some((n) => n?.type === '*')) {
        h.imports.push(`${name}.*`);
        h.wildcards.push(name);
      } else h.imports.push(name);
    } else if (DECLARATIONS.has(c.type)) {
      const name = identifierOf(c);
      if (name) h.declares.push(name);
      if (!TYPES.has(c.type)) continue;
      types++;
      if (c.children.some((n) => n?.type === 'interface')) interfaces++;
    }
  }
  if (types > 0) h.kind = interfaces === types ? 'interface' : 'class';
  return h;
}

/**
 * Every occurrence, duplicates included: the linker counts each one as edge weight.
 * Call names count too, since constructors have no `new` and top-level functions are declared symbols.
 */
function mentionsOf(root: Node): string[] {
  const names: string[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'package_header' || node.type === 'import') continue;
    const first = node.namedChild(0);
    if (node.type === 'user_type') {
      for (const c of node.namedChildren) if (c?.type === 'identifier') names.push(c.text);
    } else if (node.type === 'call_expression' && first?.type === 'identifier') {
      names.push(first.text);
    } else if (node.type === 'navigation_expression' && first?.type === 'identifier' && /^[A-Z]/.test(first.text)) {
      names.push(first.text);
    }
    for (const c of node.namedChildren) if (c) stack.push(c);
  }
  return names;
}

function extractFile(parser: Parser, file: SourceFile): FileFacts {
  const base = { name: nameOf(file.path), lines: file.text.split('\n').length };
  const tree = parser.parse(file.text);
  if (!tree) {
    return { ...base, kind: isTest(file.path) ? 'test' : 'module', imports: [], scope: '', declares: [], mentions: [], wildcards: [], hasError: true, functions: 0, complexity: 0, maxComplexity: 0 };
  }
  try {
    const root = tree.rootNode;
    const h = headerOf(root);
    return {
      ...base,
      kind: isTest(file.path) ? 'test' : h.kind,
      imports: h.imports.map((specifier) => ({ specifier, kind: 'import' as const })),
      scope: h.scope,
      declares: h.declares,
      mentions: mentionsOf(root),
      wildcards: h.wildcards,
      hasError: root.hasError,
      ...measure(root, 'kotlin'),
    };
  } finally {
    tree.delete();
  }
}

const resolveImport = (_from: string, specifier: string, index: ProjectIndex): string[] | null => resolveJvmImport(specifier, index);

export const kotlinModule: LangModule = { extractFile, resolveImport, symbolLinks: true };
