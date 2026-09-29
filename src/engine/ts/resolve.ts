type Resolver = (fromPath: string, specifier: string) => string | null;

interface PathRule {
  prefix: string;
  suffix: string;
  wildcard: boolean;
  targets: string[]; // repo-relative, may contain one '*'
}

interface Settings {
  baseUrls: string[];
  rules: PathRule[];
}

const SRC_EXTS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'];
const JS_TO_TS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx', '.ts'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

/** Joins and normalises `/` paths; returns null when the result escapes the repo root. */
function normalize(path: string): string | null {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join('/');
}

const dirname = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const join = (dir: string, rel: string): string | null => normalize(dir ? `${dir}/${rel}` : rel);

/** Strips // and /* *\/ comments and trailing commas, leaving string literals untouched. */
function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] !== '}' && text[j] !== ']') out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function parseConfig(text: string | undefined): Record<string, any> | null {
  if (text === undefined) return null;
  try {
    const v = JSON.parse(stripJsonc(text));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function configFor(configs: Record<string, string>, ref: string): string | null {
  const p = normalize(ref);
  if (p === null) return null;
  if (p in configs) return p;
  const asDir = join(p, 'tsconfig.json');
  if (asDir !== null && asDir in configs) return asDir;
  return null;
}

/** Follows relative `extends` chains; the nearest config that sets a field wins. */
type Loaded = Settings & { hasPaths: boolean; refs: string[] };

function loadSettings(configs: Record<string, string>, path: string, visited: Set<string>): Loaded {
  const empty: Loaded = { baseUrls: [], rules: [], hasPaths: false, refs: [] };
  if (visited.has(path)) return empty;
  visited.add(path);
  const json = parseConfig(configs[path]);
  if (!json) return empty;
  const dir = dirname(path);

  let inherited: Loaded = empty;
  const ext = typeof json.extends === 'string' ? json.extends : null;
  if (ext && (ext.startsWith('./') || ext.startsWith('../'))) {
    const cand = join(dir, ext);
    const target = cand !== null ? [cand, `${cand}.json`].find((c) => c in configs) : undefined;
    if (target) inherited = { ...loadSettings(configs, target, visited), refs: [] };
  }

  const co = json.compilerOptions ?? {};
  let baseUrls = inherited.baseUrls;
  let baseDir: string | null = dir;
  if (typeof co.baseUrl === 'string') {
    const b = join(dir, co.baseUrl);
    baseUrls = b === null ? [] : [b];
    baseDir = b;
  }

  let rules = inherited.rules;
  let hasPaths = inherited.hasPaths;
  if (co.paths && typeof co.paths === 'object') {
    hasPaths = true;
    rules = [];
    const pathsBase = baseDir ?? dir; // relative to baseUrl when set, else the config's dir
    for (const [pattern, list] of Object.entries<any>(co.paths)) {
      if (!Array.isArray(list)) continue;
      const star = pattern.indexOf('*');
      const targets = list
        .filter((t): t is string => typeof t === 'string')
        .map((t) => join(pathsBase, t))
        .filter((t): t is string => t !== null);
      rules.push({
        prefix: star < 0 ? pattern : pattern.slice(0, star),
        suffix: star < 0 ? '' : pattern.slice(star + 1),
        wildcard: star >= 0,
        targets,
      });
    }
  }

  const refs: string[] = [];
  if (Array.isArray(json.references)) {
    for (const r of json.references) {
      if (r && typeof r.path === 'string') {
        const p = join(dir, r.path);
        if (p !== null) refs.push(p);
      }
    }
  }
  return { baseUrls, rules, hasPaths, refs };
}

function loadRoot(configs: Record<string, string>): Settings {
  const rootPath = 'tsconfig.json' in configs ? 'tsconfig.json' : 'jsconfig.json' in configs ? 'jsconfig.json' : null;
  if (!rootPath) return { baseUrls: [], rules: [] };
  const root = loadSettings(configs, rootPath, new Set());
  if (root.hasPaths || root.refs.length === 0) return root;

  const merged: Settings = { baseUrls: [...root.baseUrls], rules: [] };
  const seen = new Set<string>([rootPath]);
  for (const ref of root.refs) {
    const target = configFor(configs, ref);
    if (!target || seen.has(target)) continue;
    seen.add(target);
    const s = loadSettings(configs, target, new Set());
    merged.rules.push(...s.rules);
    for (const b of s.baseUrls) if (!merged.baseUrls.includes(b)) merged.baseUrls.push(b);
  }
  return merged;
}

export function createTsResolver(files: ReadonlySet<string>, configs: Record<string, string>): Resolver {
  const settings = loadRoot(configs);

  const tryFile = (base: string): string | null => {
    if (files.has(base)) return base;
    const m = /\.(js|jsx|mjs|cjs)$/.exec(base);
    if (m) {
      const stem = base.slice(0, -m[0].length);
      for (const e of JS_TO_TS[m[0]]) if (files.has(stem + e)) return stem + e;
    }
    for (const e of SRC_EXTS) if (files.has(base + e)) return base + e;
    for (const e of SRC_EXTS) if (files.has(`${base}/index${e}`)) return `${base}/index${e}`;
    return null;
  };

  const tryPath = (p: string | null): string | null => (p === null ? null : tryFile(p));

  return (fromPath, specifier) => {
    if (specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../')) {
      return tryPath(join(dirname(fromPath), specifier));
    }

    let best: { rule: PathRule; len: number; mid: string } | null = null;
    for (const rule of settings.rules) {
      let mid = '';
      if (rule.wildcard) {
        if (specifier.length < rule.prefix.length + rule.suffix.length) continue;
        if (!specifier.startsWith(rule.prefix) || !specifier.endsWith(rule.suffix)) continue;
        mid = specifier.slice(rule.prefix.length, specifier.length - rule.suffix.length);
      } else if (specifier !== rule.prefix) continue;
      if (!best || rule.prefix.length > best.len) best = { rule, len: rule.prefix.length, mid };
    }
    if (best) {
      for (const t of best.rule.targets) {
        const hit = tryPath(normalize(t.replace('*', () => best!.mid)));
        if (hit) return hit;
      }
    }

    if (specifier.startsWith('/')) return null;
    for (const b of settings.baseUrls) {
      const hit = tryPath(join(b, specifier));
      if (hit) return hit;
    }
    return null;
  };
}
