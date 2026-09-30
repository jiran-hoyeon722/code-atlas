import { Parser, Language, type Node } from 'web-tree-sitter';

/** Receives a file's parse tree before it is freed; `root` is only valid during the call. */
export type OnTree = (path: string, root: Node) => void;

export type WasmFile = 'web-tree-sitter.wasm' | 'tree-sitter-php.wasm' | 'tree-sitter-tsx.wasm';

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
