import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';

beforeAll(() => {
  execSync('npm run build', { stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } });
}, 120_000);

test('build emits CSP meta and wasm', () => {
  const html = readFileSync('dist/index.html', 'utf8');
  expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'">`);
  for (const f of ['web-tree-sitter.wasm', 'tree-sitter-php.wasm', 'tree-sitter-tsx.wasm']) expect(existsSync(`dist/wasm/${f}`)).toBe(true);
  expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
});

test('build ships production React (no dev-only warnings)', () => {
  const js = readdirSync('dist/assets').filter((f) => f.endsWith('.js'));
  for (const f of js) expect(readFileSync(`dist/assets/${f}`, 'utf8').includes('Invalid hook call'), f).toBe(false);
});
