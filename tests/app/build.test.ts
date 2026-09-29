import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';

beforeAll(() => {
  execSync('npm run build', { stdio: 'pipe' });
}, 120_000);

test('build emits CSP meta and wasm', () => {
  const html = readFileSync('dist/index.html', 'utf8');
  expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'">`);
  for (const f of ['web-tree-sitter.wasm', 'tree-sitter-php.wasm', 'tree-sitter-tsx.wasm']) expect(existsSync(`dist/wasm/${f}`)).toBe(true);
  expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
});
