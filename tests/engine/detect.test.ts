import { expect, test } from 'vitest';
import { detect } from '../../src/engine/detect';

const mixed = {
  name: 'x', configs: {},
  files: [
    { path: 'a/A.php', text: '' }, { path: 'a/B.php', text: '' }, { path: 'a/C.php', text: '' },
    { path: 'web/main.ts', text: '' },
  ],
};

test('laravel detection', () => {
  const d = detect({ name: 'x', configs: { 'composer.json': '{"require":{"laravel/framework":"^11"}}' }, files: [{ path: 'app/A.php', text: '' }, { path: 'routes/api.php', text: '' }] });
  expect(d).toEqual({ lang: 'php', framework: 'laravel', sourceDir: 'app', routeDirs: ['routes'] });
});
test('react detection with src', () => {
  const d = detect({ name: 'x', configs: { 'package.json': '{"dependencies":{"react":"^19"}}' }, files: [{ path: 'src/main.tsx', text: '' }, { path: 'src/routes/index.tsx', text: '' }] });
  expect(d).toEqual({ lang: 'ts', framework: 'react', sourceDir: 'src', routeDirs: ['src/routes'] });
});
test('mixed repo picks the language with more files', () => {
  expect(detect(mixed)).toEqual({ lang: 'php', framework: null, sourceDir: '', routeDirs: [] });
});
test('no supported files → null', () => { expect(detect({ name: 'x', configs: {}, files: [] })).toBeNull(); });
test('prefer overrides majority', () => {
  expect(detect(mixed, 'ts')?.lang).toBe('ts');
});
test('prefer ignored when that language has no files', () => {
  expect(detect({ name: 'x', configs: {}, files: [{ path: 'a.php', text: '' }] }, 'ts')?.lang).toBe('php');
});
test('invalid manifest JSON means no framework', () => {
  const d = detect({ name: 'x', configs: { 'package.json': '{oops' }, files: [{ path: 'src/a.ts', text: '' }] });
  expect(d?.framework).toBeNull();
});
test('react without src uses root and app route dir', () => {
  const d = detect({ name: 'x', configs: { 'package.json': '{"devDependencies":{"react":"1"}}' }, files: [{ path: 'app/page.tsx', text: '' }] });
  expect(d).toEqual({ lang: 'ts', framework: 'react', sourceDir: '', routeDirs: ['app'] });
});
test('a new language with the most files wins and has no framework', () => {
  const d = detect({ name: 'x', configs: {}, files: [{ path: 'a.php', text: '' }, { path: 'm/a.py', text: '' }, { path: 'm/b.py', text: '' }] });
  expect(d).toEqual({ lang: 'py', framework: null, sourceDir: '', routeDirs: [] });
});
test('ties go to the earlier language in ALL_LANGS', () => {
  const files = [{ path: 'a.go', text: '' }, { path: 'b.sh', text: '' }, { path: 'c.java', text: '' }];
  expect(detect({ name: 'x', configs: {}, files })?.lang).toBe('go');
  expect(detect({ name: 'x', configs: {}, files: [{ path: 'a.ts', text: '' }, { path: 'b.php', text: '' }] })?.lang).toBe('php');
});
test('prefer picks a new language when it has files', () => {
  const d = detect({ name: 'x', configs: {}, files: [{ path: 'a.php', text: '' }, { path: 'b.php', text: '' }, { path: 'run.sh', text: '' }] }, 'shell');
  expect(d).toEqual({ lang: 'shell', framework: null, sourceDir: '', routeDirs: [] });
});
