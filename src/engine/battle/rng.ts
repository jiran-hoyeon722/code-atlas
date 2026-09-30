// Integer-only hashing and PRNG: identical results in every JS engine.

export function hashString(text: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function hashInts(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    h ^= v >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= h >>> 15;
  }
  return h >>> 0;
}

/** mulberry32: returns a generator of floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Battle seed: the two repo fingerprints in name order, so A-vs-B and B-vs-A share it. */
export function battleSeed(a: string, b: string, match: number): number {
  const [x, y] = a <= b ? [a, b] : [b, a];
  return hashInts(hashString(x), hashString(y), match);
}

/** One float in [0, 1) for one attack, independent of evaluation order and of which side is "left". */
export function rollFor(seed: number, tick: number, key: string, salt = 0): number {
  return mulberry32(hashInts(seed, tick, hashString(key), salt))();
}
