import { MAX_FILES, isConfigPath, isSourcePath, parseGitignore, shouldSkipDir } from '../../engine/collect';
import type { RepoInput } from '../../engine/types';
import type { Entry, FsDir, Listing } from './types';

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

async function readGitignore(root: FsDir): Promise<(path: string, isDir: boolean) => boolean> {
  for await (const n of root.children()) {
    if (n.kind === 'file' && n.name === '.gitignore') {
      try {
        return parseGitignore(await n.text());
      } catch {
        break;
      }
    }
  }
  return () => false;
}

export async function listRepo(root: FsDir): Promise<Listing> {
  const ignored = await readGitignore(root);
  const listing: Listing = { name: root.name, sources: [], configs: [], tooLarge: [] };

  async function walk(dir: FsDir, prefix: string): Promise<void> {
    for await (const n of dir.children()) {
      const path = prefix + n.name;
      if (n.kind === 'directory') {
        if (shouldSkipDir(n.name) || ignored(path, true)) continue;
        await walk(n, `${path}/`);
        continue;
      }
      if (ignored(path, false)) continue;
      const entry: Entry = { path, size: n.size, lastModified: n.lastModified, file: n };
      if (isSourcePath(path)) {
        if (n.size > MAX_FILE_BYTES) listing.tooLarge.push(path);
        else listing.sources.push(entry);
      } else if (isConfigPath(path)) {
        listing.configs.push(entry);
      }
    }
  }

  await walk(root, '');
  return listing;
}

export async function loadRepo(
  listing: Listing,
  onRead?: (done: number, total: number) => void,
): Promise<RepoInput> {
  const total = listing.sources.length + listing.configs.length;
  let done = 0;
  const read = async (e: Entry): Promise<string | null> => {
    let text: string | null = null;
    try {
      text = await e.file.text();
    } catch {
      text = null;
    }
    onRead?.(++done, total);
    return text;
  };
  const files: RepoInput['files'] = [];
  const configs: RepoInput['configs'] = {};
  for (const e of listing.sources) {
    const text = await read(e);
    if (text !== null) files.push({ path: e.path, text });
  }
  for (const e of listing.configs) {
    const text = await read(e);
    if (text !== null) configs[e.path] = text;
  }
  return { name: listing.name, files, configs };
}

export function isTooMany(listing: Listing): boolean {
  return listing.sources.length > MAX_FILES;
}
