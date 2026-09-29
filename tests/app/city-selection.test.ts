import { expect, test, vi } from 'vitest';
import { createSelectionReporter } from '../../src/features/city/selection';

test('restore emits nothing, even across several reports', () => {
  const onSelect = vi.fn();
  const r = createSelectionReporter(onSelect);
  r.restore(() => {
    r.report({ file: 'a.php' });
    r.report({ file: 'a.php', code: true });
  });
  expect(onSelect).not.toHaveBeenCalled();
});

test('a later user action emits exactly once with the final state', () => {
  const onSelect = vi.fn();
  const r = createSelectionReporter(onSelect);
  r.restore(() => r.report({ file: 'a.php', code: true }));
  r.batch(() => {
    r.report({ file: 'b.php' });
    r.report({ file: 'b.php', code: true });
  });
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith({ file: 'b.php', code: true });
});

test('plain reports emit immediately; empty batch emits nothing', () => {
  const onSelect = vi.fn();
  const r = createSelectionReporter(onSelect);
  r.batch(() => {});
  r.report({});
  expect(onSelect.mock.calls).toEqual([[{}]]);
});
