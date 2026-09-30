import { describe, expect, test } from 'vitest';
import {
  buildCommentary,
  formatTime,
  particle,
  squadLabel,
  withParticle,
  type CommentaryInput,
} from '../../../src/engine/battle/commentary';
import { buildArmy, simulate } from '../../../src/engine/battle/sim';
import type { BattleResult, DuelRecord, Lane, Side } from '../../../src/engine/battle/sim';
import type { Quality } from '../../../src/engine/battle/types';
import { synthQuality, tinyQuality } from './synth';

function inputFor(qa: Quality, qb: Quality, match = 1, prior = { a: 0.5, b: 0.5 }): CommentaryInput {
  return {
    result: simulate(qa, qb, match, { record: true }),
    armies: { a: buildArmy(qa), b: buildArmy(qb) },
    quality: { a: qa, b: qb },
    prior,
  };
}

const plainFiles = (tag: string, extra: { ccn?: number; len?: number } = {}) =>
  [0, 1, 2, 3, 4].map((i) => ({ path: `${tag}/m${i}/f${i}.ts`, lines: 200, ...extra }));

describe('particle', () => {
  test('Hangul with and without a final consonant', () => {
    expect(particle('결제', '이/가')).toBe('가');
    expect(particle('장바구니', '을/를')).toBe('를');
    expect(particle('알림', '이/가')).toBe('이');
    expect(particle('인증', '은/는')).toBe('은');
    expect(particle('부대', '와/과')).toBe('와');
    expect(particle('장수', '와/과')).toBe('와');
    expect(particle('동기화', '으로/로')).toBe('로');
    expect(particle('서버', '으로/로')).toBe('로');
    expect(particle('모듈', '으로/로')).toBe('로');
    expect(particle('모듈', '이/가')).toBe('이');
    expect(particle('본문', '으로/로')).toBe('으로');
    expect(withParticle('결제 부대', '이/가')).toBe('결제 부대가');
  });

  test('digits read in Korean', () => {
    expect(particle('3', '이/가')).toBe('이');
    expect(particle('2', '이/가')).toBe('가');
    expect(particle('1', '으로/로')).toBe('로');
    expect(particle('7', '으로/로')).toBe('로');
    expect(particle('6', '으로/로')).toBe('으로');
    expect(particle('10', '이/가')).toBe('이');
    expect(particle('100', '을/를')).toBe('을');
    expect(particle('mod4', '은/는')).toBe('는');
    expect(particle('22%', '으로/로')).toBe('로');
  });

  test('Latin by pronunciation, with a combined form only when unknown', () => {
    expect(particle('file0.ts', '을/를')).toBe('를');
    expect(particle('file0', '을/를')).toBe('을');
    expect(particle('main.ts', '을/를')).toBe('를');
    expect(particle('main', '이/가')).toBe('이');
    expect(particle('module', '으로/로')).toBe('로');
    expect(particle('app', '은/는')).toBe('은');
    expect(particle('server', '이/가')).toBe('가');
    expect(particle('SQL', '으로/로')).toBe('로');
    expect(particle('API', '이/가')).toBe('가');
    expect(particle('src', '이/가')).toBe('가');
    expect(particle('home', '와/과')).toBe('과');
    expect(particle('「인증」', '이/가')).toBe('이');
    expect(particle('日本', '이/가')).toBe('(이)가');
    expect(particle('日本', '으로/로')).toBe('(으)로');
  });
});

describe('formatTime', () => {
  test('ticks of 0.1 s as minutes and seconds', () => {
    expect(formatTime(0)).toBe('0초');
    expect(formatTime(95)).toBe('9초');
    expect(formatTime(600)).toBe('1분');
    expect(formatTime(720)).toBe('1분 12초');
    expect(formatTime(2399)).toBe('3분 59초');
  });
});

describe('squadLabel', () => {
  test('last folder segment plus 부대', () => {
    expect(squadLabel('src/mod3')).toBe('mod3 부대');
    expect(squadLabel('root.ts')).toBe('root.ts 부대');
    expect(squadLabel('')).toBe('이름 없는 부대');
  });
});

describe('buildCommentary on a synthetic battle', () => {
  const qa = synthQuality({ name: 'left', seed: 3, cycleShare: 0.3, removableShare: 0.1, testRatio: 0.2 });
  const qb = synthQuality({ name: 'right', seed: 9, ccnShares: [0.4, 0.3, 0.2, 0.1], testRatio: 0.8 });
  const input = inputFor(qa, qb, 1, { a: 0.3, b: 0.7 });
  const out = buildCommentary(input);

  test('same input gives the same text', () => {
    expect(buildCommentary(inputFor(qa, qb, 1, { a: 0.3, b: 0.7 }))).toEqual(out);
  });

  test('entries are in tick order with text, lanes and times', () => {
    expect(out.entries.length).toBeGreaterThan(5);
    const lanes = new Set(['top', 'mid', 'bottom', 'final']);
    const labels = new Set(['상단', '중앙', '하단', '최종전']);
    for (let i = 0; i < out.entries.length; i++) {
      const e = out.entries[i];
      if (i > 0) expect(e.tick).toBeGreaterThanOrEqual(out.entries[i - 1].tick);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.body.length).toBeGreaterThan(0);
      expect(lanes.has(e.arena)).toBe(true);
      expect(labels.has(e.laneLabel)).toBe(true);
      expect(e.time).toBe(formatTime(e.tick));
      expect(e.badgeText.length).toBeGreaterThan(0);
    }
    expect(new Set(out.entries.map((e) => e.id)).size).toBe(out.entries.length);
    expect(out.entries.at(-1)!.id).toBe('end');
  });

  test('covers duel ends, final start and the battle end', () => {
    const ids = out.entries.map((e) => e.id);
    expect(ids.filter((id) => id.startsWith('duel-')).length).toBeGreaterThan(0);
    expect(ids).toContain('final');
    const end = out.entries.find((e) => e.id === 'end')!;
    if (input.result.winner) expect(['실력 승', '박빙 승', '역전 승', '명장면']).toContain(end.badgeText);
  });

  test('highlights are the highlight-badged entries, in tick order', () => {
    expect(out.highlights).toEqual(out.entries.filter((e) => e.badge === 'highlight'));
  });

  test('no markup and no hotspot talk', () => {
    const text = JSON.stringify(out);
    expect(text).not.toContain('<');
    expect(text).not.toContain('핫스팟');
    expect(text).not.toContain('체력이 새');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });
});

describe('highlight count', () => {
  test('synthetic battles keep 명장면 to a handful', () => {
    const pairs = [
      [synthQuality({ name: 'p1', seed: 1 }), synthQuality({ name: 'p2', seed: 2 })],
      [synthQuality({ name: 'q1', seed: 5, totalLines: 20_000 }), synthQuality({ name: 'q2', seed: 6, totalLines: 20_000, testRatio: 0.6 })],
      [synthQuality({ name: 's1', seed: 11, totalLines: 30_000, removableShare: 0.1 }), synthQuality({ name: 's2', seed: 11, totalLines: 30_000 })],
    ];
    for (const [qa, qb] of pairs) {
      for (const match of [1, 2, 3]) {
        const n = buildCommentary(inputFor(qa, qb, match)).highlights.length;
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThanOrEqual(6);
      }
    }
  });
});

describe('cause picking', () => {
  test('a squad with much lower attack loses to complexity', () => {
    const weak = tinyQuality('weak', plainFiles('w', { ccn: 3 }));
    const strong = tinyQuality('strong', plainFiles('s'));
    const out = buildCommentary(inputFor(weak, strong));
    const lost = out.entries.filter((e) => e.id.startsWith('duel-') && e.side === 'b');
    expect(lost.length).toBeGreaterThan(0);
    expect(lost[0].body).toContain('갈림길이 많은 코드');
    expect(lost[0].source?.metric).toBe('복잡도');
    expect(lost[0].source?.path).toMatch(/^w\/m\d\/f\d\.ts$/);
  });

  test('a shield-heavy squad wins on its shields', () => {
    const shielded = tinyQuality('shielded', plainFiles('t'), 1);
    const bare = tinyQuality('bare', plainFiles('u'), 0);
    const out = buildCommentary(inputFor(shielded, bare));
    const won = out.entries.filter((e) => e.id.startsWith('duel-') && e.side === 'a');
    expect(won.length).toBeGreaterThan(0);
    expect(won[0].body).toMatch(/테스트 방패가 공격의 \d+%를 막아냈어요/);
    expect(won[0].source).toEqual({ metric: '테스트 비율', value: '100%' });
  });
});

describe('highlights on hand-built results', () => {
  const qa = tinyQuality('ha', plainFiles('ha'));
  const qb = tinyQuality('hb', plainFiles('hb'));
  const armies = { a: buildArmy(qa), b: buildArmy(qb) };
  const quality = { a: qa, b: qb };

  function duel(
    id: number, lane: Lane, a: number, b: number, winner: Side, streak: number, hp: number, t0: number,
    outcome: DuelRecord['outcome'] = 'rout',
  ): DuelRecord {
    const lose = outcome === 'rout' ? { soldiers: 0, hp: 0 } : { soldiers: 1, hp: hp / 2 };
    const win = { soldiers: Math.max(1, Math.round(20 * hp)), hp };
    return {
      id,
      lane,
      squads: { a, b },
      startTick: t0,
      endTick: t0 + 100,
      outcome,
      winner,
      streak,
      remaining: winner === 'a' ? { a: win, b: lose } : { a: lose, b: win },
    };
  }

  function result(duels: DuelRecord[], winner: Side | null, reason: BattleResult['reason']): BattleResult {
    const ticks = 2000;
    const loser: Side | null = winner === null ? null : winner === 'a' ? 'b' : 'a';
    return {
      ruleVersion: 'test',
      match: 1,
      seed: 1,
      winner,
      reason,
      ticks,
      final: { tick: 1500, reason: 'wiped' },
      survivors: { a: 10, b: 10 },
      commanderHp: { a: loser === 'a' ? 0 : 500, b: loser === 'b' ? 0 : 500 },
      hpRatio: { a: 0.4, b: 0.1 },
      duels,
      events: [],
    };
  }

  const lane = (l: Lane) => armies.a.lanes[l];

  test('역전: the winner had under 40% in the prediction', () => {
    const out = buildCommentary({ result: result([], 'a', 'commander'), armies, quality, prior: { a: 0.3, b: 0.7 } });
    const end = out.highlights.find((e) => e.id === 'end');
    expect(end).toBeDefined();
    expect(end!.title).toContain('역전');
    expect(end!.body).toContain('100번 중 30번');
  });

  test('no 역전 highlight for a favourite', () => {
    const out = buildCommentary({ result: result([], 'a', 'timeout'), armies, quality, prior: { a: 0.7, b: 0.3 } });
    expect(out.highlights.find((e) => e.id === 'end')).toBeUndefined();
    expect(out.entries.find((e) => e.id === 'end')!.badgeText).toBe('실력 승');
  });

  test('3연승: one highlight at the longest streak of a squad', () => {
    const [s0] = lane('mid');
    const q = armies.b.lanes.mid;
    const duels = [
      duel(0, 'mid', s0, q[0], 'a', 1, 0.9, 0),
      duel(1, 'mid', s0, q[1], 'a', 2, 0.8, 100),
      duel(2, 'mid', s0, q[2], 'a', 3, 0.7, 200),
      duel(3, 'mid', s0, q[3], 'a', 4, 0.6, 300),
    ];
    const out = buildCommentary({ result: result(duels, 'a', 'commander'), armies, quality, prior: { a: 0.5, b: 0.5 } });
    const streaks = out.highlights.filter((e) => e.id.startsWith('duel-'));
    expect(streaks).toHaveLength(1);
    expect(streaks[0].id).toBe('duel-3');
    expect(streaks[0].title).toContain('4연승');
    expect(streaks[0].side).toBe('a');
  });

  test('체력 25% 이하로 버틴 승리', () => {
    const duels = [duel(0, 'top', lane('top')[0], armies.b.lanes.top[0], 'b', 1, 0.2, 0)];
    const out = buildCommentary({ result: result(duels, 'b', 'commander'), armies, quality, prior: { a: 0.5, b: 0.5 } });
    const h = out.highlights.find((e) => e.id === 'duel-0')!;
    expect(h.title).toContain('체력 20%로 버티며');
    expect(h.arena).toBe('top');
    expect(h.laneLabel).toBe('상단');
  });

  test('a timeout win on little hp is not a highlight', () => {
    const duels = [duel(0, 'top', lane('top')[0], armies.b.lanes.top[0], 'b', 1, 0.2, 0, 'timeout')];
    const out = buildCommentary({ result: result(duels, 'b', 'commander'), armies, quality, prior: { a: 0.5, b: 0.5 } });
    const e = out.entries.find((x) => x.id === 'duel-0')!;
    expect(e.badge).toBe('advantage');
    expect(e.title).toContain('시간 끝까지');
  });

  test('only the closest held-on rout win of a lane is a highlight', () => {
    const t = lane('top');
    const q = armies.b.lanes.top;
    const m = lane('mid');
    const duels = [
      duel(0, 'top', t[0], q[0], 'b', 1, 0.2, 0),
      duel(1, 'top', t[1], q[0], 'b', 2, 0.1, 100),
      duel(2, 'top', t[2], q[0], 'b', 3, 0.5, 200),
      duel(3, 'mid', m[0], armies.b.lanes.mid[0], 'a', 1, 0.15, 0),
    ];
    const out = buildCommentary({ result: result(duels, 'b', 'commander'), armies, quality, prior: { a: 0.5, b: 0.5 } });
    const ids = out.highlights.filter((e) => e.id.startsWith('duel-')).map((e) => e.id);
    expect([...ids].sort()).toEqual(['duel-1', 'duel-2', 'duel-3']);
    const first = out.entries.find((e) => e.id === 'duel-0')!;
    expect(first.badge).toBe('advantage');
    expect(first.title).toContain('체력 20%로 버티며');
  });

  test('a winner above 25% is not a highlight', () => {
    const duels = [duel(0, 'top', lane('top')[0], armies.b.lanes.top[0], 'b', 1, 0.5, 0)];
    const out = buildCommentary({ result: result(duels, 'b', 'commander'), armies, quality, prior: { a: 0.5, b: 0.5 } });
    expect(out.highlights.find((e) => e.id === 'duel-0')).toBeUndefined();
    expect(out.entries.find((e) => e.id === 'duel-0')!.badge).toBe('advantage');
  });

  test('커맨더 격파', () => {
    const out = buildCommentary({ result: result([], 'a', 'commander'), armies, quality, prior: { a: 0.5, b: 0.5 } });
    const h = out.highlights.find((e) => e.id === 'commander-b')!;
    expect(h.side).toBe('a');
    expect(h.arena).toBe('final');
    expect(h.title).toContain('장수');
    expect(h.focus).toEqual([{ side: 'b', index: -1 }]);
    expect(out.highlights.map((e) => e.tick)).toEqual([...out.highlights.map((e) => e.tick)].sort((x, y) => x - y));
  });

  test('a draw has no winner label', () => {
    const out = buildCommentary({ result: result([], null, 'draw'), armies, quality, prior: { a: 0.5, b: 0.5 } });
    const end = out.entries.find((e) => e.id === 'end')!;
    expect(end.side).toBeNull();
    expect(end.badgeText).toBe('무승부');
    expect(out.highlights).toHaveLength(0);
  });
});
