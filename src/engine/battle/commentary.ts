import { CLOCK, EFFECTS, PREDICTION_RUNS } from './rules';
import { COMMANDER, victoryLabel } from './sim';
import type { Arena, Army, BattleResult, DuelRecord, Lane, Side, Squad, UnitRef, VictoryLabel } from './sim';
import type { Quality, QualityFile } from './types';

export type CommentaryBadge = 'advantage' | 'defeat' | 'warning' | 'highlight';

export interface CommentarySource {
  path?: string;
  metric: string;
  value?: string;
}

export interface CommentaryEntry {
  id: string;
  tick: number;
  time: string;
  arena: Arena;
  laneLabel: '상단' | '중앙' | '하단' | '최종전';
  side: Side | null;
  badge: CommentaryBadge;
  /** Side-neutral text; the UI puts the repo name in front where it wants one. */
  badgeText: string;
  title: string;
  body: string;
  source: CommentarySource | null;
  squads: Record<Side, number | null>;
  focus: UnitRef[];
}

export interface CommentaryInput {
  result: BattleResult;
  armies: Record<Side, Army>;
  quality: Record<Side, Quality>;
  /** Share of prediction runs each side won (0..1). */
  prior: { a: number; b: number };
}

export interface Commentary {
  entries: CommentaryEntry[];
  highlights: CommentaryEntry[];
}

// ---------------------------------------------------------------- Korean particles

export type ParticlePair = '이/가' | '을/를' | '은/는' | '와/과' | '으로/로';

/** [after a final consonant, after none, when the reading is unknown]. */
const PAIRS: Record<ParticlePair, [string, string, string]> = {
  '이/가': ['이', '가', '(이)가'],
  '을/를': ['을', '를', '(을)를'],
  '은/는': ['은', '는', '(은)는'],
  '와/과': ['과', '와', '와(과)'],
  '으로/로': ['으로', '로', '(으)로'],
};

type Final = 'none' | 'rieul' | 'other' | null;

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const RIEUL = 8;

function hangulFinal(ch: string): Final {
  const code = ch.charCodeAt(0);
  if (code < HANGUL_START || code > HANGUL_END) return null;
  const jong = (code - HANGUL_START) % 28;
  return jong === 0 ? 'none' : jong === RIEUL ? 'rieul' : 'other';
}

/** Final consonant of each digit read in Sino-Korean: 영 일 이 삼 사 오 육 칠 팔 구. */
const DIGIT_FINAL: Final[] = ['other', 'rieul', 'none', 'other', 'none', 'none', 'other', 'rieul', 'rieul', 'none'];

function digitsFinal(run: string): Final {
  // A round number is read by its unit (영 십 백 천 만 억), and every one of those ends in a consonant.
  return DIGIT_FINAL[Number(run[run.length - 1])];
}

/** Final consonant of each Latin letter's Korean name: 에이 비 씨 … 엘 엠 엔 … 알 …. */
const LETTER_FINAL: Record<string, Final> = { l: 'rieul', m: 'other', n: 'other', r: 'rieul' };

function latinFinal(run: string): Final {
  const lower = run.toLowerCase();
  const spelled = run === run.toUpperCase() && run.length <= 5 || !/[aeiou]/.test(lower);
  if (spelled) return LETTER_FINAL[lower[lower.length - 1]] ?? 'none';
  if (/(ng|m|n|ck|k|p|b|me|ne)$/.test(lower)) return 'other';
  if (/(l|le)$/.test(lower)) return 'rieul';
  if (/[aeiou]t$/.test(lower)) return 'other';
  return 'none';
}

function finalOf(word: string): Final {
  const w = word.replace(/[\s)\]}」』"'`.,!?]+$/u, '');
  if (w.length === 0) return null;
  const last = w[w.length - 1];
  if (last === '%') return 'none';
  const hangul = hangulFinal(last);
  if (hangul) return hangul;
  const digits = /[0-9]+$/.exec(w);
  if (digits) return digitsFinal(digits[0]);
  const latin = /[A-Za-z]+$/.exec(w);
  if (latin) return latinFinal(latin[0]);
  return null;
}

/** The particle alone, chosen by the word's last sound. */
export function particle(word: string, pair: ParticlePair): string {
  const [withFinal, without, unknown] = PAIRS[pair];
  const f = finalOf(word);
  if (f === null) return unknown;
  if (pair === '으로/로') return f === 'other' ? withFinal : without;
  return f === 'none' ? without : withFinal;
}

export function withParticle(word: string, pair: ParticlePair): string {
  return word + particle(word, pair);
}

// ---------------------------------------------------------------- small formatters

export function formatTime(tick: number): string {
  const seconds = Math.floor(tick * CLOCK.tick + 1e-9);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}초`;
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
}

export function squadLabel(name: string): string {
  const seg = name.split('/').filter((p) => p.length > 0).pop();
  return seg ? `${seg} 부대` : '이름 없는 부대';
}

const LANE_LABEL: Record<Arena, CommentaryEntry['laneLabel']> = {
  top: '상단',
  mid: '중앙',
  bottom: '하단',
  final: '최종전',
};

const LABEL_TEXT: Record<VictoryLabel, string> = { skill: '실력 승', close: '박빙 승', upset: '역전 승' };

const HIGHLIGHT = { streak: 3, lowHp: 0.25 } as const;
/** Below these a cause or an effect is too small to be worth a sentence. */
const NOTABLE = { cause: 0.03, chainShare: 0.1, chainUnits: 3, cloneHp: 1, cloneUnits: 3, shieldShare: 0.15 } as const;

const pct = (x: number) => Math.round(x * 100);
const other = (s: Side): Side => (s === 'a' ? 'b' : 'a');
const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const SIDES: readonly Side[] = ['a', 'b'];

// ---------------------------------------------------------------- per-duel event tallies

interface Spread {
  damage: number;
  count: number;
  targets: Set<number>;
  peakTick: number;
  peakCount: number;
  lastTick: number;
  lastCount: number;
}

interface Tally {
  damage: number;
  blocked: number;
  chain: Spread;
  clone: Spread;
}

const spread = (): Spread => ({ damage: 0, count: 0, targets: new Set(), peakTick: 0, peakCount: 0, lastTick: -1, lastCount: 0 });
const tally = (): Tally => ({ damage: 0, blocked: 0, chain: spread(), clone: spread() });

function addSpread(s: Spread, tick: number, target: number, damage: number): void {
  s.damage += damage;
  s.count++;
  s.targets.add(target);
  if (tick === s.lastTick) s.lastCount++;
  else {
    s.lastTick = tick;
    s.lastCount = 1;
  }
  if (s.lastCount > s.peakCount) {
    s.peakCount = s.lastCount;
    s.peakTick = tick;
  }
}

type Group = Record<Side, Tally>;

class Tallies {
  readonly byDuel = new Map<number, Group>();
  readonly final: Group = { a: tally(), b: tally() };
  private readonly byLane = new Map<Lane, DuelRecord[]>();

  constructor(private readonly input: CommentaryInput) {
    const sorted = [...input.result.duels].sort((x, y) => x.startTick - y.startTick || x.id - y.id);
    for (const d of sorted) {
      const list = this.byLane.get(d.lane) ?? [];
      list.push(d);
      this.byLane.set(d.lane, list);
    }
    this.read();
  }

  private squadOf(ref: UnitRef): number {
    return ref.index === COMMANDER ? -1 : this.input.armies[ref.side].soldiers[ref.index]?.squad ?? -1;
  }

  private duelOf(lane: Lane, ref: UnitRef, tick: number): DuelRecord | undefined {
    const sq = this.squadOf(ref);
    // Sorted by start so a squad that won at this tick is billed to the duel that just ended.
    return this.byLane.get(lane)?.find((d) => d.squads[ref.side] === sq && d.startTick <= tick && tick <= d.endTick);
  }

  private anyDuel(ref: UnitRef, tick: number): DuelRecord | undefined {
    for (const lane of this.byLane.keys()) {
      const d = this.duelOf(lane, ref, tick);
      if (d) return d;
    }
    return undefined;
  }

  private group(d: DuelRecord | undefined): Group | undefined {
    if (!d) return undefined;
    let g = this.byDuel.get(d.id);
    if (!g) {
      g = { a: tally(), b: tally() };
      this.byDuel.set(d.id, g);
    }
    return g;
  }

  private at(arena: Arena, ref: UnitRef, tick: number): Group | undefined {
    return arena === 'final' ? this.final : this.group(this.duelOf(arena, ref, tick));
  }

  private read(): void {
    const finalTick = this.input.result.final.tick;
    for (const e of this.input.result.events) {
      if (e.kind === 'hit') {
        const g = this.at(e.arena, e.target, e.tick);
        if (!g) continue;
        g[e.target.side].damage += e.damage;
        g[e.target.side].blocked += e.blocked;
      } else if (e.kind === 'chain') {
        const g = this.at(e.arena, e.target, e.tick);
        if (g) addSpread(g[e.target.side].chain, e.tick, e.target.index, e.damage);
      } else if (e.kind === 'clone') {
        const g = e.tick > finalTick ? this.final : this.group(this.anyDuel(e.target, e.tick) ?? this.anyDuel(e.source, e.tick));
        if (g) {
          g[e.target.side].damage += e.damage;
          addSpread(g[e.target.side].clone, e.tick, e.target.index, e.damage);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- squad facts

interface SquadFacts {
  side: Side;
  squad: Squad;
  label: string;
  size: number;
  r: number;
  shields: number;
  homes: QualityFile[];
}

function factsOf(input: CommentaryInput, side: Side, index: number): SquadFacts {
  const army = input.armies[side];
  const squad = army.squads[index];
  const soldiers = army.soldiers.slice(squad.from, squad.to);
  const size = Math.max(1, soldiers.length);
  const byPath = new Map(input.quality[side].files.map((f) => [f.path, f]));
  const homes: QualityFile[] = [];
  const seen = new Set<string>();
  for (const s of soldiers) {
    const f = byPath.get(s.home);
    if (!f || seen.has(f.path)) continue;
    seen.add(f.path);
    homes.push(f);
  }
  return {
    side,
    squad,
    label: squadLabel(squad.name),
    size: soldiers.length,
    r: soldiers.reduce((n, s) => n + s.r, 0) / size,
    shields: soldiers.filter((s) => s.shield).length / size,
    homes,
  };
}

/** First file with the highest score; ties keep path order, so output stays stable. */
function worst(files: QualityFile[], score: (f: QualityFile) => number): QualityFile | undefined {
  let best: QualityFile | undefined;
  let top = 0;
  for (const f of files) {
    const s = score(f);
    if (s > top) {
      top = s;
      best = f;
    }
  }
  return best;
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((n, x) => n + x, 0) / xs.length);
const maxOf = (xs: number[]) => xs.reduce((n, x) => (x > n ? x : n), 0);

function complexitySource(sq: SquadFacts): CommentarySource {
  const f = worst(sq.homes, (x) => maxOf(x.functions.map((fn) => fn.ccn)) * 100 + mean(x.ccnTier));
  if (!f) return { metric: '복잡도' };
  const ccn = maxOf(f.functions.map((fn) => fn.ccn));
  return ccn > 0 ? { path: f.path, metric: '복잡도', value: String(ccn) } : { path: f.path, metric: '복잡도' };
}

function lengthSource(sq: SquadFacts): CommentarySource {
  const f = worst(sq.homes, (x) => maxOf(x.functions.map((fn) => fn.nloc)) * 100 + mean(x.lenTier));
  if (!f) return { metric: '함수 길이' };
  const nloc = maxOf(f.functions.map((fn) => fn.nloc));
  return nloc > 0 ? { path: f.path, metric: '함수 길이', value: `${nloc}줄` } : { path: f.path, metric: '함수 길이' };
}

function chainSource(input: CommentaryInput, sq: SquadFacts): CommentarySource {
  const f = worst(sq.homes, (x) => (x.cycle >= 0 ? x.lines : 0));
  if (!f) return { metric: '서로 얽힌 코드' };
  const cycle = input.quality[sq.side].cycles.find((c) => c.id === f.cycle);
  return cycle
    ? { path: f.path, metric: '서로 얽힌 코드', value: `파일 ${cycle.files.length}개 묶음` }
    : { path: f.path, metric: '서로 얽힌 코드' };
}

function cloneSource(sq: SquadFacts): CommentarySource {
  const share = (x: QualityFile) => (x.lines > 0 ? x.removable.reduce((n, v) => n + v, 0) / x.lines : 0);
  const f = worst(sq.homes, share);
  return f ? { path: f.path, metric: '복붙 줄', value: `${pct(share(f))}%` } : { metric: '복붙 줄' };
}

function shieldSource(input: CommentaryInput, side: Side): CommentarySource {
  return { metric: '테스트 비율', value: `${pct(input.quality[side].scores.tests)}%` };
}

// ---------------------------------------------------------------- why a duel went the way it did

export type Cause = 'complexity' | 'length' | 'chain' | 'clone' | 'shield';

interface Reason {
  cause: Cause | null;
  text: string;
  source: CommentarySource | null;
}

const blockedShare = (t: Tally) => (t.damage + t.blocked > 0 ? t.blocked / (t.damage + t.blocked) : 0);
const squadHp = (sq: SquadFacts) => Math.max(1, sq.size) * 100;

function tangledFiles(sq: SquadFacts): number {
  return sq.homes.filter((f) => f.cycle >= 0).length;
}

function explain(input: CommentaryInput, win: SquadFacts, lose: SquadFacts, g: Group | undefined): Reason {
  const tw = g?.[win.side] ?? tally();
  const tl = g?.[lose.side] ?? tally();
  // Each score approximates how much of the fight the effect swung, so they compare on one scale.
  const scores: [Cause, number][] = [
    ['complexity', win.squad.atk > 0 ? 1 - lose.squad.atk / win.squad.atk : 0],
    ['length', win.squad.spd > 0 ? 1 - lose.squad.spd / win.squad.spd : 0],
    ['chain', tl.chain.count > 0 ? EFFECTS.chainShare * (lose.r - win.r) : 0],
    ['clone', tl.clone.count > 0 ? tl.clone.damage / squadHp(lose) - tw.clone.damage / squadHp(win) : 0],
    // Short fights can put a few shields in front by chance; only credit shields the squad really has more of.
    ['shield', win.shields > lose.shields ? blockedShare(tw) - blockedShare(tl) : 0],
  ];
  let best: [Cause, number] | null = null;
  for (const s of scores) if (s[1] >= NOTABLE.cause && (!best || s[1] > best[1])) best = s;

  const W = win.label;
  const L = lose.label;
  if (!best) {
    return { cause: null, text: `두 부대의 힘이 비슷했어요. ${withParticle(W, '이/가')} 체력을 조금 더 지켰어요.`, source: null };
  }
  const p = pct(best[1]);
  switch (best[0]) {
    case 'complexity':
      return {
        cause: 'complexity',
        text: `${withParticle(L, '은/는')} 갈림길이 많은 코드라 굼떠요. 한 번 칠 때 피해가 상대보다 ${p}% 약했어요.`,
        source: complexitySource(lose),
      };
    case 'length':
      return {
        cause: 'length',
        text: `${withParticle(L, '은/는')} 한 번에 너무 많은 일을 하는 코드라 느려요. 공격 횟수가 상대보다 ${p}% 적었어요.`,
        source: lengthSource(lose),
      };
    case 'chain': {
      const n = tangledFiles(lose);
      const who = n > 0 ? `${L}에는 서로 얽힌 파일 ${n}개가 섞여 있어요.` : `${L}에는 서로 얽힌 코드가 섞여 있어요.`;
      return { cause: 'chain', text: `${who} 한 명이 맞자 피해가 사슬을 타고 번졌어요.`, source: chainSource(input, lose) };
    }
    case 'clone':
      return {
        cause: 'clone',
        text: `${L}에는 똑같은 복사본이 많아 하나가 무너지자 같이 흔들렸어요. ${tl.clone.targets.size}명이 함께 체력을 잃었어요.`,
        source: cloneSource(lose),
      };
    case 'shield': {
      const share = `${pct(blockedShare(tw))}%`;
      return {
        cause: 'shield',
        text: `${withParticle(W, '은/는')} 테스트를 꼼꼼히 쓴 코드예요. 테스트 방패가 공격의 ${withParticle(share, '을/를')} 막아냈어요.`,
        source: shieldSource(input, win.side),
      };
    }
  }
}

// ---------------------------------------------------------------- entries

/** Same-tick order: side notes, duel end, lane clear, final start, commander, battle end. */
type Kind = 'note' | 'duel' | 'lane' | 'final' | 'commander' | 'end';
const KIND_RANK: Record<Kind, number> = { note: 0, duel: 1, lane: 2, final: 3, commander: 4, end: 5 };

interface Draft {
  kind: Kind;
  entry: CommentaryEntry;
}

function squadRefs(input: CommentaryInput, side: Side, index: number | null): UnitRef[] {
  if (index === null) return [];
  const sq = input.armies[side].squads[index];
  const out: UnitRef[] = [];
  for (let i = sq.from; i < sq.to; i++) out.push({ side, index: i });
  return out;
}

function entry(
  fields: Omit<CommentaryEntry, 'time' | 'laneLabel' | 'squads' | 'focus'> & Partial<Pick<CommentaryEntry, 'squads' | 'focus'>>,
): CommentaryEntry {
  return {
    ...fields,
    time: formatTime(fields.tick),
    laneLabel: LANE_LABEL[fields.arena],
    squads: fields.squads ?? { a: null, b: null },
    focus: fields.focus ?? [],
  };
}

/** Each squad's longest streak (≥ 3), marked on the duel that reached it. */
function streakDuels(duels: DuelRecord[]): Set<number> {
  const best = new Map<string, DuelRecord>();
  for (const d of duels) {
    if (!d.winner || d.streak < HIGHLIGHT.streak) continue;
    const key = `${d.winner}:${d.squads[d.winner]}`;
    const cur = best.get(key);
    if (!cur || d.streak > cur.streak) best.set(key, d);
  }
  return new Set([...best.values()].map((d) => d.id));
}

function duelDrafts(input: CommentaryInput, tallies: Tallies): Draft[] {
  const out: Draft[] = [];
  const streaks = streakDuels(input.result.duels);
  for (const d of input.result.duels) {
    if (d.outcome === 'cut') continue;
    const g = tallies.byDuel.get(d.id);
    const facts = { a: factsOf(input, 'a', d.squads.a), b: factsOf(input, 'b', d.squads.b) };
    const focus = [...squadRefs(input, 'a', d.squads.a), ...squadRefs(input, 'b', d.squads.b)];
    const base = { tick: d.endTick, arena: d.lane as Arena, squads: { a: d.squads.a, b: d.squads.b }, focus };

    if (!d.winner) {
      const both = `${withParticle(facts.a.label, '와/과')} ${withParticle(facts.b.label, '이/가')}`;
      const down = d.outcome === 'both-down';
      out.push({
        kind: 'duel',
        entry: entry({
          ...base,
          id: `duel-${d.id}`,
          side: null,
          badge: down ? 'defeat' : 'warning',
          badgeText: down ? '함께 전멸' : '양쪽 퇴각',
          title: down ? `${both} 함께 쓰러졌어요` : `${both} 모두 물러났어요`,
          body: down
            ? '두 부대가 같은 순간에 마지막 병사를 잃었어요.'
            : `${CLOCK.duelSeconds}초 동안 승부가 나지 않았고 남은 체력도 거의 같았어요.`,
          source: null,
        }),
      });
      continue;
    }

    const win = facts[d.winner];
    const lose = facts[other(d.winner)];
    const why = explain(input, win, lose, g);
    const left = d.remaining[d.winner];
    const W = win.label;

    const streak = streaks.has(d.id) ? d.streak : 0;
    const low = left.hp <= HIGHLIGHT.lowHp;
    const hpText = `${pct(left.hp)}%`;
    let title: string;
    if (streak && low) title = `${withParticle(W, '이/가')} 체력 ${withParticle(hpText, '으로/로')} 버티며 ${streak}연승했어요`;
    else if (streak) title = `${withParticle(W, '이/가')} ${streak}연승했어요`;
    else if (low) title = `${withParticle(W, '이/가')} 체력 ${withParticle(hpText, '으로/로')} 버티며 이겼어요`;
    else if (d.outcome === 'timeout') title = `${withParticle(W, '이/가')} 시간 끝까지 더 버텼어요`;
    else title = `${withParticle(W, '이/가')} 상대 ${withParticle(lose.label, '을/를')} 물리쳤어요`;

    const body =
      d.outcome === 'timeout'
        ? `${CLOCK.duelSeconds}초 안에 끝나지 않아 체력이 더 남은 쪽이 이겼어요. ${why.text}`
        : `${why.text} ${left.soldiers === win.size ? '한 명도 잃지 않았어요.' : `${win.size}명 중 ${left.soldiers}명이 남았어요.`}`;
    const highlight = streak > 0 || low;
    out.push({
      kind: 'duel',
      entry: entry({
        ...base,
        id: `duel-${d.id}`,
        side: d.winner,
        badge: highlight ? 'highlight' : 'advantage',
        badgeText: highlight ? '명장면' : '우세',
        title,
        body,
        source: why.source,
      }),
    });

    if (g) {
      for (const s of SIDES) {
        const skip = s === lose.side ? why.cause : null;
        out.push(...effectDrafts(input, `${d.id}`, d.lane, s, g[s], facts[s], skip, d.squads));
      }
      const tw = g[win.side];
      if (why.cause !== 'shield' && win.shields >= EFFECTS.lookThreshold && blockedShare(tw) >= NOTABLE.shieldShare) {
        const share = `${pct(blockedShare(tw))}%`;
        out.push({
          kind: 'note',
          entry: entry({
            ...base,
            tick: Math.floor((d.startTick + d.endTick) / 2),
            id: `shield-${d.id}-${win.side}`,
            side: win.side,
            badge: 'advantage',
            badgeText: '우세',
            title: `${withParticle(W, '이/가')} 잘 버티고 있어요`,
            body: `테스트를 꼼꼼히 쓴 코드예요. 테스트 방패가 공격의 ${withParticle(share, '을/를')} 막아냈어요.`,
            source: shieldSource(input, win.side),
            focus: squadRefs(input, win.side, d.squads[win.side]),
          }),
        });
      }
    }
  }
  return out;
}

function effectDrafts(
  input: CommentaryInput,
  key: string,
  arena: Arena,
  side: Side,
  t: Tally,
  sq: SquadFacts | null,
  skip: Cause | null,
  squads: Record<Side, number | null>,
): Draft[] {
  const out: Draft[] = [];
  const who = sq ? sq.label : '최종전';
  const focusOf = (s: Spread) => [...s.targets].sort((x, y) => x - y).map((index) => ({ side, index }));

  if (
    skip !== 'chain' &&
    t.chain.targets.size >= NOTABLE.chainUnits &&
    t.damage > 0 &&
    t.chain.damage / t.damage >= NOTABLE.chainShare
  ) {
    out.push({
      kind: 'note',
      entry: entry({
        id: `chain-${key}-${side}`,
        tick: t.chain.peakTick,
        arena,
        side,
        badge: 'warning',
        badgeText: '주의',
        title: sq ? `${who} 안에서 피해가 번지고 있어요` : '최종전에서 피해가 사슬을 타고 번졌어요',
        body: `서로 얽힌 코드가 섞여 있어 한 명이 맞으면 옆 병사도 다쳐요. ${t.chain.targets.size}명이 함께 피해를 받았어요.`,
        source: sq ? chainSource(input, sq) : null,
        squads,
        focus: focusOf(t.chain),
      }),
    });
  }
  if (skip !== 'clone' && t.clone.targets.size >= NOTABLE.cloneUnits && t.clone.damage >= NOTABLE.cloneHp * 100) {
    out.push({
      kind: 'note',
      entry: entry({
        id: `clone-${key}-${side}`,
        tick: t.clone.peakTick,
        arena,
        side,
        badge: 'warning',
        badgeText: '주의',
        title: sq ? `${withParticle(who, '이/가')} 복사본 탓에 흔들렸어요` : '최종전에서 복사본 피해가 번졌어요',
        body: `똑같은 복사본이 많아 하나가 무너지자 같이 흔들렸어요. ${t.clone.targets.size}명이 함께 체력을 잃었어요.`,
        source: sq ? cloneSource(sq) : null,
        squads,
        focus: focusOf(t.clone),
      }),
    });
  }
  return out;
}

function laneDrafts(input: CommentaryInput): Draft[] {
  const out: Draft[] = [];
  for (const e of input.result.events) {
    if (e.kind !== 'lane-clear') continue;
    let last: DuelRecord | undefined;
    for (const d of input.result.duels) {
      if (d.lane === e.lane && d.winner === e.side && d.endTick <= e.tick && (!last || d.endTick >= last.endTick)) last = d;
    }
    const squad = last ? last.squads[e.side] : null;
    const label = squad === null ? null : squadLabel(input.armies[e.side].squads[squad].name);
    out.push({
      kind: 'lane',
      entry: entry({
        id: `lane-${e.lane}`,
        tick: e.tick,
        arena: e.lane,
        side: e.side,
        badge: 'advantage',
        badgeText: '레인 돌파',
        title: label ? `${withParticle(label, '이/가')} ${LANE_LABEL[e.lane]} 레인을 뚫었어요` : `${LANE_LABEL[e.lane]} 레인을 뚫었어요`,
        body: '상대 부대를 모두 이겼어요. 최종전까지 이 자리에서 기다려요.',
        source: null,
        squads: { a: e.side === 'a' ? squad : null, b: e.side === 'b' ? squad : null },
        focus: squadRefs(input, e.side, squad),
      }),
    });
  }
  return out;
}

function finalDraft(input: CommentaryInput): Draft {
  const { reason, tick } = input.result.final;
  const laneTime = formatTime(Math.round(CLOCK.laneSeconds / CLOCK.tick));
  const why =
    reason === 'wiped'
      ? '한쪽 레인 부대가 모두 사라졌어요.'
      : reason === 'lanes-idle'
        ? '더 싸울 레인 교전이 없어요.'
        : `레인 교전이 ${withParticle(laneTime, '을/를')} 넘겼어요.`;
  return {
    kind: 'final',
    entry: entry({
      id: 'final',
      tick,
      arena: 'final',
      side: null,
      badge: 'warning',
      badgeText: '최종전',
      title: '최종전이 시작됐어요',
      body: `${why} 양쪽 장수와 남은 병사가 중앙에서 한꺼번에 싸워요.`,
      source: null,
    }),
  };
}

function commanderDrafts(input: CommentaryInput): Draft[] {
  const { result } = input;
  const downs: { side: Side; tick: number }[] = [];
  for (const e of result.events) if (e.kind === 'commander-down') downs.push({ side: e.side, tick: e.tick });
  if (downs.length === 0) {
    for (const s of SIDES) if (result.commanderHp[s] <= 0) downs.push({ side: s, tick: result.ticks });
  }
  return downs.map(({ side, tick }) => {
    const cmd = input.armies[side].commander;
    const name = basename(cmd.display);
    return {
      kind: 'commander' as const,
      entry: entry({
        id: `commander-${side}`,
        tick,
        arena: 'final',
        side: other(side),
        badge: 'highlight',
        badgeText: '명장면',
        title: `상대 장수 ${withParticle(name, '을/를')} 쓰러뜨렸어요`,
        body: '장수는 레포의 중심 파일 묶음이에요. 장수가 쓰러지면 그 자리에서 승부가 나요.',
        source: cmd.files[0] ? { path: cmd.files[0], metric: '장수' } : null,
        focus: [{ side, index: COMMANDER }],
      }),
    };
  });
}

function endDraft(input: CommentaryInput): Draft {
  const { result } = input;
  const base = { id: 'end', tick: result.ticks, arena: 'final' as const };
  if (!result.winner) {
    return {
      kind: 'end',
      entry: entry({
        ...base,
        side: null,
        badge: 'warning',
        badgeText: '무승부',
        title: '승부가 나지 않았어요',
        body: `양쪽 남은 체력 차이가 ${pct(CLOCK.tieMargin)}%p 안쪽이라 비겼어요.`,
        source: null,
      }),
    };
  }
  const w = result.winner;
  const prior = input.prior[w];
  const label = victoryLabel(prior);
  const wins = Math.round(prior * PREDICTION_RUNS);
  const low = result.hpRatio[w] <= HIGHLIGHT.lowHp;
  const title = label === 'upset' ? '예상을 뒤집고 역전했어요' : label === 'close' ? '박빙 끝에 이겼어요' : '예상대로 이겼어요';
  const odds = `시뮬레이션 ${PREDICTION_RUNS}번 중 ${wins}번${label === 'upset' ? '만' : ''} 이긴 쪽이에요.`;
  const how =
    result.reason === 'commander' ? '상대 장수를 쓰러뜨려 승부가 났어요.' : '시간이 다 되어 남은 체력이 더 많은 쪽이 이겼어요.';
  const hold = low ? ` 체력 ${pct(result.hpRatio[w])}%만 남기고 버텼어요.` : '';
  return {
    kind: 'end',
    entry: entry({
      ...base,
      side: w,
      badge: label === 'upset' || low ? 'highlight' : 'advantage',
      badgeText: LABEL_TEXT[label],
      title,
      body: `${odds} ${how}${hold}`,
      source: { metric: `시뮬레이션 ${PREDICTION_RUNS}번 중 이긴 횟수`, value: `${wins}번` },
    }),
  };
}

/** Template-filled commentary: same battle in, same text out. Strings are plain text for the UI to escape. */
export function buildCommentary(input: CommentaryInput): Commentary {
  const tallies = new Tallies(input);
  const drafts: Draft[] = [
    ...duelDrafts(input, tallies),
    ...SIDES.flatMap((s) =>
      effectDrafts(input, 'final', 'final', s, tallies.final[s], null, null, { a: null, b: null }),
    ),
    ...laneDrafts(input),
    finalDraft(input),
    ...commanderDrafts(input),
    endDraft(input),
  ];
  const order = drafts.map((d, i) => ({ d, i }));
  order.sort(
    (x, y) => x.d.entry.tick - y.d.entry.tick || KIND_RANK[x.d.kind] - KIND_RANK[y.d.kind] || x.i - y.i,
  );
  const entries = order.map((o) => o.d.entry);
  return { entries, highlights: entries.filter((e) => e.badge === 'highlight') };
}

