import type { Node, Parser } from 'web-tree-sitter';
import { measure } from '../complexity';
import type { FileFacts, LangModule, ProjectIndex } from '../link';
import type { SourceFile } from '../types';

const isTest = (path: string): boolean => path.endsWith('_test.go');

const dirOf = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
};

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.go$/, '');

function packageOf(root: Node): string | null {
  for (const c of root.namedChildren) {
    if (c?.type === 'package_clause') return c.namedChild(0)?.text ?? null;
  }
  return null;
}

function importsOf(root: Node): string[] {
  const specs: string[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'import_spec') {
      const path = node.childForFieldName('path')?.text.slice(1, -1);
      if (path) specs.push(path);
    } else if (node.type === 'source_file' || node.type === 'import_declaration' || node.type === 'import_spec_list') {
      for (let i = node.childCount - 1; i >= 0; i--) {
        const c = node.child(i);
        if (c) stack.push(c);
      }
    }
  }
  return specs;
}

function extractFile(parser: Parser, file: SourceFile): FileFacts {
  const base = { name: nameOf(file.path), scope: '', declares: [], mentions: [], wildcards: [], lines: file.text.split('\n').length };
  const tree = parser.parse(file.text);
  if (!tree) return { ...base, kind: isTest(file.path) ? 'test' : 'module', imports: [], hasError: true, functions: 0, complexity: 0, maxComplexity: 0 };
  try {
    const root = tree.rootNode;
    const kind = isTest(file.path) ? 'test' : packageOf(root) === 'main' ? 'main' : 'module';
    const imports = importsOf(root).map((specifier) => ({ specifier, kind: 'import' as const }));
    return { ...base, kind, imports, hasError: root.hasError, ...measure(root, 'go') };
  } finally {
    tree.delete();
  }
}

interface GoMod {
  path: string;
  dir: string;
}

const MODULE_LINE = /^\s*module\s+"?([^\s"]+)"?/m;

// Parsed once per configs object; the linker passes the same object for every import of a run.
const modCache = new WeakMap<Record<string, string>, GoMod[]>();

function modsOf(configs: Record<string, string>): GoMod[] {
  let mods = modCache.get(configs);
  if (mods) return mods;
  mods = [];
  for (const [key, text] of Object.entries(configs)) {
    if (key !== 'go.mod' && !key.endsWith('/go.mod')) continue;
    const m = MODULE_LINE.exec(text);
    if (m) mods.push({ path: m[1], dir: dirOf(key) });
  }
  modCache.set(configs, mods);
  return mods;
}

function resolveImport(_from: string, specifier: string, index: ProjectIndex): string[] | null {
  let best: GoMod | null = null;
  for (const mod of modsOf(index.configs)) {
    const hit = specifier === mod.path || specifier.startsWith(mod.path + '/');
    if (hit && (!best || mod.path.length > best.path.length)) best = mod;
  }
  if (!best) return [];
  const rest = specifier.slice(best.path.length + 1);
  const dir = [best.dir, rest].filter((s) => s !== '').join('/');
  const files = (index.byDir.get(dir) ?? []).filter((p) => !isTest(p));
  return files.length > 0 ? files : null;
}

export const goModule: LangModule = { extractFile, resolveImport, symbolLinks: false };
