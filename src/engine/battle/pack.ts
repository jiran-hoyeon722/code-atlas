import type { Quality, QualityFile } from './types';

export const PACK_VERSION = 1;

/** Flat run-length pairs: value, count, value, count, ... */
export type Runs = number[];

export interface PackedQualityFile extends Omit<QualityFile, 'ccnTier' | 'lenTier' | 'clone' | 'removable'> {
  ccnTier: Runs;
  lenTier: Runs;
  clone: Runs;
  removable: Runs;
}

export interface PackedQuality extends Omit<Quality, 'files'> {
  packVersion: typeof PACK_VERSION;
  files: PackedQualityFile[];
}

export function encodeRuns(values: readonly number[]): Runs {
  const out: Runs = [];
  let i = 0;
  while (i < values.length) {
    const v = values[i];
    let j = i + 1;
    while (j < values.length && values[j] === v) j++;
    out.push(v, j - i);
    i = j;
  }
  return out;
}

export function decodeRuns(runs: Runs): number[] {
  let length = 0;
  for (let i = 1; i < runs.length; i += 2) length += runs[i];
  const out = new Array<number>(length);
  let at = 0;
  for (let i = 0; i < runs.length; i += 2) {
    out.fill(runs[i], at, at + runs[i + 1]);
    at += runs[i + 1];
  }
  return out;
}

export function packQuality(q: Quality): PackedQuality {
  return {
    ...q,
    packVersion: PACK_VERSION,
    files: q.files.map((f) => ({
      ...f,
      ccnTier: encodeRuns(f.ccnTier),
      lenTier: encodeRuns(f.lenTier),
      clone: encodeRuns(f.clone),
      removable: encodeRuns(f.removable),
    })),
  };
}

export function unpackQuality(p: PackedQuality): Quality {
  if (p.packVersion !== PACK_VERSION) throw new Error(`Unknown battle data pack version: ${String(p.packVersion)}`);
  const { packVersion: _, ...rest } = p;
  return {
    ...rest,
    files: p.files.map((f) => ({
      ...f,
      ccnTier: decodeRuns(f.ccnTier),
      lenTier: decodeRuns(f.lenTier),
      clone: decodeRuns(f.clone),
      removable: decodeRuns(f.removable),
    })),
  };
}
