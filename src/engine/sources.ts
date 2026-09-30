import type { Detection } from './detect';
import { isSourcePath } from './collect';
import type { SourceFile } from './types';

const isGenerated = (path: string): boolean => /\.gen\.tsx?$/.test(path);

/** Gradle's Kotlin DSL files are build configuration, not app code. */
export const isBuildScript = (path: string): boolean => path.endsWith('.gradle.kts');

/** The files the extractor for `detection.lang` parses, sorted by path. */
export function sourcesFor(detection: Detection, files: readonly SourceFile[]): SourceFile[] {
  const prefix = detection.sourceDir === '' ? '' : detection.sourceDir + '/';
  return files
    .filter((f) => f.path.startsWith(prefix) && isSourcePath(f.path) === detection.lang && !(detection.lang === 'ts' && isGenerated(f.path)) && !isBuildScript(f.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
