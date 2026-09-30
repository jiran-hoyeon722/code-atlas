/** Physical line index (0-based) of every non-blank line, in order. */
export function codeLines(text: string): number[] {
  const out: number[] = [];
  const rows = text.split('\n');
  for (let i = 0; i < rows.length; i++) if (rows[i].trim() !== '') out.push(i);
  return out;
}

/** Maps a physical line to the code line at or after it (for starts) or at or before it (for ends). */
export function codeLineMapper(physical: readonly number[]): { atOrAfter(line: number): number; atOrBefore(line: number): number } {
  const search = (line: number) => {
    let lo = 0;
    let hi = physical.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (physical[mid] < line) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return {
    atOrAfter: (line) => search(line),
    atOrBefore: (line) => {
      const i = search(line);
      return i < physical.length && physical[i] === line ? i : i - 1;
    },
  };
}
