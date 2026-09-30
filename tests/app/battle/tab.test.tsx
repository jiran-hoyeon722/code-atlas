import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Architecture } from '../../../src/engine/architecture';
import { simulate } from '../../../src/engine/battle/sim';
import type { Quality } from '../../../src/engine/battle/types';
import { MEASURE_MSG } from '../../../src/features/battle/deps';
import { priorShares } from '../../../src/features/battle/prior';
import { BattleTab } from '../../../src/features/battle/tab/BattleTab';
import { mountBattle } from '../../../src/features/battle/tab/mountBattle';
import { QualityError } from '../../../src/features/battle/worker/client';
import type { BattleAccess, BattleLoadStep, OpponentSummary, ViewerEnv } from '../../../src/features/viewer-env';
import { synthQuality } from '../../engine/battle/synth';
import { fakes } from './fakes';

const A = synthQuality({ name: 'alpha', totalLines: 4000, seed: 3, cycleShare: 0.2, removableShare: 0.06, testRatio: 0.2 });
const B = synthQuality({ name: 'beta', totalLines: 4000, seed: 4, cycleShare: 0.02, removableShare: 0.02, testRatio: 0.6 });

const opp = (key: string, over: Partial<OpponentSummary> = {}): OpponentSummary => ({
  key,
  name: key,
  lang: 'ts',
  files: 1234,
  analyzedAt: '2026-09-12T03:00:00Z',
  source: 'local',
  readiness: 'ready',
  ...over,
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeAccess(list: OpponentSummary[], self: Quality | (() => Promise<Quality>) = A) {
  const loads: { key: string; step(s: BattleLoadStep): void; d: Deferred<Quality> }[] = [];
  const access: BattleAccess = {
    self: { key: 'self-key', name: 'alpha' },
    loadSelf: vi.fn(typeof self === 'function' ? self : () => Promise.resolve(self)),
    listOpponents: vi.fn(() => Promise.resolve(list)),
    loadOpponent: vi.fn((key: string, onStep?: (s: BattleLoadStep) => void) => {
      const d = deferred<Quality>();
      loads.push({ key, step: (s) => onStep?.(s), d });
      return d.promise;
    }),
  };
  return { access, loads };
}

function fakeEnv(battle?: BattleAccess): ViewerEnv {
  return {
    readSource: vi.fn(async () => null),
    vscodeHref: () => null,
    requestVscodeSetup: vi.fn(),
    selection: {},
    onSelect: vi.fn(),
    goto: vi.fn(),
    collapse: vi.fn(),
    battle,
  };
}

const arch = { name: 'alpha' } as Architecture;
const rowOf = (name: RegExp | string) => screen.getByRole('button', { name: typeof name === 'string' ? new RegExp(name) : name });

beforeEach(() => {
  // jsdom has no WebGL, so the engagement takes its fallback path with the result button
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('mountBattle', () => {
  test('without battle access it explains instead of showing the game, and disposes cleanly', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    let dispose!: () => void;
    await act(async () => {
      dispose = mountBattle(root, arch, fakeEnv());
    });
    expect(root.textContent).toContain('대결을 준비할 수 없어요');
    expect(root.querySelector('.rb-root')).toBeTruthy();
    await act(async () => {
      dispose();
      await Promise.resolve();
    });
    expect(root.childElementCount).toBe(0);
    root.remove();
  });

  test('with battle access it opens on the pick screen', async () => {
    const { access } = fakeAccess([opp('beta')]);
    const root = document.createElement('div');
    document.body.append(root);
    let dispose!: () => void;
    await act(async () => {
      dispose = mountBattle(root, arch, fakeEnv(access));
    });
    await waitFor(() => expect(root.textContent).toContain('바로 싸울 수 있어요'));
    expect(access.loadSelf).toHaveBeenCalledTimes(1);
    await act(async () => {
      dispose();
      await Promise.resolve();
    });
    root.remove();
  });
});

describe('pick screen', () => {
  test('lists self battle first, then registered repos with readiness texts; the open repo is not repeated', async () => {
    const { access } = fakeAccess([
      opp('self-key', { name: 'alpha' }),
      opp('ready-one', { source: 'github' }),
      opp('perm-one', { readiness: 'needs-permission', lang: 'php', files: 98765 }),
      opp('fetch-one', { readiness: 'refetch', source: 'github' }),
      opp('old-one', { readiness: 'reanalyze' }),
    ]);
    render(<BattleTab env={fakeEnv(access)} jobs={fakes().deps} />);
    expect(screen.getByRole('heading', { name: '레포 전쟁' })).toBeTruthy();
    expect(screen.getByText('코드 양이 아니라 품질로 싸워요')).toBeTruthy();
    await screen.findByText(/코드 4,000줄/);

    const rows = within(screen.getByRole('region', { name: 'B · 상대 고르기' })).getAllByRole('button');
    expect(rows.map((r) => r.querySelector('.rb-pick-row-name')?.textContent)).toEqual(['자기 자신과 대결', 'ready-one', 'perm-one', 'fetch-one', 'old-one']);
    expect(rows[1].textContent).toContain('바로 싸울 수 있어요');
    expect(rows[1].textContent).toContain('GitHub');
    expect(rows[2].textContent).toContain('폴더 읽기 권한을 한 번 더 물어봐요');
    expect(rows[2].textContent).toContain('PHP · 파일 98,765개');
    expect(rows[2].textContent).toContain('로컬');
    expect(rows[3].textContent).toContain('GitHub 에서 다시 받아요');
    expect(rows[4].textContent).toContain('폴더를 다시 열어 분석해야 해요');
    expect((rows[4] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(rows[4]);
    expect(access.loadOpponent).not.toHaveBeenCalled();
  });

  test('empty list says how to get opponents', async () => {
    const { access } = fakeAccess([opp('self-key')]);
    render(<BattleTab env={fakeEnv(access)} jobs={fakes().deps} />);
    expect(await screen.findByText('다른 레포를 한 번 분석하면 여기서 고를 수 있어요')).toBeTruthy();
  });

  test('self load failure with too-small shows the plain message and retries', async () => {
    let n = 0;
    const { access } = fakeAccess([], () => (n++ === 0 ? Promise.reject(new QualityError('too-small', 'x')) : Promise.resolve(A)));
    render(<BattleTab env={fakeEnv(access)} jobs={fakes().deps} />);
    const card = screen.getByRole('region', { name: 'A · 지금 연 레포' });
    expect(await within(card).findByText(MEASURE_MSG.tooSmall)).toBeTruthy();
    expect((rowOf('자기 자신과 대결') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(card).getByRole('button', { name: '다시 시도' }));
    await within(card).findByText(/코드 4,000줄/);
    expect((rowOf('자기 자신과 대결') as HTMLButtonElement).disabled).toBe(false);
  });

  test('loading an opponent shows steps, an inline error, and retries', async () => {
    const { access, loads } = fakeAccess([opp('beta', { readiness: 'needs-permission' }), opp('gamma')]);
    render(<BattleTab env={fakeEnv(access)} jobs={fakes().deps} />);
    await screen.findByText(/코드 4,000줄/);
    fireEvent.click(rowOf(/^beta/));
    expect(access.loadOpponent).toHaveBeenCalledWith('beta', expect.any(Function));
    expect(rowOf(/^beta/).textContent).toContain('불러오는 중');
    expect((rowOf(/^gamma/) as HTMLButtonElement).disabled).toBe(true);
    act(() => loads[0].step('permission'));
    expect(rowOf(/^beta/).textContent).toContain('폴더 권한 확인 중');
    act(() => loads[0].step('reading'));
    expect(rowOf(/^beta/).textContent).toContain('파일 읽는 중');
    act(() => loads[0].step('measuring'));
    expect(rowOf(/^beta/).textContent).toContain('품질 재는 중');
    await act(async () => loads[0].d.reject(new Error('권한을 받지 못했어요')));
    expect(screen.getByRole('alert').textContent).toContain('권한을 받지 못했어요');
    expect((rowOf(/^gamma/) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '다시 시도' }));
    expect(loads).toHaveLength(2);
    await act(async () => loads[1].d.reject(new QualityError('too-small', 'tiny')));
    expect(screen.getByRole('alert').textContent).toContain(MEASURE_MSG.tooSmall);

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '다시 시도' }));
    await act(async () => loads[2].d.resolve(B));
    expect(await screen.findByRole('heading', { name: '레포 전쟁 대결 #1' })).toBeTruthy();
  });

  test('an untranslated error falls back to a plain line', async () => {
    const { access, loads } = fakeAccess([opp('beta')]);
    render(<BattleTab env={fakeEnv(access)} jobs={fakes().deps} />);
    await screen.findByText(/코드 4,000줄/);
    fireEvent.click(rowOf(/^beta/));
    await act(async () => loads[0].d.reject(new TypeError('Failed to fetch')));
    expect(screen.getByRole('alert').textContent).toContain('대결 데이터를 불러오지 못했어요');
  });

  test('malicious repo names render as text', async () => {
    const evil = '<img src=x onerror="alert(1)">';
    const { access } = fakeAccess([opp('evil', { name: evil })]);
    render(<BattleTab env={fakeEnv(access)} jobs={fakes().deps} />);
    expect(await screen.findByText(evil)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('flow', () => {
  test('self battle mirrors the open repo on side B', async () => {
    const f = fakes();
    const { access } = fakeAccess([]);
    render(<BattleTab env={fakeEnv(access)} jobs={f.deps} />);
    await screen.findByText(/코드 4,000줄/);
    fireEvent.click(rowOf('자기 자신과 대결'));
    await screen.findByRole('heading', { name: '레포 전쟁 대결 #1' });
    expect(access.loadOpponent).not.toHaveBeenCalled();
    expect(f.predictions).toHaveLength(1);
    expect(f.predictions[0].a).toBe(A);
    expect(f.predictions[0].b.name).toBe('alpha (미러)');
    expect(f.predictions[0].b.files).toBe(A.files);
  }, 30_000);

  test('pick → briefing → engage fallback → result → fix file opens the city; 처음으로 returns to pick', async () => {
    // a match the open repo loses, so the fix list holds side A files
    let match = 1;
    while (simulate(A, B, match).winner !== 'b') match++;

    const f = fakes();
    const { access, loads } = fakeAccess([opp('beta')]);
    const env = fakeEnv(access);
    render(<BattleTab env={env} jobs={f.deps} />);
    await screen.findByText(/코드 4,000줄/);
    fireEvent.click(rowOf(/^beta/));
    await act(async () => loads[0].d.resolve(B));

    expect(await screen.findByRole('heading', { name: '레포 전쟁 대결 #1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '레포 다시 고르기' })).toBeNull();
    expect(f.predictions).toHaveLength(1);
    expect(f.predictions[0]).toMatchObject({ a: A, b: B });
    await act(async () => f.predictions[0].resolve({ runs: 100, aWins: 30, bWins: 68, draws: 2 }));
    for (let m = 1; m < match; m++) fireEvent.click(screen.getByRole('button', { name: '다른 전개 보기' }));

    fireEvent.click(screen.getByRole('button', { name: '전투 시작하기' }));
    expect(screen.getByText(/3D 전장을 그릴 수 없어요/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '결과 보기' }));
    expect(screen.getByRole('heading', { name: '결과' })).toBeTruthy();

    expect(f.fixes).toHaveLength(1);
    expect(f.fixes[0]).toMatchObject({ loser: A, winner: B, loserSide: 'a' });
    const path = A.files[0].path;
    await act(async () => f.fixes[0].resolve([{ path, penalty: 5, reasons: ['complexity'], baseline: 0.2, improved: 0.35, delta: 0.15 }]));
    const item = document.querySelector(`[data-path="${path}"]`)!;
    fireEvent.click(within(item as HTMLElement).getByRole('button'));
    expect(env.goto).toHaveBeenCalledWith('city', { file: path, code: true });

    fireEvent.click(screen.getByRole('button', { name: '처음으로' }));
    expect(screen.getByRole('heading', { name: '레포 전쟁' })).toBeTruthy();
    await screen.findByText(/코드 4,000줄/);
    // the opponent loaded once this session is not asked for again
    fireEvent.click(rowOf(/^beta/));
    expect(await screen.findByRole('heading', { name: '레포 전쟁 대결 #1' })).toBeTruthy();
    expect(access.loadOpponent).toHaveBeenCalledTimes(1);
    expect(access.loadSelf).toHaveBeenCalledTimes(1);
  }, 30_000);

  test('side B fix files stay plain text; 상대 다시 고르기 goes back to pick', async () => {
    let match = 1;
    while (simulate(A, B, match).winner !== 'a') match++;
    const f = fakes();
    const { access, loads } = fakeAccess([opp('beta')]);
    const env = fakeEnv(access);
    render(<BattleTab env={env} jobs={f.deps} />);
    await screen.findByText(/코드 4,000줄/);
    fireEvent.click(rowOf(/^beta/));
    await act(async () => loads[0].d.resolve(B));
    await act(async () => f.predictions[0].resolve({ runs: 100, aWins: 60, bWins: 38, draws: 2 }));
    for (let m = 1; m < match; m++) fireEvent.click(screen.getByRole('button', { name: '다른 전개 보기' }));
    fireEvent.click(screen.getByRole('button', { name: '전투 시작하기' }));
    fireEvent.click(screen.getByRole('button', { name: '결과 보기' }));
    expect(f.fixes[0]).toMatchObject({ loser: B, loserSide: 'b' });
    const path = B.files[0].path;
    await act(async () => f.fixes[0].resolve([{ path, penalty: 5, reasons: ['complexity'], baseline: 0.2, improved: 0.35, delta: 0.15 }]));
    const item = document.querySelector(`[data-path="${path}"]`) as HTMLElement;
    expect(within(item).queryByRole('button')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '다시 싸우기' }));
    fireEvent.click(screen.getByRole('button', { name: '브리핑으로' }));
    fireEvent.click(screen.getByRole('button', { name: '상대 다시 고르기' }));
    expect(screen.getByRole('heading', { name: '레포 전쟁' })).toBeTruthy();
    expect(env.goto).not.toHaveBeenCalled();
  }, 30_000);

  test('다시 싸우기 bumps the match without a new prediction and cancels an unfinished fix job', async () => {
    let match = 1;
    while (!simulate(A, B, match).winner) match++;
    const f = fakes();
    const { access, loads } = fakeAccess([opp('beta')]);
    render(<BattleTab env={fakeEnv(access)} jobs={f.deps} />);
    await screen.findByText(/코드 4,000줄/);
    fireEvent.click(rowOf(/^beta/));
    await act(async () => loads[0].d.resolve(B));
    await act(async () => f.predictions[0].resolve({ runs: 100, aWins: 30, bWins: 68, draws: 2 }));
    for (let m = 1; m < match; m++) fireEvent.click(screen.getByRole('button', { name: '다른 전개 보기' }));
    fireEvent.click(screen.getByRole('button', { name: '전투 시작하기' }));
    fireEvent.click(screen.getByRole('button', { name: '결과 보기' }));
    expect(screen.getByText(`대결 #${match}`)).toBeTruthy();
    expect(f.fixes).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '다시 싸우기' }));
    expect(f.fixes[0].cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: '전투 장면' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '결과 보기' }));
    expect(screen.getByText(`대결 #${match + 1}`)).toBeTruthy();
    expect(f.predictions).toHaveLength(1);
  }, 30_000);
});

test('prior shares divide the wins by the runs', () => {
  expect(priorShares({ runs: 100, aWins: 30, bWins: 68, draws: 2 })).toEqual({ a: 0.3, b: 0.68 });
  expect(priorShares({ runs: 0, aWins: 0, bWins: 0, draws: 0 })).toEqual({ a: 0, b: 0 });
});
