import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isConfigPath, isSourcePath } from '../../../src/engine/collect';
import type { RepoInput } from '../../../src/engine/types';

/** Reads a folder under tests/fixtures into the RepoInput the folder picker would produce. */
export function loadFixture(name: string): RepoInput {
  const dir = join(__dirname, '../../fixtures', name);
  const input: RepoInput = { name, files: [], configs: {} };
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else {
        const path = relative(dir, abs).split('\\').join('/');
        if (isSourcePath(path)) input.files.push({ path, text: readFileSync(abs, 'utf8') });
        else if (isConfigPath(path)) input.configs[path] = readFileSync(abs, 'utf8');
      }
    }
  };
  walk(dir);
  return input;
}
