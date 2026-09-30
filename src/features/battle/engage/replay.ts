import { ARMY, FIELD } from '../../../engine/battle/rules';
import { createBattle, type Battle, type BattleEvent, type Lane, type Side } from '../../../engine/battle/sim';
import type { Quality } from '../../../engine/battle/types';
import { advance, blend, createClock, isDone, seek, setSpeed, syncBattle, targetTick, togglePause, type Clock, type Speed } from './clock';

export const SIDES: readonly Side[] = ['a', 'b'];
/** Slot of the commander in per-side unit arrays (soldiers use 0..ARMY.soldiers-1). */
export const CMD_SLOT = ARMY.soldiers;
export const SLOTS = ARMY.soldiers + 1;

export const LANE_Z: Record<Lane, number> = { top: -FIELD.laneGap, mid: 0, bottom: FIELD.laneGap };

/** Where squads that are not on the field wait: behind their side's start line, one slot per queue position. */
export const STAGE = { x: 17, slot: 5, gap: 0.9 } as const;
export const COMMANDER_REST_X = STAGE.x + STAGE.slot * 5 + 2;

export const MODE_FIELD = 0;
export const MODE_STAGED = 1;
export const MODE_DEAD = 2;

export interface SideFrame {
  x: Float32Array;
  z: Float32Array;
  mode: Uint8Array;
}

export type Frame = Record<Side, SideFrame>;

const makeSide = (): SideFrame => ({ x: new Float32Array(SLOTS), z: new Float32Array(SLOTS), mode: new Uint8Array(SLOTS) });
export const makeFrame = (): Frame => ({ a: makeSide(), b: makeSide() });

function copyFrame(from: Frame, to: Frame): void {
  for (const s of SIDES) {
    to[s].x.set(from[s].x);
    to[s].z.set(from[s].z);
    to[s].mode.set(from[s].mode);
  }
}

/** −1 when the side starts on the left (−x). Read from the sim's own first placement, not re-derived. */
export function sideSign(battle: Battle, side: Side): number {
  const u = battle.soldiers[side].find((s) => s.status === 'fighting');
  return u && u.x > 0 ? 1 : -1;
}

/**
 * Display positions for one tick. Units on the field use the sim's x/z as-is; units the sim has not placed yet
 * (queued), or that left the field (retreated), stand in their queue slot behind the line.
 */
export function readFrame(battle: Battle, sign: Record<Side, number>, placed: Record<Side, Uint8Array>, out: Frame): void {
  for (const side of SIDES) {
    const f = out[side];
    const squads = battle.squads[side];
    const pl = placed[side];
    for (const u of battle.soldiers[side]) {
      const i = u.index;
      if (u.status === 'fighting' || u.status === 'final') pl[i] = 1;
      const onField = u.status === 'fighting' || u.status === 'final' || (u.status === 'waiting' && pl[i] === 1) || (u.status === 'dead' && pl[i] === 1);
      if (onField) {
        f.x[i] = u.x;
        f.z[i] = u.z;
        f.mode[i] = u.alive ? MODE_FIELD : MODE_DEAD;
        continue;
      }
      const sq = squads[u.squad].info;
      const j = i - sq.from;
      const back = STAGE.x + Math.max(0, sq.order - 1) * STAGE.slot + Math.floor(j / FIELD.columns) * STAGE.gap;
      f.x[i] = sign[side] * back;
      f.z[i] = LANE_Z[sq.lane] + ((j % FIELD.columns) - (FIELD.columns - 1) / 2) * STAGE.gap;
      f.mode[i] = u.alive ? MODE_STAGED : MODE_DEAD;
    }
    const k = battle.commanders[side];
    const inFinal = k.status === 'final' || (k.status === 'dead' && battle.phase !== 'lanes');
    f.x[CMD_SLOT] = inFinal ? k.x : sign[side] * COMMANDER_REST_X;
    f.z[CMD_SLOT] = inFinal ? k.z : 0;
    f.mode[CMD_SLOT] = k.alive ? MODE_FIELD : MODE_DEAD;
  }
}

/** Farther than any sim move in one tick: the unit was placed, so draw it at the new spot instead of sliding. */
const SNAP2 = 1.5 * 1.5;

export function blendedPos(prev: SideFrame, cur: SideFrame, i: number, t: number): [number, number] {
  const dx = cur.x[i] - prev.x[i];
  const dz = cur.z[i] - prev.z[i];
  if (prev.mode[i] !== cur.mode[i] && cur.mode[i] !== MODE_DEAD) return [cur.x[i], cur.z[i]];
  if (dx * dx + dz * dz > SNAP2) return [cur.x[i], cur.z[i]];
  return [prev.x[i] + dx * t, prev.z[i] + dz * t];
}

/** Replays a battle whose outcome is already fixed, one sim step per 0.1 s of playback. */
export class Replay {
  readonly battle: Battle;
  clock: Clock;
  readonly prev = makeFrame();
  readonly cur = makeFrame();
  readonly sign: Record<Side, number>;
  private readonly placed: Record<Side, Uint8Array> = { a: new Uint8Array(SLOTS), b: new Uint8Array(SLOTS) };
  private cursor = 0;
  /** True when the last update stepped several ticks at once (skip), so effects should stay quiet. */
  jumped = false;

  constructor(a: Quality, b: Quality, match: number, end: number, readonly finalTick: number) {
    this.battle = createBattle(a, b, match, { record: true });
    this.clock = createClock(end);
    this.sign = { a: sideSign(this.battle, 'a'), b: sideSign(this.battle, 'b') };
    readFrame(this.battle, this.sign, this.placed, this.cur);
    copyFrame(this.cur, this.prev);
  }

  get blend(): number {
    return blend(this.clock);
  }

  get done(): boolean {
    return isDone(this.clock);
  }

  /** Advances playback; returns true when the sim moved to a new tick or playback just ended. */
  update(dtSeconds: number): boolean {
    const wasDone = this.done;
    this.clock = advance(this.clock, dtSeconds);
    const moved = this.sync();
    return moved || this.done !== wasDone;
  }

  togglePause(): void {
    this.clock = togglePause(this.clock);
  }

  setSpeed(speed: Speed): void {
    this.clock = setSpeed(this.clock, speed);
  }

  skipToFinal(): boolean {
    this.clock = seek(this.clock, this.finalTick);
    return this.sync();
  }

  /** Events the sim produced since the last drain. */
  drain(): BattleEvent[] {
    const all = this.battle.events;
    const out = all.slice(this.cursor);
    this.cursor = all.length;
    return out;
  }

  private sync(): boolean {
    const steps = syncBattle(this.battle, targetTick(this.clock), () => {
      readFrame(this.battle, this.sign, this.placed, this.cur);
      copyFrame(this.cur, this.prev);
    });
    if (steps > 0) readFrame(this.battle, this.sign, this.placed, this.cur);
    this.jumped = steps > 3;
    return steps > 0;
  }
}
