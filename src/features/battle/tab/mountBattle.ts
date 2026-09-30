import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { MountViewer } from '../../viewer-env';
import { BattleTab } from './BattleTab';

export const mountBattle: MountViewer = (root, _arch, env) => {
  const host = document.createElement('div');
  host.className = 'rb-tab-host';
  root.append(host);
  const reactRoot = createRoot(host);
  reactRoot.render(createElement(BattleTab, { env }));
  return () => {
    host.remove();
    // the shell disposes from its own effect cleanup; unmounting another root mid-commit makes React warn
    queueMicrotask(() => reactRoot.unmount());
  };
};
