import { describe, expect, test } from 'vitest';
import { formatHash, parseHash } from '../../src/features/shell/hash';

describe('parseHash / formatHash', () => {
  test('formats the documented shape', () => {
    expect(formatHash('city', { file: 'app/Http/X.php', code: true })).toBe('#city&file=app%2FHttp%2FX.php&code');
    expect(formatHash('graph', {})).toBe('#graph');
    expect(formatHash('explorer', { file: 'a.ts' })).toBe('#explorer&file=a.ts');
  });

  test('round-trips paths with &, spaces and Korean', () => {
    for (const file of ['src/a&b.ts', 'src/my file.ts', 'src/한글 폴더/컴포넌트.tsx', 'x/=&=/y#z.ts']) {
      for (const code of [true, false]) {
        const sel = code ? { file, code } : { file };
        expect(parseHash(formatHash('explorer', sel))).toEqual({ tab: 'explorer', sel });
      }
    }
  });

  test('unknown or empty tab falls back to city', () => {
    expect(parseHash('')).toEqual({ tab: 'city', sel: {} });
    expect(parseHash('#nope&file=a.ts')).toEqual({ tab: 'city', sel: { file: 'a.ts' } });
    expect(parseHash('#graph')).toEqual({ tab: 'graph', sel: {} });
  });

  test('malformed encoding does not throw', () => {
    expect(parseHash('#city&file=%E0%A4%A')).toEqual({ tab: 'city', sel: {} });
  });

  test('formats blast after code', () => {
    expect(formatHash('city', { file: 'a.ts', blast: true })).toBe('#city&file=a.ts&blast');
    expect(formatHash('city', { file: 'a.ts', code: true, blast: true })).toBe('#city&file=a.ts&code&blast');
  });

  test('round-trips blast', () => {
    for (const code of [true, false]) {
      for (const blast of [true, false]) {
        const sel: any = { file: 'a.ts' };
        if (code) sel.code = true;
        if (blast) sel.blast = true;
        expect(parseHash(formatHash('city', sel))).toEqual({ tab: 'city', sel });
      }
    }
  });

  test('blast without file is dropped', () => {
    expect(parseHash('#city&blast')).toEqual({ tab: 'city', sel: {} });
    expect(formatHash('city', { blast: true })).toBe('#city');
  });
});
