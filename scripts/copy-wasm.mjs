import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const files = [
  'web-tree-sitter/web-tree-sitter.wasm',
  'tree-sitter-php/tree-sitter-php.wasm',
  'tree-sitter-typescript/tree-sitter-tsx.wasm',
];

mkdirSync('public/wasm', { recursive: true });
for (const f of files) copyFileSync(require.resolve(f), `public/wasm/${f.split('/')[1]}`);
