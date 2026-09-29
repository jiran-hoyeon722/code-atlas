import type { Lang } from './types';

export const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules', 'vendor', '.git', 'dist', 'build', '.next', 'storage', 'coverage',
]);

export const MAX_FILES = 20000;

export function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name);
}

export function isSourcePath(path: string): Lang | null {
  const m = /\.([^./]+)$/.exec(path);
  if (!m) return null;
  const ext = m[1];
  if (ext === 'php') return 'php';
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'ts';
  return null;
}

export function isConfigPath(path: string): boolean {
  const parts = path.split('/');
  const base = parts[parts.length - 1];
  if (parts.slice(0, -1).some(shouldSkipDir)) return false;
  return base === 'composer.json' || base === 'package.json' || base === 'jsconfig.json'
    || /^tsconfig.*\.json$/.test(base);
}

function globToRegex(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; out += '(?:.*/)?'; } else out += '.*';
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return out;
}

export function parseGitignore(text: string): (path: string, isDir: boolean) => boolean {
  const rules: { re: RegExp; dirOnly: boolean }[] = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    if (!line) continue;
    const body = globToRegex(line);
    rules.push({ re: new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`), dirOnly });
  }
  return (path, isDir) => rules.some((r) => (!r.dirOnly || isDir) && r.re.test(path));
}
