import { expect, test } from 'vitest';
import { areaLabel, titleCase } from './format';

test('area label', () => {
  expect(areaLabel(0.5)).toBe('50 dm²');
  expect(areaLabel(2)).toBe('2.0 m²');
});

test('title case', () => {
  expect(titleCase('hello  garden')).toBe('Hello Garden');
});
