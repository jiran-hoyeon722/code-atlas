import { MEASURE_MSG, MeasureError, measureError } from '../deps';
import { QualityError } from '../worker/client';

const FALLBACK = '대결 데이터를 불러오지 못했어요';
const HANGUL = /[가-힣]/;

/** A plain Korean line for a failed load; worker codes such as too-small get the same wording as a failed measure. */
export function loadErrorText(e: unknown): string {
  if (e instanceof QualityError || e instanceof MeasureError) return measureError(e).message;
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  if (code === 'too-small') return MEASURE_MSG.tooSmall;
  if (code === 'unsupported') return MEASURE_MSG.unsupported;
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return HANGUL.test(msg) ? msg : FALLBACK;
}
