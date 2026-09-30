import { expect, test } from 'vitest';
import { shouldSkipDir, isSourcePath, isConfigPath, parseGitignore, MAX_FILES } from '../../src/engine/collect';

// Timing is compared against a same-length benign pattern on the same input, so machine load cancels out.
const minMs = (fn: () => void, runs: number, reps: number) => {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    for (let k = 0; k < reps; k++) fn();
    best = Math.min(best, (performance.now() - start) / reps);
  }
  return best;
};

test('skips vendor-like dirs', () => { expect(shouldSkipDir('node_modules')).toBe(true); expect(shouldSkipDir('src')).toBe(false); });
test('classifies source paths', () => { expect(isSourcePath('app/A.php')).toBe('php'); expect(isSourcePath('src/a.d.ts')).toBe('ts'); expect(isSourcePath('a.css')).toBeNull(); });
test('classifies all ts extensions', () => {
  for (const e of ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']) expect(isSourcePath(`a/b.${e}`)).toBe('ts');
});
test('config paths at any depth, not inside skipped dirs', () => {
  expect(isConfigPath('composer.json')).toBe(true);
  expect(isConfigPath('packages/web/package.json')).toBe(true);
  expect(isConfigPath('tsconfig.app.json')).toBe(true);
  expect(isConfigPath('jsconfig.json')).toBe(true);
  expect(isConfigPath('node_modules/x/package.json')).toBe(false);
  expect(isConfigPath('a/vendor/composer.json')).toBe(false);
  expect(isConfigPath('other.json')).toBe(false);
  expect(isConfigPath('go.mod')).toBe(true);
  expect(isConfigPath('tools/go.mod')).toBe(true);
  expect(isConfigPath('vendor/x/go.mod')).toBe(false);
  expect(isConfigPath('go.sum')).toBe(false);
});
test('MAX_FILES', () => { expect(MAX_FILES).toBe(20000); });
test('gitignore rules', () => {
  const ig = parseGitignore('# c\n/tmp\nlogs/\n*.gen.ts\n!keep.gen.ts\n');
  expect(ig('tmp', true)).toBe(true); expect(ig('a/tmp', true)).toBe(false); expect(ig('a/logs', true)).toBe(true);
  expect(ig('a/logs', false)).toBe(false); expect(ig('src/x.gen.ts', false)).toBe(true); expect(ig('src/x.ts', false)).toBe(false);
});
test('gitignore name-only and ** globs', () => {
  const ig = parseGitignore('\ndist\ndocs/**/*.tmp\n');
  expect(ig('a/b/dist', true)).toBe(true);
  expect(ig('docs/x/y/z.tmp', false)).toBe(true);
  expect(ig('other/z.tmp', false)).toBe(false);
});
test('gitignore **/ prefix matches at any depth including the root', () => {
  const ig = parseGitignore('**/x\n');
  expect(ig('x', true)).toBe(true);
  expect(ig('a/b/x', false)).toBe(true);
  expect(ig('a/xy', false)).toBe(false);
});
test('gitignore pattern with a middle slash is anchored to the root', () => {
  const ig = parseGitignore('a/b\n');
  expect(ig('a/b', true)).toBe(true);
  expect(ig('c/a/b', true)).toBe(false);
  expect(ig('a/bc', true)).toBe(false);
});
test('gitignore CRLF line endings', () => {
  const ig = parseGitignore('tmp\r\nlogs/\r\n*.gen.ts\r\n');
  expect(ig('a/tmp', true)).toBe(true);
  expect(ig('logs', true)).toBe(true);
  expect(ig('src/x.gen.ts', false)).toBe(true);
  expect(ig('src/x.ts', false)).toBe(false);
});
test('gitignore glob matching stays linear on pathological patterns', () => {
  const hostile = parseGitignore('*a*a*a*a*a*a*a*a*a*a*b\n');
  const benign = parseGitignore('*c*c*c*c*c*c*c*c*c*c*b\n');
  // Ends in `b` so the literal-tail shortcut passes and the matcher itself must reject it.
  const input = `${'a'.repeat(40)}/b`;
  expect(hostile(input, false)).toBe(false);
  expect(hostile('xaaaaaaaaaab', false)).toBe(true);
  benign(input, false); // warm-up
  // Backtracking blow-up is exponential (ratio in the thousands); a linear matcher stays near 1.
  const tBenign = minMs(() => { benign(input, false); }, 5, 50);
  const tHostile = minMs(() => { hostile(input, false); }, 5, 1);
  expect(tHostile / Math.max(tBenign, 0.0005)).toBeLessThan(20);
});
