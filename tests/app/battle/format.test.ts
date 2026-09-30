import { expect, test } from 'vitest';
import { codeLines, koreanCount, langLabel } from '../../../src/features/battle/select/format';

test('koreanCount keeps the two largest units and rounds down', () => {
  expect(koreanCount(0)).toBe('0');
  expect(koreanCount(950)).toBe('950');
  expect(koreanCount(9_876)).toBe('9,876');
  expect(koreanCount(10_000)).toBe('1만');
  expect(koreanCount(184_321)).toBe('18만 4천');
  expect(koreanCount(184_999)).toBe('18만 4천');
  expect(koreanCount(61_000)).toBe('6만 1천');
  expect(koreanCount(1_200_500)).toBe('120만');
  expect(koreanCount(12_345_678)).toBe('1,234만 5천');
  expect(koreanCount(123_456_789)).toBe('1억 2,345만');
  expect(koreanCount(300_000_000)).toBe('3억');
  expect(koreanCount(-5)).toBe('0');
});

test('codeLines spaces the unit only after Korean number words', () => {
  expect(codeLines(184_321)).toBe('코드 18만 4천 줄');
  expect(codeLines(1_500)).toBe('코드 1,500줄');
});

test('langLabel', () => {
  expect(langLabel('php')).toBe('PHP');
  expect(langLabel('ts')).toBe('TypeScript');
});
