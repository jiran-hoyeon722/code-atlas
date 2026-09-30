import type { OnTree, Parsers } from './parsers';
import type { Lang, RepoInput } from './types';
import { detect } from './detect';
import { sourcesFor } from './sources';
import { extractPhpProject } from './php/project';
import { extractTsProject } from './ts/project';
import { compileRoles, presetFor } from './presets';
import { buildArchitecture, type Architecture } from './architecture';

export type Progress =
  | { phase: 'parse'; done: number; total: number; path: string; role: number }
  | { phase: 'link' }
  | { phase: 'metrics' };

export class UnsupportedRepoError extends Error {
  constructor() {
    super('No supported source files (PHP or TypeScript/JavaScript) found');
    this.name = 'UnsupportedRepoError';
  }
}

export interface AnalyzeOptions {
  onProgress?: (p: Progress) => void;
  now?: Date;
  prefer?: Lang;
  /** Sees each parsed source file's tree (route-only PHP files excluded). */
  onTree?: OnTree;
}

export function analyze(
  input: RepoInput,
  parsers: Parsers,
  options: AnalyzeOptions = {},
): Architecture {
  const { onProgress, now = new Date(), prefer, onTree } = options;
  const detection = detect(input, prefer);
  if (!detection) throw new UnsupportedRepoError();

  const prefix = detection.sourceDir === '' ? '' : detection.sourceDir + '/';
  const processed = sourcesFor(detection, input.files).map((f) => f.path);

  const preset = presetFor(detection, processed);
  const match = compileRoles(preset.roles);
  const lastRole = preset.roles.length - 1;
  const total = processed.length;
  let done = 0;
  const onFile = (path: string) => {
    const r = match(path.slice(prefix.length));
    onProgress?.({ phase: 'parse', done: ++done, total, path, role: r === -1 ? lastRole : r });
  };

  const onLink = () => onProgress?.({ phase: 'link' });
  const extraction = detection.lang === 'php'
    ? extractPhpProject(input, detection, parsers, onFile, onLink, onTree)
    : extractTsProject(input, detection, parsers, onFile, onLink, onTree);

  onProgress?.({ phase: 'metrics' });
  return buildArchitecture(extraction, detection, preset, input.name, now);
}
