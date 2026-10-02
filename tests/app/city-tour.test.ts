import { expect, test } from 'vitest';
import { cityTour } from '../../src/features/city/cityTour';

const base = { name: 'shop', files: 1234, layers: ['진입점', '화면·기능', '기반'] };

test('the tour walks from the whole city to the entry file, the most-used file, and back', () => {
  const steps = cityTour({ ...base, entry: { i: 3, name: 'App', count: 5 }, hub: { i: 7, name: 'api', count: 40 } });
  expect(steps.map((s) => s.focus)).toEqual([null, 3, 7, null]);
  expect(steps[0].body).toContain('1,234개');
  expect(steps[0].body).toContain('진입점 → 화면·기능 → 기반');
  expect(steps[1].title).toContain('App');
  expect(steps[2].body).toContain('40개');
  expect(steps[2].spot).toEqual(['panel']);
});

test('a missing or repeated pick drops its step', () => {
  expect(cityTour({ ...base, entry: null, hub: null }).map((s) => s.focus)).toEqual([null, null]);
  const same = { i: 2, name: 'index', count: 9 };
  expect(cityTour({ ...base, entry: same, hub: same }).map((s) => s.focus)).toEqual([null, 2, null]);
});
