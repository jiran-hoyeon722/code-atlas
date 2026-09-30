import { isSourcePath } from '../collect';
import type { Detection } from '../detect';
import { compileGlob, type GlobSyntax } from '../glob';
import { isBuildScript, sourcesFor } from '../sources';
import type { RepoInput, SourceFile } from '../types';
import { codeLines } from './lines';
import { DEFAULT_EXCLUDE, DEFAULT_TEST_PATTERNS, LANG_TEST_PATTERNS } from './rules';

export interface Scope {
  prod: SourceFile[];
  tests: SourceFile[];
  excludedLines: number;
  testPatterns: string[];
  exclude: string[];
}

const GITIGNORE: GlobSyntax = { question: true, bareDoubleStar: 'any' };

const anyOf = (patterns: readonly string[]) => {
  const matchers = patterns.map((p) => compileGlob(p, GITIGNORE));
  return (path: string) => matchers.some((m) => m(path));
};

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function splitScope(detection: Detection, input: RepoInput): Scope {
  const testPatterns = [...DEFAULT_TEST_PATTERNS, ...(LANG_TEST_PATTERNS[detection.lang] ?? [])];
  const exclude = [...DEFAULT_EXCLUDE];
  const isTest = anyOf(testPatterns);
  const isExcluded = anyOf(exclude);

  const prod = sourcesFor(detection, input.files).filter((f) => !isTest(f.path) && !isExcluded(f.path));
  const sameLang = input.files.filter((f) => isSourcePath(f.path) === detection.lang && !isBuildScript(f.path));
  const tests = sameLang.filter((f) => isTest(f.path)).sort(byPath);

  const prefix = detection.sourceDir === '' ? '' : detection.sourceDir + '/';
  let excludedLines = 0;
  // Read from the input, not sourcesFor: sourcesFor already drops generated files, which still count as excluded.
  for (const f of sameLang) {
    if (f.path.startsWith(prefix) && !isTest(f.path) && isExcluded(f.path)) excludedLines += codeLines(f.text).length;
  }
  return { prod, tests, excludedLines, testPatterns, exclude };
}
