import { expect, test } from 'vitest';
import { QUEST, createQuest } from '../../src/features/walk/walkQuest';

test('each first-steps task counts once and the quest finishes when all are done', () => {
  const q = createQuest();
  expect(q.mark('walk')).toBe(true);
  expect(q.mark('walk')).toBe(false);
  expect(q.count).toBe(1);
  expect(q.finished).toBe(false);
  QUEST.forEach(({ id }) => q.mark(id));
  expect(q.finished).toBe(true);
  expect(q.has('enter')).toBe(true);
});
