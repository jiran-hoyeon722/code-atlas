import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { simulate } from '../../../src/engine/battle/sim';
import type { Quality } from '../../../src/engine/battle/types';
import { BattleApp, priorShares } from '../../../src/features/battle/BattleApp';
import { synthQuality } from '../../engine/battle/synth';
import { fakes } from './fakes';

const A = synthQuality({ name: 'alpha', totalLines: 4000, seed: 3, cycleShare: 0.2, removableShare: 0.06, testRatio: 0.2 });
const B = synthQuality({ name: 'beta', totalLines: 4000, seed: 4, cycleShare: 0.02, removableShare: 0.02, testRatio: 0.6 });

beforeEach(() => {
  // jsdom has no WebGL, so the engagement takes its fallback path with the result button
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function choose(side: 'a' | 'b', name: string) {
  const f = new File(['export const a = 1;'], 'a.ts', { lastModified: 1 });
  Object.defineProperty(f, 'webkitRelativePath', { value: `${name}/src/a.ts` });
  const input = screen.getByTestId(`folder-input-${side}`) as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [f] });
  fireEvent.change(input);
}

async function toBriefing(a: Quality, b: Quality) {
  const f = fakes();
  render(<BattleApp deps={f.deps} />);
  choose('a', a.name);
  choose('b', b.name);
  await waitFor(() => expect(f.runs).toHaveLength(2));
  await act(async () => {
    f.runs[0].resolve(a);
    f.runs[1].resolve(b);
  });
  fireEvent.click(screen.getByRole('button', { name: '작전 브리핑 보기' }));
  await waitFor(() => expect(f.predictions).toHaveLength(1));
  await act(async () => f.predictions[0].resolve({ runs: 100, aWins: 30, bWins: 68, draws: 2 }));
  return f;
}

const verdict = () => screen.getByRole('region', { name: /승리|무승부/ });
const nameOf = (w: 'a' | 'b' | null) => (w === 'a' ? A.name : w === 'b' ? B.name : null);

test('prior shares divide the wins by the runs', () => {
  expect(priorShares({ runs: 100, aWins: 30, bWins: 68, draws: 2 })).toEqual({ a: 0.3, b: 0.68 });
  expect(priorShares({ runs: 0, aWins: 0, bWins: 0, draws: 0 })).toEqual({ a: 0, b: 0 });
});

test('briefing → engage → result → rematch bumps the match → home keeps both repos', async () => {
  const f = await toBriefing(A, B);
  fireEvent.click(screen.getByRole('button', { name: '전투 시작하기' }));
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: '전투 장면' }));
  expect(screen.getByText(/3D 전장을 그릴 수 없어요/)).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '결과 보기' }));
  const first = simulate(A, B, 1, { record: true });
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: '결과' }));
  expect(screen.getByText('대결 #1')).toBeTruthy();
  const w1 = first.winner;
  expect(within(verdict()).getByRole('heading').textContent).toBe(w1 ? `${nameOf(w1)} 승리` : '무승부');
  expect(within(verdict()).getByText(/시뮬레이션 100번 중/)).toBeTruthy();
  if (w1) {
    expect(f.fixes).toHaveLength(1);
    const loserSide = w1 === 'a' ? 'b' : 'a';
    expect(f.fixes[0]).toMatchObject({ loser: loserSide === 'a' ? A : B, winner: w1 === 'a' ? A : B, loserSide });
    const path = (loserSide === 'a' ? A : B).files[0].path;
    await act(async () => f.fixes[0].resolve([{ path, penalty: 5, reasons: ['complexity'], baseline: 0.2, improved: 0.35, delta: 0.15 }]));
    expect(document.querySelector(`[data-path="${path}"]`)).toBeTruthy();
  } else {
    expect(f.fixes).toHaveLength(0);
  }

  fireEvent.click(screen.getByRole('button', { name: '다시 싸우기' }));
  expect(screen.getByRole('heading', { name: '전투 장면' })).toBeTruthy();
  expect(f.predictions).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '결과 보기' }));
  expect(screen.getByText('대결 #2')).toBeTruthy();
  const w2 = simulate(A, B, 2, { record: true }).winner;
  expect(within(verdict()).getByRole('heading').textContent).toBe(w2 ? `${nameOf(w2)} 승리` : '무승부');
  expect(screen.getByText('다시 싸우면 대결 #3 로 새 전투를 해요')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '처음으로' }));
  expect(screen.getByRole('heading', { name: '레포 전쟁' })).toBeTruthy();
  expect(within(screen.getByRole('region', { name: '레포 A' })).getByText('alpha')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: '레포 B' })).getByText('beta')).toBeTruthy();
  expect((screen.getByRole('button', { name: '작전 브리핑 보기' }) as HTMLButtonElement).disabled).toBe(false);
});

test('leaving the result screen cancels an unfinished fix job; engage back returns to the briefing', async () => {
  const f = await toBriefing(A, B);
  fireEvent.click(screen.getByRole('button', { name: '전투 시작하기' }));
  fireEvent.click(screen.getByRole('button', { name: '브리핑으로' }));
  expect(screen.getByRole('heading', { name: '레포 전쟁 대결 #1' })).toBeTruthy();

  // find a match that ends with a winner so the fix list is requested
  let match = 1;
  while (!simulate(A, B, match).winner) match++;
  for (let m = 1; m < match; m++) fireEvent.click(screen.getByRole('button', { name: '다른 전개 보기' }));
  fireEvent.click(screen.getByRole('button', { name: '전투 시작하기' }));
  fireEvent.click(screen.getByRole('button', { name: '결과 보기' }));
  expect(f.fixes).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '다시 싸우기' }));
  expect(f.fixes[0].cancel).toHaveBeenCalledTimes(1);
});
