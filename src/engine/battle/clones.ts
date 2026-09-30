import { hashString } from './rng';
import { CLONE_MIN_LINES, FOUR_STAR } from './rules';
import type { CloneGroup } from './types';

const MIN_ALNUM = 30;
const SEED_A = 0x811c9dc5;
const SEED_B = 0x9e3779b9;
const NEWLINE = '\n';

export interface CloneResult {
  groups: CloneGroup[];
  perFile: Map<string, { clone: number[]; removable: number[] }>;
}

interface Window {
  file: number;
  start: number;
  key: string;
}

function normalizedCodeLines(text: string): string[] {
  const out: string[] = [];
  for (const row of text.split('\n')) {
    const line = row.trim().replace(/\s+/g, ' ');
    if (line !== '') out.push(line);
  }
  return out;
}

function alnumCount(line: string): number {
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) n++;
  }
  return n;
}

// Chaining FNV over each line equals hashing the joined window text, without building that string.
function windowKey(lines: string[], start: number): string {
  let a = SEED_A;
  let b = SEED_B;
  for (let i = start; i < start + CLONE_MIN_LINES; i++) {
    if (i > start) {
      a = hashString(NEWLINE, a);
      b = hashString(NEWLINE, b);
    }
    a = hashString(lines[i], a);
    b = hashString(lines[i], b);
  }
  return `${a.toString(36)}.${b.toString(36)}`;
}

function windowsOf(lines: string[], file: number): Window[] {
  const out: Window[] = [];
  const prefix = [0];
  for (const line of lines) prefix.push(prefix[prefix.length - 1] + alnumCount(line));
  for (let s = 0; s + CLONE_MIN_LINES <= lines.length; s++) {
    if (prefix[s + CLONE_MIN_LINES] - prefix[s] < MIN_ALNUM) continue;
    out.push({ file, start: s, key: windowKey(lines, s) });
  }
  return out;
}

export function findClones(files: { path: string; text: string }[]): CloneResult {
  const sorted = [...files].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  const clone: number[][] = [];
  const removable: number[][] = [];
  const windows: Window[] = [];
  const counts = new Map<string, number>();

  sorted.forEach((f, i) => {
    const lines = normalizedCodeLines(f.text);
    clone.push(new Array<number>(lines.length).fill(0));
    removable.push(new Array<number>(lines.length).fill(0));
    for (const w of windowsOf(lines, i)) {
      windows.push(w);
      counts.set(w.key, (counts.get(w.key) ?? 0) + 1);
    }
  });

  const groupOf = new Map<string, number>();
  for (const w of windows) {
    if ((counts.get(w.key) ?? 0) < 2) continue;
    let group = groupOf.get(w.key);
    const first = group === undefined;
    if (group === undefined) {
      group = groupOf.size;
      groupOf.set(w.key, group);
    }
    const c = clone[w.file];
    const r = removable[w.file];
    for (let i = w.start; i < w.start + CLONE_MIN_LINES; i++) {
      if (c[i] === 0) c[i] = group + 1;
      if (!first) r[i] = 1;
    }
  }

  const groups: CloneGroup[] = Array.from({ length: groupOf.size }, (_, id) => ({ id, fragments: [] }));
  sorted.forEach((f, i) => {
    const c = clone[i];
    let s = 0;
    while (s < c.length) {
      let e = s;
      while (e + 1 < c.length && c[e + 1] === c[s]) e++;
      if (c[s] > 0) groups[c[s] - 1].fragments.push({ path: f.path, start: s, end: e });
      s = e + 1;
    }
  });

  const perFile = new Map<string, { clone: number[]; removable: number[] }>();
  sorted.forEach((f, i) => perFile.set(f.path, { clone: clone[i], removable: removable[i] }));
  return { groups, perFile };
}

export function duplicationScores(removableLines: number, prodLines: number): { duplication: number; duplicationExcess: number } {
  const duplication = prodLines > 0 ? removableLines / prodLines : 0;
  return { duplication, duplicationExcess: duplication / FOUR_STAR.duplication };
}
