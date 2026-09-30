import { describe, expect, test } from 'vitest';
import { GithubError, githubZipUrl, openGithub, parseGithubUrl, rawUrl } from '../../src/app/files/github';
import { listRepo, loadRepo } from '../../src/app/files/walk';

describe('parseGithubUrl', () => {
  test.each([
    ['acme/shop', { owner: 'acme', repo: 'shop', subdir: '' }],
    ['  https://github.com/acme/shop  ', { owner: 'acme', repo: 'shop', subdir: '' }],
    ['github.com/acme/shop.git', { owner: 'acme', repo: 'shop', subdir: '' }],
    ['git@github.com:acme/shop.git', { owner: 'acme', repo: 'shop', subdir: '' }],
    ['https://www.github.com/acme/shop/?tab=readme#top', { owner: 'acme', repo: 'shop', subdir: '' }],
    ['https://github.com/acme/shop/tree/dev/packages/web', { owner: 'acme', repo: 'shop', ref: 'dev', subdir: 'packages/web' }],
    ['https://github.com/acme/shop/blob/main/src/app.ts', { owner: 'acme', repo: 'shop', ref: 'main', subdir: 'src' }],
  ])('%s', (input, spec) => {
    expect(parseGithubUrl(input)).toEqual(spec);
  });

  test.each(['', 'acme', 'https://gitlab.com/acme/shop', 'acme/shop/issues/3', 'acme/../x', 'acme/shop/tree/main/../..', 'user@evil/x', '-bad/shop'])(
    'rejects %s',
    (input) => {
      expect(parseGithubUrl(input)).toBeNull();
    },
  );
});

const SHA = 'a'.repeat(40);

function fakeGithub(opts: { status?: number; headers?: Record<string, string>; truncated?: boolean } = {}) {
  const calls: string[] = [];
  const files: Record<string, string> = {
    'src/App.tsx': "import { a } from './a';\nexport const App = () => a;\n",
    'src/a.ts': 'export const a = 1;\n',
    'README.md': '# hi',
    'package.json': '{"dependencies":{"react":"19"}}',
  };
  const fetchFn = (async (url: string) => {
    calls.push(url);
    if (opts.status) return new Response('{}', { status: opts.status, headers: opts.headers });
    if (url === 'https://api.github.com/repos/acme/shop') return Response.json({ name: 'shop', owner: { login: 'acme' }, default_branch: 'main' });
    if (url === 'https://api.github.com/repos/acme/shop/commits/main') return new Response(SHA);
    if (url.startsWith(`https://api.github.com/repos/acme/shop/git/trees/${SHA}`)) {
      return Response.json({
        truncated: !!opts.truncated,
        tree: [{ path: 'src', type: 'tree' }, ...Object.entries(files).map(([path, t]) => ({ path, type: 'blob', size: t.length }))],
      });
    }
    const raw = `https://raw.githubusercontent.com/acme/shop/${SHA}/`;
    if (url.startsWith(raw) && files[url.slice(raw.length)]) return new Response(files[url.slice(raw.length)]);
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe('openGithub', () => {
  test('pins the default branch commit and lists the tree as a folder', async () => {
    const gh = fakeGithub();
    const { origin, dir } = await openGithub({ owner: 'acme', repo: 'shop', subdir: '' }, gh.fetchFn);
    expect(origin).toEqual({ kind: 'github', owner: 'acme', repo: 'shop', sha: SHA, ref: '', subdir: '' });
    const listing = await listRepo(dir);
    expect(listing.name).toBe('acme/shop');
    expect(listing.sources.map((e) => e.path).sort()).toEqual(['src/App.tsx', 'src/a.ts']);
    const input = await loadRepo(listing);
    expect(input.files.find((f) => f.path === 'src/a.ts')?.text).toBe('export const a = 1;\n');
    expect(input.configs['package.json']).toContain('react');
    expect(gh.calls.filter((u) => u.startsWith('https://api.github.com'))).toHaveLength(3);
  });

  test('a subfolder URL roots the listing there', async () => {
    const gh = fakeGithub();
    const { dir, origin } = await openGithub({ owner: 'acme', repo: 'shop', ref: 'main', subdir: 'src' }, gh.fetchFn);
    const listing = await listRepo(dir);
    expect(listing.name).toBe('acme/shop/src');
    expect(listing.sources.map((e) => e.path).sort()).toEqual(['App.tsx', 'a.ts']);
    expect(rawUrl(origin, 'App.tsx')).toBe(`https://raw.githubusercontent.com/acme/shop/${SHA}/src/App.tsx`);
  });

  test('a missing subfolder is not found', async () => {
    await expect(openGithub({ owner: 'acme', repo: 'shop', subdir: 'nope' }, fakeGithub().fetchFn)).rejects.toMatchObject({ code: 'notFound' });
  });

  test('maps API failures to error codes', async () => {
    await expect(openGithub({ owner: 'acme', repo: 'shop', subdir: '' }, fakeGithub({ status: 404 }).fetchFn)).rejects.toMatchObject({ code: 'notFound' });
    const limited = openGithub(
      { owner: 'acme', repo: 'shop', subdir: '' },
      fakeGithub({ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' } }).fetchFn,
    );
    await expect(limited).rejects.toBeInstanceOf(GithubError);
    await expect(limited).rejects.toMatchObject({ code: 'rateLimit', resetAt: new Date(1790000000 * 1000) });
    await expect(openGithub({ owner: 'acme', repo: 'shop', subdir: '' }, fakeGithub({ truncated: true }).fetchFn)).rejects.toMatchObject({ code: 'truncated' });
    const offline = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    await expect(openGithub({ owner: 'acme', repo: 'shop', subdir: '' }, offline)).rejects.toMatchObject({ code: 'network' });
  });
});

test('zip fallback link', () => {
  expect(githubZipUrl({ owner: 'acme', repo: 'shop' })).toBe('https://github.com/acme/shop/archive/HEAD.zip');
  expect(githubZipUrl({ owner: 'acme', repo: 'shop', ref: 'dev' })).toBe('https://github.com/acme/shop/archive/dev.zip');
});

test('loadRepo keeps listing order while reading in parallel', async () => {
  const slow = (name: string, ms: number) => ({
    name, kind: 'file' as const, size: 1, lastModified: 0,
    text: () => new Promise<string>((ok) => setTimeout(() => ok(name), ms)),
  });
  const dir = {
    name: 'r', kind: 'directory' as const,
    async *children() { yield slow('a.ts', 20); yield slow('b.ts', 1); yield slow('c.ts', 10); },
  };
  const seen: number[] = [];
  const input = await loadRepo(await listRepo(dir), (done) => seen.push(done));
  expect(input.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  expect(seen).toEqual([1, 2, 3]);
});
