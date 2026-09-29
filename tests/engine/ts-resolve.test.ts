import { describe, expect, test } from 'vitest';
import { createTsResolver } from '../../src/engine/ts/resolve';

const files = new Set(['src/a.ts', 'src/dir/index.tsx', 'src/lib/util.ts', 'src/b.tsx', 'src/c.d.ts']);
const mk = (configs: Record<string, string> = {}, f: ReadonlySet<string> = files) =>
  createTsResolver(f, configs);

describe('ts resolve', () => {
  const r = mk();
  test('relative with extension fill', () => { expect(r('src/b.tsx', './a')).toBe('src/a.ts'); });
  test('directory index', () => { expect(r('src/b.tsx', './dir')).toBe('src/dir/index.tsx'); });
  test('.js specifier to .ts file', () => { expect(r('src/b.tsx', './a.js')).toBe('src/a.ts'); });
  test('parent relative and .d.ts', () => {
    expect(r('src/lib/util.ts', '../a')).toBe('src/a.ts');
    expect(r('src/b.tsx', './c')).toBe('src/c.d.ts');
  });
  test('exact file match', () => { expect(r('src/b.tsx', './a.ts')).toBe('src/a.ts'); });
  test('relative escaping repo root is null', () => { expect(r('src/b.tsx', '../../x')).toBeNull(); });
  test('package import is null', () => { expect(r('src/b.tsx', 'react')).toBeNull(); });

  test('paths alias', () => {
    const rr = mk({ 'tsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["./src/*"]}}}' });
    expect(rr('src/b.tsx', '@/lib/util')).toBe('src/lib/util.ts');
    expect(rr('src/b.tsx', 'react')).toBeNull();
  });

  test('longest prefix wins and multiple targets fall through', () => {
    const rr = mk({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { paths: { '@/*': ['nope/*'], '@/lib/*': ['missing/*', 'src/lib/*'], exact: ['src/a'] } },
      }),
    });
    expect(rr('src/b.tsx', '@/lib/util')).toBe('src/lib/util.ts');
    expect(rr('src/b.tsx', 'exact')).toBe('src/a.ts');
  });

  test('baseUrl resolution', () => {
    const rr = mk({ 'tsconfig.json': '{"compilerOptions":{"baseUrl":"src"}}' });
    expect(rr('src/b.tsx', 'lib/util')).toBe('src/lib/util.ts');
  });

  test('config in subdirectory is relative to its own dir', () => {
    const f = new Set(['app/src/x.ts', 'app/main.ts']);
    const rr = mk({ 'tsconfig.json': '{"extends":"./app/tsconfig.json"}', 'app/tsconfig.json': '{"compilerOptions":{"baseUrl":"src"}}' }, f);
    expect(rr('app/main.ts', 'x')).toBe('app/src/x.ts');
  });

  test('baseUrl escaping repo root yields null', () => {
    const rr = mk({ 'tsconfig.json': '{"compilerOptions":{"baseUrl":"../.."}}' });
    expect(rr('src/b.tsx', 'a')).toBeNull();
  });

  test('extends inherits paths', () => {
    const rr = mk({
      'tsconfig.json': '{"extends":"./tsconfig.base.json"}',
      'tsconfig.base.json': '{"compilerOptions":{"baseUrl":".","paths":{"~/*":["src/*"]}}}',
    });
    expect(rr('src/b.tsx', '~/a')).toBe('src/a.ts');
  });

  test('jsconfig used when no tsconfig', () => {
    const rr = mk({ 'jsconfig.json': '{"compilerOptions":{"paths":{"~/*":["src/*"]}}}' });
    expect(rr('src/b.tsx', '~/a')).toBe('src/a.ts');
  });

  test('references fallback', () => {
    const rr = mk({
      'tsconfig.json': '{"files":[],"references":[{"path":"./tsconfig.app.json"}]}',
      'tsconfig.app.json': '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["./src/*"]}}}',
    });
    expect(rr('src/b.tsx', '@/lib/util')).toBe('src/lib/util.ts');
  });

  test('jsonc and cyclic extends tolerated', () => {
    const rr = mk({
      'tsconfig.json': `{
        // comment
        "extends": "./a.json", /* block */
        "compilerOptions": { "paths": { "@/*": ["src/*",], "u": ["http://x//y"] }, },
      }`,
      'a.json': '{"extends":"./b.json"}',
      'b.json': '{"extends":"./a.json"}',
    });
    expect(() => rr('src/b.tsx', './a')).not.toThrow();
    expect(rr('src/b.tsx', './a')).toBe('src/a.ts');
    expect(rr('src/b.tsx', '@/lib/util')).toBe('src/lib/util.ts');
  });

  test('invalid json config is ignored', () => {
    const rr = mk({ 'tsconfig.json': '{not json' });
    expect(rr('src/b.tsx', './a')).toBe('src/a.ts');
    expect(rr('src/b.tsx', 'react')).toBeNull();
  });
});
