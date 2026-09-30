import type { Node, Parser } from 'web-tree-sitter';
import { measure } from '../complexity';
import { resolveJvmImport } from '../jvm/resolve';
import type { FileFacts, LangModule, ProjectIndex } from '../link';
import type { SourceFile } from '../types';

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.java$/, '');

const isTest = (path: string): boolean =>
  path.startsWith('src/test/') || path.includes('/src/test/') || /Tests?$/.test(nameOf(path));

const DECLARATIONS = new Set([
  'class_declaration',
  'interface_declaration',
  'enum_declaration',
  'record_declaration',
  'annotation_type_declaration',
]);

const RECEIVERS = new Set(['method_invocation', 'field_access']);

interface Header {
  scope: string;
  imports: string[];
  wildcards: string[];
  declares: string[];
  interfaceOnly: boolean;
}

/** `import a.b.*` → `a.b.*` (+ wildcard `a.b`); `import static a.b.C.*` → `a.b.C`, since it opens a class, not a package. */
function headerOf(root: Node): Header {
  const h: Header = { scope: '', imports: [], wildcards: [], declares: [], interfaceOnly: false };
  let types = 0;
  let interfaces = 0;
  for (const c of root.namedChildren) {
    if (!c) continue;
    if (c.type === 'package_declaration') {
      h.scope = c.namedChildren.find((n) => n?.type === 'scoped_identifier' || n?.type === 'identifier')?.text ?? '';
    } else if (c.type === 'import_declaration') {
      const name = c.namedChildren.find((n) => n?.type === 'scoped_identifier' || n?.type === 'identifier')?.text;
      if (!name) continue;
      const star = c.namedChildren.some((n) => n?.type === 'asterisk');
      const isStatic = c.children.some((n) => n?.type === 'static');
      if (!star || isStatic) h.imports.push(name);
      else {
        h.imports.push(`${name}.*`);
        h.wildcards.push(name);
      }
    } else if (DECLARATIONS.has(c.type)) {
      const name = c.childForFieldName('name')?.text;
      if (name) h.declares.push(name);
      types++;
      if (c.type === 'interface_declaration') interfaces++;
    }
  }
  h.interfaceOnly = types > 0 && interfaces === types;
  return h;
}

/** Every occurrence, duplicates included: the linker counts each one as edge weight. */
function mentionsOf(root: Node): string[] {
  const names: string[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'type_identifier') names.push(node.text);
    else if (RECEIVERS.has(node.type)) {
      const obj = node.childForFieldName('object');
      if (obj?.type === 'identifier' && /^[A-Z]/.test(obj.text)) names.push(obj.text);
    }
    if (node.type === 'package_declaration' || node.type === 'import_declaration') continue;
    for (const c of node.namedChildren) if (c) stack.push(c);
  }
  return names;
}

function extractFile(parser: Parser, file: SourceFile): FileFacts {
  const base = { name: nameOf(file.path), lines: file.text.split('\n').length };
  const tree = parser.parse(file.text);
  if (!tree) {
    return { ...base, kind: isTest(file.path) ? 'test' : 'class', imports: [], scope: '', declares: [], mentions: [], wildcards: [], hasError: true, functions: 0, complexity: 0, maxComplexity: 0 };
  }
  try {
    const root = tree.rootNode;
    const h = headerOf(root);
    const kind = isTest(file.path) ? 'test' : h.interfaceOnly ? 'interface' : 'class';
    return {
      ...base,
      kind,
      imports: h.imports.map((specifier) => ({ specifier, kind: 'import' as const })),
      scope: h.scope,
      declares: h.declares,
      mentions: mentionsOf(root),
      wildcards: h.wildcards,
      hasError: root.hasError,
      ...measure(root, 'java'),
    };
  } finally {
    tree.delete();
  }
}

const resolveImport = (_from: string, specifier: string, index: ProjectIndex): string[] | null => resolveJvmImport(specifier, index);

export const javaModule: LangModule = { extractFile, resolveImport, symbolLinks: true };
