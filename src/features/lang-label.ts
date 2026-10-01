import { LANGS } from '../engine/langs';
import { baseRoleName } from '../engine/merge';
import type { Lang } from '../engine/types';

const FRAMEWORK: Record<string, string> = { laravel: 'Laravel', react: 'React' };

const langName = (l: Lang) => LANGS[l]?.label ?? l;
const name = (lang: Lang, framework: string | null | undefined) => (framework ? (FRAMEWORK[framework] ?? framework) : langName(lang));

export function repoLabel(r: { lang: Lang; langs?: Lang[]; frameworks?: (string | null)[]; framework: string | null }): string {
  if (r.langs && r.langs.length >= 2) return r.langs.map((l, i) => name(l, r.frameworks?.[i])).join(' + ');
  return name(r.lang, r.framework);
}

/** Single-language chips stay as they were; only a merged role drops a layer label it already ends with. */
export function roleChip(role: string, layer: string): string {
  const base = baseRoleName(role);
  return base !== role && base === layer ? role : `${role} · ${layer}`;
}
