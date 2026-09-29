import type { Selection, TabId } from '../viewer-env';

const TABS: readonly TabId[] = ['city', 'graph', 'explorer'];

export function parseHash(h: string): { tab: TabId; sel: Selection } {
  const [head, ...parts] = h.replace(/^#/, '').split('&');
  const tab = (TABS as readonly string[]).includes(head) ? (head as TabId) : 'city';
  const sel: Selection = {};
  for (const part of parts) {
    if (part === 'code') sel.code = true;
    else if (part.startsWith('file=')) {
      try {
        sel.file = decodeURIComponent(part.slice(5));
      } catch {
        // malformed percent-encoding: ignore the file part
      }
    }
  }
  if (sel.file === undefined) delete sel.code;
  return { tab, sel };
}

export function formatHash(tab: TabId, sel: Selection): string {
  if (sel.file === undefined) return `#${tab}`;
  return `#${tab}&file=${encodeURIComponent(sel.file)}${sel.code ? '&code' : ''}`;
}
