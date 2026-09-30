import { battleSeed, rollFor } from '../rng';
import { ARMY, CLOCK, EFFECTS, FIELD, LUCK, RULE_VERSION } from '../rules';
import type { Quality } from '../types';
import { LANES, buildArmy } from './army';
import {
  COMMANDER,
  type Arena,
  type Army,
  type Battle,
  type BattleEvent,
  type BattleOptions,
  type BattlePhase,
  type BattleReason,
  type BattleResult,
  type DuelOutcome,
  type DuelRecord,
  type DuelState,
  type FinalReason,
  type Lane,
  type LaneState,
  type Side,
  type SquadRemaining,
  type SquadState,
  type SquadStatus,
  type Squad,
  type UnitRef,
  type UnitState,
  type UnitStatus,
} from './types';

type C = 0 | 1;

const ticksOf = (seconds: number) => Math.round(seconds / CLOCK.tick);
const DUEL_TICKS = ticksOf(CLOCK.duelSeconds);
const LANE_TICKS = ticksOf(CLOCK.laneSeconds);
const FINAL_TICKS = ticksOf(CLOCK.finalSeconds);
// Charge counts in spd-per-tick units so a speed-1 soldier reaches exactly 10, not 0.1 × 10 ≈ 0.9999.
const CHARGE_FULL = ticksOf(1);
const REACH2 = FIELD.reach * FIELD.reach;
const LANE_Z: Record<Lane, number> = { top: -FIELD.laneGap, mid: 0, bottom: FIELD.laneGap };

export function hitDamage(atk: number, u1: number, u2: number): { damage: number; crit: boolean } {
  const crit = u2 < LUCK.critChance;
  const luck = LUCK.hitMin + (LUCK.hitMax - LUCK.hitMin) * u1;
  return { damage: ARMY.attack * atk * luck * (crit ? LUCK.critMul : 1), crit };
}

export function guardDamage(raw: number, shield: boolean, guard: number): { damage: number; blocked: number } {
  const damage = (shield ? raw * (1 - EFFECTS.shieldCut) : raw) * guard;
  return { damage, blocked: raw - damage };
}

/**
 * Extra damage a linked soldier takes on top of the hit. It stays on the target: splitting the hit
 * with allies spread it thin and made cycles a shield, and handing the extra to allies only worked
 * in small repos, where one cycle covers many soldiers of the same fight.
 */
export function chainExtra(damage: number, r: number): number {
  return damage * EFFECTS.chainShare * r;
}

export function cloneBurst(maxHp: number, d: number): number {
  return maxHp * EFFECTS.cloneBurst * d;
}

class Unit implements UnitState {
  lane: Lane | null = null;
  status: UnitStatus = 'queued';
  x = 0;
  z = 0;
  hp: number;
  alive = true;
  target: Unit | null = null;
  charge = 0;
  pending = 0;
  marked = false;
  nx = 0;
  nz = 0;
  /** Canonical sort position: soldiers by index, commander last. */
  readonly order: number;

  constructor(
    readonly c: C,
    readonly side: Side,
    readonly index: number,
    readonly key: string,
    readonly role: 'soldier' | 'commander',
    readonly squad: number,
    readonly maxHp: number,
    readonly atk: number,
    readonly spd: number,
    readonly r: number,
    readonly chainGroup: number,
    readonly d: number,
    readonly cloneGroup: number,
    readonly shield: boolean,
    readonly guard: number,
    /** Walking speed: the squad's mean, so a squad arrives together whatever its members' spread. */
    readonly march: number,
  ) {
    this.hp = maxHp;
    this.order = index === COMMANDER ? ARMY.soldiers : index;
    // Staggered first swing: equal-speed soldiers swinging in step overkill the same targets, which
    // cost evenly built (big-repo) armies against mixed ones.
    this.charge = ((this.order * 37) % 100) / 10;
  }
}

class SquadRt implements SquadState {
  status: SquadStatus = 'queued';
  wins = 0;
  readonly lane: Lane;

  constructor(
    readonly c: C,
    readonly side: Side,
    readonly index: number,
    readonly info: Squad,
    readonly units: Unit[],
  ) {
    this.lane = info.lane;
  }

  alive(): number {
    let n = 0;
    for (const u of this.units) if (u.alive) n++;
    return n;
  }

  remaining(): SquadRemaining {
    let hp = 0;
    let max = 0;
    for (const u of this.units) {
      hp += u.hp;
      max += u.maxHp;
    }
    return { soldiers: this.alive(), hp: hp / max };
  }
}

class DuelRt implements DuelState {
  constructor(
    readonly id: number,
    readonly lane: Lane,
    readonly squads: Record<Side, number>,
    readonly startTick: number,
    readonly sq: [SquadRt, SquadRt],
  ) {}
}

class LaneRt implements LaneState {
  duel: DuelRt | null = null;
  clearedBy: Side | null = null;

  constructor(
    readonly lane: Lane,
    readonly q: [number[], number[]],
    readonly queues: Record<Side, number[]>,
  ) {}
}

/** Slowest walking speed per chain group among `units`. */
function slowestMarch(units: Unit[]): Map<number, number> | null {
  let map: Map<number, number> | null = null;
  for (const u of units) {
    if (u.chainGroup < 0) continue;
    map ??= new Map();
    const slowest = map.get(u.chainGroup);
    if (slowest === undefined || u.march < slowest) map.set(u.chainGroup, u.march);
  }
  return map;
}

const ref = (u: Unit): UnitRef => ({ side: u.side, index: u.index });

class BattleRun implements Battle {
  tick = 0;
  phase: BattlePhase = 'lanes';
  readonly armies: Record<Side, Army>;
  readonly soldiers: Record<Side, Unit[]>;
  readonly commanders: Record<Side, Unit>;
  readonly squads: Record<Side, SquadRt[]>;
  readonly lanes: LaneRt[];
  readonly duels: DuelRecord[] = [];
  readonly events: BattleEvent[] = [];

  private readonly units: [Unit[], Unit[]];
  private readonly cmd: [Unit, Unit];
  private readonly sq: [SquadRt[], SquadRt[]];
  private readonly clones: [Map<number, Unit[]>, Map<number, Unit[]>];
  private readonly startHp: [number, number];
  private readonly record: boolean;
  /**
   * Each army's hit-rate roll for the whole battle. Per-attack rolls average out over thousands of
   * hits and left every war to hair-thin stat gaps; one roll per army keeps upsets possible.
   */
  private readonly form: [number, number];
  /**
   * Matches come in pairs (1-2, 3-4, …) on one seed with the two sides' rolls swapped, so over a
   * pair both armies get exactly the same luck and a repo against itself splits every pair.
   */
  private readonly salt: [number, number];
  private finalUnits: [Unit[], Unit[]] = [[], []];
  private final: { tick: number; reason: FinalReason } = { tick: 0, reason: 'lane-time' };
  private touched: Unit[] = [];
  /** Per side, the fighters' positions as x0, z0, x1, z1, … for the nearest-foe scans. */
  private readonly pos: [Float64Array, Float64Array] = [new Float64Array(2 * ARMY.soldiers + 2), new Float64Array(2 * ARMY.soldiers + 2)];
  private nearestD2 = 0;
  private duelCount = 0;
  private res: BattleResult | null = null;

  constructor(
    armies: [Army, Army],
    private readonly sides: [Side, Side],
    readonly match: number,
    readonly seed: number,
    opts: BattleOptions,
  ) {
    this.record = opts.record === true;
    this.salt = match % 2 === 1 ? [0, 1] : [1, 0];
    this.form = [rollFor(seed, 0, 'form', this.salt[0]), rollFor(seed, 0, 'form', this.salt[1])];
    this.armies = this.pair((c) => armies[c]);
    this.units = [this.makeUnits(armies[0], 0), this.makeUnits(armies[1], 1)];
    this.cmd = [this.makeCommander(armies[0], 0), this.makeCommander(armies[1], 1)];
    this.sq = [this.makeSquads(armies[0], 0), this.makeSquads(armies[1], 1)];
    this.clones = [this.cloneIndex(0), this.cloneIndex(1)];
    this.startHp = [this.totalHp(0), this.totalHp(1)];
    this.soldiers = this.pair((c) => this.units[c]);
    this.commanders = this.pair((c) => this.cmd[c]);
    this.squads = this.pair((c) => this.sq[c]);
    this.lanes = LANES.map((lane) => {
      const q: [number[], number[]] = [[...armies[0].lanes[lane]], [...armies[1].lanes[lane]]];
      return new LaneRt(lane, q, this.pair((c) => q[c]));
    });
    for (const lane of this.lanes) this.nextDuel(lane);
  }

  get done(): boolean {
    return this.phase === 'done';
  }

  result(): BattleResult | null {
    return this.res;
  }

  run(): BattleResult {
    while (this.phase !== 'done') this.step();
    return this.res!;
  }

  step(): void {
    if (this.phase === 'done') return;
    this.tick++;
    if (this.phase === 'lanes') {
      for (const lane of this.lanes) {
        const d = lane.duel;
        if (d) this.fight(lane.lane, d.sq[0].units, d.sq[1].units);
      }
    } else {
      this.fight('final', this.finalUnits[0], this.finalUnits[1]);
    }
    const deaths = this.applyPending('hit');
    if (deaths.length > 0) this.burstClones(deaths);
    if (this.phase === 'lanes') this.updateLanes();
    else this.checkEnd();
  }

  private pair<T>(f: (c: C) => T): Record<Side, T> {
    // Keys in canonical order so a swapped battle serialises as an exact mirror.
    const out = {} as Record<Side, T>;
    out[this.sides[0]] = f(0);
    out[this.sides[1]] = f(1);
    return out;
  }

  private makeUnits(army: Army, c: C): Unit[] {
    return army.soldiers.map(
      (s) =>
        new Unit(c, this.sides[c], s.index, s.key, 'soldier', s.squad, ARMY.hp, s.atk, s.spd, s.r, s.chainGroup, s.d, s.cloneGroup, s.shield, 1, army.squads[s.squad].spd),
    );
  }

  private makeCommander(army: Army, c: C): Unit {
    const k = army.commander;
    const u = new Unit(c, this.sides[c], COMMANDER, k.key, 'commander', -1, k.hp, k.atk, k.spd, 0, -1, 0, -1, false, k.guard, k.spd);
    u.status = 'waiting';
    return u;
  }

  private makeSquads(army: Army, c: C): SquadRt[] {
    return army.squads.map((s) => {
      const units = this.units[c].slice(s.from, s.to);
      for (const u of units) u.lane = s.lane;
      return new SquadRt(c, this.sides[c], s.index, s, units);
    });
  }

  private cloneIndex(c: C): Map<number, Unit[]> {
    const map = new Map<number, Unit[]>();
    for (const u of this.units[c]) {
      if (u.cloneGroup < 0) continue;
      const list = map.get(u.cloneGroup);
      if (list) list.push(u);
      else map.set(u.cloneGroup, [u]);
    }
    return map;
  }

  private totalHp(c: C): number {
    let hp = 0;
    for (const u of this.units[c]) if (u.alive) hp += u.hp;
    return hp + this.cmd[c].hp;
  }

  private emit(e: BattleEvent): void {
    if (this.record) this.events.push(e);
  }

  private placeSquad(sq: SquadRt): void {
    const cols = FIELD.columns;
    const z0 = LANE_Z[sq.lane];
    sq.units.forEach((u, j) => {
      const base = FIELD.startX + Math.floor(j / cols) * FIELD.spacing;
      u.x = sq.c === 0 ? -base : base;
      u.z = z0 + ((j % cols) - (cols - 1) / 2) * FIELD.spacing;
      u.target = null;
      if (u.alive) u.status = 'fighting';
    });
  }

  /** Nearest of `foes`, whose positions are mirrored in `pos` as x0, z0, x1, z1, … */
  private nearest(u: Unit, foes: Unit[], pos: Float64Array): Unit {
    let best = 0;
    let bd = Infinity;
    const ux = u.x;
    const uz = u.z;
    for (let i = 0, n = foes.length; i < n; i++) {
      const dx = pos[2 * i] - ux;
      const dz = pos[2 * i + 1] - uz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd || (d2 === bd && foes[i].key < foes[best].key)) {
        best = i;
        bd = d2;
      }
    }
    this.nearestD2 = bd;
    return foes[best];
  }

  private snapshot(c: C, units: Unit[]): Float64Array {
    const pos = this.pos[c];
    for (let i = 0; i < units.length; i++) {
      pos[2 * i] = units[i].x;
      pos[2 * i + 1] = units[i].z;
    }
    return pos;
  }

  private fight(arena: Arena, side0: Unit[], side1: Unit[]): void {
    const P: [Unit[], Unit[]] = [side0.filter((u) => u.alive), side1.filter((u) => u.alive)];
    if (P[0].length === 0 || P[1].length === 0) return;
    const slowest = [slowestMarch(P[0]), slowestMarch(P[1])];
    let pos = [this.snapshot(0, P[0]), this.snapshot(1, P[1])];

    for (let c = 0; c < 2; c++) {
      const foes = P[1 - c];
      const groups = slowest[c];
      for (const u of P[c]) {
        const t = u.target && u.target.alive ? u.target : this.nearest(u, foes, pos[1 - c]);
        u.nx = u.x;
        u.nz = u.z;
        const dx = t.x - u.x;
        const dz = t.z - u.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist <= FIELD.hold) continue;
        let spd = u.march;
        if (groups && u.chainGroup >= 0 && u.r > 0) spd = u.march * (1 - u.r) + groups.get(u.chainGroup)! * u.r;
        const m = Math.min(FIELD.moveSpeed * spd * CLOCK.tick, dist - FIELD.hold);
        u.nx = u.x + (dx / dist) * m;
        u.nz = u.z + (dz / dist) * m;
      }
    }
    for (const list of P) {
      for (const u of list) {
        u.x = u.nx;
        u.z = u.nz;
      }
    }

    pos = [this.snapshot(0, P[0]), this.snapshot(1, P[1])];
    for (let c = 0; c < 2; c++) {
      const foes = P[1 - c];
      for (const u of P[c]) {
        const t = this.nearest(u, foes, pos[1 - c]);
        u.target = t;
        if (this.nearestD2 > REACH2) continue;
        u.charge += u.spd;
        if (u.charge < CHARGE_FULL) continue;
        u.charge -= CHARGE_FULL;
        this.attack(arena, u, t);
      }
    }
  }

  private attack(arena: Arena, u: Unit, t: Unit): void {
    const u1 = this.form[u.c];
    const u2 = rollFor(this.seed, this.tick, u.key, this.salt[u.c] + 2);
    const hit = hitDamage(u.atk, u1, u2);
    const g = guardDamage(hit.damage, t.shield, t.guard);
    this.emit({ kind: 'hit', tick: this.tick, arena, attacker: ref(u), target: ref(t), damage: g.damage, crit: hit.crit, blocked: g.blocked });
    this.hurt(t, g.damage);
    const extra = chainExtra(g.damage, t.r);
    if (extra <= 0) return;
    this.hurt(t, extra);
    this.emit({ kind: 'chain', tick: this.tick, arena, from: ref(t), target: ref(t), damage: extra });
  }

  private hurt(u: Unit, amount: number): void {
    if (!u.marked) {
      u.marked = true;
      u.pending = 0;
      this.touched.push(u);
    }
    u.pending += amount;
  }

  private applyPending(cause: 'hit' | 'clone'): Unit[] {
    const deaths: Unit[] = [];
    for (const u of this.touched) {
      u.hp -= u.pending;
      u.pending = 0;
      u.marked = false;
      if (u.hp <= 0) deaths.push(u);
    }
    this.touched = [];
    deaths.sort((x, y) => x.c - y.c || x.order - y.order);
    for (const u of deaths) {
      u.hp = 0;
      u.alive = false;
      u.status = 'dead';
      u.target = null;
      this.emit({ kind: 'death', tick: this.tick, unit: ref(u), cause });
      if (u.role === 'commander') this.emit({ kind: 'commander-down', tick: this.tick, side: u.side });
    }
    return deaths;
  }

  private burstClones(deaths: Unit[]): void {
    for (const dead of deaths) {
      if (dead.role !== 'soldier' || dead.d <= 0) continue;
      // The burst is the dead soldier's own share split among its copies, or among its squad when no
      // copy is left: small chunks sit in many small groups, big chunks rarely share one, so a
      // per-copy burst would make the same duplication hurt small repos far more.
      let hit = (this.clones[dead.c].get(dead.cloneGroup) ?? []).filter((m) => m.alive);
      if (hit.length === 0) hit = this.sq[dead.c][dead.squad].units.filter((m) => m.alive);
      if (hit.length === 0) continue;
      const amount = cloneBurst(dead.maxHp, dead.d) / hit.length;
      for (const m of hit) {
        this.hurt(m, amount);
        this.emit({ kind: 'clone', tick: this.tick, source: ref(dead), target: ref(m), damage: amount });
      }
    }
    if (this.touched.length > 0) this.applyPending('clone');
  }

  private updateLanes(): void {
    for (const lane of this.lanes) {
      const d = lane.duel;
      if (!d) continue;
      const alive0 = d.sq[0].alive();
      const alive1 = d.sq[1].alive();
      if (alive0 === 0 || alive1 === 0) {
        this.endDuel(lane, alive0 + alive1 === 0 ? 'both-down' : 'rout', alive0 > 0 ? 0 : alive1 > 0 ? 1 : -1);
      } else if (this.tick - d.startTick >= DUEL_TICKS) {
        const win = this.compare(d.sq[0].remaining().hp, d.sq[1].remaining().hp);
        this.endDuel(lane, win === -1 ? 'both-retreat' : 'timeout', win);
      }
    }
    const active = this.lanes.some((l) => l.duel !== null);
    if (active && this.tick < LANE_TICKS) return;
    let reason: FinalReason = 'lane-time';
    if (!active) reason = this.laneSquads(0) === 0 || this.laneSquads(1) === 0 ? 'wiped' : 'lanes-idle';
    for (const lane of this.lanes) if (lane.duel) this.endDuel(lane, 'cut', -1);
    this.startFinal(reason);
  }

  /** Winner by ratio, or -1 within the tie margin. */
  private compare(r0: number, r1: number): C | -1 {
    if (Math.abs(r0 - r1) <= CLOCK.tieMargin) return -1;
    return r0 > r1 ? 0 : 1;
  }

  private endDuel(lane: LaneRt, outcome: DuelOutcome, win: C | -1): void {
    const d = lane.duel!;
    const remaining = this.pair((c) => d.sq[c].remaining());
    if (win !== -1) d.sq[win].wins++;
    for (const c of [0, 1] as const) {
      const sq = d.sq[c];
      for (const u of sq.units) u.target = null;
      if (c === win || outcome === 'cut') continue;
      const alive = sq.alive() > 0;
      sq.status = alive ? 'retreated' : 'destroyed';
      for (const u of sq.units) {
        if (!u.alive) continue;
        u.status = 'retreated';
        u.lane = null;
      }
      lane.q[c].shift();
    }
    const record: DuelRecord = {
      id: d.id,
      lane: d.lane,
      squads: d.squads,
      startTick: d.startTick,
      endTick: this.tick,
      outcome,
      winner: win !== -1 ? this.sides[win] : null,
      streak: win !== -1 ? d.sq[win].wins : 0,
      remaining,
    };
    this.duels.push(record);
    this.emit({
      kind: 'duel-end',
      tick: this.tick,
      duel: d.id,
      lane: d.lane,
      squads: d.squads,
      outcome,
      winner: record.winner,
      streak: record.streak,
      remaining,
    });
    lane.duel = null;
    if (outcome !== 'cut') this.nextDuel(lane);
  }

  private nextDuel(lane: LaneRt): void {
    for (const c of [0, 1] as const) {
      const q = lane.q[c];
      while (q.length > 0 && this.sq[c][q[0]].alive() === 0) {
        this.sq[c][q[0]].status = 'destroyed';
        q.shift();
      }
    }
    const has0 = lane.q[0].length > 0;
    const has1 = lane.q[1].length > 0;
    if (has0 && has1) {
      const pair: [SquadRt, SquadRt] = [this.sq[0][lane.q[0][0]], this.sq[1][lane.q[1][0]]];
      for (const sq of pair) {
        if (sq.status === 'fighting') continue;
        sq.status = 'fighting';
        this.placeSquad(sq);
      }
      const d = new DuelRt(this.duelCount++, lane.lane, this.pair((c) => pair[c].index), this.tick, pair);
      lane.duel = d;
      this.emit({ kind: 'duel-start', tick: this.tick, duel: d.id, lane: lane.lane, squads: d.squads });
      return;
    }
    if (!(has0 || has1) || lane.clearedBy !== null) return;
    const c: C = has0 ? 0 : 1;
    lane.clearedBy = this.sides[c];
    for (const s of lane.q[c]) {
      const sq = this.sq[c][s];
      sq.status = 'waiting';
      for (const u of sq.units) if (u.alive) u.status = 'waiting';
    }
    this.emit({ kind: 'lane-clear', tick: this.tick, lane: lane.lane, side: this.sides[c] });
  }

  private laneSquads(c: C): number {
    let n = 0;
    for (const sq of this.sq[c]) {
      if ((sq.status === 'queued' || sq.status === 'fighting' || sq.status === 'waiting') && sq.alive() > 0) n++;
    }
    return n;
  }

  private startFinal(reason: FinalReason): void {
    this.phase = 'final';
    this.final = { tick: this.tick, reason };
    const W = FIELD.finalRowWidth;
    for (const c of [0, 1] as const) {
      const alive = this.units[c].filter((u) => u.alive);
      alive.forEach((u, j) => {
        const base = FIELD.startX + Math.floor(j / W) * FIELD.spacing;
        u.x = c === 0 ? -base : base;
        u.z = ((j % W) - (W - 1) / 2) * FIELD.spacing;
        u.status = 'final';
        u.lane = null;
        u.target = null;
      });
      const k = this.cmd[c];
      const back = FIELD.startX + (Math.floor((alive.length + W - 1) / W) + 1) * FIELD.spacing;
      k.x = c === 0 ? -back : back;
      k.z = 0;
      k.status = 'final';
      for (const sq of this.sq[c]) sq.status = sq.alive() > 0 ? 'final' : 'destroyed';
      this.finalUnits[c] = [...alive, k];
    }
    this.emit({ kind: 'final-start', tick: this.tick, reason, soldiers: this.pair((c) => this.finalUnits[c].length - 1) });
  }

  private hpRatio(c: C): number {
    return this.totalHp(c) / this.startHp[c];
  }

  private checkEnd(): void {
    const down0 = !this.cmd[0].alive;
    const down1 = !this.cmd[1].alive;
    if (down0 && down1) this.finish(this.compare(this.hpRatio(0), this.hpRatio(1)), 'commander');
    else if (down0 || down1) this.finish(down0 ? 1 : 0, 'commander');
    else if (this.tick - this.final.tick >= FINAL_TICKS) this.finish(this.compare(this.hpRatio(0), this.hpRatio(1)), 'timeout');
  }

  private finish(win: C | -1, why: BattleReason): void {
    this.phase = 'done';
    const reason: BattleReason = win === -1 ? 'draw' : why;
    const winner = win === -1 ? null : this.sides[win];
    const hpRatio = this.pair((c) => this.hpRatio(c));
    this.emit({ kind: 'battle-end', tick: this.tick, winner, reason, hpRatio });
    this.res = {
      ruleVersion: RULE_VERSION,
      match: this.match,
      seed: this.seed,
      winner,
      reason,
      ticks: this.tick,
      final: this.final,
      survivors: this.pair((c) => this.units[c].filter((u) => u.alive).length),
      commanderHp: this.pair((c) => this.cmd[c].hp),
      hpRatio,
      duels: this.duels,
      events: this.events,
    };
  }
}

/** Canonical order: sides sorted by army id so A-vs-B and B-vs-A run the exact same arithmetic. */
export function createBattleFromArmies(a: Army, b: Army, match: number, opts: BattleOptions = {}): Battle {
  const swapped = b.id < a.id;
  const armies: [Army, Army] = swapped ? [b, a] : [a, b];
  const sides: [Side, Side] = swapped ? ['b', 'a'] : ['a', 'b'];
  return new BattleRun(armies, sides, match, battleSeed(a.id, b.id, (match + (match % 2)) / 2), opts);
}

export function createBattle(a: Quality, b: Quality, match: number, opts: BattleOptions = {}): Battle {
  return createBattleFromArmies(buildArmy(a), buildArmy(b), match, opts);
}

export function simulate(a: Quality, b: Quality, match: number, opts: BattleOptions = {}): BattleResult {
  return createBattle(a, b, match, opts).run();
}
