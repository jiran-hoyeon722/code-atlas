import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import { LANGS } from '../../engine/langs';
import type { Lang } from '../../engine/types';

hljs.registerLanguage('php', php);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('swift', swift);

export function highlight(code: string, lang: Lang): string {
  return hljs.highlight(code, { language: LANGS[lang].hljs }).value;
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
