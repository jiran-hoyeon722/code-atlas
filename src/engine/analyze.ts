import type { Parsers } from './parsers';
import type { Lang, RepoInput } from './types';
import { detect } from './detect';
import { isSourcePath } from './collect';
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

export function analyze(
  input: RepoInput,
  parsers: Parsers,
  onProgress?: (p: Progress) => void,
  now: Date = new Date(),
  prefer?: Lang,
): Architecture {
  const detection = detect(input, prefer);
  if (!detection) throw new UnsupportedRepoError();

  const prefix = detection.sourceDir === '' ? '' : detection.sourceDir + '/';
  // The extractors skip generated TS files, so they must not count toward `total`.
  const processed = input.files
    .map((f) => f.path)
    .filter((p) => p.startsWith(prefix) && isSourcePath(p) === detection.lang && !(detection.lang === 'ts' && /\.gen\.tsx?$/.test(p)))
    .sort();

  const preset = presetFor(detection, processed);
  const match = compileRoles(preset.roles);
  const lastRole = preset.roles.length - 1;
  const total = processed.length;
  let done = 0;
  const onFile = (path: string) => {
    const r = match(path.slice(prefix.length));
    onProgress?.({ phase: 'parse', done: ++done, total, path, role: r === -1 ? lastRole : r });
  };

  const extraction = detection.lang === 'php'
    ? extractPhpProject(input, detection, parsers, onFile)
    : extractTsProject(input, detection, parsers, onFile);

  onProgress?.({ phase: 'link' });
  onProgress?.({ phase: 'metrics' });
  return buildArchitecture(extraction, detection, preset, input.name, now);
}
