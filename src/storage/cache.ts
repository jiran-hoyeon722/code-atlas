import type { Architecture } from '../engine/architecture';
import type { PackedQuality } from '../engine/battle/pack';
import type { QualityIssue } from '../engine/battle/quality';
import type { Lang } from '../engine/types';
import type { GithubOrigin } from '../app/files/github';
import type { Listing } from '../app/files/types';

export interface CacheSummary {
  key: string;
  name: string;
  framework: string | null;
  lang: Lang;
  /** set only for a repo opened as several languages merged into one city; `lang` is the first */
  langs?: Lang[];
  files: number;
  analyzedAt: string;
  /** set when the analysis came from a public GitHub repo; code is fetched again from that commit */
  origin?: GithubOrigin;
  /** Set by `listAnalyses`. Entries saved before battle data existed read as 'missing'. */
  battle?: BattleState;
  /** Set by `listAnalyses`: a folder handle is stored, so the folder can be read again after a permission prompt. */
  hasHandle?: boolean;
}

/** 'too-small' / 'no-production' can never battle, however often the repo is measured again. */
export type BattleState = 'ready' | 'missing' | 'too-small' | 'no-production';

export interface CacheEntry extends Omit<CacheSummary, 'battle' | 'hasHandle'> {
  architecture: Architecture;
  handle?: FileSystemDirectoryHandle;
  /** battle data measured with the analysis (measurements only, no source text) */
  quality?: PackedQuality;
  qualityIssue?: QualityIssue;
}

export function battleState(e: Pick<CacheEntry, 'quality' | 'qualityIssue'>): BattleState {
  if (e.quality) return 'ready';
  if (e.qualityIssue === 'too-small' || e.qualityIssue === 'no-production') return e.qualityIssue;
  return 'missing';
}

const DB_NAME = 'code-atlas';
const STORE = 'analyses';

export const githubKey = (o: GithubOrigin) => `gh:${o.owner}/${o.repo}@${o.sha}/${o.subdir}`;

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
    .map((e): CacheSummary => {
      const { key, name, framework, lang, langs, files, analyzedAt, origin } = e;
      return { key, name, framework, lang, ...(langs && { langs }), files, analyzedAt, ...(origin && { origin }), battle: battleState(e), hasHandle: !!e.handle };
    })
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
