import type { Detection } from './detect';
import type { Parsers } from './parsers';
import { extractPhpProject } from './php/project';
import { extractTsProject } from './ts/project';
import { extractProject, type LangModule } from './link';
import { goModule } from './go/module';
import { javaModule } from './java/module';
import { kotlinModule } from './kotlin/module';
import { pyModule } from './py/module';
import { shellModule } from './shell/module';
import { swiftModule } from './swift/module';
import type { Extraction, Lang, RepoInput } from './types';

export type Extractor = (
  input: RepoInput,
  detection: Detection,
  parsers: Parsers,
  onFile?: (path: string) => void,
  onLink?: () => void,
) => Extraction;

const MODULES: Partial<Record<Lang, LangModule>> = { py: pyModule, go: goModule, java: javaModule, kotlin: kotlinModule, shell: shellModule, swift: swiftModule };

const EXTRACTORS: Partial<Record<Lang, Extractor>> = { php: extractPhpProject, ts: extractTsProject };

export function extractorFor(lang: Lang): Extractor | null {
  const direct = EXTRACTORS[lang];
  if (direct) return direct;
  const mod = MODULES[lang];
  return mod ? (...args) => extractProject(lang, mod, ...args) : null;
}

export const hasExtractor = (lang: Lang): boolean => extractorFor(lang) !== null;
