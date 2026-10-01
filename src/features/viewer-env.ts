import type { Architecture } from '../engine/architecture';
import type { Quality } from '../engine/battle/types';
import type { Lang } from '../engine/types';

export type TabId = 'city' | 'graph' | 'explorer' | 'battle' | 'walk';

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
  /** The repo was destroyed in play: forget its cached analysis and go back to the landing screen. */
  collapse(): void;
  /** Present when the session can supply battle data (the current repo and the registered ones). */
  battle?: BattleAccess;
}

/**
 * How a registered repo's battle data can be obtained: already in the cache, or measured again
 * from its folder (asks for read permission) or from its GitHub commit.
 */
export type OpponentReadiness = 'ready' | 'needs-permission' | 'refetch' | 'reanalyze';

export interface OpponentSummary {
  key: string;
  name: string;
  lang: Lang;
  files: number;
  analyzedAt: string;
  source: 'local' | 'github';
  readiness: OpponentReadiness;
}

export type BattleLoadStep = 'permission' | 'reading' | 'measuring';

export interface BattleAccess {
  self: { key: string; name: string };
  loadSelf(): Promise<Quality>;
  listOpponents(): Promise<OpponentSummary[]>;
  loadOpponent(key: string, onStep?: (step: BattleLoadStep) => void): Promise<Quality>;
}

export type MountViewer = (root: HTMLElement, arch: Architecture, env: ViewerEnv) => () => void;
