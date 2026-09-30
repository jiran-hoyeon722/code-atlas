import { packQuality, unpackQuality, type PackedQuality } from '../engine/battle/pack';
import type { QualityIssue } from '../engine/battle/quality';
import type { Quality } from '../engine/battle/types';
import type { Lang, RepoInput } from '../engine/types';
import { QualityError } from '../features/battle/worker/client';
import type { BattleAccess, BattleLoadStep, OpponentReadiness, OpponentSummary } from '../features/viewer-env';
import type * as cacheApi from '../storage/cache';
import type { CacheEntry, CacheSummary } from '../storage/cache';
import { GithubError, type GithubOrigin } from './files/github';
import { fromDirectoryHandle } from './files/sources';
import type { FsDir, Listing } from './files/types';
import { listRepo, loadRepo } from './files/walk';

/** What the open viewer knows about its own repo; read on every call because a reconnect swaps it. */
export interface SelfSource {
  key: string;
  name: string;
  lang: Lang;
  quality?: PackedQuality | null;
  qualityIssue?: QualityIssue;
  /** the folder listing is still in memory (the repo was opened or reconnected in this session) */
  listing?: Listing;
  origin?: GithubOrigin;
  handle?: FileSystemDirectoryHandle;
}

export interface BattleAccessDeps {
  cache: Pick<typeof cacheApi, 'listAnalyses' | 'loadAnalysis' | 'saveAnalysis'>;
  /** Measures battle data in the battle worker; rejects with `QualityError` codes such as 'too-small'. */
  measure(input: RepoInput, prefer: Lang): Promise<Quality>;
  /** The file tree of an analysed GitHub commit. */
  readGithub(origin: GithubOrigin): Promise<FsDir>;
}

export const BATTLE_MSG = {
  selfMissing: '이 레포의 대결 데이터가 없어요. 위의 "다시 분석"을 누르면 만들어져요',
  missing: '저장된 분석을 찾지 못했어요',
  reanalyze: '폴더를 다시 열어 분석해야 해요',
  denied: '폴더 읽기 권한을 받지 못했어요. 다시 시도하면 한 번 더 물어봐요',
  noFiles: '폴더에서 PHP·TS/JS 파일을 찾지 못했어요',
  readFailed: '폴더를 읽지 못했어요',
  githubRate: 'GitHub 요청 한도를 다 썼어요. 잠시 뒤 다시 시도해 주세요',
  githubNotFound: 'GitHub 에서 그 커밋을 찾지 못했어요',
  githubNetwork: 'GitHub 에 연결하지 못했어요. 네트워크를 확인해 주세요',
} as const;

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?(d: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'read' }): Promise<PermissionState>;
};

async function readPermission(handle: FileSystemDirectoryHandle, request: boolean): Promise<boolean> {
  const h = handle as PermissionHandle;
  try {
    if ((await h.queryPermission?.({ mode: 'read' })) === 'granted') return true;
    return request && (await h.requestPermission?.({ mode: 'read' })) === 'granted';
  } catch {
    return false;
  }
}

function githubFailure(e: unknown): Error {
  if (!(e instanceof GithubError)) return e instanceof Error ? e : new Error(String(e));
  if (e.code === 'rateLimit') return new Error(BATTLE_MSG.githubRate);
  if (e.code === 'notFound') return new Error(BATTLE_MSG.githubNotFound);
  return new Error(BATTLE_MSG.githubNetwork);
}

const unfitError = (issue: QualityIssue | undefined) =>
  issue === 'too-small' ? new QualityError('too-small', 'too small to battle') : issue === 'no-production' ? new QualityError('unsupported', 'no production code') : null;

function unpacked(p: PackedQuality | null | undefined): Quality | null {
  if (!p) return null;
  try {
    return unpackQuality(p);
  } catch {
    // an unknown pack version is measured again, like an entry that never had battle data
    return null;
  }
}

function readinessOf(s: CacheSummary): OpponentReadiness {
  if (s.battle === 'ready') return 'ready';
  if (s.origin) return 'refetch';
  if (s.hasHandle) return 'needs-permission';
  return 'reanalyze';
}

export function createBattleAccess(getSelf: () => SelfSource, deps: BattleAccessDeps): BattleAccess {
  const first = getSelf();
  const loaded = new Map<string, Promise<Quality>>();

  const once = (key: string, load: () => Promise<Quality>): Promise<Quality> => {
    const hit = loaded.get(key);
    if (hit) return hit;
    const p = load();
    loaded.set(key, p);
    p.catch(() => loaded.delete(key));
    return p;
  };

  const writeBack = async (key: string, patch: Pick<CacheEntry, 'quality' | 'qualityIssue'>) => {
    try {
      const entry = await deps.cache.loadAnalysis(key);
      if (!entry) return;
      const { quality: _q, qualityIssue: _i, ...rest } = entry;
      await deps.cache.saveAnalysis({ ...rest, ...patch });
    } catch {
      // the measurement is still used for this battle; only the cache misses out
    }
  };

  const readDir = async (dir: FsDir): Promise<RepoInput> => {
    let listing: Listing;
    try {
      listing = await listRepo(dir);
    } catch {
      throw new Error(BATTLE_MSG.readFailed);
    }
    if (listing.sources.length === 0) throw new Error(BATTLE_MSG.noFiles);
    return loadRepo(listing);
  };

  /** Measures, then stores the battle data (or why there is none) in the entry. */
  const measure = async (key: string, input: RepoInput, lang: Lang): Promise<Quality> => {
    try {
      const q = await deps.measure(input, lang);
      await writeBack(key, { quality: packQuality(q) });
      return q;
    } catch (e) {
      const code = e instanceof QualityError ? e.code : null;
      if (code === 'too-small') await writeBack(key, { qualityIssue: 'too-small' });
      else if (code === 'unsupported') await writeBack(key, { qualityIssue: 'no-production' });
      throw e;
    }
  };

  const fromGithub = async (key: string, origin: GithubOrigin, lang: Lang, onStep?: (s: BattleLoadStep) => void) => {
    onStep?.('reading');
    let input: RepoInput;
    try {
      input = await readDir(await deps.readGithub(origin));
    } catch (e) {
      throw githubFailure(e);
    }
    onStep?.('measuring');
    return measure(key, input, lang);
  };

  const fromHandle = async (key: string, handle: FileSystemDirectoryHandle, lang: Lang, onStep?: (s: BattleLoadStep) => void) => {
    onStep?.('reading');
    const input = await readDir(fromDirectoryHandle(handle));
    onStep?.('measuring');
    return measure(key, input, lang);
  };

  const loadSelf = () =>
    once(first.key, async () => {
      const cur = getSelf();
      const s = cur.key === first.key ? cur : first;
      const ready = unpacked(s.quality);
      if (ready) return ready;
      const unfit = unfitError(s.qualityIssue);
      if (unfit) throw unfit;
      if (s.listing) return measure(s.key, await loadRepo(s.listing), s.lang);
      if (s.origin) return fromGithub(s.key, s.origin, s.lang);
      // no click behind this call, so only a permission that is already granted can be used
      if (s.handle && (await readPermission(s.handle, false))) return fromHandle(s.key, s.handle, s.lang);
      throw new Error(BATTLE_MSG.selfMissing);
    });

  const listOpponents = async (): Promise<OpponentSummary[]> => {
    const all = await deps.cache.listAnalyses();
    return all
      .filter((s) => s.key !== first.key && s.battle !== 'too-small' && s.battle !== 'no-production')
      .sort((a, b) => (a.analyzedAt < b.analyzedAt ? 1 : a.analyzedAt > b.analyzedAt ? -1 : 0))
      .map((s) => ({
        key: s.key,
        name: s.name,
        lang: s.lang,
        files: s.files,
        analyzedAt: s.analyzedAt,
        source: s.origin ? 'github' : 'local',
        readiness: readinessOf(s),
      }));
  };

  const loadOpponent = (key: string, onStep?: (step: BattleLoadStep) => void) =>
    once(key, async () => {
      const entry = await deps.cache.loadAnalysis(key);
      if (!entry) throw new Error(BATTLE_MSG.missing);
      const ready = unpacked(entry.quality);
      if (ready) return ready;
      const unfit = unfitError(entry.qualityIssue);
      if (unfit) throw unfit;
      if (entry.origin) return fromGithub(key, entry.origin, entry.lang, onStep);
      if (entry.handle) {
        onStep?.('permission');
        // the pick click is the user gesture that lets the browser show the permission prompt
        if (!(await readPermission(entry.handle, true))) throw new Error(BATTLE_MSG.denied);
        return fromHandle(key, entry.handle, entry.lang, onStep);
      }
      throw new Error(BATTLE_MSG.reanalyze);
    });

  return { self: { key: first.key, name: first.name }, loadSelf, listOpponents, loadOpponent };
}
