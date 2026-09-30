import { ARMY, ATTACK_BY_TIER, EFFECTS, FIELD, LIMITS, SPEED_BY_TIER } from '../rules';
import type { Quality, QualityFile } from '../types';
import type { Army, Commander, Lane, Soldier, Squad, SquadGear } from './types';

export const LANES: readonly Lane[] = ['top', 'mid', 'bottom'];

const byPath = (x: QualityFile, y: QualityFile) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0);

/** floor(i · total / parts) in exact integer arithmetic. */
export function chunkStart(i: number, total: number, parts: number = ARMY.soldiers): number {
  const n = i * total;
  return (n - (n % parts)) / parts;
}

export function isShield(i: number, shields: number, soldiers: number = ARMY.soldiers): boolean {
  return chunkStart(i + 1, shields, soldiers) > chunkStart(i, shields, soldiers);
}

class TierCount {
  readonly ccn = [0, 0, 0, 0];
  readonly len = [0, 0, 0, 0];
  n = 0;

  add(file: QualityFile, from: number, to: number): void {
    for (let k = from; k < to; k++) {
      this.ccn[Math.min(3, file.ccnTier[k] ?? 0)]++;
      this.len[Math.min(3, file.lenTier[k] ?? 0)]++;
    }
    this.n += to - from;
  }

  atk(): number {
    if (this.n === 0) return 1;
    let s = 0;
    for (let t = 0; t < 4; t++) s += this.ccn[t] * ATTACK_BY_TIER[t];
    return s / this.n;
  }

  spd(): number {
    if (this.n === 0) return 1;
    let s = 0;
    for (let t = 0; t < 4; t++) s += this.len[t] * SPEED_BY_TIER[t];
    return s / this.n;
  }
}

/** Most frequent key in insertion order; strict > keeps the first on ties. */
function mode<K>(counts: Map<K, number>, none: K): K {
  let best = none;
  let most = 0;
  for (const [k, n] of counts) {
    if (n > most) {
      best = k;
      most = n;
    }
  }
  return best;
}

function bump<K>(counts: Map<K, number>, key: K, by = 1): void {
  counts.set(key, (counts.get(key) ?? 0) + by);
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(0, slash);
}

/**
 * Path order, dealt mid, top, bottom. Sorting by power put an uneven army's best squads first and
 * cost it the war against an even army of the same average, which made small repos lose to big ones.
 */
export function placeSquads(squads: readonly Pick<Squad, 'index'>[]): Record<Lane, number[]> {
  const order = squads.map((s) => s.index).sort((x, y) => x - y);
  const lanes: Record<Lane, number[]> = { top: [], mid: [], bottom: [] };
  const byRank: Lane[] = ['mid', 'top', 'bottom'];
  order.forEach((s, k) => lanes[byRank[k % 3]].push(s));
  return lanes;
}

function buildSquads(soldiers: Soldier[]): { squads: Squad[]; lanes: Record<Lane, number[]> } {
  const size = ARMY.squadSize;
  const squads: Squad[] = [];
  for (let s = 0; s * size < soldiers.length; s++) {
    const from = s * size;
    const to = Math.min(soldiers.length, from + size);
    const folders = new Map<string, number>();
    let atk = 0;
    let spd = 0;
    let r = 0;
    let d = 0;
    let h = 0;
    let shields = 0;
    let heavy = 0;
    for (let i = from; i < to; i++) {
      const u = soldiers[i];
      u.squad = s;
      bump(folders, folderOf(u.home));
      atk += u.atk;
      spd += u.spd;
      r += u.r;
      d += u.d;
      h += u.burn;
      if (u.shield) shields++;
      if (u.atk < FIELD.heavyAttackBelow) heavy++;
    }
    const n = to - from;
    const t = EFFECTS.lookThreshold;
    const gear: SquadGear[] = [];
    if (r / n >= t) gear.push('link');
    if (shields / n >= t) gear.push('shield');
    if (d / n >= t) gear.push('mirror');
    if (h / n >= t) gear.push('burn');
    squads.push({
      index: s,
      name: mode(folders, ''),
      body: heavy * 2 > n ? 'heavy' : 'sprint',
      gear,
      atk: atk / n,
      spd: spd / n,
      power: (atk / n) * (spd / n),
      lane: 'mid',
      order: 0,
      from,
      to,
    });
  }
  const lanes = placeSquads(squads);
  for (const lane of LANES) {
    lanes[lane].forEach((s, order) => {
      squads[s].lane = lane;
      squads[s].order = order;
    });
  }
  return { squads, lanes };
}

function buildCommander(q: Quality, files: QualityFile[], tests: number): Commander {
  const byName = new Map(files.map((f) => [f.path, f]));
  const count = new TierCount();
  for (const path of q.commander.files) {
    const f = byName.get(path);
    if (f) count.add(f, 0, f.lines);
  }
  return {
    key: `${q.commander.display}#commander`,
    display: q.commander.display,
    files: [...q.commander.files],
    atk: count.atk(),
    spd: count.spd(),
    hp: ARMY.hp * ARMY.commanderHpMul,
    guard: 1 - EFFECTS.shieldCut * tests,
  };
}

/** Turns one repo's Quality into its army. Pure and seed-free: same data, same army. */
export function buildArmy(q: Quality): Army {
  const files = [...q.files].sort(byPath);
  let total = 0;
  for (const f of files) total += f.lines;
  if (total < LIMITS.minLines) {
    throw new Error(`battle needs at least ${LIMITS.minLines} code lines, got ${total}`);
  }
  const tests = Math.max(0, Math.min(1, q.scores.tests));
  const count = ARMY.soldiers;
  const shields = Math.round(count * tests);
  const soldiers: Soldier[] = [];
  let f = 0;
  let off = 0;
  for (let i = 0; i < count; i++) {
    const start = chunkStart(i, total);
    const end = chunkStart(i + 1, total);
    const tiers = new TierCount();
    const cycles = new Map<number, number>();
    const clones = new Map<number, number>();
    let cycleLines = 0;
    let removable = 0;
    let home = '';
    let homeLines = 0;
    let left = end - start;
    while (left > 0) {
      const file = files[f];
      const take = Math.min(left, file.lines - off);
      if (take > 0) {
        tiers.add(file, off, off + take);
        for (let k = off; k < off + take; k++) {
          removable += file.removable[k] ?? 0;
          const c = file.clone[k] ?? 0;
          if (c > 0) bump(clones, c);
        }
        if (file.cycle >= 0) {
          cycleLines += take;
          bump(cycles, file.cycle, take);
        }
        if (take > homeLines) {
          home = file.path;
          homeLines = take;
        }
      }
      off += take;
      left -= take;
      if (off >= file.lines) {
        f++;
        off = 0;
      }
    }
    const n = end - start;
    soldiers.push({
      index: i,
      key: `${home}#${i}`,
      home,
      start,
      end,
      atk: tiers.atk(),
      spd: tiers.spd(),
      r: cycleLines / n,
      chainGroup: mode(cycles, -1),
      d: removable / n,
      cloneGroup: mode(clones, 0) - 1,
      shield: isShield(i, shields),
      burn: 0,
      squad: 0,
    });
  }
  const { squads, lanes } = buildSquads(soldiers);
  return {
    id: `${q.name}@${q.fingerprint}`,
    name: q.name,
    lines: total,
    tests,
    soldiers,
    squads,
    commander: buildCommander(q, files, tests),
    lanes,
  };
}
