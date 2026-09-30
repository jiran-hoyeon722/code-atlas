import { describe, expect, test } from 'vitest';
import { buildCommentary, type CommentaryEntry } from '../../../src/engine/battle/commentary';
import { buildArmy, createBattle, simulate } from '../../../src/engine/battle/sim';
import { MODE_DEAD, MODE_FIELD, MODE_STAGED, Replay } from '../../../src/features/battle/engage/replay';
import { badgeOf, hudModel, metaOf, pinnedEntry, remainingSquads, sourceOf, tagModels, visibleEntries } from '../../../src/features/battle/engage/view';
import { synthQuality } from '../../engine/battle/synth';

const qa = synthQuality({ name: 'left', seed: 3, cycleShare: 0.3, removableShare: 0.1, testRatio: 0.2 });
const qb = synthQuality({ name: 'right', seed: 9, ccnShares: [0.4, 0.3, 0.2, 0.1], testRatio: 0.8 });
const result = simulate(qa, qb, 1, { record: true });
const { entries } = buildCommentary({ result, armies: { a: buildArmy(qa), b: buildArmy(qb) }, quality: { a: qa, b: qb }, prior: { a: 0.45, b: 0.55 } });
const names = { a: 'left', b: 'right' };

function entry(over: Partial<CommentaryEntry>): CommentaryEntry {
  return {
    id: 'x',
    tick: 10,
    time: '1초',
    arena: 'top',
    laneLabel: '상단',
    side: 'a',
    badge: 'advantage',
    badgeText: '우세',
    title: 't',
    body: 'b',
    source: null,
    squads: { a: null, b: null },
    focus: [],
    ...over,
  };
}

describe('visible commentary', () => {
  test('nothing shows before its tick, newest first after', () => {
    expect(visibleEntries(entries, 0, 'all')).toEqual([]);
    const mid = entries[Math.floor(entries.length / 2)].tick;
    const shown = visibleEntries(entries, mid, 'all');
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((e) => e.tick <= mid)).toBe(true);
    for (let i = 1; i < shown.length; i++) expect(shown[i - 1].tick).toBeGreaterThanOrEqual(shown[i].tick);
  });

  test('the pinned highlight is the latest reached one and is not repeated in the log', () => {
    const pin = pinnedEntry(entries, result.ticks);
    expect(pin?.badge).toBe('highlight');
    expect(visibleEntries(entries, result.ticks, 'all')).not.toContain(pin);
    const all = visibleEntries(entries, result.ticks, 'all');
    expect(all.length + 1).toBe(entries.length);
    const firstHl = entries.find((e) => e.badge === 'highlight')!;
    expect(pinnedEntry(entries, firstHl.tick - 1)?.tick ?? -1).toBeLessThan(firstHl.tick);
  });

  test('filters by highlight and by side', () => {
    const end = result.ticks;
    expect(visibleEntries(entries, end, 'highlight').every((e) => e.badge === 'highlight')).toBe(true);
    const a = visibleEntries(entries, end, 'a');
    const b = visibleEntries(entries, end, 'b');
    expect(a.every((e) => e.side === 'a')).toBe(true);
    expect(b.every((e) => e.side === 'b')).toBe(true);
    expect(a.length + b.length).toBeGreaterThan(0);
  });

  test('badge tones follow the frame', () => {
    expect(badgeOf(entry({ side: 'b' }), names)).toEqual({ tone: 'b', text: 'right 우세' });
    expect(badgeOf(entry({ badge: 'highlight', badgeText: '명장면' }), names)).toEqual({ tone: 'highlight', text: '명장면' });
    expect(badgeOf(entry({ badge: 'warning', badgeText: '주의' }), names).tone).toBe('warn');
    expect(badgeOf(entry({ badge: 'warning', side: null, badgeText: '최종전' }), names).tone).toBe('muted');
    expect(badgeOf(entry({ badge: 'defeat', badgeText: '패배' }), names).tone).toBe('muted');
  });

  test('meta and source lines', () => {
    expect(metaOf(entry({}))).toBe('상단 · 1초');
    expect(metaOf(entry({}), true)).toBe('상단 레인 · 1초');
    expect(metaOf(entry({ arena: 'final', laneLabel: '최종전' }), true)).toBe('최종전 · 1초');
    expect(sourceOf(entry({ source: { path: 'src/a/Pay.ts', metric: '복잡도', value: '64' } }))).toBe('Pay.ts · 복잡도 64');
    expect(sourceOf(entry({ source: { metric: '테스트 비율' } }))).toBe('테스트 비율');
    expect(sourceOf(entry({}))).toBeNull();
  });
});

describe('HUD view-model', () => {
  test('starts with every squad standing in round 1 on three lanes', () => {
    const battle = createBattle(qa, qb, 1);
    const hud = hudModel(battle);
    expect(hud.remaining).toEqual({ a: 15, b: 15 });
    expect(hud.title).toBe('1라운드');
    expect(hud.subtitle).toBe('세 레인에서 동시에 싸우는 중');
    expect(hud.time).toBe('0초');
    const tags = tagModels(battle);
    expect(tags.filter((t) => t.squad >= 0)).toHaveLength(6);
    expect(tags.filter((t) => t.squad < 0).map((t) => t.label)).toEqual(['장수 대기', '장수 대기']);
    expect(tags.find((t) => t.squad >= 0)?.count).toBe('20/20');
  });

  test('remaining squads count squads with a living soldier', () => {
    const battle = createBattle(qa, qb, 1);
    for (let i = 0; i < 700; i++) battle.step();
    for (const side of ['a', 'b'] as const) {
      const alive = new Set(battle.soldiers[side].filter((u) => u.alive).map((u) => u.squad));
      expect(remainingSquads(battle, side)).toBe(alive.size);
    }
    expect(Number(hudModel(battle).title.replace('라운드', ''))).toBeGreaterThan(1);
  });

  test('final and done phases', () => {
    const r = new Replay(qa, qb, 1, result.ticks, result.final.tick);
    r.skipToFinal();
    const hud = hudModel(r.battle);
    expect(hud.title).toBe('최종전');
    expect(tagModels(r.battle).every((t) => t.squad < 0 && t.label === '장수')).toBe(true);
    while (!r.done) r.update(0.25);
    expect(hudModel(r.battle).title).toBe('전투 끝');
  });

  test('display frame: sim positions on the field, queue slots behind the line, never invented', () => {
    const r = new Replay(qa, qb, 1, result.ticks, result.final.tick);
    for (let i = 0; i < 40; i++) r.update(0.1);
    for (const side of ['a', 'b'] as const) {
      const f = r.cur[side];
      for (const u of r.battle.soldiers[side]) {
        if (u.status === 'fighting') {
          expect(f.mode[u.index]).toBe(u.alive ? MODE_FIELD : MODE_DEAD);
          expect(f.x[u.index]).toBeCloseTo(u.x * r.flip);
          expect(f.z[u.index]).toBeCloseTo(u.z);
        } else if (u.status === 'queued') {
          expect(f.mode[u.index]).toBe(MODE_STAGED);
          expect(Math.sign(f.x[u.index])).toBe(r.sign[side]);
        }
      }
    }
    expect(r.sign.a).toBe(-r.sign.b);
  });

  test('A is drawn on the left even when the sim puts it second in canonical order', () => {
    const late = synthQuality({ name: 'zeta', seed: 3 });
    const early = synthQuality({ name: 'alpha', seed: 9 });
    const res = simulate(late, early, 1);
    const r = new Replay(late, early, 1, res.ticks, res.final.tick);
    for (let i = 0; i < 40; i++) r.update(0.1);
    expect(r.flip).toBe(-1);
    for (const side of ['a', 'b'] as const) {
      const queued = r.battle.soldiers[side].filter((u) => u.status === 'queued');
      expect(queued.length).toBeGreaterThan(0);
      for (const u of queued) expect(Math.sign(r.cur[side].x[u.index])).toBe(side === 'a' ? -1 : 1);
    }
    const start = new Replay(late, early, 1, res.ticks, res.final.tick);
    const firstA = start.battle.soldiers.a.find((u) => u.status === 'fighting')!;
    expect(start.cur.a.x[firstA.index]).toBeLessThan(0);
  });
});
