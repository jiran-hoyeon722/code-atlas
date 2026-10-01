import { expect, test } from 'vitest';
import type { Lang } from '../../src/engine/types';
import { repoLabel } from '../../src/features/lang-label';

test('merged languages are joined in order', () => {
  expect(repoLabel({ lang: 'py', langs: ['py', 'go'], framework: null })).toBe('Python + Go');
});

test('a single language keeps the framework name first', () => {
  expect(repoLabel({ lang: 'php', framework: 'laravel' })).toBe('Laravel');
  expect(repoLabel({ lang: 'ts', framework: 'react' })).toBe('React');
  expect(repoLabel({ lang: 'go', framework: null })).toBe('Go');
  expect(repoLabel({ lang: 'go', langs: ['go'], framework: null })).toBe('Go');
});

test('an unknown language or framework shows its own string', () => {
  expect(repoLabel({ lang: 'cobol' as Lang, framework: null })).toBe('cobol');
  expect(repoLabel({ lang: 'ts', framework: 'vue' })).toBe('vue');
});
