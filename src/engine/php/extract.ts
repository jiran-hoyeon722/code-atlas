import type { Node, Parser } from 'web-tree-sitter';
import type { OnTree } from '../parsers';
import type { RefKind, SourceFile } from '../types';
import { measure } from '../complexity';
import { resolveClassName, scopeAt } from './names';

export type DeclKind = 'class' | 'abstract' | 'interface' | 'trait' | 'enum';

export interface PhpFacts {
  declarations: { fqcn: string; kind: DeclKind }[];
  refs: { fqcn: string; kind: RefKind }[];
  listen: [event: string, listener: string][];
  binds: [abstract: string, concrete: string][];
  hasError: boolean;
  lines: number;
  functions: number;
  complexity: number;
  maxComplexity: number;
}

const NAME_TYPES = new Set(['name', 'qualified_name', 'relative_name']);

const DECLARATIONS: Record<string, DeclKind> = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  trait_declaration: 'trait',
  enum_declaration: 'enum',
};

// Builtin type keywords are never class names (tree-sitter sometimes parses them as named_type).
const RESERVED = new Set([
  'int', 'string', 'array', 'bool', 'float', 'void', 'mixed', 'null', 'callable',
  'iterable', 'object', 'never', 'false', 'true',
]);

const TYPE_WRAPPERS = new Set(['named_type', 'optional_type', 'union_type', 'intersection_type', 'disjunctive_normal_form_type']);
const PARAMETERS = new Set(['simple_parameter', 'property_promotion_parameter', 'variadic_parameter']);
const FUNCTION_LIKE = new Set(['function_definition', 'method_declaration', 'anonymous_function', 'arrow_function']);
const TRAIT_ADAPTATIONS = new Set(['use_instead_of_clause', 'use_as_clause']);
const BIND_METHODS = new Set(['bind', 'singleton', 'scoped']);

const same = (a: Node | null | undefined, b: Node) => !!a && a.id === b.id;

// Mirrors deps.php typeKind(): the owner of a type decides between inject / type / other.
function typeKind(owner: Node | null): RefKind {
  if (!owner) return 'other';
  if (PARAMETERS.has(owner.type)) {
    const fn = owner.parent?.parent;
    return fn?.type === 'method_declaration' && fn.childForFieldName('name')?.text.toLowerCase() === '__construct'
      ? 'inject'
      : 'type';
  }
  return owner.type === 'property_declaration' || FUNCTION_LIKE.has(owner.type) ? 'type' : 'other';
}

// Mirrors deps.php referenceKind(): classified by the syntactic parent; null = not a class-name position.
function referenceKind(n: Node): RefKind | null {
  const p = n.parent;
  if (!p) return null;
  switch (p.type) {
    case 'named_type': {
      let owner: Node | null = p;
      while (owner && TYPE_WRAPPERS.has(owner.type)) owner = owner.parent;
      if (owner?.type === 'type_list') return owner.parent?.type === 'catch_clause' ? 'catch' : 'other';
      return typeKind(owner);
    }
    case 'base_clause':
      return p.parent?.type === 'class_declaration' || p.parent?.type === 'anonymous_class' ? 'extends' : 'implements';
    case 'class_interface_clause':
      return 'implements';
    case 'use_declaration':
      return 'trait';
    case 'use_instead_of_clause':
      // `A::f insteadof B`: the first child is the A::f access; later names are traits.
      return same(p.namedChild(0), n) ? null : 'other';
    case 'object_creation_expression':
      return 'new';
    case 'scoped_call_expression':
    case 'scoped_property_access_expression':
      return same(p.childForFieldName('scope'), n) ? 'static-call' : null;
    case 'class_constant_access_expression': {
      if (!same(p.namedChild(0), n)) return null;
      if (p.parent && TRAIT_ADAPTATIONS.has(p.parent.type)) return 'other';
      return p.namedChild(p.namedChildCount - 1)?.text.toLowerCase() === 'class' ? 'class-ref' : 'const';
    }
    case 'binary_expression':
      return same(p.childForFieldName('right'), n) && p.childForFieldName('operator')?.type.toLowerCase() === 'instanceof'
        ? 'instanceof'
        : null;
    case 'attribute':
      return same(p.namedChild(0), n) ? 'attribute' : null;
    default:
      return null;
  }
}

function resolve(root: Node, n: Node): string {
  if (n.type === 'name' && RESERVED.has(n.text.toLowerCase())) return '';
  return resolveClassName(n.text, scopeAt(root, n));
}

// deps.php classConstTarget(): `X::<anything>` where X resolves to a real class name.
function classConstTarget(root: Node, n: Node | null | undefined): string {
  if (n?.type !== 'class_constant_access_expression') return '';
  const cls = n.namedChild(0);
  return cls && NAME_TYPES.has(cls.type) ? resolve(root, cls) : '';
}

function arrayItems(arr: Node): { key: Node | null; value: Node | null }[] {
  const out: { key: Node | null; value: Node | null }[] = [];
  for (const item of arr.namedChildren) {
    if (item?.type !== 'array_element_initializer') continue;
    const keyed = item.children.some((c) => c?.type === '=>');
    const parts = item.namedChildren.filter((c): c is Node => !!c && c.type !== 'comment');
    out.push(keyed ? { key: parts[0] ?? null, value: parts[parts.length - 1] ?? null } : { key: null, value: parts[0] ?? null });
  }
  return out;
}

function argValue(arg: Node | null | undefined): Node | null {
  if (!arg) return null;
  const name = arg.childForFieldName('name');
  const parts = arg.namedChildren.filter((c): c is Node => !!c && !same(name, c) && c.type !== 'comment');
  return parts[parts.length - 1] ?? null;
}

function declName(root: Node, decl: Node): string {
  const name = decl.childForFieldName('name')?.text ?? '';
  const ns = scopeAt(root, decl).namespace;
  return ns ? `${ns}\\${name}` : name;
}

export function extractPhpFile(parser: Parser, file: SourceFile, isProvider: boolean, onTree?: OnTree): PhpFacts {
  const facts: PhpFacts = {
    declarations: [],
    refs: [],
    listen: [],
    binds: [],
    hasError: true,
    lines: file.text.split('\n').length,
    functions: 0,
    complexity: 0,
    maxComplexity: 0,
  };
  const tree = parser.parse(file.text);
  if (!tree) return facts;
  try {
    const root = tree.rootNode;
    facts.hasError = root.hasError;
    Object.assign(facts, measure(root, 'php'));
    // deps.php order: method-call binds before provider class-map binds.
    const mapBinds: [string, string][] = [];

    const stack: Node[] = [root];
    while (stack.length > 0) {
      const n = stack.pop()!;
      const declKind = DECLARATIONS[n.type];

      if (declKind && n.childForFieldName('name')) {
        const abstract = declKind === 'class' && n.children.some((c) => c?.type === 'abstract_modifier');
        facts.declarations.push({ fqcn: declName(root, n), kind: abstract ? 'abstract' : declKind });
      } else if (n.type === 'namespace_use_declaration') {
        continue;
      } else if (NAME_TYPES.has(n.type)) {
        const kind = referenceKind(n);
        if (kind) {
          const fqcn = resolve(root, n);
          if (fqcn) facts.refs.push({ fqcn, kind });
        }
        continue;
      } else if (n.type === 'property_declaration') {
        const first = n.namedChildren.find((c) => c?.type === 'property_element');
        const init = first?.childForFieldName('default_value');
        if (first?.childForFieldName('name')?.text === '$listen' && init?.type === 'array_creation_expression') {
          for (const { key, value } of arrayItems(init)) {
            const event = classConstTarget(root, key);
            if (!event || value?.type !== 'array_creation_expression') continue;
            for (const l of arrayItems(value)) {
              const listener = classConstTarget(root, l.value);
              if (listener) facts.listen.push([event, listener]);
            }
          }
        }
      } else if (n.type === 'member_call_expression') {
        const method = n.childForFieldName('name');
        const args = n.childForFieldName('arguments')?.namedChildren.filter((c) => c && c.type !== 'comment') ?? [];
        if (method?.type === 'name' && BIND_METHODS.has(method.text.toLowerCase()) && args.length >= 2) {
          const a = classConstTarget(root, argValue(args[0]));
          const c = classConstTarget(root, argValue(args[1]));
          if (a && c) facts.binds.push([a, c]);
        }
      } else if (isProvider && n.type === 'array_creation_expression') {
        for (const { key, value } of arrayItems(n)) {
          const a = classConstTarget(root, key);
          const c = classConstTarget(root, value);
          if (a && c) mapBinds.push([a, c]);
        }
      }

      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i);
        if (c) stack.push(c);
      }
    }
    facts.binds.push(...mapBinds);
    onTree?.(file.path, root);
  } finally {
    tree.delete();
  }
  return facts;
}
