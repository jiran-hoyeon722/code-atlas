import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const entry = (f: string) => fileURLToPath(new URL(`../../src/engine/${f}`, import.meta.url));

// A worker needs both analyze() and loadParsers(); analyze.ts alone only type-imports parsers.ts.
test('engine bundles for the browser without node built-ins', async () => {
  const result = await build({
    entryPoints: [entry('analyze.ts'), entry('parsers.ts')],
    outdir: 'out',
    platform: 'browser',
    format: 'esm',
    bundle: true,
    write: false,
    logLevel: 'silent',
  });
  expect(result.errors).toEqual([]);
  expect(result.outputFiles).toHaveLength(2);
}, 30_000);
