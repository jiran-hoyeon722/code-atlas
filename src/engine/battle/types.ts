import type { Lang } from '../types';

/** Line coordinates in battle data are 0-based indexes into a file's code lines (non-blank lines). */

export interface FnInfo {
  /** First and last code line (inclusive). */
  start: number;
  end: number;
  nloc: number;
  ccn: number;
}

export interface QualityFile {
  path: string;
  /** Code lines (non-blank). */
  lines: number;
  functions: FnInfo[];
  /** Per code line: complexity tier (0..3) of the innermost function, 0 outside functions. */
  ccnTier: number[];
  /** Per code line: length tier (0..3) of the innermost function, 0 outside functions. */
  lenTier: number[];
  /** Per code line: clone group id + 1, or 0 when the line is in no clone. */
  clone: number[];
  /** Per code line: 1 when the line is a removable duplicate (2nd and later occurrences). */
  removable: number[];
  /** Cycle (SCC) id, or -1. */
  cycle: number;
  centrality: number;
}

export interface CloneGroup {
  id: number;
  fragments: { path: string; start: number; end: number }[];
}

export interface Cycle {
  id: number;
  files: string[];
}

/** Four-star excess ratios: 1.0 or less passes. `null` = not measured in this version. */
export interface Scores {
  readability: number;
  complexityExcess: number;
  lengthExcess: number;
  /** Share of code lines inside cycles. */
  tangle: number;
  /** Share of removable duplicate lines. */
  duplication: number;
  duplicationExcess: number;
  /** Test lines ÷ production lines, capped at 1. */
  tests: number;
  hotspot: null;
}

export interface Quality {
  ruleVersion: string;
  name: string;
  lang: Lang;
  /** Fingerprint of the measured content; stands in for a commit id in the battle seed. */
  fingerprint: string;
  config: {
    sourceDir: string;
    exclude: string[];
    testPatterns: string[];
    excludedLines: number;
  };
  totals: { prodLines: number; testLines: number; testFiles: number };
  /** Production files, sorted by path. */
  files: QualityFile[];
  clones: CloneGroup[];
  cycles: Cycle[];
  commander: { files: string[]; display: string };
  scores: Scores;
  warnings: ('shaky' | 'excluded-heavy')[];
}
