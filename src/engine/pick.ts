import { isSourcePath } from './collect';
import { hasExtractor } from './extractors';
import { ALL_LANGS } from './langs';
import { isBuildScript } from './sources';
import type { Lang } from './types';

/** Source files per language, leaving out build scripts that share a source extension. */
export function countLangs(paths: Iterable<string>): Partial<Record<Lang, number>> {
  const counts: Partial<Record<Lang, number>> = {};
  for (const p of paths) {
    const l = isSourcePath(p);
    if (l && !isBuildScript(p)) counts[l] = (counts[l] ?? 0) + 1;
  }
  return counts;
}

/** 파일 수로 고른 기본 언어와, 사용자에게 물어야 할 후보(2개 이상일 때만). */
export function pickLang(counts: Partial<Record<Lang, number>>): { lang: Lang | null; ask: Lang[] } {
  const present = ALL_LANGS.filter((l) => hasExtractor(l) && (counts[l] ?? 0) > 0);
  // Repos in any other language often carry helper scripts, so shell only counts when nothing else is there.
  const real = present.filter((l) => l !== 'shell');
  const candidates = (real.length > 0 ? real : present).sort((a, b) => counts[b]! - counts[a]!);
  return { lang: candidates[0] ?? null, ask: candidates.length >= 2 ? candidates : [] };
}
