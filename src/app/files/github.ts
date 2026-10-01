import type { FsDir, FsFile } from './types';

export interface GithubSpec {
  owner: string;
  repo: string;
  ref?: string;
  subdir: string;
}

export interface GithubOrigin {
  kind: 'github';
  owner: string;
  repo: string;
  sha: string;
  /** the ref the user asked for; '' means the default branch */
  ref: string;
  subdir: string;
}

export type GithubErrorCode = 'notFound' | 'rateLimit' | 'network' | 'truncated';

export class GithubError extends Error {
  constructor(readonly code: GithubErrorCode, readonly resetAt?: Date) {
    super(code);
  }
}

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const SEGMENT = /^[^\s/\\]+$/;

const safeSegments = (parts: string[]) => parts.every((p) => SEGMENT.test(p) && p !== '.' && p !== '..');

/** Accepts `owner/repo`, github.com URLs (with /tree/<ref>/<dir> or /blob/<ref>/<file>) and git clone URLs. */
export function parseGithubUrl(input: string): GithubSpec | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^git@github\.com:/i, '').replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.includes('@')) return null;
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null;
  if (parts.length === 2) return { owner, repo, subdir: '' };
  const [, , kind, ref, ...rest] = parts;
  if ((kind !== 'tree' && kind !== 'blob') || !ref) return null;
  const dir = kind === 'blob' ? rest.slice(0, -1) : rest;
  if (!safeSegments([ref, ...dir])) return null;
  return { owner, repo, ref, subdir: dir.join('/') };
}

export const githubLabel = (o: Pick<GithubOrigin, 'owner' | 'repo' | 'subdir'>) =>
  `${o.owner}/${o.repo}${o.subdir ? `/${o.subdir}` : ''}`;

export const githubPageUrl = (o: Pick<GithubOrigin, 'owner' | 'repo'>) => `https://github.com/${o.owner}/${o.repo}`;

/** Where the user can grab a ZIP by hand when the API route fails. */
export const githubZipUrl = (o: Pick<GithubSpec, 'owner' | 'repo' | 'ref'>) =>
  `https://github.com/${o.owner}/${o.repo}/archive/${o.ref ? encodeURIComponent(o.ref) : 'HEAD'}.zip`;

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export const rawUrl = (o: GithubOrigin, path: string) =>
  `${RAW}/${o.owner}/${o.repo}/${o.sha}/${encodePath(o.subdir ? `${o.subdir}/${path}` : path)}`;

async function call(fetchFn: typeof fetch, url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch {
    throw new GithubError('network');
  }
  if (res.ok) return res;
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    throw new GithubError('rateLimit', Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : undefined);
  }
  if (res.status === 404 || res.status === 422) throw new GithubError('notFound');
  throw new GithubError('network');
}

export async function fetchGithubText(o: GithubOrigin, path: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await call(fetchFn, rawUrl(o, path));
  return res.text();
}

interface TreeItem { path: string; type: string; size?: number }
interface Bucket { dirs: Map<string, Bucket>; files: { name: string; path: string; size: number }[] }

function treeDir(name: string, items: TreeItem[], o: GithubOrigin, fetchFn: typeof fetch): FsDir {
  const prefix = o.subdir ? `${o.subdir}/` : '';
  const root: Bucket = { dirs: new Map(), files: [] };
  for (const it of items) {
    if (it.type !== 'blob' || !it.path.startsWith(prefix)) continue;
    const path = it.path.slice(prefix.length);
    const parts = path.split('/');
    if (!safeSegments(parts)) continue;
    let b = root;
    for (const d of parts.slice(0, -1)) {
      if (!b.dirs.has(d)) b.dirs.set(d, { dirs: new Map(), files: [] });
      b = b.dirs.get(d)!;
    }
    b.files.push({ name: parts[parts.length - 1], path, size: it.size ?? 0 });
  }
  const file = (f: Bucket['files'][number]): FsFile => ({
    name: f.name, kind: 'file', size: f.size, lastModified: 0, text: () => fetchGithubText(o, f.path, fetchFn),
  });
  const mk = (n: string, b: Bucket): FsDir => ({
    name: n,
    kind: 'directory',
    async *children() {
      for (const [dn, c] of b.dirs) yield mk(dn, c);
      for (const f of b.files) yield file(f);
    },
  });
  if (o.subdir && root.dirs.size === 0 && root.files.length === 0) throw new GithubError('notFound');
  return mk(name, root);
}

export interface GithubRepo {
  origin: GithubOrigin;
  dir: FsDir;
}

/** Three API calls: repo metadata, the commit the ref points at, and that commit's full file tree. */
export async function openGithub(spec: GithubSpec, fetchFn: typeof fetch = fetch): Promise<GithubRepo> {
  const base = `${API}/repos/${spec.owner}/${spec.repo}`;
  const meta = (await (await call(fetchFn, base)).json()) as { name: string; owner: { login: string }; default_branch: string };
  const ref = spec.ref ?? meta.default_branch;
  const shaRes = await call(fetchFn, `${base}/commits/${encodeURIComponent(ref)}`, { headers: { Accept: 'application/vnd.github.sha' } });
  const sha = (await shaRes.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new GithubError('network');
  const tree = (await (await call(fetchFn, `${base}/git/trees/${sha}?recursive=1`)).json()) as { tree: TreeItem[]; truncated: boolean };
  if (tree.truncated) throw new GithubError('truncated');
  // the API returns the canonical spelling, but it still ends up in URLs, so keep it to the same shape as user input
  const owner = OWNER.test(meta.owner?.login ?? '') ? meta.owner.login : spec.owner;
  const repo = REPO.test(meta.name ?? '') ? meta.name : spec.repo;
  const origin: GithubOrigin = { kind: 'github', owner, repo, sha, ref: spec.ref ?? '', subdir: spec.subdir };
  return { origin, dir: treeDir(githubLabel(origin), tree.tree, origin, fetchFn) };
}

/** The file tree of a commit already analysed, so the same code is read again (one API call). */
export async function openGithubCommit(origin: GithubOrigin, fetchFn: typeof fetch = fetch): Promise<FsDir> {
  if (!OWNER.test(origin.owner) || !REPO.test(origin.repo) || !/^[0-9a-f]{40}$/.test(origin.sha)) throw new GithubError('notFound');
  const url = `${API}/repos/${origin.owner}/${origin.repo}/git/trees/${origin.sha}?recursive=1`;
  const tree = (await (await call(fetchFn, url)).json()) as { tree: TreeItem[]; truncated: boolean };
  if (tree.truncated) throw new GithubError('truncated');
  return treeDir(githubLabel(origin), tree.tree, origin, fetchFn);
}
