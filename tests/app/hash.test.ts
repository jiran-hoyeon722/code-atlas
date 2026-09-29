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
});
