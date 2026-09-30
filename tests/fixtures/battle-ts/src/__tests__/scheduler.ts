import { expect, test } from 'vitest';
import { planWeek } from '../lib/scheduler';

test('empty plot rests', () => {
  const plan = planWeek([{ id: 'a', name: 'A', area: 1, crops: [] }], { rainy: false, frost: false, weekday: 1 });
  expect(plan.tasks).toEqual([{ plot: 'a', kind: 'rest', amount: 0 }]);
});
