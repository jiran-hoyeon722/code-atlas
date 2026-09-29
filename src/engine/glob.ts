/**
 * Glob matching without regex backtracking: an O(pattern × path) DP, so hostile
 * patterns like `*a*a*a…b` from a repo's .gitignore cannot stall the worker.
 */
type GlobToken =
  | { t: 'lit'; c: string }
  | { t: 'one' } // `?`: one char except `/`
  | { t: 'star' } // `*`: any run without `/`
  | { t: 'any' } // `**` not followed by `/`: any run
  | { t: 'dirs' }; // `**/`: empty, or any run ending in `/`

export interface GlobSyntax {
  /** `?` matches one char; otherwise it is literal. */
  question: boolean;
  /** Meaning of `**` when not followed by `/`. */
  bareDoubleStar: 'any' | 'star';
}

function tokenizeGlob(glob: string, syntax: GlobSyntax): GlobToken[] {
  const out: GlobToken[] = [];
  const push = (tok: GlobToken) => {
    const prev = out[out.length - 1];
    // Collapse runs so equivalent patterns compile to the same short token list.
    if (tok.t === 'dirs' && prev?.t === 'dirs') return;
    if ((tok.t === 'star' || tok.t === 'any') && (prev?.t === 'star' || prev?.t === 'any')) {
      if (tok.t === 'any') out[out.length - 1] = tok;
      return;
    }
    out.push(tok);
  };
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '\\' && i + 1 < glob.length) push({ t: 'lit', c: glob[++i] });
    else if (c === '*') {
      let j = i;
      while (glob[j + 1] === '*') j++;
      if (j === i) push({ t: 'star' });
      else if (glob[j + 1] === '/') {
        push({ t: 'dirs' });
        j++;
      } else push({ t: syntax.bareDoubleStar });
      i = j;
    } else if (c === '?' && syntax.question) push({ t: 'one' });
    else push({ t: 'lit', c });
  }
  return out;
}

/**
 * Compiles a glob to a whole-path matcher, or with `prefix` a matcher for any leading part of the path.
 * Leading/trailing literal runs are checked with plain string compares; only the rest runs the DP.
 */
export function compileGlob(glob: string, syntax: GlobSyntax, prefix = false): (path: string) => boolean {
  const tokens = tokenizeGlob(glob, syntax);
  let lo = 0;
  let head = '';
  while (lo < tokens.length && tokens[lo].t === 'lit') head += (tokens[lo++] as { c: string }).c;
  let hi = tokens.length;
  let tail = '';
  if (!prefix) while (hi > lo && tokens[hi - 1].t === 'lit') tail = (tokens[--hi] as { c: string }).c + tail;
  const mid = tokens.slice(lo, hi);

  if (mid.length === 0) return prefix ? (path) => path.startsWith(head) : (path) => path === head + tail;
  return (path) => {
    if (path.length < head.length + tail.length || !path.startsWith(head) || !path.endsWith(tail)) return false;
    return matchTokens(mid, path, head.length, path.length - tail.length, prefix);
  };
}

/** DP over tokens × positions of path[from..to): O(tokens × length), no backtracking. */
function matchTokens(tokens: readonly GlobToken[], path: string, from: number, to: number, prefix: boolean): boolean {
  // next[p]: tokens[ti+1..] match path[p..to); rows are filled from the last token backwards.
  let next = new Uint8Array(to + 1);
  let cur = new Uint8Array(to + 1);
  for (let p = from; p <= to; p++) next[p] = prefix || p === to ? 1 : 0;
  for (let ti = tokens.length - 1; ti >= 0; ti--) {
    const tok = tokens[ti];
    let inner = 0; // for `dirs`: some `/` at or after p is followed by a match of the rest
    cur[to] = tok.t === 'lit' || tok.t === 'one' ? 0 : next[to];
    for (let p = to - 1; p >= from; p--) {
      const ch = path[p];
      switch (tok.t) {
        case 'lit':
          cur[p] = ch === tok.c ? next[p + 1] : 0;
          break;
        case 'one':
          cur[p] = ch !== '/' ? next[p + 1] : 0;
          break;
        case 'star':
          cur[p] = next[p] || (ch !== '/' ? cur[p + 1] : 0);
          break;
        case 'any':
          cur[p] = next[p] || cur[p + 1];
          break;
        case 'dirs':
          if (ch === '/' && next[p + 1]) inner = 1;
          cur[p] = next[p] || inner;
          break;
      }
    }
    [next, cur] = [cur, next];
  }
  return next[from] === 1;
}
