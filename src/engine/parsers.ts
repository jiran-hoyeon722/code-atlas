import { createRequire } from 'node:module';
import { Parser, Language } from 'web-tree-sitter';

export type WasmFile = 'web-tree-sitter.wasm' | 'tree-sitter-php.wasm' | 'tree-sitter-tsx.wasm';

export interface Parsers {
  php: Parser;
  tsx: Parser;
}

const PACKAGE_OF: Record<WasmFile, string> = {
  'web-tree-sitter.wasm': 'web-tree-sitter',
  'tree-sitter-php.wasm': 'tree-sitter-php',
  'tree-sitter-tsx.wasm': 'tree-sitter-typescript',
};

export function nodeLocate(file: WasmFile): string {
  return createRequire(import.meta.url).resolve(`${PACKAGE_OF[file]}/${file}`);
}

let cached: Promise<Parsers> | null = null;

export function loadParsers(locate: (file: WasmFile) => string): Promise<Parsers> {
  // A failed load must not poison later retries.
  cached ??= init(locate).catch((e) => {
    cached = null;
    throw e;
  });
  return cached;
}

async function init(locate: (file: WasmFile) => string): Promise<Parsers> {
  await Parser.init({ locateFile: (name: string) => locate(name as WasmFile) });
  const [phpLang, tsxLang] = await Promise.all([
    Language.load(locate('tree-sitter-php.wasm')),
    Language.load(locate('tree-sitter-tsx.wasm')),
  ]);
  const php = new Parser();
  php.setLanguage(phpLang);
  const tsx = new Parser();
  tsx.setLanguage(tsxLang);
  return { php, tsx };
}
