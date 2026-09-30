import type { Architecture } from '../engine/architecture';

export type TabId = 'city' | 'graph' | 'explorer' | 'walk';

export interface Selection {
  file?: string;
  code?: boolean;
  blast?: boolean;
}

export interface ViewerEnv {
  readSource(path: string): Promise<string | null>;
  vscodeHref(path: string): string | null;
  requestVscodeSetup(): void;
  selection: Selection;
  onSelect(sel: Selection): void;
  goto(tab: TabId, sel?: Selection): void;
}

export type MountViewer = (root: HTMLElement, arch: Architecture, env: ViewerEnv) => () => void;
