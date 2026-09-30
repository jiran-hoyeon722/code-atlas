import type { Parsers } from './parsers';
import type { Lang, RepoInput } from './types';
import { detect } from './detect';
import { sourcesFor } from './sources';
import { extractorFor } from './extractors';
import { compileRoles, presetFor } from './presets';
import { buildArchitecture, type Architecture } from './architecture';

export type Progress =
  | { phase: 'parse'; done: number; total: number; path: string; role: number }
  | { phase: 'link' }
  | { phase: 'metrics' };

export class UnsupportedRepoError extends Error {
  constructor() {
    super('No supported source files found');
    this.name = 'UnsupportedRepoError';
  }
}

export interface AnalyzeOptions {
  onProgress?: (p: Progress) => void;
  now?: Date;
  prefer?: Lang;
}

export function analyze(
  input: RepoInput,
  parsers: Parsers,
  options: AnalyzeOptions = {},
): Architecture {
  const { onProgress, now = new Date(), prefer } = options;
  const detection = detect(input, prefer);
  if (!detection) throw new UnsupportedRepoError();
  const extract = extractorFor(detection.lang);
  if (!extract) throw new UnsupportedRepoError();

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
  const extraction = extract(input, detection, parsers, onFile, onLink);

  onProgress?.({ phase: 'metrics' });
  return buildArchitecture(extraction, detection, preset, input.name, now);
}
