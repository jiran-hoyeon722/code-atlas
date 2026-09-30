import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { simulate } from '../../../src/engine/battle/sim';
import { EngageScreen } from '../../../src/features/battle/engage/EngageScreen';
import { synthQuality } from '../../engine/battle/synth';

const qa = synthQuality({ name: 'left', seed: 3, cycleShare: 0.3, removableShare: 0.1, testRatio: 0.2 });
const qb = synthQuality({ name: 'right', seed: 9, ccnShares: [0.4, 0.3, 0.2, 0.1], testRatio: 0.8 });

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('without WebGL it shows a plain message, the whole commentary and a result button', () => {
  const onDone = vi.fn();
  render(<EngageScreen a={qa} b={qb} match={1} prior={{ a: 0.45, b: 0.55 }} onDone={onDone} onBack={() => {}} />);
  expect(screen.getByText(/3D 전장을 그릴 수 없어요/)).toBeTruthy();
  expect(document.querySelector('canvas')).toBeNull();

  const panel = screen.getByRole('complementary', { name: '전투 해설' });
  expect(within(panel).getByText('최종전이 시작됐어요')).toBeTruthy();
  expect(within(panel).queryByText('교전이 시작되면 여기에 해설이 쌓여요.')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '결과 보기' }));
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(onDone.mock.calls[0][0]).toEqual(simulate(qa, qb, 1, { record: true }));
});

test('reduced motion skips the animation and says why', () => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
  render(<EngageScreen a={qa} b={qb} match={1} prior={{ a: 0.45, b: 0.55 }} onDone={() => {}} onBack={() => {}} />);
  expect(screen.getByText(/동작 줄이기 설정이 켜져 있어/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '결과 보기' })).toBeTruthy();
});

test('filters narrow the log and the back button calls onBack', () => {
  const onBack = vi.fn();
  render(<EngageScreen a={qa} b={qb} match={1} prior={{ a: 0.45, b: 0.55 }} onDone={() => {}} onBack={onBack} />);
  const panel = screen.getByRole('complementary', { name: '전투 해설' });
  const count = () => panel.querySelectorAll('.rb-eng-log > li').length;
  const all = count();
  fireEvent.click(within(panel).getByRole('button', { name: '명장면' }));
  expect(within(panel).getByRole('button', { name: '명장면' }).getAttribute('aria-pressed')).toBe('true');
  expect(count()).toBeLessThan(all);
  fireEvent.click(within(panel).getByRole('button', { name: 'right' }));
  expect(Array.from(panel.querySelectorAll('.rb-eng-log .rb-eng-badge')).every((b) => !b.classList.contains('rb-eng-tone-a'))).toBe(true);
  fireEvent.click(within(panel).getByRole('button', { name: '브리핑으로' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('repo text is rendered as text, never as markup', () => {
  const evil = synthQuality({ name: '<img src=x onerror=alert(1)>', seed: 3 });
  render(<EngageScreen a={evil} b={qb} match={1} prior={{ a: 0.5, b: 0.5 }} onDone={() => {}} onBack={() => {}} />);
  expect(document.querySelector('img')).toBeNull();
  expect(screen.getAllByText('<img src=x onerror=alert(1)>').length).toBeGreaterThan(0);
});
