import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { analyze } from '../src/engine/analyze';
import { nodeLocate } from '../src/engine/node';
import { loadParsers } from '../src/engine/parsers';
import type { Lang } from '../src/engine/types';
import type { SampleManifest, SampleRepo } from '../src/app/files/samples';
import { readRepo } from './read-repo';

// Public repos only: their analysis results ship with the app as ready-made samples.
const SAMPLES: { owner: string; repo: string; subdir?: string; prefer?: Lang; blurb: string }[] = [
  { owner: 'alan2207', repo: 'bulletproof-react', subdir: 'apps/react-vite', blurb: '확장하기 좋은 React 앱 구조의 교과서' },
  { owner: 'excalidraw', repo: 'excalidraw', blurb: '손그림 느낌의 협업 화이트보드' },
  { owner: 'shadcn-ui', repo: 'taxonomy', blurb: 'Next.js App Router 로 만든 실전 예제 앱' },
  { owner: 'honojs', repo: 'hono', blurb: '어느 런타임에서나 도는 가벼운 웹 프레임워크' },
  { owner: 'koel', repo: 'koel', prefer: 'php', blurb: 'Laravel 로 만든 개인 음악 스트리밍 서버' },
  { owner: 'BookStackApp', repo: 'BookStack', prefer: 'php', blurb: 'Laravel 기반 위키·문서 플랫폼' },
];

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, '.local/samples-src');
const OUT = join(ROOT, 'public/samples');

function checkout(owner: string, repo: string): { dir: string; sha: string } {
  const dir = join(SRC, `${owner}_${repo}`);
  if (!existsSync(dir)) execFileSync('git', ['clone', '-q', '--depth', '1', `https://github.com/${owner}/${repo}.git`, dir], { stdio: 'inherit' });
  const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  return { dir, sha };
}

async function stars(owner: string, repo: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
    return res.ok ? ((await res.json()) as { stargazers_count: number }).stargazers_count : null;
  } catch {
    return null;
  }
}

async function main() {
  const parsers = await loadParsers(nodeLocate);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const repos: SampleRepo[] = [];
  for (const s of SAMPLES) {
    const { dir, sha } = checkout(s.owner, s.repo);
    const id = `${s.owner}-${s.repo}`.toLowerCase();
    const input = readRepo(s.subdir ? join(dir, s.subdir) : dir, `${s.owner}/${s.repo}`);
    const arch = analyze(input, parsers, { prefer: s.prefer });
    const json = JSON.stringify(arch);
    writeFileSync(join(OUT, `${id}.json`), json);
    const roleCounts = arch.roles.map(() => 0);
    for (const n of arch.nodes) roleCounts[n.role]++;
    repos.push({
      id, owner: s.owner, repo: s.repo, sha, subdir: s.subdir ?? '', blurb: s.blurb,
      lang: arch.lang, framework: arch.framework, files: arch.nodes.length, edges: arch.edges.length,
      stars: await stars(s.owner, s.repo),
      roles: arch.roles.map((r) => ({ name: r.name, layer: r.layer, color: r.color })), roleCounts,
    });
    console.log(`${id}: ${arch.lang}/${arch.framework ?? '-'} ${arch.nodes.length} files, ${arch.edges.length} edges, ${(json.length / 1024).toFixed(0)} KB`);
  }
  const manifest: SampleManifest = { generatedAt: new Date().toISOString().slice(0, 10), repos };
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

void main();
