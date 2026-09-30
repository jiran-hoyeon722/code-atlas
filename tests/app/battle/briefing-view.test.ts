import { describe, expect, test } from 'vitest';
import type { Quality } from '../../../src/engine/battle/types';
import {
  briefingView,
  commanderText,
  excessText,
  percentText,
  squadName,
  subjectParticle,
  verdictText,
} from '../../../src/features/battle/briefing/view';
import { qfile, quality } from './fakes';

/** 15 files of 100 lines in their own folders: each squad of 20 soldiers is exactly one file. */
function foldered(name: string, root: string, over: Partial<Quality> = {}): Quality {
  const files = Array.from({ length: 15 }, (_, i) => qfile(`${root}/f${String(i).padStart(2, '0')}/x.ts`, 100));
  return quality(name, { files, totals: { prodLines: 1500, testLines: 0, testFiles: 0 }, ...over });
}

describe('formatting', () => {
  test('complexity excess reads as a multiple of the limit, or a pass', () => {
    expect(excessText(0)).toBe('기준 통과');
    expect(excessText(1)).toBe('기준 통과');
    expect(excessText(3.24)).toBe('기준의 3.2배');
    expect(excessText(12)).toBe('기준의 12.0배');
  });

  test('shares keep one decimal, tests none, and a tiny share never reads as 0', () => {
    expect(percentText(0.084)).toBe('8.4%');
    expect(percentText(0)).toBe('0%');
    expect(percentText(0.0004)).toBe('0.1% 미만');
    expect(percentText(0.64, 0)).toBe('64%');
    expect(percentText(1, 0)).toBe('100%');
  });

  test('squad names use the last folder segment', () => {
    expect(squadName('src/components')).toBe('components 부대');
    expect(squadName('app/Http/Controllers')).toBe('Controllers 부대');
    expect(squadName('main.ts')).toBe('main 부대');
    expect(squadName('')).toBe('이름 없는 부대');
  });

  test('commander is the top file plus how many more', () => {
    const q = quality('x', { commander: { files: ['a/Order.php', 'b', 'c'], display: 'Order.php' } });
    expect(commanderText(q)).toBe('Order.php 외 2개');
    expect(commanderText(quality('y'))).toBe('main.ts');
    expect(commanderText(quality('z', { commander: { files: [], display: '' } }))).toBe('없음');
  });
});

describe('verdict', () => {
  test('subject particle follows the last sound', () => {
    expect(subjectParticle('결제')).toBe('가');
    expect(subjectParticle('주문')).toBe('이');
    expect(subjectParticle('alpha')).toBe('가');
    expect(subjectParticle('kitchen')).toBe('이');
    expect(subjectParticle('mall')).toBe('이');
    expect(subjectParticle('repo1')).toBe('이');
    expect(subjectParticle('v2')).toBe('가');
    expect(subjectParticle('api)')).toBe('이(가)');
  });

  test('under 60 wins is close, otherwise the leader is ahead', () => {
    expect(verdictText({ runs: 100, aWins: 58, bWins: 42, draws: 0 }, 'a', 'b')).toBe('박빙이에요');
    expect(verdictText({ runs: 100, aWins: 50, bWins: 50, draws: 0 }, 'a', 'b')).toBe('박빙이에요');
    expect(verdictText({ runs: 100, aWins: 60, bWins: 40, draws: 0 }, '주문', 'b')).toBe('주문이 우세해요');
    expect(verdictText({ runs: 100, aWins: 25, bWins: 70, draws: 5 }, 'x', 'alpha')).toBe('alpha가 우세해요');
  });
});

describe('briefingView', () => {
  test('metric rows, bars and the unmeasured hotspot row', () => {
    const q = foldered('alpha', 'src', {
      scores: { readability: 3.24, complexityExcess: 4, lengthExcess: 2.48, tangle: 0.084, duplication: 0.051, duplicationExcess: 1.1, tests: 0.64, hotspot: null },
    });
    const [a] = briefingView(q, foldered('beta', 'app'), null, 1).sides;
    expect(a.rows.map((r) => [r.label, r.value])).toEqual([
      ['복잡한 함수', '기준의 3.2배'],
      ['서로 얽힌 코드', '8.4%'],
      ['복붙한 코드', '5.1%'],
      ['테스트 코드', '64%'],
      ['불안한 수정', 'v1 에서는 재지 않아요'],
    ]);
    expect(a.rows.map((r) => r.fill)).toEqual([3.24 / 8, 0.084 / 0.2, 0.051 / 0.1, 0.64, null]);
    expect(a.rows.every((r) => r.note === undefined)).toBe(true);
    expect(a.sub).toBe('TypeScript · 코드 1,500줄');
  });

  test('bars stop at full', () => {
    const q = foldered('a', 'src', { scores: { readability: 20, complexityExcess: 0, lengthExcess: 0, tangle: 0.9, duplication: 0.5, duplicationExcess: 0, tests: 1, hotspot: null } });
    expect(briefingView(q, q, null, 1).sides[0].rows.map((r) => r.fill)).toEqual([1, 1, 1, 1, null]);
  });

  test('different languages mark the readability row on both sides', () => {
    const view = briefingView(foldered('a', 'src'), foldered('b', 'app', { lang: 'php' }), null, 1);
    for (const s of view.sides) {
      expect(s.rows[0].note).toBe('언어 차이 오차 가능');
      expect(s.rows.slice(1).every((r) => r.note === undefined)).toBe(true);
    }
  });

  test('lane queues come from the army, first squad is the vanguard', () => {
    const view = briefingView(foldered('a', 'src'), foldered('b', 'app'), null, 1);
    // equal power: rank k goes to mid, top, bottom in turn
    expect(view.lanes.map((l) => [l.label, l.a[0], l.b[0]])).toEqual([
      ['상단 레인 선봉', 'f01 부대', 'f01 부대'],
      ['중앙 레인 선봉', 'f00 부대', 'f00 부대'],
      ['하단 레인 선봉', 'f02 부대', 'f02 부대'],
    ]);
    expect(view.lanes.map((l) => l.a.length)).toEqual([5, 5, 5]);
    expect(view.lanes[1].a).toEqual(['f00 부대', 'f03 부대', 'f06 부대', 'f09 부대', 'f12 부대']);
  });

  test('config, warnings and counts', () => {
    const a = foldered('a', 'src', {
      config: { sourceDir: 'src', exclude: ['**/*.gen.ts'], testPatterns: ['tests/**'], excludedLines: 400 },
      warnings: ['shaky', 'excluded-heavy'],
    });
    const none = briefingView(a, foldered('b', 'app'), null, 3);
    expect(none.match).toBe(3);
    expect(none.counts).toBeNull();
    const [sa, sb] = none.sides;
    expect(sa.config).toEqual({ sourceDir: 'src', exclude: ['**/*.gen.ts'], testPatterns: ['tests/**'], excluded: '400줄' });
    expect(sa.warnings).toEqual(['코드가 적어 결과가 흔들릴 수 있어요', '제외 비중 높음 · 측정에서 뺀 코드가 10%를 넘어요']);
    expect(sb.config.sourceDir).toBe('레포 전체');
    expect(sb.warnings).toEqual([]);

    const done = briefingView(a, foldered('b', 'app'), { runs: 100, aWins: 71, bWins: 27, draws: 2 }, 1);
    expect(done.counts).toEqual({ runs: 100, a: 71, b: 27, draws: 2, verdict: 'a가 우세해요' });
  });
});
