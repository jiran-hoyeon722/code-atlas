import { ATTACK_BY_TIER, CCN_TIERS, EFFECTS, LENGTH_TIERS, SPEED_BY_TIER } from './rules';
import { buildArmy, createBattleFromArmies } from './sim';
import type { Army, Side } from './sim';
import type { Cycle, Quality, QualityFile } from './types';

export type FixReason = 'complexity' | 'length' | 'tangle' | 'duplication';

export interface FixCandidate {
  path: string;
  /** How many soldier-lines of strength this file costs the loser (bigger = worse). */
  penalty: number;
  /** What makes the file costly, biggest share first. */
  reasons: FixReason[];
  /** Loser's win share over matches 1..seeds, as is and with this file made low-risk. */
  baseline: number;
  improved: number;
  delta: number;
}

export interface FixOptions {
  seeds?: number;
  count?: number;
}

const REASON_ORDER: readonly FixReason[] = ['complexity', 'length', 'tangle', 'duplication'];

interface Ranked {
  path: string;
  penalty: number;
  reasons: FixReason[];
}

function rankFile(f: QualityFile): Ranked {
  let complexity = 0;
  let length = 0;
  let duplication = 0;
  for (let k = 0; k < f.lines; k++) {
    const atk = ATTACK_BY_TIER[f.ccnTier[k] ?? 0];
    const spd = SPEED_BY_TIER[f.lenTier[k] ?? 0];
    // 1 − atk·spd splits exactly into (1 − atk) + atk·(1 − spd), so each cause gets its own share.
    complexity += 1 - atk;
    length += atk * (1 - spd);
    duplication += (f.removable[k] ?? 0) * EFFECTS.cloneBurst;
  }
  const tangle = f.cycle >= 0 ? f.lines * EFFECTS.chainShare : 0;
  const parts: Record<FixReason, number> = { complexity, length, tangle, duplication };
  const reasons = REASON_ORDER.filter((r) => parts[r] > 1e-9);
  reasons.sort((x, y) => parts[y] - parts[x] || REASON_ORDER.indexOf(x) - REASON_ORDER.indexOf(y));
  return { path: f.path, penalty: complexity + length + tangle + duplication, reasons };
}

/** Production files ranked by how much they weaken the army; files that cost nothing are left out. */
export function rankFixes(q: Quality): Ranked[] {
  const ranked = q.files.map(rankFile).filter((r) => r.penalty > 1e-9);
  ranked.sort((x, y) => y.penalty - x.penalty || (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  return ranked;
}

/** The same repo with one file rewritten as low-risk code: simple short functions, no copies, no cycle. */
export function withLowRiskFile(q: Quality, path: string): Quality {
  const target = q.files.find((f) => f.path === path);
  if (!target) return q;
  const dissolved = new Set<number>();
  const cycles: Cycle[] = [];
  for (const c of q.cycles) {
    if (c.id !== target.cycle) {
      cycles.push(c);
      continue;
    }
    const rest = c.files.filter((p) => p !== path);
    if (rest.length >= 2) cycles.push({ id: c.id, files: rest });
    else dissolved.add(c.id);
  }
  const files = q.files.map((f): QualityFile => {
    if (f.path === path) {
      return {
        ...f,
        functions: f.functions.map((fn) => ({ ...fn, ccn: Math.min(fn.ccn, CCN_TIERS[0]), nloc: Math.min(fn.nloc, LENGTH_TIERS[0]) })),
        ccnTier: new Array(f.lines).fill(0),
        lenTier: new Array(f.lines).fill(0),
        clone: new Array(f.lines).fill(0),
        removable: new Array(f.lines).fill(0),
        cycle: -1,
      };
    }
    return dissolved.has(f.cycle) ? { ...f, cycle: -1 } : f;
  });
  const clones = q.clones
    .map((g) => ({ id: g.id, fragments: g.fragments.filter((fr) => fr.path !== path) }))
    .filter((g) => g.fragments.length >= 2);
  return { ...q, files, cycles, clones };
}

function winShare(loser: Army, winner: Army, loserSide: Side, seeds: number): number {
  const [a, b] = loserSide === 'a' ? [loser, winner] : [winner, loser];
  let wins = 0;
  for (let match = 1; match <= seeds; match++) {
    if (createBattleFromArmies(a, b, match).run().winner === loserSide) wins++;
  }
  return seeds > 0 ? wins / seeds : 0;
}

/**
 * The loser's files most worth fixing, each with the win share it would gain if that one file were
 * low-risk. Replays matches 1..seeds in the real side order so the numbers match the battle shown.
 */
export function fixCandidates(loser: Quality, winner: Quality, loserSide: Side, opts: FixOptions = {}): FixCandidate[] {
  const seeds = Math.max(0, Math.floor(opts.seeds ?? 20));
  const count = Math.max(0, Math.floor(opts.count ?? 5));
  const top = rankFixes(loser).slice(0, count);
  if (top.length === 0) return [];
  const winnerArmy = buildArmy(winner);
  const baseline = winShare(buildArmy(loser), winnerArmy, loserSide, seeds);
  return top.map((r) => {
    const improved = winShare(buildArmy(withLowRiskFile(loser, r.path)), winnerArmy, loserSide, seeds);
    return { path: r.path, penalty: r.penalty, reasons: r.reasons, baseline, improved, delta: improved - baseline };
  });
}
