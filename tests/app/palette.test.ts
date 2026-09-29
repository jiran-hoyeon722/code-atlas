import { expect, test } from 'vitest';
import { roleColors } from '../../src/features/palette';

test('configured color wins, others follow layer hue', () => {
  const c = roleColors({ roles: [{ name: 'A', layer: 0, patterns: [], description: '' }, { name: 'B', layer: 0, patterns: [], description: '', color: '#123456' }, { name: 'C', layer: 3, patterns: [], description: '' }] });
  expect(c).toEqual(['hsl(228, 78%, 56%)', '#123456', 'hsl(200, 30%, 56%)']);
});
