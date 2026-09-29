import type { Architecture } from '../engine/architecture';
import type { Lang } from '../engine/types';
import type { Listing } from '../app/files/types';

export interface CacheSummary {
  key: string;
  name: string;
  framework: string | null;
  lang: Lang;
  files: number;
  analyzedAt: string;
}

export interface CacheEntry extends CacheSummary {
  architecture: Architecture;
  handle?: FileSystemDirectoryHandle;
}

const DB_NAME = 'code-atlas';
const STORE = 'analyses';

export async function cacheKey(listing: Listing): Promise<string> {
  const lines = [...listing.sources, ...listing.configs]
    .map((e) => `${e.path}|${e.size}|${e.lastModified}`)
    .sort();
  const data = new TextEncoder().encode([listing.name, ...lines].join('\n'));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveAnalysis(e: CacheEntry): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          if ((cursor.value as CacheEntry).name === e.name && cursor.key !== e.key) cursor.delete();
          cursor.continue();
        } else {
          store.put(e);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function listAnalyses(): Promise<CacheSummary[]> {
  const all = await run<CacheEntry[]>('readonly', (s) => s.getAll());
  return all
    .map(({ key, name, framework, lang, files, analyzedAt }) => ({ key, name, framework, lang, files, analyzedAt }))
    .sort((a, b) => (a.analyzedAt < b.analyzedAt ? 1 : a.analyzedAt > b.analyzedAt ? -1 : 0));
}

export function loadAnalysis(key: string): Promise<CacheEntry | undefined> {
  return run<CacheEntry | undefined>('readonly', (s) => s.get(key));
}

export async function deleteAnalysis(key: string): Promise<void> {
  await run('readwrite', (s) => s.delete(key));
}

export async function clearAnalyses(): Promise<void> {
  await run('readwrite', (s) => s.clear());
}
