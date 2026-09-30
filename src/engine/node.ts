import { createRequire } from 'node:module';
import type { WasmFile } from './parsers';

const PACKAGE_OF: Record<WasmFile, string> = {
  'web-tree-sitter.wasm': 'web-tree-sitter',
  'tree-sitter-php.wasm': 'tree-sitter-php',
  'tree-sitter-tsx.wasm': 'tree-sitter-typescript',
  'tree-sitter-python.wasm': 'tree-sitter-python',
  'tree-sitter-go.wasm': 'tree-sitter-go',
  'tree-sitter-java.wasm': 'tree-sitter-java',
  'tree-sitter-kotlin.wasm': '@tree-sitter-grammars/tree-sitter-kotlin',
  'tree-sitter-bash.wasm': 'tree-sitter-bash',
  'tree-sitter-swift.wasm': 'tree-sitter-swift',
};

export function nodeLocate(file: WasmFile): string {
  return createRequire(import.meta.url).resolve(`${PACKAGE_OF[file]}/${file}`);
}
