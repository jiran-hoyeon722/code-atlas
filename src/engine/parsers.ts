import { Parser, Language } from 'web-tree-sitter';

import type { WasmFile } from './langs';

export type { WasmFile };

export interface Parsers {
  php: Parser;
  tsx: Parser;
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
