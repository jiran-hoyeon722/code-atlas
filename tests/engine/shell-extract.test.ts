import { beforeAll, describe, expect, test } from 'vitest';
import type { Parser } from 'web-tree-sitter';
import { loadParsers } from '../../src/engine/parsers';
import { nodeLocate } from '../../src/engine/node';
import type { ProjectIndex } from '../../src/engine/link';
import { shellModule } from '../../src/engine/shell/module';

let parser: Parser;
beforeAll(async () => {
  parser = (await loadParsers(nodeLocate, ['shell'])).get('shell');
});

const facts = (text: string, path = 'scripts/run.sh') => shellModule.extractFile(parser, { path, text });
const refs = (text: string) => facts(text).imports.map((i) => `${i.kind}:${i.specifier}`);

function index(paths: string[]): ProjectIndex {
  return { paths: new Set(paths), configs: {}, byDir: new Map(), bySymbol: new Map(), facts: new Map() };
}

describe('shellModule.extractFile', () => {
  test('source and dot are import edges, with quotes stripped', () => {
    expect(refs('source ./a.sh\n. ../b.sh\nsource "c.sh"\nsource \'d.sh\'\n')).toEqual([
      'import:./a.sh', 'import:../b.sh', 'import:c.sh', 'import:d.sh',
    ]);
  });

  test('executed scripts are other edges', () => {
    expect(refs('./build.sh\n../x/y\nbash scripts/deploy.sh\nsh ./ci/run.sh --fast\ntool.sh -v\nx=1 ./env.sh\n')).toEqual([
      'other:./build.sh', 'other:../x/y', 'other:scripts/deploy.sh', 'other:./ci/run.sh', 'other:tool.sh', 'other:./env.sh',
    ]);
  });

  test('commands nested in functions, conditions and substitutions are found', () => {
    expect(refs('f() { if true; then source ./a.sh; fi; }\nx=$(./b.sh)\n')).toEqual(['import:./a.sh', 'other:./b.sh']);
  });

  test('arguments with expansions are skipped', () => {
    const text = 'source "$DIR/x.sh"\nsource `pwd`/y.sh\nsource "$(pwd)/z.sh"\nsource a${b}.sh\nsource ./"q".sh\n"$X"/run.sh\nbash "$1"\nbash -x run.sh\n';
    expect(refs(text)).toEqual([]);
  });

  test('plain commands and missing arguments make no edge', () => {
    expect(refs('echo ./a.sh\nsource\nbash\nls\n')).toEqual([]);
  });

  test('name keeps the extension and the kind is script', () => {
    expect(facts('', 'lib/common.sh')).toMatchObject({ name: 'common.sh', kind: 'script' });
    expect(facts('', 'tool.bash')).toMatchObject({ name: 'tool.bash', kind: 'script' });
  });

  test('metrics count functions, branches and each && / || once', () => {
    const f = facts('f() {\n  if a && b || c; then :; elif d; then :; fi\n  case $1 in x) :;; y) :;; esac\n}\nwhile [[ $a = 1 && $b = 2 ]]; do :; done\nfor i in 1; do :; done\n');
    expect(f).toMatchObject({ functions: 1, hasError: false, lines: 7 });
    // f: 1 + if + && + || + elif + 2 case items = 7; outside: while + [[ && ]] + for = 3
    expect(f).toMatchObject({ complexity: 10, maxComplexity: 7 });
  });

  test('syntax errors are flagged; no symbol links', () => {
    expect(facts('if then fi (\n').hasError).toBe(true);
    expect(shellModule.symbolLinks).toBe(false);
    expect(facts('source ./a.sh')).toMatchObject({ scope: '', declares: [], mentions: [], wildcards: [] });
  });
});

describe('shellModule.resolveImport', () => {
  const idx = index(['env.sh', 'lib/common.sh', 'lib/env.sh', 'scripts/deploy.sh', 'scripts/lib/util.sh', 'ci/run.sh']);
  const resolve = (spec: string, from = 'scripts/deploy.sh') => shellModule.resolveImport(from, spec, idx);

  test('relative to the current folder first', () => {
    expect(resolve('lib/util.sh')).toEqual(['scripts/lib/util.sh']);
    expect(resolve('./lib/util.sh')).toEqual(['scripts/lib/util.sh']);
    expect(resolve('../ci/run.sh')).toEqual(['ci/run.sh']);
    expect(resolve('../env.sh', 'lib/common.sh')).toEqual(['env.sh']);
    expect(resolve('env.sh', 'lib/common.sh')).toEqual(['lib/env.sh']);
  });

  test('then relative to the repo root', () => {
    expect(resolve('lib/common.sh')).toEqual(['lib/common.sh']);
    expect(resolve('./ci/run.sh')).toEqual(['ci/run.sh']);
    expect(resolve('scripts/deploy.sh', 'lib/common.sh')).toEqual(['scripts/deploy.sh']);
  });

  test('a missing script, or one above the repo root, is unresolved', () => {
    expect(resolve('nope.sh')).toBeNull();
    expect(resolve('../../outside.sh')).toBeNull();
    expect(resolve('../../env.sh')).toBeNull();
    expect(resolve('../env.sh', 'env.sh')).toBeNull();
  });

  test('absolute and home paths are outside the project', () => {
    expect(resolve('/etc/profile')).toEqual([]);
    expect(resolve('~/.bashrc')).toEqual([]);
  });
});
