import { expect, test } from 'vitest';
import { parseCheat } from '../../src/features/walk/walkCheat';

test('cheat codes are trimmed, case-insensitive and accept Korean aliases', () => {
  expect(parseCheat('tank')).toBe('tank');
  expect(parseCheat('  TaNk ')).toBe('tank');
  expect(parseCheat('HELICOPTER')).toBe('helicopter');
  expect(parseCheat('car')).toBe('car');
  expect(parseCheat('Motorcycle')).toBe('motorcycle');
  expect(parseCheat('탱크')).toBe('tank');
  expect(parseCheat('헬기')).toBe('helicopter');
  expect(parseCheat('헬리콥터')).toBe('helicopter');
  expect(parseCheat(' 차 ')).toBe('car');
  expect(parseCheat('자동차')).toBe('car');
  expect(parseCheat('오토바이')).toBe('motorcycle');
});

test('anything else is not a cheat', () => {
  expect(parseCheat('')).toBeNull();
  expect(parseCheat('bike')).toBeNull();
  expect(parseCheat('car car')).toBeNull();
  expect(parseCheat('constructor')).toBeNull();
  expect(parseCheat('toString')).toBeNull();
});
