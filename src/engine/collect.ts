import { ALL_LANGS, LANGS } from './langs';
import type { Lang } from './types';
import { compileGlob, type GlobSyntax } from './glob';

export const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules', 'vendor', '.git', 'dist', 'build', '.next', 'storage', 'coverage',
]);

export const MAX_FILES = 20000;

export function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name);
}

const EXT_TO_LANG = new Map<string, Lang>(ALL_LANGS.flatMap((l) => LANGS[l].exts.map((e) => [e, l] as const)));

export function isSourcePath(path: string): Lang | null {
  const m = /\.([^./]+)$/.exec(path);
  if (!m) return null;
  const ext = m[1];
  return EXT_TO_LANG.get(ext) ?? null;
}

export function isConfigPath(path: string): boolean {
  const parts = path.split('/');
  const base = parts[parts.length - 1];
  if (parts.slice(0, -1).some(shouldSkipDir)) return false;
  return base === 'composer.json' || base === 'package.json' || base === 'jsconfig.json'
    || /^tsconfig.*\.json$/.test(base);
}

const GITIGNORE: GlobSyntax = { question: true, bareDoubleStar: 'any' };

export function parseGitignore(text: string): (path: string, isDir: boolean) => boolean {
  const rules: { match: (path: string) => boolean; dirOnly: boolean }[] = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    if (!line) continue;
    rules.push({ match: compileGlob(anchored ? line : `**/${line}`, GITIGNORE), dirOnly });
  }
  return (path, isDir) => rules.some((r) => (!r.dirOnly || isDir) && r.match(path));
}
