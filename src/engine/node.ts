import { createRequire } from 'node:module';
import type { WasmFile } from './parsers';

const PACKAGE_OF: Record<WasmFile, string> = {
  'web-tree-sitter.wasm': 'web-tree-sitter',
  'tree-sitter-php.wasm': 'tree-sitter-php',
  'tree-sitter-tsx.wasm': 'tree-sitter-typescript',
};

export function nodeLocate(file: WasmFile): string {
  return createRequire(import.meta.url).resolve(`${PACKAGE_OF[file]}/${file}`);
}
