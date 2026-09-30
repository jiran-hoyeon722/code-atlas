import type { Node, Parser } from 'web-tree-sitter';
import type { OnTree } from '../parsers';
import { measure } from '../complexity';
import type { SourceFile } from '../types';

export type ImportKind = 'import' | 'type-import' | 'dynamic-import' | 're-export' | 'require';

export interface TsImport {
  specifier: string;
  kind: ImportKind;
}

export interface TsFileResult {
  imports: TsImport[];
  hasError: boolean;
  lines: number;
  functions: number;
  complexity: number;
  maxComplexity: number;
}

/** Text of a plain string literal node; null for template strings, empty strings, etc. */
function literal(node: Node | null): string | null {
  if (!node || node.type !== 'string') return null;
  const frag = node.namedChildren.find((c) => c.type === 'string_fragment');
  return frag ? frag.text : null;
}

const hasTypeKeyword = (node: Node): boolean => node.children.some((c) => c.type === 'type');

/** `import {type A, type B} from` — every specifier type-only (and at least one). */
function allSpecifiersTypeOnly(clause: Node): boolean {
  if (clause.namedChildren.some((c) => c.type !== 'named_imports')) return false; // default / namespace import
  const specs = clause.namedChildren[0]?.namedChildren.filter((c) => c.type === 'import_specifier') ?? [];
  return specs.length > 0 && specs.every(hasTypeKeyword);
}

function importKind(stmt: Node): ImportKind {
  if (stmt.namedChildren.some((c) => c.type === 'import_require_clause')) return 'require';
  if (hasTypeKeyword(stmt)) return 'type-import';
  const clause = stmt.namedChildren.find((c) => c.type === 'import_clause');
  return clause && allSpecifiersTypeOnly(clause) ? 'type-import' : 'import';
}

const TYPE_CONTEXT = new Set([
  'type_annotation', 'opting_type_annotation', 'omitting_type_annotation', 'type_arguments', 'type_parameters',
  'type_alias_declaration', 'interface_declaration', 'object_type', 'type_query', 'generic_type', 'union_type',
  'intersection_type', 'array_type', 'tuple_type', 'function_type', 'constraint', 'default_type',
]);

/**
 * `import('./x').T` used as a type. The grammar parses it as a call, and `import('./x').T[]` even as an ERROR,
 * so rely on the surroundings: a type ancestor, or a member access on the promise that is never called.
 */
function isTypePositionImport(call: Node): boolean {
  const parent = call.parent;
  if (parent?.type === 'member_expression' && parent.childForFieldName('object')?.id === call.id) {
    const grand = parent.parent;
    if (!(grand?.type === 'call_expression' && grand.childForFieldName('function')?.id === parent.id)) return true;
  }
  for (let n = parent; n; n = n.parent) if (TYPE_CONTEXT.has(n.type)) return true;
  return false;
}

export function extractTsFile(parser: Parser, file: SourceFile, onTree?: OnTree): TsFileResult {
  const lines = file.text.split('\n').length;
  const tree = parser.parse(file.text);
  if (!tree) return { imports: [], hasError: true, lines, functions: 0, complexity: 0, maxComplexity: 0 };
  try {
    const root = tree.rootNode;
    const imports: TsImport[] = [];
    // Explicit stack (document order): deeply nested code must not overflow the call stack.
    const stack: Node[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.type === 'import_statement') {
        const req = node.namedChildren.find((c) => c.type === 'import_require_clause');
        const spec = literal((req ?? node).childForFieldName('source'));
        if (spec !== null) imports.push({ specifier: spec, kind: importKind(node) });
      } else if (node.type === 'export_statement') {
        const spec = literal(node.childForFieldName('source'));
        if (spec !== null) imports.push({ specifier: spec, kind: hasTypeKeyword(node) ? 'type-import' : 're-export' });
      } else if (node.type === 'call_expression') {
        const fn = node.childForFieldName('function');
        const args = node.childForFieldName('arguments');
        const spec = literal(args?.namedChildren[0] ?? null);
        if (spec !== null && fn) {
          if (fn.type === 'import') imports.push({ specifier: spec, kind: isTypePositionImport(node) ? 'type-import' : 'dynamic-import' });
          else if (fn.type === 'identifier' && fn.text === 'require') imports.push({ specifier: spec, kind: 'require' });
        }
      }
      for (let i = node.childCount - 1; i >= 0; i--) {
        const c = node.child(i);
        if (c) stack.push(c);
      }
    }
    const result = { imports, hasError: root.hasError, lines, ...measure(root, 'ts') };
    onTree?.(file.path, root);
    return result;
  } finally {
    tree.delete();
  }
}
