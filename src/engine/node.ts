import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { WasmFile } from './parsers';

const PACKAGE_OF: Record<Exclude<WasmFile, 'tree-sitter-swift.wasm'>, string> = {
  'web-tree-sitter.wasm': 'web-tree-sitter',
  'tree-sitter-php.wasm': 'tree-sitter-php',
  'tree-sitter-tsx.wasm': 'tree-sitter-typescript',
  'tree-sitter-python.wasm': 'tree-sitter-python',
  'tree-sitter-go.wasm': 'tree-sitter-go',
  'tree-sitter-java.wasm': 'tree-sitter-java',
  'tree-sitter-kotlin.wasm': '@tree-sitter-grammars/tree-sitter-kotlin',
  'tree-sitter-bash.wasm': 'tree-sitter-bash',
};

export function nodeLocate(file: WasmFile): string {
  // npm has no swift wasm, so it is committed under vendor/wasm.
  if (file === 'tree-sitter-swift.wasm') return fileURLToPath(new URL(`../../vendor/wasm/${file}`, import.meta.url));
  return createRequire(import.meta.url).resolve(`${PACKAGE_OF[file]}/${file}`);
}
