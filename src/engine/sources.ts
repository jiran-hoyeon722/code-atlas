import type { Detection } from './detect';
import { isSourcePath } from './collect';
import type { SourceFile } from './types';

const isGenerated = (path: string): boolean => /\.gen\.tsx?$/.test(path);

/** The files the extractor for `detection.lang` parses, sorted by path. */
export function sourcesFor(detection: Detection, files: readonly SourceFile[]): SourceFile[] {
  const prefix = detection.sourceDir === '' ? '' : detection.sourceDir + '/';
  return files
    .filter((f) => f.path.startsWith(prefix) && isSourcePath(f.path) === detection.lang && !(detection.lang === 'ts' && isGenerated(f.path)))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
