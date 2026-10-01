import { Parser, Language, type Node } from 'web-tree-sitter';

/** Receives a file's parse tree before it is freed; `root` is only valid during the call. */
export type OnTree = (path: string, root: Node) => void;

import { ALL_LANGS, LANGS, type Lang, type WasmFile } from './langs';

export type { WasmFile };

export interface Parsers {
  get(lang: Lang): Parser;
}

let ready: Promise<void> | null = null;
const grammars = new Map<WasmFile, Promise<Parser>>();

function initOnce(locate: (file: WasmFile) => string): Promise<void> {
  // A failed load must not poison later retries.
  ready ??= Parser.init({ locateFile: (name: string) => locate(name as WasmFile) }).catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

function grammar(file: WasmFile, locate: (file: WasmFile) => string): Promise<Parser> {
  let p = grammars.get(file);
  if (!p) {
    p = initOnce(locate)
      .then(() => Language.load(locate(file)))
      .then((language) => {
        const parser = new Parser();
        parser.setLanguage(language);
        return parser;
      })
      .catch((e) => {
        grammars.delete(file);
        throw e;
      });
    grammars.set(file, p);
  }
  return p;
}

export async function loadParsers(
  locate: (file: WasmFile) => string,
  langs: readonly Lang[] = ALL_LANGS,
): Promise<Parsers> {
  const loaded = new Map<Lang, Parser>();
  await Promise.all(langs.map(async (lang) => loaded.set(lang, await grammar(LANGS[lang].wasm, locate))));
  return {
    get(lang) {
      const parser = loaded.get(lang);
      if (!parser) throw new Error(`parser for ${lang} is not loaded`);
      return parser;
    },
  };
}
