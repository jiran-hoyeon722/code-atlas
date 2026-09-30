import { analyze, UnsupportedRepoError, type Progress } from '../analyze';
import { detect } from '../detect';
import type { Parsers } from '../parsers';
import type { Lang, RepoInput, SourceFile } from '../types';
import { findClones, duplicationScores } from './clones';
import { measureFunctions, readabilityScores, type FunctionProfile } from './functions';
import { findCycles, pickCommander, tangleScore, testsScore } from './graph';
import { codeLines } from './lines';
import { hashInts, hashString } from './rng';
import { LIMITS, RULE_VERSION } from './rules';
import { splitScope } from './scope';
import type { Quality, QualityFile } from './types';

export type QualityProgress =
  | { phase: 'analyze'; step: Progress }
  | { phase: 'functions'; done: number; total: number }
  | { phase: 'clones' }
  | { phase: 'graph' };

export interface QualityOptions {
  prefer?: Lang;
  onProgress?(p: QualityProgress): void;
}

export class TooSmallRepoError extends Error {
  constructor(readonly prodLines: number) {
    super(`Too little production code to battle: ${prodLines} code lines (need ${LIMITS.minLines})`);
    this.name = 'TooSmallRepoError';
  }
}

function profileOf(parsers: Parsers, lang: Lang, file: SourceFile): FunctionProfile {
  const parser = parsers.get(lang);
  let tree: ReturnType<typeof parser.parse> = null;
  try {
    tree = parser.parse(file.text);
  } catch {
    tree = null;
  }
  if (!tree) {
    const lines = codeLines(file.text).length;
    return { lines, functions: [], ccnTier: new Array<number>(lines).fill(0), lenTier: new Array<number>(lines).fill(0) };
  }
  try {
    return measureFunctions(tree.rootNode, lang, file.text);
  } finally {
    tree.delete();
  }
}

function fingerprintOf(files: readonly SourceFile[]): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  let h = hashInts(sorted.length);
  for (const f of sorted) h = hashInts(h, hashString(f.path), hashString(f.text));
  return h.toString(16).padStart(8, '0');
}

export function buildQuality(input: RepoInput, parsers: Parsers, opts: QualityOptions = {}): Quality {
  const { prefer, onProgress } = opts;
  const detection = detect(input, prefer);
  if (!detection) throw new UnsupportedRepoError();
  const scope = splitScope(detection, input);
  if (scope.prod.length === 0) throw new UnsupportedRepoError();

  const prodLineCounts = scope.prod.map((f) => codeLines(f.text).length);
  const prodLines = prodLineCounts.reduce((a, b) => a + b, 0);
  if (prodLines < LIMITS.minLines) throw new TooSmallRepoError(prodLines);

  const arch = analyze(input, parsers, { prefer: detection.lang, onProgress: (step) => onProgress?.({ phase: 'analyze', step }) });
  const centrality = new Map(arch.nodes.map((n) => [n.path, n.centrality]));

  const total = scope.prod.length;
  const profiles = scope.prod.map((f, i) => {
    const p = profileOf(parsers, detection.lang, f);
    onProgress?.({ phase: 'functions', done: i + 1, total });
    return p;
  });

  onProgress?.({ phase: 'clones' });
  const clones = findClones(scope.prod);

  onProgress?.({ phase: 'graph' });
  const cycles = findCycles(arch, new Set(scope.prod.map((f) => f.path)));
  const cycleOf = new Map<string, number>();
  for (const c of cycles) for (const p of c.files) cycleOf.set(p, c.id);

  let removableLines = 0;
  const files: QualityFile[] = scope.prod.map((f, i) => {
    const p = profiles[i];
    const dup = clones.perFile.get(f.path);
    const clone = dup?.clone ?? new Array<number>(p.lines).fill(0);
    const removable = dup?.removable ?? new Array<number>(p.lines).fill(0);
    for (const r of removable) removableLines += r;
    return {
      path: f.path,
      lines: prodLineCounts[i],
      functions: p.functions,
      ccnTier: p.ccnTier,
      lenTier: p.lenTier,
      clone,
      removable,
      cycle: cycleOf.get(f.path) ?? -1,
      centrality: centrality.get(f.path) ?? 0,
    };
  });

  const testLines = scope.tests.reduce((sum, f) => sum + codeLines(f.text).length, 0);
  const readability = readabilityScores(files, prodLines);
  const warnings: Quality['warnings'] = [];
  if (prodLines < LIMITS.shakyLines) warnings.push('shaky');
  if (scope.excludedLines > LIMITS.excludedWarn * prodLines) warnings.push('excluded-heavy');

  return {
    ruleVersion: RULE_VERSION,
    name: input.name,
    lang: detection.lang,
    fingerprint: fingerprintOf([...scope.prod, ...scope.tests]),
    config: {
      sourceDir: detection.sourceDir,
      exclude: scope.exclude,
      testPatterns: scope.testPatterns,
      excludedLines: scope.excludedLines,
    },
    totals: { prodLines, testLines, testFiles: scope.tests.length },
    files,
    clones: clones.groups,
    cycles,
    commander: pickCommander(files, prodLines),
    scores: {
      ...readability,
      tangle: tangleScore(files, prodLines),
      ...duplicationScores(removableLines, prodLines),
      tests: testsScore(testLines, prodLines),
      hotspot: null,
    },
    warnings,
  };
}
