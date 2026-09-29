import { expect, test } from 'vitest';
import { sourcesFor } from '../../src/engine/sources';
import type { Detection } from '../../src/engine/detect';

const files = (...paths: string[]) => paths.map((path) => ({ path, text: '' }));

test('ts sources: inside sourceDir, ts-family extensions, no generated files, sorted', () => {
  const d: Detection = { lang: 'ts', framework: 'react', sourceDir: 'src', routeDirs: [] };
  const got = sourcesFor(d, files('src/z.tsx', 'src/a.ts', 'src/r.gen.ts', 'src/r.gen.tsx', 'src/s.css', 'srcx/b.ts', 'lib/c.ts', 'src/d/e.mjs', 'src/p.php'));
  expect(got.map((f) => f.path)).toEqual(['src/a.ts', 'src/d/e.mjs', 'src/z.tsx']);
});

test('php sources: inside sourceDir only', () => {
  const d: Detection = { lang: 'php', framework: 'laravel', sourceDir: 'app', routeDirs: ['routes'] };
  const got = sourcesFor(d, files('routes/web.php', 'app/B.php', 'app/A.php', 'app/x.gen.php', 'app/c.ts'));
  expect(got.map((f) => f.path)).toEqual(['app/A.php', 'app/B.php', 'app/x.gen.php']);
});

test('empty sourceDir means the whole repo', () => {
  const d: Detection = { lang: 'php', framework: null, sourceDir: '', routeDirs: [] };
  expect(sourcesFor(d, files('b/x.php', 'a.php')).map((f) => f.path)).toEqual(['a.php', 'b/x.php']);
});
