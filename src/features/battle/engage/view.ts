import { formatTime, squadLabel, type CommentaryEntry } from '../../../engine/battle/commentary';
import { type Arena, type Battle, type Side } from '../../../engine/battle/sim';
import { SIDES } from './replay';

export type Filter = 'all' | 'highlight' | Side;

export interface HudModel {
  title: string;
  subtitle: string;
  /** Squads with at least one living soldier. */
  remaining: Record<Side, number>;
  time: string;
  phase: Battle['phase'];
}

const COUNT_WORD = ['', '한', '두', '세'];

export function remainingSquads(battle: Battle, side: Side): number {
  const alive = new Uint8Array(battle.squads[side].length);
  for (const u of battle.soldiers[side]) if (u.alive) alive[u.squad] = 1;
  let n = 0;
  for (const v of alive) n += v;
  return n;
}

/** Deepest duel reached in any lane, 1-based. */
export function roundOf(battle: Battle): number {
  let round = 1;
  for (const lane of battle.lanes) {
    let n = lane.duel ? 1 : 0;
    for (const d of battle.duels) if (d.lane === lane.lane && d.outcome !== 'cut') n++;
    round = Math.max(round, n);
  }
  return round;
}

export function hudModel(battle: Battle): HudModel {
  const remaining = { a: remainingSquads(battle, 'a'), b: remainingSquads(battle, 'b') };
  const time = formatTime(battle.tick);
  if (battle.phase === 'final') {
    return { title: '최종전', subtitle: '장수와 남은 병사가 가운데에서 싸우는 중', remaining, time, phase: battle.phase };
  }
  if (battle.phase === 'done') {
    return { title: '전투 끝', subtitle: '승부가 났어요', remaining, time, phase: battle.phase };
  }
  const active = battle.lanes.filter((l) => l.duel !== null).length;
  const subtitle = active > 0 ? `${COUNT_WORD[active]} 레인에서 동시에 싸우는 중` : '다음 교전을 준비하는 중';
  return { title: `${roundOf(battle)}라운드`, subtitle, remaining, time, phase: battle.phase };
}

export interface TagModel {
  key: string;
  side: Side;
  /** Squad index, or -1 for the commander. */
  squad: number;
  arena: Arena;
  label: string;
  count: string;
  hp: number;
}

export function tagModels(battle: Battle): TagModel[] {
  const out: TagModel[] = [];
  if (battle.phase === 'lanes') {
    for (const side of SIDES) {
      for (const sq of battle.squads[side]) {
        if (sq.status !== 'fighting' && !(sq.status === 'waiting' && sq.wins > 0)) continue;
        let alive = 0;
        let hp = 0;
        let max = 0;
        for (let i = sq.info.from; i < sq.info.to; i++) {
          const u = battle.soldiers[side][i];
          if (u.alive) alive++;
          hp += u.hp;
          max += u.maxHp;
        }
        if (alive === 0) continue;
        out.push({
          key: `${side}-${sq.index}`,
          side,
          squad: sq.index,
          arena: sq.lane,
          label: squadLabel(sq.info.name),
          count: `${alive}/${sq.info.to - sq.info.from}`,
          hp: max > 0 ? hp / max : 0,
        });
      }
    }
  }
  for (const side of SIDES) {
    const k = battle.commanders[side];
    if (!k.alive) continue;
    const hp = k.maxHp > 0 ? k.hp / k.maxHp : 0;
    out.push({
      key: `${side}-cmd`,
      side,
      squad: -1,
      arena: 'final',
      label: battle.phase === 'lanes' ? '장수 대기' : '장수',
      count: `${Math.round(hp * 100)}%`,
      hp,
    });
  }
  return out;
}

// ---------------------------------------------------------------- commentary

export const revealed = (entries: readonly CommentaryEntry[], tick: number) => entries.filter((e) => e.tick <= tick);

/** Latest highlight playback has reached, pinned above the log. */
export function pinnedEntry(entries: readonly CommentaryEntry[], tick: number): CommentaryEntry | null {
  let best: CommentaryEntry | null = null;
  for (const e of entries) if (e.tick <= tick && e.badge === 'highlight') best = e;
  return best;
}

export function matchesFilter(e: CommentaryEntry, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'highlight') return e.badge === 'highlight';
  return e.side === filter;
}

/** Entries playback has reached, newest first, minus the pinned card. */
export function visibleEntries(entries: readonly CommentaryEntry[], tick: number, filter: Filter): CommentaryEntry[] {
  const pin = pinnedEntry(entries, tick);
  const out: CommentaryEntry[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.tick > tick || e === pin || !matchesFilter(e, filter)) continue;
    out.push(e);
  }
  return out;
}

export type Tone = Side | 'highlight' | 'warn' | 'muted';

export function badgeOf(e: CommentaryEntry, names: Record<Side, string>): { tone: Tone; text: string } {
  if (e.badge === 'highlight') return { tone: 'highlight', text: e.badgeText };
  if (e.badge === 'advantage' && e.side) return { tone: e.side, text: `${names[e.side]} ${e.badgeText}` };
  if (e.badge === 'warning' && e.side) return { tone: 'warn', text: e.badgeText };
  return { tone: 'muted', text: e.badgeText };
}

export function metaOf(e: CommentaryEntry, card = false): string {
  const where = card && e.arena !== 'final' ? `${e.laneLabel} 레인` : e.laneLabel;
  return `${where} · ${e.time}`;
}

export function sourceOf(e: CommentaryEntry): string | null {
  const s = e.source;
  if (!s) return null;
  const file = s.path ? s.path.split('/').filter((p) => p.length > 0).pop() : undefined;
  const metric = [s.metric, s.value].filter((v) => v).join(' ');
  return [file, metric].filter((v) => v).join(' · ') || null;
}
