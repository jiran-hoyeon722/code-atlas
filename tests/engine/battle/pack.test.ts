import { beforeAll, describe, expect, test } from 'vitest';
import { serialize } from 'node:v8';
import { loadParsers, type Parsers } from '../../../src/engine/parsers';
import { nodeLocate } from '../../../src/engine/node';
import { buildQuality } from '../../../src/engine/battle/quality';
import { decodeRuns, encodeRuns, PACK_VERSION, packQuality, unpackQuality, type PackedQuality } from '../../../src/engine/battle/pack';
import { loadFixture } from './fixture';
import { synthQuality } from './synth';

let parsers: Parsers;
beforeAll(async () => {
  parsers = await loadParsers(nodeLocate);
});

describe('run-length pairs', () => {
  test('encode and decode', () => {
    expect(encodeRuns([])).toEqual([]);
    expect(encodeRuns([0, 0, 0, 2, 2, 1])).toEqual([0, 3, 2, 2, 1, 1]);
    expect(decodeRuns([0, 3, 2, 2, 1, 1])).toEqual([0, 0, 0, 2, 2, 1]);
  });
});

describe('packQuality', () => {
  test.each(['battle-ts', 'battle-php'])('%s round-trips', (name) => {
    const q = buildQuality(loadFixture(name), parsers);
    const packed = packQuality(q);
    expect(packed.packVersion).toBe(PACK_VERSION);
    expect(unpackQuality(packed)).toEqual(q);
    expect(unpackQuality(structuredClone(packed))).toEqual(q);
    expect(unpackQuality(JSON.parse(JSON.stringify(packed)) as PackedQuality)).toEqual(q);
  });

  test('a 200k-line Quality round-trips and packs much smaller', () => {
    const q = synthQuality({ totalLines: 200_000, removableShare: 0.1, cycleShare: 0.2, seed: 7 });
    const packed = packQuality(q);
    expect(unpackQuality(packed)).toEqual(q);

    const json = [JSON.stringify(q).length, JSON.stringify(packed).length];
    const clone = [serialize(q).length, serialize(packed).length];
    const perLine = (x: { files: object[] }) =>
      JSON.stringify(x.files.map((f) => { const { ccnTier, lenTier, clone, removable } = f as Record<string, unknown>; return [ccnTier, lenTier, clone, removable]; })).length;
    const lines = [perLine(q), perLine(packed)];
    const ratio = (a: number[]) => (a[0] / a[1]).toFixed(1);
    console.log(`200k lines: JSON ${json[0]} -> ${json[1]} (x${ratio(json)}), structured clone ${clone[0]} -> ${clone[1]} (x${ratio(clone)}), per-line arrays ${lines[0]} -> ${lines[1]} (x${ratio(lines)})`);
    // functions and clone groups stay as they are, so the whole shrinks less than the per-line arrays.
    expect(lines[1] * 8).toBeLessThan(lines[0]);
    expect(json[1] * 2).toBeLessThan(json[0]);
    expect(clone[1] * 2).toBeLessThan(clone[0]);
  });

  test('rejects an unknown pack version', () => {
    const packed = { ...packQuality(synthQuality({ totalLines: 500 })), packVersion: 99 } as unknown as PackedQuality;
    expect(() => unpackQuality(packed)).toThrow(/pack version/);
  });
});
