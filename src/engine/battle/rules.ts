/**
 * Every number the battle is judged by. Changing one changes results, so bump RULE_VERSION with it
 * and keep the rulebook in step.
 */
export const RULE_VERSION = '1.4';

/** SIG/TÜViT 2015 four-star limits: share of code lines allowed above each threshold. */
export const FOUR_STAR = {
  complexity: [
    { above: 25, max: 0.015 },
    { above: 10, max: 0.1 },
    { above: 5, max: 0.252 },
  ],
  length: [
    { above: 60, max: 0.069 },
    { above: 30, max: 0.223 },
    { above: 15, max: 0.437 },
  ],
  duplication: 0.046,
} as const;

/** Upper bounds of each risk tier (tier 0 = low risk ... tier 3 = very high). */
export const CCN_TIERS = [5, 10, 25] as const;
export const LENGTH_TIERS = [15, 30, 60] as const;

export const ATTACK_BY_TIER = [1.0, 0.9, 0.7, 0.5] as const;
export const SPEED_BY_TIER = [1.0, 0.9, 0.8, 0.6] as const;

export const CLONE_MIN_LINES = 6;

export const ARMY = {
  soldiers: 300,
  squadSize: 20,
  lanes: 3,
  hp: 100,
  attack: 10,
  commanderHpMul: 10,
  commanderShare: 0.05,
  commanderMinFiles: 5,
} as const;

export const EFFECTS = {
  chainShare: 0.3,
  cloneBurst: 0.5,
  shieldCut: 0.3,
  burnPerSecond: 0.01,
  burnCap: 0.5,
  lookThreshold: 0.5,
} as const;

export const LUCK = {
  hitMin: 0.85,
  hitMax: 1.0,
  critChance: 0.05,
  critMul: 1.5,
} as const;

export const CLOCK = {
  tick: 0.1,
  duelSeconds: 30,
  laneSeconds: 180,
  finalSeconds: 60,
  tieMargin: 0.01,
} as const;

export const PREDICTION_RUNS = 100;

export const LIMITS = {
  minLines: 300,
  shakyLines: 2000,
  excludedWarn: 0.1,
  tangleFloor: 0.001,
} as const;

export const DEFAULT_TEST_PATTERNS = ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', 'tests/**'] as const;
export const DEFAULT_EXCLUDE = ['**/*.d.ts', '**/*.gen.ts', '**/*.gen.tsx'] as const;

export function tierOf(value: number, bounds: readonly number[]): number {
  let t = 0;
  while (t < bounds.length && value > bounds[t]) t++;
  return t;
}
