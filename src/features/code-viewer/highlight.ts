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
