import type { Lang, RepoInput } from './types';
import { isSourcePath } from './collect';

export interface Detection {
  lang: Lang;
  framework: 'laravel' | 'react' | null;
  sourceDir: string;
  routeDirs: string[];
}

function readJson(text: string | undefined): Record<string, unknown> | null {
  if (text === undefined) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function hasKey(obj: unknown, key: string): boolean {
  return !!obj && typeof obj === 'object' && key in (obj as object);
}

export function detect(input: RepoInput, prefer?: Lang): Detection | null {
  const count: Partial<Record<Lang, number>> = {};
  for (const f of input.files) {
    const l = isSourcePath(f.path);
    if (l) count[l] = (count[l] ?? 0) + 1;
  }
  const php = count.php ?? 0;
  const ts = count.ts ?? 0;
  if (php + ts === 0) return null;

  let lang: Lang;
  if (prefer && (count[prefer] ?? 0) > 0) lang = prefer;
  else lang = php >= ts ? 'php' : 'ts';

  const hasDir = (dir: string) => input.files.some((f) => f.path.startsWith(dir + '/'));

  if (lang === 'php') {
    const composer = readJson(input.configs['composer.json']);
    const laravel = hasKey(composer?.require, 'laravel/framework') || hasKey(composer?.['require-dev'], 'laravel/framework');
    if (laravel) {
      return { lang, framework: 'laravel', sourceDir: 'app', routeDirs: hasDir('routes') ? ['routes'] : [] };
    }
    return { lang, framework: null, sourceDir: '', routeDirs: [] };
  }

  const pkg = readJson(input.configs['package.json']);
  const react = ['dependencies', 'devDependencies', 'peerDependencies'].some((k) => hasKey(pkg?.[k], 'react'));
  if (react) {
    const sourceDir = hasDir('src') ? 'src' : '';
    const routeDirs = ['src/routes', 'src/pages', 'app'].filter(hasDir);
    return { lang, framework: 'react', sourceDir, routeDirs };
  }
  return { lang, framework: null, sourceDir: '', routeDirs: [] };
}
