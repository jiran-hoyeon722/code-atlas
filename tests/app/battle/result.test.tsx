import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { buildCommentary } from '../../../src/engine/battle/commentary';
import type { FixCandidate } from '../../../src/engine/battle/fixes';
import { buildArmy, simulate, type BattleResult } from '../../../src/engine/battle/sim';
import type { Quality } from '../../../src/engine/battle/types';
import { ResultScreen, type ResultScreenProps } from '../../../src/features/battle/result/ResultScreen';
import { metricRows, percent, pointDelta } from '../../../src/features/battle/result/format';
import { synthQuality } from '../../engine/battle/synth';

afterEach(cleanup);

const A = synthQuality({ name: 'alpha', totalLines: 4000, seed: 3, cycleShare: 0.2, removableShare: 0.06, testRatio: 0.2 });
const B = synthQuality({ name: 'beta', totalLines: 4000, seed: 4, cycleShare: 0.02, removableShare: 0.02, testRatio: 0.6 });
const REAL = simulate(A, B, 1, { record: true });

function withScores(q: Quality, over: Partial<Quality['scores']>): Quality {
  return { ...q, scores: { ...q.scores, ...over } };
}

function fix(path: string, delta: number, over: Partial<FixCandidate> = {}): FixCandidate {
  return { path, penalty: 10, reasons: ['complexity', 'tangle'], baseline: 0.1, improved: 0.1 + delta, delta, ...over };
}

function setup(over: Partial<ResultScreenProps> = {}) {
  const props: ResultScreenProps = {
    a: A,
    b: B,
    match: 3,
    prior: { a: 0.3, b: 0.7 },
    result: { ...REAL, winner: 'b', reason: 'commander', survivors: { a: 0, b: 42 } },
    loadFixes: vi.fn(() => Promise.resolve([fix('src/mod1/file4.ts', 0.15)])),
    onRematch: vi.fn(),
    onHome: vi.fn(),
    ...over,
  };
  const view = render(<ResultScreen {...props} />);
  return { props, view };
}

const verdict = () => screen.getByRole('region', { name: /승리|무승부/ });

test('shows the winner, the label from its prior, the odds, the end reason and survivors', async () => {
  setup();
  const v = verdict();
  expect(within(v).getByRole('heading').textContent).toBe('beta 승리');
  expect(within(v).getByText('실력 승')).toBeTruthy();
  expect(within(v).getByText('시뮬레이션 100번 중 70번 이긴 쪽이에요')).toBeTruthy();
  expect(within(v).getByText('끝난 이유 · 상대 장수를 쓰러뜨림')).toBeTruthy();
  expect(v.querySelector('[data-side="a"] .rb-res-big')!.textContent).toBe('0명');
  expect(v.querySelector('[data-side="b"] .rb-res-big')!.textContent).toBe('42명');
  await act(async () => {});
});

test.each([
  [0.5, '박빙 승'],
  [0.4, '박빙 승'],
  [0.39, '역전 승'],
  [0.6, '실력 승'],
])('winner prior %s reads %s', async (p, label) => {
  setup({ prior: { a: 1 - p, b: p }, result: { ...REAL, winner: 'b', reason: 'timeout' } });
  expect(within(verdict()).getByText(label)).toBeTruthy();
  expect(within(verdict()).getByText('끝난 이유 · 시간이 다 됨')).toBeTruthy();
  await act(async () => {});
});

test('a draw has no label, shows both odds and skips the fix search', () => {
  const loadFixes = vi.fn(() => Promise.resolve([]));
  setup({ loadFixes, prior: { a: 0.48, b: 0.46 }, result: { ...REAL, winner: null, reason: 'draw' } as BattleResult });
  const v = verdict();
  expect(within(v).getByRole('heading').textContent).toBe('무승부');
  expect(within(v).queryByText(/승$/)).toBeNull();
  expect(within(v).getByText('시뮬레이션 100번 중 alpha 48번, beta 46번 이겼어요')).toBeTruthy();
  expect(within(v).getByText('끝난 이유 · 무승부')).toBeTruthy();
  expect(loadFixes).not.toHaveBeenCalled();
  expect(screen.getByText(/비겨서 진 쪽이 없어요/)).toBeTruthy();
  expect(screen.getByRole('heading', { name: '무엇이 달랐나' })).toBeTruthy();
});

test('metric rows use plain words and mark only the better shown value', () => {
  const a = withScores(A, { readability: 3.24, tangle: 0.1234, duplication: 0.05, tests: 0.2 });
  const b = { ...withScores(B, { readability: 0.8, tangle: 0.1234, duplication: 0.0123, tests: 0.65 }), lang: 'php' as const };
  const rows = Object.fromEntries(metricRows(a, b).map((r) => [r.id, r]));
  expect(rows.readability.cells.a.text).toBe('기준의 3.2배');
  expect(rows.readability.cells.b.text).toBe('기준 통과');
  expect(rows.readability.better).toBe('b');
  expect(rows.readability.note).toBe('언어 차이 오차 가능');
  expect(rows.tangle.cells.a.text).toBe('12.3%');
  expect(rows.tangle.better).toBeNull();
  expect(rows.duplication.cells.a.text).toBe('5%');
  expect(rows.duplication.cells.b.text).toBe('1.2%');
  expect(rows.duplication.note).toBe('4성 기준 4.6% 이하');
  expect(rows.duplication.better).toBe('b');
  expect(rows.tests.better).toBe('b');
  expect(rows.hotspot.cells.a.text).toBe('v1 에서는 재지 않아요');
  expect(rows.hotspot.better).toBeNull();
  expect(metricRows(A, B)[0].note).toBeNull();
  expect(percent(0)).toBe('0%');
  expect(pointDelta(0.15)).toBe('+15%p');
  expect(pointDelta(-0.05)).toBe('−5%p');
  expect(pointDelta(0)).toBe('+0%p');
});

test('the table marks the better side and says it does not decide the winner', async () => {
  setup({ a: withScores(A, { tests: 0.9 }), b: withScores(B, { tests: 0.3 }) });
  const why = screen.getByRole('region', { name: '왜 이겼나' });
  expect(within(why).getByText(/승패는 전투 결과로만 정해져요/)).toBeTruthy();
  const tests = why.querySelector('[data-metric="tests"]')!;
  const lead = tests.querySelector('[data-better="true"]')!;
  expect(lead.getAttribute('data-side')).toBe('a');
  expect(lead.textContent).toBe('90%앞섬');
  expect(tests.querySelector('[data-side="b"]')!.textContent).toBe('30%');
  await act(async () => {});
});

test('fixes load, list the loser files with reasons and +N%p', async () => {
  let resolve!: (v: FixCandidate[]) => void;
  const loadFixes = vi.fn(() => new Promise<FixCandidate[]>((ok) => (resolve = ok)));
  setup({ loadFixes });
  const card = screen.getByRole('region', { name: '고칠 곳' });
  expect(within(card).getByRole('status').textContent).toContain('다시 싸워 보는 중이에요');
  expect(within(card).getByText('alpha')).toBeTruthy();
  await act(async () => resolve([fix('src/mod1/file4.ts', 0.15), fix('src/mod2/file9.ts', 0, { reasons: ['duplication'] })]));
  const items = within(card).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0].textContent).toContain('file4.ts');
  expect(items[0].textContent).toContain('src/mod1/');
  expect(items[0].textContent).toContain('갈림길이 많은 함수 · 서로 얽힌 파일');
  expect(items[0].textContent).toContain('+15%p');
  expect(items[1].textContent).toContain('복붙한 코드');
  expect(items[1].textContent).toContain('+0%p');
  expect(within(card).getByText(/이길 확률은 10%예요/)).toBeTruthy();
  expect(loadFixes).toHaveBeenCalledTimes(1);
});

test('a failed fix search can be retried', async () => {
  const loadFixes = vi
    .fn<() => Promise<FixCandidate[]>>()
    .mockRejectedValueOnce(new Error('worker died'))
    .mockResolvedValueOnce([fix('src/a.ts', 0.05)]);
  setup({ loadFixes });
  const card = screen.getByRole('region', { name: '고칠 곳' });
  await act(async () => {});
  expect(within(card).getByRole('alert').textContent).toContain('계산하지 못했어요');
  await act(async () => fireEvent.click(within(card).getByRole('button', { name: '다시 계산하기' })));
  expect(within(card).queryByRole('alert')).toBeNull();
  expect(within(card).getByText('+5%p')).toBeTruthy();
  expect(loadFixes).toHaveBeenCalledTimes(2);
});

test('an empty fix list says so', async () => {
  setup({ loadFixes: () => Promise.resolve([]) });
  await act(async () => {});
  expect(screen.getByText('눈에 띄게 손볼 파일이 없어요')).toBeTruthy();
});

test('shows the commentary highlights except the ending line', async () => {
  const result = REAL;
  const prior = { a: 0.45, b: 0.55 };
  const expected = buildCommentary({ result, prior, armies: { a: buildArmy(A), b: buildArmy(B) }, quality: { a: A, b: B } })
    .highlights.filter((e) => e.id !== 'end')
    .slice(0, 5);
  setup({ result, prior });
  const scenes = screen.getByRole('region', { name: '명장면' });
  if (expected.length === 0) expect(within(scenes).getByText(/눈에 띄는 장면 없이/)).toBeTruthy();
  const titles = Array.from(scenes.querySelectorAll('.rb-res-scene-title')).map((n) => n.textContent);
  expect(titles).toEqual(expected.map((e) => e.title));
  await act(async () => {});
});

test('settings show both sides exclude, test patterns and rule versions', async () => {
  const a = { ...A, config: { ...A.config, exclude: ['gen/**'], testPatterns: ['spec/**'] } };
  setup({ a });
  const set = screen.getByRole('region', { name: '설정 공개' });
  expect(within(set).getByText('gen/**')).toBeTruthy();
  expect(within(set).getByText('spec/**')).toBeTruthy();
  expect(within(set).getByText('없음')).toBeTruthy();
  expect(within(set).getByText(`전투 규칙 버전 ${REAL.ruleVersion}`)).toBeTruthy();
  await act(async () => {});
});

test('buttons rematch and go home', async () => {
  const { props } = setup();
  fireEvent.click(screen.getByRole('button', { name: '다시 싸우기' }));
  fireEvent.click(screen.getByRole('button', { name: '처음으로' }));
  expect(props.onRematch).toHaveBeenCalledTimes(1);
  expect(props.onHome).toHaveBeenCalledTimes(1);
  expect(screen.getByText('다시 싸우면 대결 #4 로 새 전투를 해요')).toBeTruthy();
  await act(async () => {});
});

test('repo-derived names and paths render as text, never as markup', async () => {
  const evil = '<img src=x onerror="window.__pwned=1">';
  const a = { ...A, name: `${evil}repo`, config: { ...A.config, exclude: [evil] } };
  const { view } = setup({ a, loadFixes: () => Promise.resolve([fix(`src/${evil}.ts`, 0.1)]) });
  await act(async () => {});
  expect(view.container.querySelector('img')).toBeNull();
  expect(view.container.textContent).toContain(`${evil}.ts`);
  expect(view.container.textContent).toContain(`${evil}repo`);
  expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
});
