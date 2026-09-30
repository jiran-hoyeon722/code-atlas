import hljs from 'highlight.js/lib/core';
import { afterEach, expect, test, vi } from 'vitest';
import { HIGHLIGHT_LIMIT, highlight, renderCode } from '../../src/features/code-viewer/highlight';
import type { Lang } from '../../src/engine/types';

const el = () => ({ innerHTML: '', textContent: '' }) as unknown as HTMLElement;

afterEach(() => vi.restoreAllMocks());

test('an unknown language comes back as escaped plain text', () => {
  expect(highlight('<b>&"x"</b>', 'rust' as Lang)).toBe('&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;');
});

test('highlights normal sources as markup', () => {
  const e = el();
  renderCode(e, 'const a = 1;', 'ts');
  expect(e.innerHTML).toContain('hljs-keyword');
});

test('falls back to plain text when highlighting throws', () => {
  vi.spyOn(hljs, 'highlight').mockImplementation(() => {
    throw new Error('bad grammar');
  });
  const e = el();
  renderCode(e, '<img src=x onerror=alert(1)>', 'php');
  expect(e.innerHTML).toBe('');
  expect(e.textContent).toBe('<img src=x onerror=alert(1)>');
});

test('skips highlighting for sources over the size limit', () => {
  const spy = vi.spyOn(hljs, 'highlight');
  const big = 'x'.repeat(HIGHLIGHT_LIMIT + 1);
  const e = el();
  renderCode(e, big, 'ts');
  expect(spy).not.toHaveBeenCalled();
  expect(e.textContent).toBe(big);
  expect(HIGHLIGHT_LIMIT).toBe(500 * 1024);
});

test('highlights the newly supported languages', () => {
  const e = el();
  renderCode(e, 'def run():\n    return 1\n', 'py');
  expect(e.innerHTML).toContain('hljs-keyword');
  const g = el();
  renderCode(g, 'package main\nfunc main() {}\n', 'go');
  expect(g.innerHTML).toContain('hljs-keyword');
});
