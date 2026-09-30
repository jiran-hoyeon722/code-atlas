import type { FixReason } from '../../../engine/battle/fixes';
import { FOUR_STAR } from '../../../engine/battle/rules';
import type { BattleReason, Side, VictoryLabel } from '../../../engine/battle/sim';
import type { Quality } from '../../../engine/battle/types';

export const LABEL_TEXT: Record<VictoryLabel, string> = { skill: '실력 승', close: '박빙 승', upset: '역전 승' };

export const REASON_TEXT: Record<BattleReason, string> = {
  commander: '상대 장수를 쓰러뜨림',
  timeout: '시간이 다 됨',
  draw: '무승부',
};

export const FIX_REASON_TEXT: Record<FixReason, string> = {
  complexity: '갈림길이 많은 함수',
  length: '너무 긴 함수',
  tangle: '서로 얽힌 파일',
  duplication: '복붙한 코드',
};

export const other = (s: Side): Side => (s === 'a' ? 'b' : 'a');

/** One decimal, trailing ".0" dropped: 0.1234 → "12.3%", 0.05 → "5%". */
export function percent(x: number): string {
  const v = Math.round(x * 1000) / 10;
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}%`;
}

/** Win-share change in percentage points: +15%p, −5%p, +0%p. */
export function pointDelta(delta: number): string {
  const n = Math.round(delta * 100);
  return n < 0 ? `−${-n}%p` : `+${n}%p`;
}

export interface MetricCell {
  text: string;
  /** Comparable number where lower is better, or null when the metric is not measured. */
  rank: number | null;
}

export interface MetricRow {
  id: 'readability' | 'tangle' | 'duplication' | 'tests' | 'hotspot';
  label: string;
  hint: string;
  note: string | null;
  cells: Record<Side, MetricCell>;
  better: Side | null;
}

function readability(q: Quality): MetricCell {
  const x = q.scores.readability;
  if (x <= 1) return { text: '기준 통과', rank: 0 };
  const v = Math.round(x * 10) / 10;
  return { text: `기준의 ${v.toFixed(1)}배`, rank: v };
}

function share(x: number, higherIsBetter = false): MetricCell {
  const text = percent(x);
  const v = Math.round(x * 1000);
  return { text, rank: higherIsBetter ? -v : v };
}

function betterOf(cells: Record<Side, MetricCell>): Side | null {
  const { a, b } = cells;
  if (a.rank === null || b.rank === null || a.rank === b.rank) return null;
  return a.rank < b.rank ? 'a' : 'b';
}

/** The "왜 이겼나" table: plain words, and the better side only when the shown values differ. */
export function metricRows(a: Quality, b: Quality): MetricRow[] {
  const q = { a, b };
  const row = (base: Omit<MetricRow, 'cells' | 'better'>, cell: (x: Quality) => MetricCell): MetricRow => {
    const cells = { a: cell(q.a), b: cell(q.b) };
    return { ...base, cells, better: betterOf(cells) };
  };
  return [
    row(
      {
        id: 'readability',
        label: '복잡한 함수',
        hint: '갈림길이 많거나 긴 함수가 품질 기준(4성)보다 얼마나 많은지예요. 낮을수록 좋아요',
        note: a.lang !== b.lang ? '언어 차이 오차 가능' : null,
      },
      readability,
    ),
    row(
      { id: 'tangle', label: '서로 얽힌 코드', hint: '파일끼리 서로를 물고 도는 묶음에 든 코드 비율이에요. 낮을수록 좋아요', note: null },
      (x) => share(x.scores.tangle),
    ),
    row(
      {
        id: 'duplication',
        label: '복붙한 코드',
        hint: '똑같이 복사된 코드 중 지워도 되는 줄의 비율이에요. 낮을수록 좋아요',
        note: `4성 기준 ${percent(FOUR_STAR.duplication)} 이하`,
      },
      (x) => share(x.scores.duplication),
    ),
    row(
      { id: 'tests', label: '테스트 코드', hint: '운영 코드 대비 테스트 코드 양이에요(최대 100%). 높을수록 좋아요', note: null },
      (x) => share(x.scores.tests, true),
    ),
    row(
      { id: 'hotspot', label: '불안한 수정', hint: '위험한 함수가 든 파일을 자주 고치는 정도예요. 수정 기록이 필요해요', note: null },
      () => ({ text: 'v1 에서는 재지 않아요', rank: null }),
    ),
  ];
}
