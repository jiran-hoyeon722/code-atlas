import type { Node, Parser } from 'web-tree-sitter';
import { measure } from '../complexity';
import type { FileFacts, LangModule, ProjectIndex } from '../link';
import type { SourceFile } from '../types';

const ROOTS = ['', 'src'];

const dirOf = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
};

function nameOf(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1);
  if (file !== '__init__.py') return file.replace(/\.py$/, '');
  const dir = dirOf(path);
  return dir === '' ? '__init__' : `${dir.slice(dir.lastIndexOf('/') + 1)}/__init__`;
}

function kindOf(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1);
  const test = file.startsWith('test_') || file.endsWith('_test.py') || path.startsWith('tests/') || path.includes('/tests/');
  return test ? 'test' : 'module';
}

const dotted = (n: Node | null): string | null => {
  if (!n) return null;
  return n.type === 'aliased_import' ? (n.childForFieldName('name')?.text ?? null) : n.text;
};

/** Specifiers: `import a.b` → `a.b`; `from X import n` → `X.n`, `from X import *` → `X`; relative keeps its dots (`from . import a` → `.a`, `from .p import b` → `.p.b`). */
function importsOf(root: Node): string[] {
  const specs: string[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'import_statement') {
      for (const n of node.childrenForFieldName('name')) {
        const s = dotted(n);
        if (s) specs.push(s);
      }
    } else if (node.type === 'import_from_statement') {
      const module = node.childForFieldName('module_name')?.text ?? '';
      const names = node.childrenForFieldName('name').map(dotted).filter((s): s is string => !!s);
      if (names.length === 0) specs.push(module);
      const sep = module === '' || module.endsWith('.') ? '' : '.';
      for (const n of names) specs.push(module + sep + n);
    } else {
      for (let i = node.childCount - 1; i >= 0; i--) {
        const c = node.child(i);
        if (c) stack.push(c);
      }
    }
  }
  return specs;
}

function extractFile(parser: Parser, file: SourceFile): FileFacts {
  const base = { name: nameOf(file.path), kind: kindOf(file.path), scope: '', declares: [], mentions: [], wildcards: [], lines: file.text.split('\n').length };
  const tree = parser.parse(file.text);
  if (!tree) return { ...base, imports: [], hasError: true, functions: 0, complexity: 0, maxComplexity: 0 };
  try {
    const root = tree.rootNode;
    const imports = importsOf(root).map((specifier) => ({ specifier, kind: 'import' as const }));
    return { ...base, imports, hasError: root.hasError, ...measure(root, 'py') };
  } finally {
    tree.delete();
  }
}

function moduleAt(dir: string, segs: string[], index: ProjectIndex): string | null {
  const stem = [dir, ...segs].filter((s) => s !== '').join('/');
  const candidates = segs.length === 0 ? [stem === '' ? '__init__.py' : `${stem}/__init__.py`] : [`${stem}.py`, `${stem}/__init__.py`];
  return candidates.find((c) => index.paths.has(c)) ?? null;
}

// Only the last segment may be a name rather than a module (`from X import name`), so drop at most one.
const attempts = (segs: string[]): string[][] => (segs.length > 0 ? [segs, segs.slice(0, -1)] : [segs]);

function resolveImport(from: string, specifier: string, index: ProjectIndex): string[] | null {
  const dots = specifier.match(/^\.*/)![0].length;
  const segs = specifier.slice(dots).split('.').filter((s) => s !== '');
  if (dots > 0) {
    let dir = dirOf(from);
    for (let i = 1; i < dots; i++) {
      if (dir === '') return null;
      dir = dirOf(dir);
    }
    for (const s of attempts(segs)) {
      const hit = moduleAt(dir, s, index);
      if (hit) return [hit];
    }
    return null;
  }
  for (const s of attempts(segs)) {
    if (s.length === 0) continue;
    for (const root of ROOTS) {
      const hit = moduleAt(root, s, index);
      if (hit) return [hit];
    }
  }
  return [];
}

export const pyModule: LangModule = { extractFile, resolveImport, symbolLinks: false };
