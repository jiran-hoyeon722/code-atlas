import hljs from 'highlight.js/lib/core';
import php from 'highlight.js/lib/languages/php';
import typescript from 'highlight.js/lib/languages/typescript';
import type { Lang } from '../../engine/types';

hljs.registerLanguage('php', php);
hljs.registerLanguage('typescript', typescript);

const LANGUAGE: Record<Lang, string> = { php: 'php', ts: 'typescript' };

export function highlight(code: string, lang: Lang): string {
  return hljs.highlight(code, { language: LANGUAGE[lang] }).value;
}

// highlight.js gets slow on huge files and can throw on odd input; plain text is always safe
export const HIGHLIGHT_LIMIT = 500 * 1024;

export function renderCode(el: HTMLElement, code: string, lang: Lang): void {
  if (code.length <= HIGHLIGHT_LIMIT) {
    try {
      el.innerHTML = highlight(code, lang);
      return;
    } catch {
      // fall through to plain text
    }
  }
  el.textContent = code;
}
