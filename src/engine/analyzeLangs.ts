import { analyze, UnsupportedRepoError, type Progress } from './analyze';
import type { Architecture } from './architecture';
import { analyzeWithQuality, type AnalysisWithQuality, type AnalyzeWithQualityOptions } from './battle/quality';
import { detect } from './detect';
import { mergeArchitectures } from './merge';
import type { Parsers } from './parsers';
import { sourcesFor } from './sources';
import type { Lang, RepoInput } from './types';

/** langs[0] = 주 언어(배틀 데이터 대상). 분석할 게 없는 언어(UnsupportedRepoError)는 건너뛴다; 주 언어가 그러면 다음 언어가 주 언어가 된다. 전부 없으면 UnsupportedRepoError. */
export function analyzeLangs(input: RepoInput, parsers: Parsers, langs: Lang[], opts: AnalyzeWithQualityOptions = {}): AnalysisWithQuality {
  const { onProgress, onQualityProgress, prefer: _prefer, ...rest } = opts;
  // detect falls back to another language when `l` is not a candidate, so only exact matches count.
  const plan = langs.flatMap((lang) => {
    const detection = detect(input, lang);
    if (detection?.lang !== lang) return [];
    const files = sourcesFor(detection, input.files).length;
    return files > 0 ? [{ lang, files }] : [];
  });
  const total = plan.reduce((s, p) => s + p.files, 0);

  const parts: Architecture[] = [];
  let primary: AnalysisWithQuality | null = null;
  let doneBase = 0;
  let roleBase = 0;
  for (const { lang, files } of plan) {
    const shift = (p: Progress): Progress =>
      p.phase === 'parse' ? { ...p, done: p.done + doneBase, total, role: p.role + roleBase } : p;
    const progressOpts = { ...rest, prefer: lang, onProgress: onProgress && ((p: Progress) => onProgress(shift(p))) };
    let arch: Architecture;
    try {
      if (primary) arch = analyze(input, parsers, progressOpts);
      else {
        primary = analyzeWithQuality(input, parsers, { ...progressOpts, onQualityProgress });
        arch = primary.architecture;
      }
    } catch (e) {
      if (e instanceof UnsupportedRepoError) continue;
      if (primary) throw e;
      // Battle data never fails the analysis: measure nothing and keep the plain result.
      arch = analyze(input, parsers, progressOpts);
      primary = { architecture: arch, quality: null, qualityIssue: 'failed' };
    }
    parts.push(arch);
    doneBase += files;
    roleBase += arch.roles.length;
  }
  if (!primary) throw new UnsupportedRepoError();
  return { ...primary, architecture: mergeArchitectures(parts) };
}
