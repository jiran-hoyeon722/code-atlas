import { describe, expect, test } from 'vitest';
import { isSourcePath } from '../../src/engine/collect';
import { ALL_LANGS, LANGS } from '../../src/engine/langs';

describe('langs', () => {
  test('extensions map to languages', () => {
    expect(isSourcePath('a/b.py')).toBe('py');
    expect(isSourcePath('cmd/main.go')).toBe('go');
    expect(isSourcePath('A.java')).toBe('java');
    expect(isSourcePath('A.kt')).toBe('kotlin');
    expect(isSourcePath('build.gradle.kts')).toBe('kotlin');
    expect(isSourcePath('deploy.sh')).toBe('shell');
    expect(isSourcePath('V.swift')).toBe('swift');
    expect(isSourcePath('x.pyc')).toBeNull();
    expect(isSourcePath('a.tsx')).toBe('ts');
  });
  test('every language names a wasm file and a highlight.js language', () => {
    for (const l of ALL_LANGS) {
      expect(LANGS[l].wasm).toMatch(/\.wasm$/);
      expect(LANGS[l].hljs).not.toBe('');
    }
  });
});
