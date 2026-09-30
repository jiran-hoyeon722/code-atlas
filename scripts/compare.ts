import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { analyze } from '../src/engine/analyze';
import { loadParsers } from '../src/engine/parsers';
import { nodeLocate } from '../src/engine/node';
import { readRepo } from './read-repo';

interface BaselineEdge {
  from: string;
  to: string;
  weight: number;
  kinds: Record<string, number>;
}

interface Baseline {
  nodes: { id: string }[];
  edges: BaselineEdge[];
}

const LIMIT = 50;

function usage(): never {
  console.error('usage: npm run compare -- <repoDir> <baselineDepsJson> [--out <dir>]');
  process.exit(2);
}

function parseArgs(argv: string[]): { repoDir: string; baselinePath: string; outDir: string } {
  const positional: string[] = [];
  let outDir = '.local/compare';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') {
      const v = argv[++i];
      if (!v) usage();
      outDir = v;
    } else positional.push(argv[i]);
  }
  if (positional.length !== 2) usage();
  return { repoDir: resolve(positional[0]), baselinePath: resolve(positional[1]), outDir: resolve(outDir) };
}

const kindKey = (kinds: Record<string, number>): string => Object.keys(kinds).sort().join(',');

async function main() {
  const { repoDir, baselinePath, outDir } = parseArgs(process.argv.slice(2));
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
  const parsers = await loadParsers(nodeLocate);

  const started = performance.now();
  const input = readRepo(repoDir);
  const arch = analyze(input, parsers);
  const ms = Math.round(performance.now() - started);

  const engineIds = arch.nodes.map((n) => n.path);
  const engineEdges = new Map<string, Record<string, number>>();
  for (const [from, to, , kinds] of arch.edges) {
    engineEdges.set(`${engineIds[from]}\0${engineIds[to]}`, kinds as Record<string, number>);
  }
  const baseEdges = new Map(baseline.edges.map((e) => [`${e.from}\0${e.to}`, e.kinds]));

  const engineSet = new Set(engineIds);
  const baseSet = new Set(baseline.nodes.map((n) => n.id));
  const onlyEngineFiles = [...engineSet].filter((id) => !baseSet.has(id)).sort();
  const onlyBaselineFiles = [...baseSet].filter((id) => !engineSet.has(id)).sort();

  const onlyEngine: string[] = [];
  const onlyBaseline: string[] = [];
  const kindMismatch: string[] = [];
  const line = (key: string, e: Record<string, number> | undefined, b: Record<string, number> | undefined) => {
    const [from, to] = key.split('\0');
    return `${from} → ${to}  ${e ? kindKey(e) : '-'} | ${b ? kindKey(b) : '-'}`;
  };
  for (const [key, kinds] of engineEdges) {
    const b = baseEdges.get(key);
    if (!b) onlyEngine.push(line(key, kinds, undefined));
    else if (kindKey(kinds) !== kindKey(b)) kindMismatch.push(line(key, kinds, b));
  }
  for (const [key, kinds] of baseEdges) {
    if (!engineEdges.has(key)) onlyBaseline.push(line(key, undefined, kinds));
  }
  [onlyEngine, onlyBaseline, kindMismatch].forEach((l) => l.sort());

  const summary = [
    `files ${engineSet.size}/${baseSet.size}`,
    `edges ${engineEdges.size}/${baseEdges.size}`,
    `onlyEngine ${onlyEngine.length}`,
    `onlyBaseline ${onlyBaseline.length}`,
    `kindMismatch ${kindMismatch.length}`,
    `failed ${arch.failed.length}`,
    `unresolved ${arch.unresolved}`,
    `ms ${ms}`,
  ].join('  ');
  console.log(summary);

  const section = (title: string, items: string[]) =>
    [`## ${title} (${items.length})`, '', ...items.slice(0, LIMIT).map((s) => `- ${s}`), ''].join('\n');
  const name = basename(repoDir);
  const report = [
    `# ${name}`,
    '',
    '```',
    summary,
    '```',
    '',
    section('onlyEngine files', onlyEngineFiles),
    section('onlyBaseline files', onlyBaselineFiles),
    section('onlyEngine edges', onlyEngine),
    section('onlyBaseline edges', onlyBaseline),
    section('kindMismatch edges', kindMismatch),
    section('failed', arch.failed.map((f) => `${f.path}  ${f.reason}`)),
  ].join('\n');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${name}.md`), report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
