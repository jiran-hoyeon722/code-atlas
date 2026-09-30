import type { Node, Parser } from 'web-tree-sitter';
import { measure } from '../complexity';
import type { FileFacts, LangModule, ProjectIndex } from '../link';
import type { RefKind, SourceFile } from '../types';

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const dirOf = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
};

/** Plain text of an argument, or null when it has any expansion (`$x`, backticks, `$(…)`). */
function literal(arg: Node): string | null {
  let text: string;
  if (arg.type === 'word') text = arg.text;
  else if (arg.type === 'raw_string') text = arg.text.slice(1, -1);
  else if (arg.type === 'string') {
    if (arg.namedChildren.some((c) => c?.type !== 'string_content')) return null;
    text = arg.namedChildren.map((c) => c!.text).join('');
  } else return null;
  return text === '' || text.includes('$') || text.includes('`') ? null : text;
}

function refOf(cmd: Node): { specifier: string; kind: RefKind } | null {
  const name = cmd.childForFieldName('name');
  if (name?.type !== 'command_name') return null;
  const first = name.text;
  const args = cmd.childrenForFieldName('argument');
  const arg = args[0] ? literal(args[0]) : null;
  if (first === 'source' || first === '.') return arg ? { specifier: arg, kind: 'import' } : null;
  if (first === 'bash' || first === 'sh') return arg && !arg.startsWith('-') ? { specifier: arg, kind: 'other' } : null;
  if (first.startsWith('./') || first.startsWith('../') || first.endsWith('.sh')) {
    const own = literal(name.namedChild(0)!);
    return own ? { specifier: own, kind: 'other' } : null;
  }
  return null;
}

function refsOf(root: Node): { specifier: string; kind: RefKind }[] {
  const refs: { specifier: string; kind: RefKind }[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'command') {
      const ref = refOf(node);
      if (ref) refs.push(ref);
    }
    for (let i = node.childCount - 1; i >= 0; i--) {
      const c = node.child(i);
      if (c) stack.push(c);
    }
  }
  return refs;
}

function extractFile(parser: Parser, file: SourceFile): FileFacts {
  const base = { name: nameOf(file.path), kind: 'script', scope: '', declares: [], mentions: [], wildcards: [], lines: file.text.split('\n').length };
  const tree = parser.parse(file.text);
  if (!tree) return { ...base, imports: [], hasError: true, functions: 0, complexity: 0, maxComplexity: 0 };
  try {
    const root = tree.rootNode;
    return { ...base, imports: refsOf(root), hasError: root.hasError, ...measure(root, 'shell') };
  } finally {
    tree.delete();
  }
}

/** Folds `.` and `..`; null when the path climbs above the repo root. */
function normalize(path: string): string | null {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join('/');
}

function resolveImport(from: string, specifier: string, index: ProjectIndex): string[] | null {
  if (specifier.startsWith('/') || specifier.startsWith('~')) return [];
  const dir = dirOf(from);
  const local = normalize(dir === '' ? specifier : `${dir}/${specifier}`);
  if (local !== null && index.paths.has(local)) return [local];
  const root = normalize(specifier);
  return root !== null && index.paths.has(root) ? [root] : null;
}

export const shellModule: LangModule = { extractFile, resolveImport, symbolLinks: false };
