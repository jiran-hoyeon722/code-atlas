import { useEffect, useRef, useState } from 'react';
import type { Architecture } from '../engine/architecture';
import { isSourcePath } from '../engine/collect';
import { detect } from '../engine/detect';
import { presetFor, type Role } from '../engine/presets';
import { sourcesFor } from '../engine/sources';
import type { Lang } from '../engine/types';
import type { LoadStep } from '../features/loading/LoadingScreen';
import * as cache from '../storage/cache';
import { githubKey, type CacheEntry, type CacheSummary } from '../storage/cache';
import { AnalysisCancelled, UnsupportedRepo, startAnalysis } from './analysis/client';
import { GithubError, fetchGithubText, githubLabel, openGithub, parseGithubUrl, type GithubOrigin, type GithubSpec } from './files/github';
import { loadSample, loadSampleManifest, type SampleRepo } from './files/samples';
import { fromDirectoryHandle, fromEntry, fromFileList } from './files/sources';
import type { Entry, FsDir, Listing } from './files/types';
import { isTooMany, listRepo, loadRepo } from './files/walk';

export interface SessionDeps {
  startAnalysis: typeof startAnalysis;
  cache: Pick<typeof cache, 'cacheKey' | 'saveAnalysis' | 'listAnalyses' | 'loadAnalysis' | 'deleteAnalysis' | 'clearAnalyses'>;
  pickDirectory: (() => Promise<FileSystemDirectoryHandle>) | null;
  fetch: typeof fetch;
}

export type Phase = 'landing' | 'listing' | 'confirmTooMany' | 'chooseLang' | 'reading' | 'analyzing' | 'viewer';

export interface LoadingInfo {
  name: string;
  framework: string | null;
  sourceDir: string;
  roles: Role[];
  step: LoadStep;
  /** files come over the network (GitHub) rather than from disk */
  remote?: boolean;
}

export interface SessionState {
  phase: Phase;
  recent: CacheSummary[];
  notice?: string;
  loading?: LoadingInfo;
  tooMany?: number;
  langCounts?: Record<Lang, number>;
  viewer?: { arch: Architecture; skipped: number; canReconnect: boolean; id: number; origin?: GithubOrigin };
  samples: SampleRepo[];
  /** the GitHub spec behind the current notice, so the landing can offer a ZIP download instead */
  failedGithub?: GithubSpec;
}

export const NOTICE = {
  notFolder: '폴더를 끌어다 놓아 주세요. 파일 하나로는 분석할 수 없어요.',
  noFiles: 'PHP·TS/JS 파일을 찾지 못했어요.',
  readFailed: '폴더를 읽지 못했어요. 다시 시도해 주세요.',
  analyzeFailed: '분석하지 못했어요. 다시 시도해 주세요.',
  missing: '저장된 분석을 찾지 못했어요.',
  reconnectFailed: '폴더를 다시 연결하지 못했어요.',
  badGithubUrl: 'GitHub 레포 주소를 알아보지 못했어요. 예: github.com/owner/repo',
  githubNotFound: '레포를 찾지 못했어요. 공개 레포인지, 주소와 브랜치·폴더가 맞는지 확인해 주세요.',
  githubNetwork: 'GitHub 에 연결하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.',
  githubTruncated: '레포가 너무 커서 파일 목록을 다 받지 못했어요. 하위 폴더 주소(…/tree/main/폴더)로 좁혀 주세요.',
  sampleFailed: '샘플을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.',
} as const;

/** Every file is its own request, so a huge repo would take minutes; ask for a subfolder instead. */
export const GITHUB_MAX_FILES = 3000;

const githubTooMany = (n: number) =>
  `소스 파일이 ${n.toLocaleString('ko-KR')}개라 GitHub 에서 받기엔 많아요. 하위 폴더 주소(…/tree/main/폴더)로 좁히거나, ZIP 으로 받아 폴더로 열어 주세요.`;

const rateLimitNotice = (resetAt?: Date) =>
  `GitHub 요청 한도(시간당 60회)를 다 썼어요.${resetAt ? ` ${resetAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 이후 다시 시도하거나` : ''} ZIP 으로 받아 폴더로 열어 주세요.`;

function githubNotice(e: unknown): string {
  if (!(e instanceof GithubError)) return NOTICE.githubNetwork;
  if (e.code === 'rateLimit') return rateLimitNotice(e.resetAt);
  if (e.code === 'notFound') return NOTICE.githubNotFound;
  if (e.code === 'truncated') return NOTICE.githubTruncated;
  return NOTICE.githubNetwork;
}

const reconnectNotice = (reason: string) => `${NOTICE.reconnectFailed} ${reason}`;

const FRAMEWORK = { laravel: 'Laravel', react: 'React' } as const;

type Source = { dir: FsDir; handle?: FileSystemDirectoryHandle; origin?: GithubOrigin };
type Mode = 'open' | 'reanalyze' | 'reconnect';

interface Current {
  key: string;
  dir?: FsDir;
  handle?: FileSystemDirectoryHandle;
  files?: Map<string, Entry>;
  origin?: GithubOrigin;
}

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?(d: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'read' }): Promise<PermissionState>;
};

function nativePicker(): SessionDeps['pickDirectory'] {
  const w = globalThis as unknown as { showDirectoryPicker?: (o: { mode: 'read' }) => Promise<FileSystemDirectoryHandle> };
  return typeof w.showDirectoryPicker === 'function' ? () => w.showDirectoryPicker!({ mode: 'read' }) : null;
}

export const defaultDeps = (): SessionDeps => ({ startAnalysis, cache, pickDirectory: nativePicker(), fetch: (...a) => globalThis.fetch(...a) });

async function hasReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as PermissionHandle;
  try {
    if ((await h.queryPermission?.({ mode: 'read' })) === 'granted') return true;
    return (await h.requestPermission?.({ mode: 'read' })) === 'granted';
  } catch {
    return false;
  }
}

async function readFromHandle(root: FileSystemDirectoryHandle, path: string): Promise<string> {
  const parts = path.split('/');
  let dir = root;
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
  const file = await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
  return file.text();
}

function counting(dir: FsDir, onSource: () => void): FsDir {
  return {
    name: dir.name,
    kind: 'directory',
    async *children() {
      for await (const c of dir.children()) {
        if (c.kind === 'directory') yield counting(c, onSource);
        else {
          if (isSourcePath(c.name)) onSource();
          yield c;
        }
      }
    },
  };
}

function throttled<T>(fn: (v: T) => void, ms = 80): (v: T) => void {
  let last = -Infinity;
  return (v) => {
    const now = performance.now();
    if (now - last < ms) return;
    last = now;
    fn(v);
  };
}

/** The language whose framework is detected, when exactly one of PHP (Laravel) / TS (React) has one. */
async function frameworkLang(listing: Listing): Promise<Lang | undefined> {
  const configs: Record<string, string> = {};
  for (const e of listing.configs) {
    try {
      configs[e.path] = await e.file.text();
    } catch {
      // unreadable config: treat as absent
    }
  }
  const input = { name: listing.name, files: listing.sources.map((e) => ({ path: e.path, text: '' })), configs };
  const laravel = detect(input, 'php')?.framework === 'laravel';
  const react = detect(input, 'ts')?.framework === 'react';
  if (laravel === react) return undefined;
  return laravel ? 'php' : 'ts';
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export function useRepoSession(overrides?: Partial<SessionDeps>) {
  const [defaults] = useState(defaultDeps);
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  const d = (): SessionDeps => ({ ...defaults, ...overridesRef.current });

  const [state, setState] = useState<SessionState>({ phase: 'landing', recent: [], samples: [] });
  const patch = (p: Partial<SessionState>) => setState((s) => ({ ...s, ...p }));

  const runId = useRef(0);
  const cancelAnalysis = useRef<(() => void) | null>(null);
  const answer = useRef<((v: unknown) => void) | null>(null);
  const current = useRef<Current | null>(null);
  const viewerSeq = useRef(0);
  const inputMode = useRef<Mode>('open');
  const viewerInput = useRef<HTMLInputElement>(null);

  const refreshRecent = async () => {
    try {
      const recent = await d().cache.listAnalyses();
      patch({ recent });
    } catch {
      patch({ recent: [] });
    }
  };

  useEffect(() => {
    void refreshRecent();
    loadSampleManifest(d().fetch).then((m) => patch({ samples: m.repos }), () => {});
    // a stray drop outside the drop zone would make the browser navigate to the file and lose the session
    const block = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
      runId.current++;
      cancelAnalysis.current?.();
      cancelAnalysis.current = null;
      answerWith(null);
    };
  }, []);

  const toLanding = (notice?: string, failedGithub?: GithubSpec) => {
    cancelAnalysis.current = null;
    setState((s) => ({ phase: 'landing', recent: s.recent, samples: s.samples, notice, failedGithub }));
    void refreshRecent();
  };

  const ask = <T,>(p: Partial<SessionState>): Promise<T> =>
    new Promise<T>((resolve) => {
      answer.current = resolve as (v: unknown) => void;
      patch(p);
    });

  const showViewer = (arch: Architecture, cur: Current, skipped: number, canReconnect: boolean) => {
    current.current = cur;
    setState((s) => ({
      phase: 'viewer', recent: s.recent, samples: s.samples,
      viewer: { arch, skipped, canReconnect, id: ++viewerSeq.current, origin: cur.origin },
    }));
  };

  const setCanReconnect = (canReconnect: boolean) =>
    setState((s) => (s.viewer && s.viewer.canReconnect !== canReconnect ? { ...s, viewer: { ...s.viewer, canReconnect } } : s));

  const save = async (entry: CacheEntry) => {
    const c = d().cache;
    try {
      await c.saveAnalysis(entry);
    } catch {
      // handles are not structured-cloneable in every browser; the analysis alone is still worth keeping
      if (entry.handle) await c.saveAnalysis({ ...entry, handle: undefined }).catch(() => {});
    }
  };

  const run = async (src: Source, mode: Mode) => {
    const id = ++runId.current;
    answerWith(null);
    const alive = () => runId.current === id;
    const deps = d();
    const name = src.dir.name;
    const setStep = (step: LoadStep, extra?: Partial<LoadingInfo>) =>
      setState((s) => (alive() ? { ...s, loading: { ...(s.loading as LoadingInfo), ...extra, step } } : s));

    // a failed reconnect keeps the open analysis instead of dropping back to the landing screen
    const fail = (notice: string) => (mode === 'reconnect' ? patch({ notice: reconnectNotice(notice) }) : toLanding(notice));
    let found = 0;
    const onFound = throttled(() => setStep({ phase: 'list', found }));
    const enterLoading = () =>
      setState((s) => ({
        phase: 'listing', recent: s.recent, samples: s.samples,
        loading: { name, framework: null, sourceDir: '', roles: [], step: { phase: 'list', found }, remote: !!src.origin },
      }));
    if (mode !== 'reconnect') enterLoading();

    let listing: Listing;
    let key: string;
    try {
      listing = await listRepo(counting(src.dir, () => { found++; onFound(undefined); }));
      if (!alive()) return;
      if (listing.sources.length === 0) return fail(NOTICE.noFiles);
      if (src.origin && listing.sources.length > GITHUB_MAX_FILES) return toLanding(githubTooMany(listing.sources.length), src.origin);
      key = src.origin ? githubKey(src.origin) : await deps.cache.cacheKey(listing);
    } catch {
      if (alive()) fail(NOTICE.readFailed);
      return;
    }
    if (!alive()) return;
    const files = new Map(listing.sources.map((e) => [e.path, e]));
    const cur: Current = { key, dir: src.dir, handle: src.handle, files, origin: src.origin };

    if (mode === 'reconnect' && current.current?.key === key) {
      current.current = cur;
      setCanReconnect(false);
      patch({ notice: undefined });
      const entry = src.handle ? await deps.cache.loadAnalysis(key).catch(() => undefined) : undefined;
      if (entry && src.handle) await save({ ...entry, handle: src.handle });
      return;
    }
    if (mode === 'reconnect') enterLoading();

    if (mode !== 'reanalyze') {
      const hit = await deps.cache.loadAnalysis(key).catch(() => undefined);
      if (!alive()) return;
      if (hit) {
        if (src.handle && !hit.handle) void save({ ...hit, handle: src.handle });
        showViewer(hit.architecture, cur, listing.tooLarge.length, false);
        void refreshRecent();
        return;
      }
    }

    setStep({ phase: 'list', found: listing.sources.length });

    if (isTooMany(listing)) {
      const ok = await ask<boolean>({ phase: 'confirmTooMany', tooMany: listing.sources.length });
      if (!alive()) return;
      if (!ok) return toLanding();
    }

    const counts: Record<Lang, number> = { php: 0, ts: 0 };
    for (const e of listing.sources) {
      const lang = isSourcePath(e.path);
      if (lang) counts[lang]++;
    }
    let prefer: Lang | undefined;
    if (counts.php > 0 && counts.ts > 0) prefer = await frameworkLang(listing);
    if (!alive()) return;
    if (counts.php > 0 && counts.ts > 0 && !prefer) {
      const choice = await ask<Lang | null>({ phase: 'chooseLang', langCounts: counts });
      if (!alive()) return;
      if (!choice) return toLanding();
      prefer = choice;
    }

    setState((s) => ({ ...s, phase: 'reading', tooMany: undefined, langCounts: undefined }));
    const onRead = throttled((v: { done: number; total: number }) => setStep({ phase: 'read', ...v }));
    const input = await loadRepo(listing, (done, total) => onRead({ done, total }));
    if (!alive()) return;

    const detection = detect(input, prefer);
    if (!detection) return toLanding(NOTICE.noFiles);
    const roles = presetFor(detection, sourcesFor(detection, input.files).map((f) => f.path)).roles;
    const framework = detection.framework ? FRAMEWORK[detection.framework] : null;
    setState((s) => ({ ...s, phase: 'analyzing' }));
    setStep({ phase: 'read', done: input.files.length, total: input.files.length }, { framework, sourceDir: detection.sourceDir, roles });

    const job = deps.startAnalysis(input, { prefer, onProgress: (p) => setStep(p) });
    cancelAnalysis.current = job.cancel;
    let arch: Architecture;
    try {
      arch = await job.result;
    } catch (e) {
      if (!alive() || e instanceof AnalysisCancelled) return;
      return toLanding(e instanceof UnsupportedRepo ? NOTICE.noFiles : NOTICE.analyzeFailed);
    }
    if (!alive()) return;
    cancelAnalysis.current = null;

    await save({
      key, name: listing.name, framework: arch.framework, lang: arch.lang, files: arch.nodes.length,
      analyzedAt: arch.generatedAt, architecture: arch, handle: src.handle, ...(src.origin && { origin: src.origin }),
    });
    if (!alive()) return;
    showViewer(arch, cur, listing.tooLarge.length, false);
    void refreshRecent();
  };

  const pick = async (mode: Mode) => {
    const picker = d().pickDirectory;
    if (!picker) {
      inputMode.current = mode;
      viewerInput.current?.click();
      return;
    }
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await picker();
    } catch (e) {
      if (!isAbort(e)) patch({ notice: mode === 'reconnect' ? reconnectNotice(NOTICE.readFailed) : NOTICE.readFailed });
      return;
    }
    await run({ dir: fromDirectoryHandle(handle), handle }, mode);
  };

  const onDrop = (items: DataTransferItemList) => {
    // DataTransferItems are only valid during the drop event, so grab every handle/entry synchronously
    type Item = DataTransferItem & { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> };
    const pending: { handle?: Promise<FileSystemHandle | null>; entry: FileSystemEntry | null }[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as Item;
      if (item.kind !== 'file') continue;
      pending.push({ handle: item.getAsFileSystemHandle?.(), entry: item.webkitGetAsEntry?.() ?? null });
    }
    void (async () => {
      for (const p of pending) {
        const handle = p.handle ? await p.handle.catch(() => null) : null;
        if (handle?.kind === 'directory') {
          const dir = handle as FileSystemDirectoryHandle;
          return run({ dir: fromDirectoryHandle(dir), handle: dir }, 'open');
        }
        if (!handle && p.entry?.isDirectory) return run({ dir: fromEntry(p.entry as FileSystemDirectoryEntry) }, 'open');
      }
      patch({ notice: NOTICE.notFolder });
    })();
  };

  const onFiles = (list: FileList) => {
    const mode = inputMode.current;
    inputMode.current = 'open';
    if (list.length === 0) {
      if (mode === 'open') patch({ notice: NOTICE.noFiles });
      else if (mode === 'reconnect') patch({ notice: reconnectNotice(NOTICE.noFiles) });
      return;
    }
    void run({ dir: fromFileList(list) }, mode);
  };

  const openGithubSpec = async (spec: GithubSpec, mode: Mode) => {
    const id = ++runId.current;
    answerWith(null);
    setState((s) => ({
      phase: 'listing', recent: s.recent, samples: s.samples,
      loading: { name: githubLabel(spec), framework: null, sourceDir: '', roles: [], step: { phase: 'list', found: 0 }, remote: true },
    }));
    let repo: Awaited<ReturnType<typeof openGithub>>;
    try {
      repo = await openGithub(spec, d().fetch);
    } catch (e) {
      // a ZIP only helps when the repo exists but the API route did not work out
      if (runId.current === id) toLanding(githubNotice(e), e instanceof GithubError && e.code === 'notFound' ? undefined : spec);
      return;
    }
    if (runId.current !== id) return;
    await run({ dir: repo.dir, origin: repo.origin }, mode);
  };

  const onOpenGithub = (input: string) => {
    const spec = parseGithubUrl(input);
    if (!spec) {
      patch({ notice: NOTICE.badGithubUrl, failedGithub: undefined });
      return;
    }
    void openGithubSpec(spec, 'open');
  };

  const onOpenSample = async (sample: SampleRepo) => {
    const id = ++runId.current;
    let arch: Architecture;
    try {
      arch = await loadSample(sample.id, d().fetch);
    } catch {
      if (runId.current === id) patch({ notice: NOTICE.sampleFailed });
      return;
    }
    if (runId.current !== id) return;
    const origin: GithubOrigin = { kind: 'github', owner: sample.owner, repo: sample.repo, sha: sample.sha, ref: '', subdir: sample.subdir };
    showViewer(arch, { key: `sample:${sample.id}`, origin }, 0, false);
  };

  const onOpenRecent = async (key: string) => {
    const id = ++runId.current;
    const entry = await d().cache.loadAnalysis(key).catch(() => undefined);
    if (runId.current !== id) return;
    if (!entry) {
      patch({ notice: NOTICE.missing });
      void refreshRecent();
      return;
    }
    showViewer(entry.architecture, { key, handle: entry.handle, origin: entry.origin }, 0, !entry.origin);
  };

  const onDeleteRecent = async (key: string) => {
    await d().cache.deleteAnalysis(key).catch(() => {});
    await refreshRecent();
  };

  const onClearAll = async () => {
    await d().cache.clearAnalyses().catch(() => {});
    await refreshRecent();
  };

  function answerWith(v: unknown) {
    const resolve = answer.current;
    answer.current = null;
    resolve?.(v);
  }

  const onCancel = () => {
    runId.current++;
    cancelAnalysis.current?.();
    answerWith(null);
    toLanding();
  };

  const readSource = async (path: string): Promise<string | null> => {
    const cur = current.current;
    if (!cur) return null;
    if (cur.files) {
      const e = cur.files.get(path);
      if (!e) return null;
      try {
        return await e.file.text();
      } catch {
        return null;
      }
    }
    if (cur.origin) {
      try {
        return await fetchGithubText(cur.origin, path, d().fetch);
      } catch {
        return null;
      }
    }
    if (!cur.handle) return null;
    if (!(await hasReadPermission(cur.handle))) {
      setCanReconnect(true);
      return null;
    }
    setCanReconnect(false);
    try {
      return await readFromHandle(cur.handle, path);
    } catch {
      return null;
    }
  };

  const onReconnect = () => void pick('reconnect');

  const onReanalyze = async () => {
    const cur = current.current;
    // GitHub: fetch the ref again, which picks up newer commits
    if (cur?.origin) return openGithubSpec({ owner: cur.origin.owner, repo: cur.origin.repo, ref: cur.origin.ref || undefined, subdir: cur.origin.subdir }, 'reanalyze');
    if (cur?.dir) return run({ dir: cur.dir, handle: cur.handle }, 'reanalyze');
    if (cur?.handle && (await hasReadPermission(cur.handle))) {
      return run({ dir: fromDirectoryHandle(cur.handle), handle: cur.handle }, 'reanalyze');
    }
    return pick('reanalyze');
  };

  const onOpenOther = () => {
    runId.current++;
    current.current = null;
    history.replaceState(null, '', location.pathname + location.search);
    toLanding();
  };

  return {
    state,
    hasPicker: !!d().pickDirectory,
    viewerInput,
    onPickFolder: () => void pick('open'),
    onOpenGithub,
    onOpenSample: (sample: SampleRepo) => void onOpenSample(sample),
    onDrop,
    onFiles,
    onOpenRecent,
    onDeleteRecent,
    onClearAll,
    onCancel,
    onConfirmTooMany: (ok: boolean) => answerWith(ok),
    onChooseLang: (lang: Lang | null) => answerWith(lang),
    readSource,
    onReconnect,
    onReanalyze,
    onOpenOther,
    onDismissNotice: () => patch({ notice: undefined, failedGithub: undefined }),
  };
}
