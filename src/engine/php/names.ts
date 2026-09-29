import type { Node, Tree } from 'web-tree-sitter';

export interface PhpScope {
  namespace: string;
  classes: Map<string, string>;
  functions: Map<string, string>;
  consts: Map<string, string>;
}

type UseKind = 'classes' | 'functions' | 'consts';

const cache = new WeakMap<Tree, Map<number, PhpScope>>();

const strip = (s: string) => s.replace(/^\\+/, '');
const lastSegment = (s: string) => s.slice(s.lastIndexOf('\\') + 1);

function kindOf(n: Node): UseKind | null {
  for (const c of n.children) {
    if (!c) continue;
    if (c.type === 'function') return 'functions';
    if (c.type === 'const') return 'consts';
  }
  return null;
}

function addUses(decl: Node, scope: PhpScope): void {
  const declKind = kindOf(decl);
  const group = decl.childForFieldName('body');
  if (group) {
    const prefixNode = decl.children.find((c) => c?.type === 'namespace_name');
    const prefix = prefixNode ? strip(prefixNode.text) : '';
    for (const clause of group.children) {
      if (clause?.type === 'namespace_use_clause') addClause(clause, prefix, kindOf(clause) ?? declKind ?? 'classes', scope);
    }
    return;
  }
  for (const clause of decl.children) {
    if (clause?.type === 'namespace_use_clause') addClause(clause, '', declKind ?? kindOf(clause) ?? 'classes', scope);
  }
}

function addClause(clause: Node, prefix: string, kind: UseKind, scope: PhpScope): void {
  const nameNode = clause.children.find((c) => c && (c.type === 'name' || c.type === 'qualified_name') && c.id !== clause.childForFieldName('alias')?.id);
  if (!nameNode) return;
  const name = strip(nameNode.text);
  const full = prefix ? `${prefix}\\${name}` : name;
  const alias = clause.childForFieldName('alias')?.text ?? lastSegment(full);
  const key = kind === 'consts' ? alias : alias.toLowerCase();
  scope[kind].set(key, full);
}

function build(container: Node, nsName: string): PhpScope {
  const scope: PhpScope = { namespace: nsName, classes: new Map(), functions: new Map(), consts: new Map() };
  for (const c of container.children) {
    if (c?.type === 'namespace_use_declaration') addUses(c, scope);
  }
  return scope;
}

export function scopeAt(root: Node, node: Node): PhpScope {
  // Bracketed `namespace X { ... }`: the enclosing block is the scope.
  let block: Node | null = node;
  while (block && block.type !== 'namespace_definition') block = block.parent;
  let key: number;
  let make: () => PhpScope;
  if (block && block.childForFieldName('body')) {
    const b = block;
    key = b.startIndex;
    make = () => build(b.childForFieldName('body')!, b.childForFieldName('name')?.text ?? '');
  } else {
    // Unbracketed: the last top-level `namespace X;` starting at or before the node, else global.
    let start: Node | null = null;
    for (const c of root.children) {
      if (!c || c.startIndex > node.startIndex) break;
      if (c.type === 'namespace_definition' && !c.childForFieldName('body')) start = c;
    }
    key = start ? start.startIndex : -1;
    make = () => {
      const scope: PhpScope = { namespace: start?.childForFieldName('name')?.text ?? '', classes: new Map(), functions: new Map(), consts: new Map() };
      let inScope = start === null;
      for (const c of root.children) {
        if (!c) continue;
        if (c.type === 'namespace_definition') {
          inScope = start !== null && c.id === start.id;
          continue;
        }
        if (inScope && c.type === 'namespace_use_declaration') addUses(c, scope);
      }
      return scope;
    };
  }
  let perTree = cache.get(root.tree);
  if (!perTree) cache.set(root.tree, (perTree = new Map()));
  let scope = perTree.get(key);
  if (!scope) perTree.set(key, (scope = make()));
  return scope;
}

export function resolveClassName(raw: string, scope: PhpScope): string {
  if (raw.startsWith('\\')) return raw.slice(1);
  const lower = raw.toLowerCase();
  if (lower === 'self' || lower === 'static' || lower === 'parent') return '';
  const ns = scope.namespace;
  const qualify = (n: string) => (ns ? `${ns}\\${n}` : n);
  if (lower.startsWith('namespace\\')) return qualify(raw.slice('namespace\\'.length));
  const i = raw.indexOf('\\');
  const first = i === -1 ? raw : raw.slice(0, i);
  const hit = scope.classes.get(first.toLowerCase());
  if (hit) return i === -1 ? hit : `${hit}${raw.slice(i)}`;
  return qualify(raw);
}
