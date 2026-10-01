import { LANGS } from '../engine/langs';
import type { Lang } from '../engine/types';

const FRAMEWORK: Record<string, string> = { laravel: 'Laravel', react: 'React' };

const langName = (l: Lang) => LANGS[l]?.label ?? l;

export function repoLabel(r: { lang: Lang; langs?: Lang[]; framework: string | null }): string {
  if (r.langs && r.langs.length >= 2) return r.langs.map(langName).join(' + ');
  return r.framework ? (FRAMEWORK[r.framework] ?? r.framework) : langName(r.lang);
}
