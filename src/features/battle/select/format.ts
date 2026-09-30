import type { Lang } from '../../../engine/types';

const LANG: Record<Lang, string> = { php: 'PHP', ts: 'TypeScript' };

export const langLabel = (lang: Lang): string => LANG[lang] ?? lang;

/** Rounds down to the two largest Korean units: 184,321 → "18만 4천", 9,876 → "9,876". */
export function koreanCount(n: number): string {
  const v = Math.max(0, Math.floor(n));
  if (v < 10_000) return v.toLocaleString('ko-KR');
  if (v < 100_000_000) {
    const man = Math.floor(v / 10_000);
    const cheon = Math.floor((v % 10_000) / 1_000);
    return cheon ? `${man.toLocaleString('ko-KR')}만 ${cheon}천` : `${man.toLocaleString('ko-KR')}만`;
  }
  const eok = Math.floor(v / 100_000_000);
  const man = Math.floor((v % 100_000_000) / 10_000);
  return man ? `${eok.toLocaleString('ko-KR')}억 ${man.toLocaleString('ko-KR')}만` : `${eok.toLocaleString('ko-KR')}억`;
}

export function codeLines(n: number): string {
  const c = koreanCount(n);
  return /\d$/.test(c) ? `코드 ${c}줄` : `코드 ${c} 줄`;
}
