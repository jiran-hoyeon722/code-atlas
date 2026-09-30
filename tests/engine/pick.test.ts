import { expect, test } from 'vitest';
import { countLangs, pickLang } from '../../src/engine/pick';

test('shell only wins when nothing else is there', () => {
  expect(pickLang({ go: 40, shell: 12 })).toEqual({ lang: 'go', ask: [] });
  expect(pickLang({ shell: 3 })).toEqual({ lang: 'shell', ask: [] });
});

test('two real languages ask, biggest first', () => {
  expect(pickLang({ java: 10, kotlin: 30 })).toEqual({ lang: 'kotlin', ask: ['kotlin', 'java'] });
});

test('php and ts keep the old tie rule', () => {
  expect(pickLang({ php: 5, ts: 5 }).lang).toBe('php');
  expect(pickLang({ php: 5, ts: 5 }).ask).toEqual(['php', 'ts']);
});

test('nothing supported', () => {
  expect(pickLang({})).toEqual({ lang: null, ask: [] });
  expect(pickLang({ go: 0 })).toEqual({ lang: null, ask: [] });
});

test('countLangs counts sources and skips gradle build scripts', () => {
  expect(countLangs(['a.kt', 'build.gradle.kts', 'settings.gradle.kts', 'b.kts', 'Package.swift', 'x.sh', 'README.md', 'go.mod'])).toEqual({
    kotlin: 2,
    swift: 1,
    shell: 1,
  });
});
