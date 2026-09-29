import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Role } from '../../src/engine/presets';

const add = vi.fn();
const dispose = vi.fn();
const mount = vi.fn((_root: HTMLElement) => ({ add, dispose }));
vi.mock('../../src/features/loading/miniCity', () => ({ mountMiniCity: (root: HTMLElement) => mount(root) }));

import { LoadingScreen, type LoadStep } from '../../src/features/loading/LoadingScreen';

const roles: Role[] = [
  { name: 'A', layer: 0, patterns: [], description: '', color: '#111111' },
  { name: 'B', layer: 1, patterns: [], description: '', color: '#222222' },
];

function view(step: LoadStep, onCancel = vi.fn()) {
  return render(<LoadingScreen name="demo" framework="Laravel" sourceDir="app" roles={roles} step={step} onCancel={onCancel} />);
}
const states = () => screen.getAllByRole('listitem').map((li) => li.getAttribute('data-state'));

afterEach(cleanup);
beforeEach(() => { add.mockClear(); dispose.mockClear(); mount.mockClear(); });

test('list phase: first step current with count', () => {
  view({ phase: 'list', found: 42 });
  expect(states()).toEqual(['current', 'waiting', 'waiting', 'waiting']);
  expect(screen.getByText('42개')).toBeTruthy();
  for (const t of ['파일 찾기', '코드 읽기', '참조 연결', '도시 짓기']) expect(screen.getByText(t)).toBeTruthy();
});

test('read phase: read step current with N / total', () => {
  view({ phase: 'read', done: 3, total: 10 });
  expect(states()).toEqual(['done', 'current', 'waiting', 'waiting']);
  expect(screen.getByText('3 / 10')).toBeTruthy();
});

test('parse phase: still 코드 읽기, progress bar ratio and path', () => {
  const { container } = view({ phase: 'parse', done: 5, total: 20, path: 'app/Http/<b>X</b>.php', role: 0 });
  expect(states()).toEqual(['done', 'current', 'waiting', 'waiting']);
  expect(screen.getByText('5 / 20')).toBeTruthy();
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
  expect((container.querySelector('.cc-load-bar > i') as HTMLElement).style.width).toBe('25%');
  expect(screen.getByText('app/Http/<b>X</b>.php')).toBeTruthy();
  expect(container.querySelector('.cc-load-path b')).toBeNull();
});

test('link and metrics phases', () => {
  const { rerender } = view({ phase: 'link' });
  expect(states()).toEqual(['done', 'done', 'current', 'waiting']);
  rerender(<LoadingScreen name="demo" framework={null} sourceDir="" roles={roles} step={{ phase: 'metrics' }} onCancel={() => {}} />);
  expect(states()).toEqual(['done', 'done', 'done', 'current']);
});

test('cancel button calls onCancel', () => {
  const onCancel = vi.fn();
  view({ phase: 'list', found: 0 }, onCancel);
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test('mini city mounts once, adds per new parse event, disposes on unmount', () => {
  const p = (done: number, role: number): LoadStep => ({ phase: 'parse', done, total: 9, path: 'a', role });
  const { rerender, unmount } = view(p(1, 0));
  const re = (s: LoadStep) => rerender(<LoadingScreen name="demo" framework="Laravel" sourceDir="app" roles={roles} step={s} onCancel={() => {}} />);
  expect(mount).toHaveBeenCalledTimes(1);
  expect(add).toHaveBeenCalledTimes(1);
  expect(add).toHaveBeenLastCalledWith('#111111');
  re(p(1, 0));
  expect(add).toHaveBeenCalledTimes(1);
  re(p(2, 1));
  expect(add).toHaveBeenLastCalledWith('#222222');
  expect(add).toHaveBeenCalledTimes(2);
  expect(mount).toHaveBeenCalledTimes(1);
  unmount();
  expect(dispose).toHaveBeenCalledTimes(1);
});
