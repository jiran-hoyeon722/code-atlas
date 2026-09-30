import type { Node, Parser } from 'web-tree-sitter';
import { measure } from '../complexity';
import type { FileFacts, LangModule } from '../link';
import type { SourceFile } from '../types';

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.swift$/, '');

const isTest = (path: string): boolean => path.startsWith('Tests/') || path.includes('/Tests/') || /Tests$/.test(nameOf(path));

const kindOf = (path: string): string => {
  if (isTest(path)) return 'test';
  return /View(Controller)?$/.test(nameOf(path)) ? 'view' : 'type';
};

/** A SwiftPM target is one module; anything outside `Sources/<T>/`·`Tests/<T>/` (e.g. an Xcode project) counts as a single module. */
const scopeOf = (path: string): string => /^(?:.*?\/)??(?:Sources|Tests)\/[^/]+\//.exec(path)?.[0] ?? '';

const DECLARATIONS = new Set(['class_declaration', 'protocol_declaration', 'typealias_declaration', 'function_declaration']);

function declaresOf(root: Node): string[] {
  const names: string[] = [];
  for (const c of root.namedChildren) {
    if (!c || !DECLARATIONS.has(c.type)) continue;
    if (c.childForFieldName('declaration_kind')?.type === 'extension') continue;
    const name = c.childForFieldName('name');
    if (name) names.push(name.text);
  }
  return names;
}

const isTypeName = (node: Node | null): node is Node => node?.type === 'simple_identifier' && /^[A-Z]/.test(node.text);

/** Every occurrence, duplicates included: the linker counts each one as edge weight. */
function mentionsOf(root: Node): string[] {
  const names: string[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'import_declaration') continue;
    if (node.type === 'user_type') {
      for (const c of node.namedChildren) if (c?.type === 'type_identifier') names.push(c.text);
    } else if (node.type === 'call_expression') {
      const callee = node.namedChild(0);
      if (isTypeName(callee)) names.push(callee.text);
    } else if (node.type === 'navigation_expression') {
      const target = node.childForFieldName('target');
      if (isTypeName(target)) names.push(target.text);
    }
    for (const c of node.namedChildren) if (c) stack.push(c);
  }
  return names;
}

function extractFile(parser: Parser, file: SourceFile): FileFacts {
  const base = { name: nameOf(file.path), kind: kindOf(file.path), lines: file.text.split('\n').length, scope: scopeOf(file.path), imports: [], wildcards: [] };
  const tree = parser.parse(file.text);
  if (!tree) return { ...base, declares: [], mentions: [], hasError: true, functions: 0, complexity: 0, maxComplexity: 0 };
  try {
    const root = tree.rootNode;
    return { ...base, declares: declaresOf(root), mentions: mentionsOf(root), hasError: root.hasError, ...measure(root, 'swift') };
  } finally {
    tree.delete();
  }
}

/** Swift imports name whole modules (`import UIKit`), so they never point at a file. */
const resolveImport = (): string[] => [];

export const swiftModule: LangModule = { extractFile, resolveImport, symbolLinks: true };
