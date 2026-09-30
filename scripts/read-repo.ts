import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isConfigPath, isSourcePath, parseGitignore, shouldSkipDir } from '../src/engine/collect';
import type { RepoInput } from '../src/engine/types';

/** Read-only walk: never writes to `root`. */
export function readRepo(root: string, name = basename(root)): RepoInput {
  let ignored: (path: string, isDir: boolean) => boolean = () => false;
  try {
    ignored = parseGitignore(readFileSync(join(root, '.gitignore'), 'utf8'));
  } catch {
    // no root .gitignore
  }
  const files: RepoInput['files'] = [];
  const configs: RepoInput['configs'] = {};
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name) && !ignored(path, true)) walk(path);
      } else if (entry.isFile() && !ignored(path, false)) {
        if (isSourcePath(path)) files.push({ path, text: readFileSync(join(root, path), 'utf8') });
        else if (isConfigPath(path)) configs[path] = readFileSync(join(root, path), 'utf8');
      }
    }
  };
  walk('');
  return { name, files, configs };
}
