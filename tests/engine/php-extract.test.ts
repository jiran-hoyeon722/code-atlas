import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { loadParsers, nodeLocate, type Parsers } from '../../src/engine/parsers';
import { detect, type Detection } from '../../src/engine/detect';
import { extractPhpFile } from '../../src/engine/php/extract';
import { extractPhpProject } from '../../src/engine/php/project';
import type { Edge, Extraction, RepoInput } from '../../src/engine/types';

const FIXTURE = join(__dirname, '../fixtures/laravel-mini');

function loadRepo(dir: string): RepoInput {
  const input: RepoInput = { name: 'laravel-mini', files: [], configs: {} };
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else {
        const path = relative(dir, abs).split('\\').join('/');
        const text = readFileSync(abs, 'utf8');
        if (path.endsWith('.php')) input.files.push({ path, text });
        else if (path === 'composer.json') input.configs[path] = text;
      }
    }
  };
  walk(dir);
  return input;
}

let parsers: Parsers;
let repo: RepoInput;
let detection: Detection;
let result: Extraction;
const processed: string[] = [];

const file = (path: string) => repo.files.find((f) => f.path === path)!;
const edge = (from: string, to: string): Edge | undefined =>
  result.edges.find((e) => e.from === from && e.to === to);

beforeAll(async () => {
  parsers = await loadParsers(nodeLocate);
  repo = loadRepo(FIXTURE);
  detection = detect(repo)!;
  result = extractPhpProject(repo, detection, parsers, (p) => processed.push(p));
});

describe('extractPhpFile', () => {
  test('reference kinds', () => {
    const facts = extractPhpFile(parsers.php, file('app/Actions/CreatePost.php'), false);
    expect(facts.refs).toEqual([
      { fqcn: 'App\\Models\\User', kind: 'inject' },
      { fqcn: 'App\\Models\\Post', kind: 'type' },
      { fqcn: 'App\\Models\\Post', kind: 'new' },
      { fqcn: 'App\\Enums\\Status', kind: 'const' },
      { fqcn: 'App\\Events\\PostCreated', kind: 'static-call' },
    ]);
    // `use App\Contracts\Clock;` is imported but never used
    expect(facts.refs.some((r) => r.fqcn === 'App\\Contracts\\Clock')).toBe(false);
    expect(facts.declarations).toEqual([{ fqcn: 'App\\Actions\\CreatePost', kind: 'class' }]);
    expect(facts.hasError).toBe(false);
    expect(facts.lines).toBe(28);
    expect(facts.functions).toBe(2);
  });

  test('every class-name position is classified like deps.php', () => {
    const src = `<?php
namespace N;
use X\\Imported;
#[Attr(Z::class)]
abstract class C extends P implements I, \\J\\K {
    use T1, T2 { T1::f insteadof T2; T2::f as g; }
    const ?Q X = 1;
    public ?Foo $p;
    public function __construct(private Bar|Baz $b, (M&N2)|null $d, int $i, self $s, Parent $pa) {}
    public function m(V ...$v): static|W {
        new Q2(); new class extends R implements RI {}; S::m(); S::$v; S::C; S1::class;
        $x instanceof U; $x instanceof $y;
        try {} catch (E1 | E2 $e) {}
        static::x(); new static; fn(A1 $a): A2 => 1; function (B1 $b): B2 {};
        \\f\\g(); namespace\\Rel::x(); strlen('x'); FOO;
        return mixed::class;
    }
}
interface I2 extends I3 {}
trait T3 {}
enum E3: string implements I4 { case A = 'a'; }
function top(never|Foo2 $x): iterable {}
`;
    const facts = extractPhpFile(parsers.php, { path: 'x.php', text: src }, false);
    expect(facts.refs).toEqual([
      { fqcn: 'N\\Attr', kind: 'attribute' },
      { fqcn: 'N\\Z', kind: 'class-ref' },
      { fqcn: 'N\\P', kind: 'extends' },
      { fqcn: 'N\\I', kind: 'implements' },
      { fqcn: 'J\\K', kind: 'implements' },
      { fqcn: 'N\\T1', kind: 'trait' },
      { fqcn: 'N\\T2', kind: 'trait' },
      { fqcn: 'N\\T1', kind: 'other' },
      { fqcn: 'N\\T2', kind: 'other' },
      { fqcn: 'N\\T2', kind: 'other' },
      { fqcn: 'N\\Q', kind: 'other' },
      { fqcn: 'N\\Foo', kind: 'type' },
      { fqcn: 'N\\Bar', kind: 'inject' },
      { fqcn: 'N\\Baz', kind: 'inject' },
      { fqcn: 'N\\M', kind: 'inject' },
      { fqcn: 'N\\N2', kind: 'inject' },
      { fqcn: 'N\\V', kind: 'type' },
      { fqcn: 'N\\W', kind: 'type' },
      { fqcn: 'N\\Q2', kind: 'new' },
      { fqcn: 'N\\R', kind: 'extends' },
      { fqcn: 'N\\RI', kind: 'implements' },
      { fqcn: 'N\\S', kind: 'static-call' },
      { fqcn: 'N\\S', kind: 'static-call' },
      { fqcn: 'N\\S', kind: 'const' },
      { fqcn: 'N\\S1', kind: 'class-ref' },
      { fqcn: 'N\\U', kind: 'instanceof' },
      { fqcn: 'N\\E1', kind: 'catch' },
      { fqcn: 'N\\E2', kind: 'catch' },
      { fqcn: 'N\\A1', kind: 'type' },
      { fqcn: 'N\\A2', kind: 'type' },
      { fqcn: 'N\\B1', kind: 'type' },
      { fqcn: 'N\\B2', kind: 'type' },
      { fqcn: 'N\\Rel', kind: 'static-call' },
      { fqcn: 'N\\I3', kind: 'implements' },
      { fqcn: 'N\\I4', kind: 'implements' },
      { fqcn: 'N\\Foo2', kind: 'type' },
    ]);
    expect(facts.declarations).toEqual([
      { fqcn: 'N\\C', kind: 'abstract' },
      { fqcn: 'N\\I2', kind: 'interface' },
      { fqcn: 'N\\T3', kind: 'trait' },
      { fqcn: 'N\\E3', kind: 'enum' },
    ]);
  });

  test('laravel wiring facts', () => {
    const esp = extractPhpFile(parsers.php, file('app/Providers/EventServiceProvider.php'), true);
    expect(esp.listen).toEqual([['App\\Events\\PostCreated', 'App\\Listeners\\NotifyAuthor']]);
    const asp = file('app/Providers/AppServiceProvider.php');
    expect(extractPhpFile(parsers.php, asp, true).binds).toEqual([
      ['App\\Contracts\\PostRepository', 'App\\Repositories\\EloquentPostRepository'],
      ['App\\Contracts\\Clock', 'App\\Support\\SystemClock'],
    ]);
    // Outside providers only the bind() call counts, not the class map.
    expect(extractPhpFile(parsers.php, asp, false).binds).toEqual([
      ['App\\Contracts\\PostRepository', 'App\\Repositories\\EloquentPostRepository'],
    ]);
  });

  test('bind/singleton/scoped calls: named args, case, and non-method calls', () => {
    const src = `<?php
$this->app->bind(abstract: A::class, concrete: B::class);
$app->SINGLETON(C::class, D::class);
$app->scoped(E::class, F::class);
$app->bind(G::class);
$app->instance(H::class, I::class);
App::bind(J::class, K::class);
$app->bind(self::class, L::class);
`;
    expect(extractPhpFile(parsers.php, { path: 'x.php', text: src }, false).binds).toEqual([
      ['A', 'B'],
      ['C', 'D'],
      ['E', 'F'],
    ]);
  });
});

describe('extractPhpProject', () => {
  test('laravel wiring edges', () => {
    expect(edge('app/Events/PostCreated.php', 'app/Listeners/NotifyAuthor.php')).toEqual({
      from: 'app/Events/PostCreated.php',
      to: 'app/Listeners/NotifyAuthor.php',
      weight: 1,
      kinds: { triggers: 1 },
    });
    expect(edge('app/Contracts/PostRepository.php', 'app/Repositories/EloquentPostRepository.php')?.kinds).toEqual({ binds: 1 });
    expect(edge('app/Contracts/Clock.php', 'app/Support/SystemClock.php')?.kinds).toEqual({ binds: 1 });
  });

  test('weights count references and kinds count per reference', () => {
    expect(edge('app/Actions/CreatePost.php', 'app/Models/Post.php')).toMatchObject({ weight: 2, kinds: { type: 1, new: 1 } });
    expect(edge('app/Models/Post.php', 'app/Enums/Status.php')).toMatchObject({ weight: 2, kinds: { 'class-ref': 1, const: 1 } });
  });

  test('route refs', () => {
    expect(result.routeRefs).toEqual({
      'app/Http/Controllers/PostController.php': { 'routes/api.php': 2 },
    });
  });

  test('case-insensitive class match', () => {
    expect(edge('app/legacy.php', 'app/Models/User.php')).toMatchObject({ weight: 1, kinds: { new: 1 } });
  });

  test('multiple classes in global namespace', () => {
    const facts = extractPhpFile(parsers.php, file('app/legacy.php'), false);
    expect(facts.declarations).toEqual([
      { fqcn: 'LegacyReport', kind: 'class' },
      { fqcn: 'LegacyFormatter', kind: 'class' },
    ]);
    expect(edge('app/Listeners/NotifyAuthor.php', 'app/legacy.php')).toMatchObject({ weight: 1, kinds: { 'static-call': 1 } });
    expect(result.nodes.find((n) => n.id === 'app/legacy.php')).toMatchObject({ name: 'LegacyReport', kind: 'class' });
  });

  test('syntax error recorded but extracted', () => {
    expect(result.failed).toEqual([{ path: 'app/Broken.php', reason: 'syntax' }]);
    expect(result.nodes.find((n) => n.id === 'app/Broken.php')).toBeDefined();
  });

  test('no self edges', () => {
    expect(result.edges.filter((e) => e.from === e.to)).toEqual([]);
    expect(edge('app/Models/Post.php', 'app/Models/Post.php')).toBeUndefined();
  });

  test('nodes', () => {
    expect(result.nodes.map((n) => n.id)).toEqual([...repo.files.map((f) => f.path).filter((p) => p.startsWith('app/'))].sort());
    expect(result.nodes.find((n) => n.id === 'app/Enums/Status.php')).toEqual({
      id: 'app/Enums/Status.php', name: 'Status', kind: 'enum', lines: 10, functions: 0, complexity: 0, maxComplexity: 0,
    });
    expect(result.nodes.find((n) => n.id === 'app/Contracts/Clock.php')?.kind).toBe('interface');
    expect(result.unresolved).toBe(0);
    expect(processed).toEqual(result.nodes.map((n) => n.id));
  });

  test('script node falls back to the file name', () => {
    const input: RepoInput = { name: 'x', configs: {}, files: [{ path: 'app/helpers.php', text: '<?php\nfunction h() {}\n' }] };
    const r = extractPhpProject(input, { lang: 'php', framework: 'laravel', sourceDir: 'app', routeDirs: [] }, parsers);
    expect(r.nodes).toEqual([{ id: 'app/helpers.php', name: 'helpers.php', kind: 'script', lines: 3, functions: 1, complexity: 1, maxComplexity: 1 }]);
  });

  test('matches deps.php reference output except documented deviations', () => {
    const ref = JSON.parse(readFileSync(join(FIXTURE, 'deps-reference.json'), 'utf8')) as {
      nodes: { id: string; kind: string; lines: number }[];
      edges: Edge[];
      routeRefs: Extraction['routeRefs'];
    };
    // Deviations by design: case-insensitive class lookup (legacy.php) and error-tolerant parsing (Broken.php).
    const deviating = new Set(['app/legacy.php', 'app/Broken.php']);
    const key = (e: Edge) => `${e.from} -> ${e.to}`;
    const ours = result.edges.filter((e) => !deviating.has(e.from)).sort((a, b) => key(a).localeCompare(key(b)));
    const theirs = ref.edges.filter((e) => !deviating.has(e.from)).sort((a, b) => key(a).localeCompare(key(b)));
    expect(ours).toEqual(theirs);
    expect(result.routeRefs).toEqual(ref.routeRefs);
    expect(result.nodes.map((n) => [n.id, n.lines])).toEqual(ref.nodes.map((n) => [n.id, n.lines]));
    expect(result.nodes.filter((n) => !deviating.has(n.id)).map((n) => n.kind)).toEqual(
      ref.nodes.filter((n) => !deviating.has(n.id)).map((n) => n.kind),
    );
  });
});
