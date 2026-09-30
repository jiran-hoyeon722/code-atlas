import { LIMITS, VICTORY_LABEL } from '../../../engine/battle/rules';
import { buildArmy, LANES } from '../../../engine/battle/sim';
import type { Army, Lane, Prediction } from '../../../engine/battle/sim/types';
import type { Quality } from '../../../engine/battle/types';
import { codeLines, langLabel } from '../select/format';

export type Side = 'a' | 'b';

export interface MetricRow {
  key: 'readability' | 'tangle' | 'duplication' | 'tests' | 'hotspot';
  label: string;
  value: string;
  /** Bar length 0..1; null = not measured, no bar. */
  fill: number | null;
  /** Small caveat next to the label. */
  note?: string;
}

export interface SideView {
  side: Side;
  name: string;
  sub: string;
  rows: MetricRow[];
  commander: string;
  warnings: string[];
  config: { sourceDir: string; exclude: string[]; testPatterns: string[]; excluded: string };
}

export interface LaneView {
  lane: Lane;
  label: string;
  /** Squad names in queue order, first = vanguard. */
  a: string[];
  b: string[];
}

export interface CountsView {
  runs: number;
  a: number;
  b: number;
  draws: number;
  verdict: string;
}

export interface BriefingView {
  match: number;
  sides: [SideView, SideView];
  lanes: LaneView[];
  counts: CountsView | null;
}

const LANE_LABEL: Record<Lane, string> = { top: '상단 레인 선봉', mid: '중앙 레인 선봉', bottom: '하단 레인 선봉' };

// Bar full scale per metric, as in the style frame: 8× the limit, 20% tangled, 10% copied, 100% tests.
const SCALE = { readability: 8, tangle: 0.2, duplication: 0.1, tests: 1 } as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

export const WARNING_TEXT: Record<Quality['warnings'][number], string> = {
  shaky: '코드가 적어 결과가 흔들릴 수 있어요',
  'excluded-heavy': `제외 비중 높음 · 측정에서 뺀 코드가 ${Math.round(LIMITS.excludedWarn * 100)}%를 넘어요`,
};

/** "기준의 3.2배", or "기준 통과" at or under the four-star limit. */
export function excessText(v: number): string {
  const r = Math.round(v * 10) / 10;
  return v <= 1 ? '기준 통과' : `기준의 ${r.toFixed(1)}배`;
}

/** Share with one decimal; a tiny non-zero share never reads as 0. */
export function percentText(v: number, digits: 0 | 1 = 1): string {
  const p = Math.max(0, v) * 100;
  const step = digits === 1 ? 10 : 1;
  const r = Math.round(p * step) / step;
  if (r === 0) return p > 0 ? `${digits === 1 ? '0.1' : '1'}% 미만` : '0%';
  return `${r.toFixed(digits)}%`;
}

function lastSegment(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/** Squad name for people: last folder segment + 부대. Root files lose their extension. */
export function squadName(folder: string): string {
  let seg = lastSegment(folder);
  if (!folder.includes('/')) {
    const dot = seg.lastIndexOf('.');
    if (dot > 0) seg = seg.slice(0, dot);
  }
  return seg ? `${seg} 부대` : '이름 없는 부대';
}

export function commanderText(q: Quality): string {
  const display = q.commander.display || lastSegment(q.commander.files[0] ?? '');
  if (!display) return '없음';
  const rest = q.commander.files.length - 1;
  return rest > 0 ? `${display} 외 ${rest}개` : display;
}

const DIGIT_BATCHIM = [true, true, false, true, false, false, true, true, true, false];

/**
 * 이/가 for a name. Hangul checks the final consonant; digits and Latin letters go by how they are
 * read aloud (l, m, n end in a consonant); anything else falls back to "이(가)".
 */
export function subjectParticle(name: string): '이' | '가' | '이(가)' {
  const ch = name.trim().slice(-1);
  if (!ch) return '이(가)';
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? '가' : '이';
  if (ch >= '0' && ch <= '9') return DIGIT_BATCHIM[code - 48] ? '이' : '가';
  if (/[a-z]/i.test(ch)) return /[lmn]/i.test(ch) ? '이' : '가';
  return '이(가)';
}

export function verdictText(prior: Prediction, a: string, b: string): string {
  const runs = Math.max(1, prior.runs);
  const lead = Math.max(prior.aWins, prior.bWins);
  if (prior.aWins === prior.bWins || lead / runs < VICTORY_LABEL.skill) return '박빙이에요';
  const name = prior.aWins > prior.bWins ? a : b;
  return `${name}${subjectParticle(name)} 우세해요`;
}

function rows(q: Quality, langDiffers: boolean): MetricRow[] {
  const s = q.scores;
  return [
    {
      key: 'readability',
      label: '복잡한 함수',
      value: excessText(s.readability),
      fill: clamp01(s.readability / SCALE.readability),
      note: langDiffers ? '언어 차이 오차 가능' : undefined,
    },
    { key: 'tangle', label: '서로 얽힌 코드', value: percentText(s.tangle), fill: clamp01(s.tangle / SCALE.tangle) },
    { key: 'duplication', label: '복붙한 코드', value: percentText(s.duplication), fill: clamp01(s.duplication / SCALE.duplication) },
    { key: 'tests', label: '테스트 코드', value: percentText(s.tests, 0), fill: clamp01(s.tests / SCALE.tests) },
    { key: 'hotspot', label: '불안한 수정', value: 'v1 에서는 재지 않아요', fill: null },
  ];
}

function sideView(side: Side, q: Quality, langDiffers: boolean): SideView {
  return {
    side,
    name: q.name,
    sub: `${langLabel(q.lang)} · ${codeLines(q.totals.prodLines)}`,
    rows: rows(q, langDiffers),
    commander: commanderText(q),
    warnings: q.warnings.map((w) => WARNING_TEXT[w] ?? w),
    config: {
      sourceDir: q.config.sourceDir || '레포 전체',
      exclude: [...q.config.exclude],
      testPatterns: [...q.config.testPatterns],
      excluded: codeLines(q.config.excludedLines).replace(/^코드 /, ''),
    },
  };
}

function laneQueue(army: Army, lane: Lane): string[] {
  return army.lanes[lane].map((i) => squadName(army.squads[i].name));
}

/** Everything the briefing shows, from the two measured repos and (once ready) the prediction. */
export function briefingView(a: Quality, b: Quality, prior: Prediction | null, match: number): BriefingView {
  const langDiffers = a.lang !== b.lang;
  const armyA = buildArmy(a);
  const armyB = buildArmy(b);
  return {
    match,
    sides: [sideView('a', a, langDiffers), sideView('b', b, langDiffers)],
    lanes: LANES.map((lane) => ({ lane, label: LANE_LABEL[lane], a: laneQueue(armyA, lane), b: laneQueue(armyB, lane) })),
    counts: prior
      ? { runs: prior.runs, a: prior.aWins, b: prior.bWins, draws: prior.draws, verdict: verdictText(prior, a.name, b.name) }
      : null,
  };
}
