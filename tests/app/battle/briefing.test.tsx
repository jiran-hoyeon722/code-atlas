import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Prediction } from '../../../src/engine/battle/sim/types';
import type { Quality } from '../../../src/engine/battle/types';
import { BriefingScreen, type BriefingScreenProps } from '../../../src/features/battle/briefing/BriefingScreen';
import { fakes, quality } from './fakes';

afterEach(cleanup);

function setup(over: Partial<BriefingScreenProps> & { a?: Quality; b?: Quality } = {}) {
  const f = fakes();
  const props: BriefingScreenProps = {
    deps: f.deps,
    a: quality('alpha'),
    b: quality('beta', { lang: 'php' }),
    match: 1,
    prior: null,
    onPrior: vi.fn(),
    onMatch: vi.fn(),
    onBack: vi.fn(),
    onStart: vi.fn(),
    ...over,
  };
  const view = render(<BriefingScreen {...props} />);
  return { ...f, props, view };
}

const start = () => screen.getByRole('button', { name: '전투 시작하기' }) as HTMLButtonElement;

test('loading → counts → start', async () => {
  const { predictions, props, view } = setup();
  expect(predictions).toHaveLength(1);
  expect(predictions[0].a).toBe(props.a);
  expect(screen.getByText('시뮬레이션 100번 돌리는 중 · 0/100')).toBeTruthy();
  expect(start().disabled).toBe(true);
  act(() => predictions[0].progress(37, 100));
  expect(screen.getByText('시뮬레이션 100번 돌리는 중 · 37/100')).toBeTruthy();

  const prior: Prediction = { runs: 100, aWins: 58, bWins: 40, draws: 2 };
  await act(async () => predictions[0].resolve(prior));
  expect(props.onPrior).toHaveBeenCalledWith(prior);
  // the parent hands the prediction back as a prop
  view.rerender(<BriefingScreen {...props} prior={prior} />);
  expect(predictions).toHaveLength(1);
  const counts = screen.getByRole('region', { name: '시뮬레이션 100번 중 이긴 횟수' });
  expect(within(counts).getByText('58')).toBeTruthy();
  expect(within(counts).getByText('40')).toBeTruthy();
  expect(within(counts).getByText('박빙이에요')).toBeTruthy();
  expect(within(counts).getByText('비김 2번')).toBeTruthy();
  expect(start().disabled).toBe(false);
  fireEvent.click(start());
  expect(props.onStart).toHaveBeenCalledTimes(1);
});

test('a clear lead names the leader with the right particle', async () => {
  setup({ prior: { runs: 100, aWins: 12, bWins: 88, draws: 0 }, b: quality('주문') });
  expect(screen.getByText('주문이 우세해요')).toBeTruthy();
});

test('other outcome bumps the match, back returns to the picker', () => {
  const { props } = setup({ match: 4, prior: { runs: 100, aWins: 50, bWins: 50, draws: 0 } });
  expect(screen.getByRole('heading', { name: '레포 전쟁 대결 #4' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '다른 전개 보기' }));
  expect(props.onMatch).toHaveBeenCalledWith(5);
  fireEvent.click(screen.getByRole('button', { name: '레포 다시 고르기' }));
  expect(props.onBack).toHaveBeenCalledTimes(1);
});

test('a failed prediction can be retried; leaving cancels the job', async () => {
  const { predictions, view } = setup();
  await act(async () => predictions[0].reject(new Error('boom')));
  const alert = screen.getByRole('alert');
  expect(within(alert).getByText('시뮬레이션을 돌리지 못했어요')).toBeTruthy();
  expect(start().disabled).toBe(true);
  fireEvent.click(within(alert).getByRole('button', { name: '다시 돌리기' }));
  expect(predictions).toHaveLength(2);
  expect(screen.getByText('시뮬레이션 100번 돌리는 중 · 0/100')).toBeTruthy();
  view.unmount();
  expect(predictions[1].cancel).toHaveBeenCalled();
});

test('side cards: metrics, language caveat, commander, vanguards, settings and warnings', () => {
  const a = quality('alpha', {
    scores: { readability: 3.24, complexityExcess: 0, lengthExcess: 0, tangle: 0.084, duplication: 0.051, duplicationExcess: 0, tests: 0.64, hotspot: null },
    config: { sourceDir: 'src', exclude: ['**/*.gen.ts'], testPatterns: ['**/*.test.*'], excludedLines: 250 },
    warnings: ['excluded-heavy'],
    commander: { files: ['src/app/main.ts', 'src/app/b.ts', 'src/app/c.ts'], display: 'main.ts' },
  });
  setup({ a });
  const card = within(screen.getByRole('region', { name: 'alpha' }));
  expect(card.getByText('기준의 3.2배')).toBeTruthy();
  expect(card.getByText('8.4%')).toBeTruthy();
  expect(card.getByText('5.1%')).toBeTruthy();
  expect(card.getByText('64%')).toBeTruthy();
  expect(card.getByText('v1 에서는 재지 않아요')).toBeTruthy();
  expect(card.getByText('언어 차이 오차 가능')).toBeTruthy();
  expect(card.getByText('main.ts 외 2개')).toBeTruthy();
  expect(card.getByText('제외 비중 높음 · 측정에서 뺀 코드가 10%를 넘어요')).toBeTruthy();

  const toggle = card.getByRole('button', { name: '측정 설정' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(card.queryByText('**/*.gen.ts')).toBeNull();
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(card.getByText('**/*.gen.ts')).toBeTruthy();
  expect(card.getByText('**/*.test.*')).toBeTruthy();
  expect(card.getByText('250줄')).toBeTruthy();
  fireEvent.click(card.getByRole('button', { name: '닫기' }));
  expect(card.queryByText('**/*.gen.ts')).toBeNull();
  expect(document.activeElement).toBe(toggle);

  const field = within(screen.getByRole('region', { name: '부대 배치' }));
  expect(field.getByText('양쪽 15개 부대 · 3개 레인')).toBeTruthy();
  for (const label of ['상단 레인 선봉', '중앙 레인 선봉', '하단 레인 선봉']) expect(field.getByText(label)).toBeTruthy();
  expect(field.getAllByText('app 부대')).toHaveLength(6);
});

test('repo text is rendered as text, never as markup', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const a = quality(evil, {
    config: { sourceDir: evil, exclude: [evil], testPatterns: [], excludedLines: 0 },
    commander: { files: [`src/${evil}`], display: evil },
    files: [quality('x').files[0], { ...quality('x').files[0], path: `${evil}/y.ts` }],
  });
  const { view } = setup({ a, prior: { runs: 100, aWins: 70, bWins: 30, draws: 0 } });
  fireEvent.click(within(screen.getByRole('region', { name: evil })).getByRole('button', { name: '측정 설정' }));
  expect(screen.getAllByText(evil).length).toBeGreaterThan(2);
  expect(view.container.querySelector('img')).toBeNull();
});
