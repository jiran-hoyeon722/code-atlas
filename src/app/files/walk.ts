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

const READ_CONCURRENCY = 12;

export async function loadRepo(
  listing: Listing,
  onRead?: (done: number, total: number) => void,
): Promise<RepoInput> {
  const all = [...listing.sources, ...listing.configs];
  const texts: (string | null)[] = new Array(all.length).fill(null);
  let done = 0;
  let next = 0;
  // parallel so a remote source (GitHub) is not one round trip per file; results keep listing order
  const worker = async () => {
    while (next < all.length) {
      const i = next++;
      try {
        texts[i] = await all[i].file.text();
      } catch {
        texts[i] = null;
      }
      onRead?.(++done, all.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, all.length) }, worker));
  const files: RepoInput['files'] = [];
  const configs: RepoInput['configs'] = {};
  all.forEach((e, i) => {
    const text = texts[i];
    if (text === null) return;
    if (i < listing.sources.length) files.push({ path: e.path, text });
    else configs[e.path] = text;
  });
  return { name: listing.name, files, configs };
}

export function isTooMany(listing: Listing): boolean {
  return listing.sources.length > MAX_FILES;
}
