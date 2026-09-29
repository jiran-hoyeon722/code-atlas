import type { FsDir, FsFile } from './types';

function fromFile(name: string, get: () => Promise<File>, meta?: File): FsFile {
  let cached: Promise<File> | undefined;
  const file = () => (cached ??= get());
  return {
    name,
    kind: 'file',
    size: meta?.size ?? 0,
    lastModified: meta?.lastModified ?? 0,
    text: async () => (await file()).text(),
  };
}

// A file whose stat fails is still listed (size 0); its text() rejects so loadRepo skips it.
async function statFile(name: string, get: () => Promise<File>): Promise<FsFile> {
  try {
    const f = await get();
    return fromFile(name, async () => f, f);
  } catch (e) {
    return fromFile(name, () => Promise.reject(e));
  }
}

export function fromDirectoryHandle(h: FileSystemDirectoryHandle): FsDir {
  return {
    name: h.name,
    kind: 'directory',
    async *children() {
      // values() is typed loosely across TS lib versions
      const it = (h as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
      for await (const c of it) {
        if (c.kind === 'directory') {
          yield fromDirectoryHandle(c as FileSystemDirectoryHandle);
        } else {
          const fh = c as FileSystemFileHandle;
          yield await statFile(fh.name, () => fh.getFile());
        }
      }
    },
  };
}

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((ok, err) => reader.readEntries(ok, err));
}

export function fromEntry(e: FileSystemDirectoryEntry): FsDir {
  return {
    name: e.name,
    kind: 'directory',
    async *children() {
      const reader = e.createReader();
      for (;;) {
        const batch = await readBatch(reader);
        if (batch.length === 0) return;
        for (const c of batch) {
          if (c.isDirectory) {
            yield fromEntry(c as FileSystemDirectoryEntry);
          } else {
            const fe = c as FileSystemFileEntry;
            yield await statFile(fe.name, () => new Promise<File>((ok, err) => fe.file(ok, err)));
          }
        }
      }
    },
  };
}

interface Bucket { dirs: Map<string, Bucket>; files: File[] }

export function fromFileList(files: FileList | File[]): FsDir {
  const root: Bucket = { dirs: new Map(), files: [] };
  let rootName = '';
  for (const f of Array.from(files)) {
    const parts = (f.webkitRelativePath || f.name).split('/');
    if (parts.length > 1 && !rootName) rootName = parts[0];
    const rel = parts.length > 1 ? parts.slice(1) : parts;
    let b = root;
    for (const d of rel.slice(0, -1)) {
      if (!b.dirs.has(d)) b.dirs.set(d, { dirs: new Map(), files: [] });
      b = b.dirs.get(d)!;
    }
    b.files.push(f);
  }
  const mk = (name: string, b: Bucket): FsDir => ({
    name,
    kind: 'directory',
    async *children() {
      for (const [n, c] of b.dirs) yield mk(n, c);
      for (const f of b.files) yield fromFile(f.name, async () => f, f);
    },
  });
  return mk(rootName, root);
}
