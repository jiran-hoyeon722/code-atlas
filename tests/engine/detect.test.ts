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
test('the majority language beats a lone python file and shell scripts', () => {
  const files = ['a.php', 'b.php', 's/1.sh', 's/2.sh', 's/3.sh', 'tool.py'].map((path) => ({ path, text: '' }));
  expect(detect({ name: 'x', configs: {}, files })).toEqual({ lang: 'php', framework: null, sourceDir: '', routeDirs: [] });
});
test('a repo with only unsupported sources → null', () => {
  expect(detect({ name: 'x', configs: {}, files: [{ path: 'm/a.rb', text: '' }, { path: 'm/b.rb', text: '' }] })).toBeNull();
});
test('a python-only repo is detected once python has an extractor', () => {
  expect(detect({ name: 'x', configs: {}, files: [{ path: 'm/a.py', text: '' }, { path: 'm/b.py', text: '' }] })).toEqual({ lang: 'py', framework: null, sourceDir: '', routeDirs: [] });
});
test('prefer with no files is ignored', () => {
  const files = [{ path: 'a.ts', text: '' }, { path: 'b.go', text: '' }, { path: 'c.go', text: '' }];
  expect(detect({ name: 'x', configs: {}, files }, 'swift')?.lang).toBe('go');
  expect(detect({ name: 'x', configs: {}, files: [...files, { path: 'd.swift', text: '' }] }, 'swift')?.lang).toBe('swift');
});
test('a swift-only repo is detected once swift has an extractor', () => {
  expect(detect({ name: 'x', configs: {}, files: [{ path: 'Sources/A/a.swift', text: '' }] })).toEqual({ lang: 'swift', framework: null, sourceDir: '', routeDirs: [] });
});
test('shell only wins when nothing else is there', () => {
  const sh = ['scripts/a.sh', 'scripts/b.sh', 'scripts/c.bash'].map((path) => ({ path, text: '' }));
  const go = [{ path: 'main.go', text: '' }];
  expect(detect({ name: 'x', configs: {}, files: [...go, ...sh] })?.lang).toBe('go');
  expect(detect({ name: 'x', configs: {}, files: [...go, ...sh] }, 'shell')?.lang).toBe('go');
  expect(detect({ name: 'x', configs: {}, files: sh })).toEqual({ lang: 'shell', framework: null, sourceDir: '', routeDirs: [] });
});
test('ties go to the earlier language in ALL_LANGS', () => {
  expect(detect({ name: 'x', configs: {}, files: [{ path: 'a.ts', text: '' }, { path: 'b.php', text: '' }] })?.lang).toBe('php');
});
test('gradle kotlin build scripts do not make a java repo kotlin', () => {
  const files = ['build.gradle.kts', 'settings.gradle.kts', 'app/build.gradle.kts', 'app/src/main/java/a/A.java'].map((path) => ({ path, text: '' }));
  expect(detect({ name: 'x', configs: {}, files })?.lang).toBe('java');
});
