import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const files = [
  'web-tree-sitter/web-tree-sitter.wasm',
  'tree-sitter-php/tree-sitter-php.wasm',
  'tree-sitter-typescript/tree-sitter-tsx.wasm',
  'tree-sitter-python/tree-sitter-python.wasm',
  'tree-sitter-go/tree-sitter-go.wasm',
  'tree-sitter-java/tree-sitter-java.wasm',
  '@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm',
  'tree-sitter-bash/tree-sitter-bash.wasm',
];

mkdirSync('public/wasm', { recursive: true });
for (const f of files) copyFileSync(require.resolve(f), `public/wasm/${f.split('/').pop()}`);
copyFileSync('vendor/wasm/tree-sitter-swift.wasm', 'public/wasm/tree-sitter-swift.wasm');
