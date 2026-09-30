import { mulberry32 } from '../../../src/engine/battle/rng';
import { ARMY, FOUR_STAR, RULE_VERSION } from '../../../src/engine/battle/rules';
import type { CloneGroup, Cycle, FnInfo, Quality, QualityFile } from '../../../src/engine/battle/types';

export type TierShares = readonly [number, number, number, number];

export interface SynthOptions {
  name?: string;
  fingerprint?: string;
  totalLines?: number;
  files?: number;
  filesPerModule?: number;
  /** Share of code lines in each complexity tier (0..3). Normalised. */
  ccnShares?: TierShares;
  /** Share of code lines in each function-length tier (0..3). Normalised. */
  lenShares?: TierShares;
  /** Target share of code lines in files that sit in cycles. */
  cycleShare?: number;
  /** Target share of code lines that are removable duplicates. */
  removableShare?: number;
  /** Test lines ÷ production lines. */
  testRatio?: number;
  seed?: number;
}

const CCN_OF_TIER = [3, 8, 15, 30];
const LEN_OF_TIER = [10, 22, 45, 80];

function normalise(s: TierShares): number[] {
  const total = s[0] + s[1] + s[2] + s[3];
  return s.map((v) => (total > 0 ? v / total : 0));
}

function pick(weights: number[], u: number): number {
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (u < acc) return i;
  }
  return weights.length - 1;
}

/** Deterministic fake Quality with independently tunable quality knobs. */
export function synthQuality(opts: SynthOptions = {}): Quality {
  const total = opts.totalLines ?? 20_000;
  const fileCount = Math.max(1, opts.files ?? Math.max(5, Math.round(total / 200)));
  const perModule = opts.filesPerModule ?? 10;
  const ccnW = normalise(opts.ccnShares ?? [0.8, 0.12, 0.06, 0.02]);
  const lenW = normalise(opts.lenShares ?? [0.6, 0.25, 0.1, 0.05]);
  const cycleShare = opts.cycleShare ?? 0;
  const removableShare = opts.removableShare ?? 0;
  const testRatio = opts.testRatio ?? 0.5;
  const rand = mulberry32(opts.seed ?? 1);
  // Separate streams so changing one knob (say cycles) leaves the other layouts (say clones) as they were.
  const cycleRand = mulberry32(((opts.seed ?? 1) * 7919 + 1) >>> 0);
  const cloneRand = mulberry32(((opts.seed ?? 1) * 7919 + 2) >>> 0);

  const weights = Array.from({ length: fileCount }, () => 0.5 + rand());
  const wsum = weights.reduce((s, w) => s + w, 0);
  const sizes = weights.map((w) => Math.max(1, Math.floor((w / wsum) * total)));
  let diff = total - sizes.reduce((s, v) => s + v, 0);
  for (let i = 0; diff !== 0; i = (i + 1) % fileCount) {
    if (diff > 0) {
      sizes[i]++;
      diff--;
    } else if (sizes[i] > 1) {
      sizes[i]--;
      diff++;
    }
  }

  const files: QualityFile[] = sizes.map((lines, i) => {
    const ccnTier: number[] = new Array(lines).fill(0);
    const lenTier: number[] = new Array(lines).fill(0);
    const functions: FnInfo[] = [];
    let at = 0;
    while (at < lines) {
      const size = Math.min(lines - at, 8 + Math.floor(rand() * 13));
      const ct = pick(ccnW, rand());
      const lt = pick(lenW, rand());
      for (let k = at; k < at + size; k++) {
        ccnTier[k] = ct;
        lenTier[k] = lt;
      }
      functions.push({ start: at, end: at + size - 1, nloc: size, ccn: CCN_OF_TIER[ct] });
      at += size;
    }
    const mod = Math.floor(i / perModule);
    return {
      path: `src/mod${mod}/file${i}.ts`,
      lines,
      functions,
      ccnTier,
      lenTier,
      clone: new Array(lines).fill(0),
      removable: new Array(lines).fill(0),
      cycle: -1,
      centrality: rand(),
    };
  });
  files.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));

  const cycles: Cycle[] = [];
  const cycleTarget = Math.round(cycleShare * total);
  let inCycles = 0;
  const order = files.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(cycleRand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let cursor = 0;
  while (inCycles < cycleTarget && cursor + 1 < order.length) {
    let size = Math.min(order.length - cursor, 2 + Math.floor(cycleRand() * 5));
    const linesOf = (n: number) => order.slice(cursor, cursor + n).reduce((t, m) => t + files[m].lines, 0);
    // Trim the group so whole-file cycles land near the target instead of overshooting by a group.
    while (size > 2 && inCycles + linesOf(size) > cycleTarget) size--;
    const over = inCycles + linesOf(size) - cycleTarget;
    if (over > 0 && over > cycleTarget - inCycles) break;
    const members = order.slice(cursor, cursor + size);
    cursor += size;
    const id = cycles.length;
    for (const m of members) {
      files[m].cycle = id;
      inCycles += files[m].lines;
    }
    cycles.push({ id, files: members.map((m) => files[m].path).sort() });
  }

  const clones: CloneGroup[] = [];
  const removableTarget = Math.round(removableShare * total);
  let removable = 0;
  let attempts = 0;
  const free = (f: QualityFile, start: number, len: number) => {
    if (start + len > f.lines) return false;
    for (let k = start; k < start + len; k++) if (f.clone[k] !== 0) return false;
    return true;
  };
  while (removable < removableTarget && attempts < 20_000) {
    attempts++;
    const len = 6 + Math.floor(cloneRand() * 7);
    const copies = 1 + Math.floor(cloneRand() * 3);
    const spots: { f: QualityFile; start: number }[] = [];
    for (let c = 0; c <= copies; c++) {
      const f = files[Math.floor(cloneRand() * files.length)];
      const start = Math.floor(cloneRand() * Math.max(1, f.lines - len + 1));
      if (!free(f, start, len) || spots.some((s) => s.f === f && Math.abs(s.start - start) < len)) break;
      spots.push({ f, start });
    }
    if (spots.length < 2) continue;
    spots.sort((x, y) => (x.f.path < y.f.path ? -1 : x.f.path > y.f.path ? 1 : x.start - y.start));
    const id = clones.length;
    spots.forEach((s, n) => {
      for (let k = s.start; k < s.start + len; k++) {
        s.f.clone[k] = id + 1;
        if (n > 0) {
          s.f.removable[k] = 1;
          removable++;
        }
      }
    });
    clones.push({ id, fragments: spots.map((s) => ({ path: s.f.path, start: s.start, end: s.start + len - 1 })) });
  }

  const byCentrality = [...files].sort((x, y) => y.centrality - x.centrality || (x.path < y.path ? -1 : 1));
  const commanderFiles: string[] = [];
  let commanderLines = 0;
  for (const f of byCentrality) {
    if (commanderLines >= ARMY.commanderShare * total && commanderFiles.length >= ARMY.commanderMinFiles) break;
    commanderFiles.push(f.path);
    commanderLines += f.lines;
  }

  const shareAbove = (tiers: (f: QualityFile) => number[], minTier: number) => {
    let n = 0;
    for (const f of files) for (const t of tiers(f)) if (t >= minTier) n++;
    return n / total;
  };
  const excess = (tiers: (f: QualityFile) => number[], bands: readonly { max: number }[]) =>
    Math.max(...bands.map((b, i) => shareAbove(tiers, 3 - i) / b.max));
  const complexityExcess = excess((f) => f.ccnTier, FOUR_STAR.complexity);
  const lengthExcess = excess((f) => f.lenTier, FOUR_STAR.length);
  const duplication = removable / total;
  const testLines = Math.round(testRatio * total);
  const name = opts.name ?? 'synth';

  return {
    ruleVersion: RULE_VERSION,
    name,
    lang: 'ts',
    fingerprint: opts.fingerprint ?? `seed${opts.seed ?? 1}`,
    config: { sourceDir: 'src', exclude: [], testPatterns: ['tests/**'], excludedLines: 0 },
    totals: { prodLines: total, testLines, testFiles: testLines > 0 ? Math.max(1, Math.round(fileCount / 4)) : 0 },
    files,
    clones,
    cycles,
    commander: { files: commanderFiles, display: commanderFiles[0].slice(commanderFiles[0].lastIndexOf('/') + 1) },
    scores: {
      readability: (complexityExcess + lengthExcess) / 2,
      complexityExcess,
      lengthExcess,
      tangle: inCycles / total,
      duplication,
      duplicationExcess: duplication / FOUR_STAR.duplication,
      tests: Math.min(1, testRatio),
      hotspot: null,
    },
    warnings: [],
  };
}

/** Minimal hand-built Quality: one file per entry, every line at the given tiers. */
export function tinyQuality(
  name: string,
  entries: { path: string; lines: number; ccn?: number; len?: number; cycle?: number; clone?: number; removable?: boolean }[],
  tests = 0,
): Quality {
  const files: QualityFile[] = entries.map((e) => ({
    path: e.path,
    lines: e.lines,
    functions: [],
    ccnTier: new Array(e.lines).fill(e.ccn ?? 0),
    lenTier: new Array(e.lines).fill(e.len ?? 0),
    clone: new Array(e.lines).fill(e.clone ?? 0),
    removable: new Array(e.lines).fill(e.removable ? 1 : 0),
    cycle: e.cycle ?? -1,
    centrality: 0,
  }));
  const q = synthQuality({ name, totalLines: 300, files: 5 });
  return {
    ...q,
    name,
    fingerprint: 'tiny',
    files,
    commander: { files: files.slice(0, 5).map((f) => f.path), display: files[0].path },
    scores: { ...q.scores, tests },
  };
}
