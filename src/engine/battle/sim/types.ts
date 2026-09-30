export type Side = 'a' | 'b';
export type Lane = 'top' | 'mid' | 'bottom';
export type Arena = Lane | 'final';
export type SquadBody = 'heavy' | 'sprint';
export type SquadGear = 'link' | 'shield' | 'mirror' | 'burn';

/** Soldier index used for a side's commander in unit references. */
export const COMMANDER = -1;

export interface Soldier {
  index: number;
  /** `${home}#${index}`: stable identity for rolls and tie-breaks. */
  key: string;
  home: string;
  /** Code lines [start, end) of the concatenated production code. */
  start: number;
  end: number;
  atk: number;
  spd: number;
  /** Share of lines inside cycles, and the cycle holding most of them (-1 if none). */
  r: number;
  chainGroup: number;
  /** Share of removable duplicate lines, and the most frequent clone group (-1 if none). */
  d: number;
  cloneGroup: number;
  shield: boolean;
  burn: number;
  squad: number;
}

export interface Squad {
  index: number;
  name: string;
  body: SquadBody;
  gear: SquadGear[];
  atk: number;
  spd: number;
  power: number;
  lane: Lane;
  /** Position in the lane queue, 0 = first to fight. */
  order: number;
  /** Soldier indexes [from, to). */
  from: number;
  to: number;
}

export interface Commander {
  key: string;
  display: string;
  files: string[];
  atk: number;
  spd: number;
  hp: number;
  /** Damage taken is multiplied by this (1 − 0.3 × tests). */
  guard: number;
}

export interface Army {
  /** `${name}@${fingerprint}`: canonical side order and battle seed use this. */
  id: string;
  name: string;
  lines: number;
  tests: number;
  soldiers: Soldier[];
  squads: Squad[];
  commander: Commander;
  lanes: Record<Lane, number[]>;
}

export interface UnitRef {
  side: Side;
  /** Soldier index, or COMMANDER. */
  index: number;
}

export type UnitStatus = 'queued' | 'fighting' | 'waiting' | 'retreated' | 'final' | 'dead';
export type SquadStatus = 'queued' | 'fighting' | 'waiting' | 'retreated' | 'destroyed' | 'final';
export type BattlePhase = 'lanes' | 'final' | 'done';

export interface UnitState {
  readonly side: Side;
  readonly index: number;
  readonly key: string;
  readonly role: 'soldier' | 'commander';
  readonly squad: number;
  readonly lane: Lane | null;
  readonly status: UnitStatus;
  readonly x: number;
  readonly z: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  readonly target: UnitState | null;
}

export interface SquadState {
  readonly side: Side;
  readonly index: number;
  readonly info: Squad;
  readonly lane: Lane;
  readonly status: SquadStatus;
  /** Consecutive duel wins so far. */
  readonly wins: number;
}

export interface DuelState {
  readonly id: number;
  readonly lane: Lane;
  readonly squads: Record<Side, number>;
  readonly startTick: number;
}

export interface LaneState {
  readonly lane: Lane;
  /** Squad indexes still to fight in this lane, head first (the head is fighting or waiting). */
  readonly queues: Record<Side, readonly number[]>;
  readonly duel: DuelState | null;
  /** Side that beat every enemy squad here, once decided. */
  readonly clearedBy: Side | null;
}

export type DuelOutcome = 'rout' | 'timeout' | 'both-down' | 'both-retreat' | 'cut';

export interface SquadRemaining {
  soldiers: number;
  /** Squad hp ÷ squad max hp. */
  hp: number;
}

export interface DuelRecord {
  id: number;
  lane: Lane;
  squads: Record<Side, number>;
  startTick: number;
  endTick: number;
  outcome: DuelOutcome;
  winner: Side | null;
  /** Winner squad's consecutive wins including this one (0 without a winner). */
  streak: number;
  remaining: Record<Side, SquadRemaining>;
}

export type FinalReason = 'wiped' | 'lanes-idle' | 'lane-time';
export type BattleReason = 'commander' | 'timeout' | 'draw';

export interface HitEvent {
  kind: 'hit';
  tick: number;
  arena: Arena;
  attacker: UnitRef;
  target: UnitRef;
  /** Damage after shield/commander guard, before chain sharing. */
  damage: number;
  crit: boolean;
  /** Damage the target's tests (shield or commander guard) absorbed. */
  blocked: number;
}

export interface ChainEvent {
  kind: 'chain';
  tick: number;
  arena: Arena;
  from: UnitRef;
  target: UnitRef;
  damage: number;
}

export interface CloneEvent {
  kind: 'clone';
  tick: number;
  source: UnitRef;
  target: UnitRef;
  damage: number;
}

export interface DeathEvent {
  kind: 'death';
  tick: number;
  unit: UnitRef;
  cause: 'hit' | 'clone';
}

export interface DuelStartEvent {
  kind: 'duel-start';
  tick: number;
  duel: number;
  lane: Lane;
  squads: Record<Side, number>;
}

export interface DuelEndEvent {
  kind: 'duel-end';
  tick: number;
  duel: number;
  lane: Lane;
  squads: Record<Side, number>;
  outcome: DuelOutcome;
  winner: Side | null;
  streak: number;
  remaining: Record<Side, SquadRemaining>;
}

export interface LaneClearEvent {
  kind: 'lane-clear';
  tick: number;
  lane: Lane;
  side: Side;
}

export interface FinalStartEvent {
  kind: 'final-start';
  tick: number;
  reason: FinalReason;
  soldiers: Record<Side, number>;
}

export interface CommanderDownEvent {
  kind: 'commander-down';
  tick: number;
  side: Side;
}

export interface BattleEndEvent {
  kind: 'battle-end';
  tick: number;
  winner: Side | null;
  reason: BattleReason;
  hpRatio: Record<Side, number>;
}

export type BattleEvent =
  | HitEvent
  | ChainEvent
  | CloneEvent
  | DeathEvent
  | DuelStartEvent
  | DuelEndEvent
  | LaneClearEvent
  | FinalStartEvent
  | CommanderDownEvent
  | BattleEndEvent;

export interface BattleResult {
  ruleVersion: string;
  match: number;
  seed: number;
  winner: Side | null;
  reason: BattleReason;
  ticks: number;
  final: { tick: number; reason: FinalReason };
  /** Living soldiers (commander excluded). */
  survivors: Record<Side, number>;
  commanderHp: Record<Side, number>;
  /** Remaining hp (commander included) ÷ starting hp. */
  hpRatio: Record<Side, number>;
  duels: DuelRecord[];
  /** Filled only with `record: true`. */
  events: BattleEvent[];
}

export interface BattleOptions {
  record?: boolean;
}

export interface Battle {
  readonly match: number;
  readonly seed: number;
  readonly tick: number;
  readonly phase: BattlePhase;
  readonly done: boolean;
  readonly armies: Record<Side, Army>;
  readonly soldiers: Record<Side, readonly UnitState[]>;
  readonly commanders: Record<Side, UnitState>;
  readonly squads: Record<Side, readonly SquadState[]>;
  readonly lanes: readonly LaneState[];
  readonly duels: readonly DuelRecord[];
  readonly events: readonly BattleEvent[];
  /** Advances one tick (0.1 s); no-op once done. */
  step(): void;
  /** Steps to the end and returns the result. */
  run(): BattleResult;
  /** The result once done, else null. */
  result(): BattleResult | null;
}

export interface Prediction {
  runs: number;
  aWins: number;
  bWins: number;
  draws: number;
}

export type VictoryLabel = 'skill' | 'close' | 'upset';
