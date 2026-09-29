import type { Selection } from '../viewer-env';

export interface SelectionReporter {
  report(sel: Selection): void;
  batch(fn: () => void): void;
  restore(fn: () => void): void;
}

// restore(): the host already knows the selection it handed us, so echoing it back could loop a remount.
export function createSelectionReporter(onSelect: (sel: Selection) => void): SelectionReporter {
  let mode: 'live' | 'batch' | 'silent' = 'live';
  let pending: Selection | null = null;
  const run = (next: 'batch' | 'silent', fn: () => void) => {
    const prev = mode;
    mode = next;
    try {
      fn();
    } finally {
      mode = prev;
    }
  };
  return {
    report(sel) {
      if (mode === 'live') onSelect(sel);
      else if (mode === 'batch') pending = sel;
    },
    batch(fn) {
      if (mode !== 'live') return fn();
      pending = null;
      run('batch', fn);
      const sel = pending;
      pending = null;
      if (sel) onSelect(sel);
    },
    restore(fn) {
      run('silent', fn);
    },
  };
}
