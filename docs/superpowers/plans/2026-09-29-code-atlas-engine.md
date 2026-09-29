# Code Atlas 분석 엔진 Implementation Plan (계획 1/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 레포 파일 목록을 받아 PHP(Laravel)·TS/JS(React) 의존성 구조와 지표를 계산하는, 브라우저 Worker 와 Node 양쪽에서 도는 순수 TS 분석 엔진을 만들고, 기존 docker 파이프라인 결과와 대조해 검증한다.

**Architecture:** `src/engine/` 은 React·DOM 비의존 순수 TS. 입력은 메모리의 `{ path, text }[]`, 파서는 web-tree-sitter(PHP·TSX 문법 WASM). 언어별 추출기가 공통 `Extraction` 을 내고, `buildArchitecture` 가 역할·계층·파생 지표를 붙여 `Architecture` 를 만든다. 화면(계획 2)은 `Architecture` 만 소비한다.

**Tech Stack:** TypeScript ^5.9, Vitest ^5, web-tree-sitter 0.27.0, tree-sitter-php 0.24.2, tree-sitter-typescript 0.23.2, tsx(스크립트 실행), Node 22+.

**Spec:** `docs/superpowers/specs/2026-09-29-code-atlas-browser-design.md`

## Global Constraints

- 레포에 분석 대상 레포의 소스·경로·클래스명·구조 설명·분석 수치를 넣지 않는다. 테스트 픽스처는 직접 만든 가짜 코드(`tests/fixtures/`)만. 대조 결과와 기준값은 `.local/` 에만.
- 엔진은 네트워크 호출·DOM 접근을 하지 않는다. `fetch` 는 WASM 로드용 `locateFile` 경로 외에 쓰지 않는다.
- 파일 경로는 레포 루트 기준 상대경로, 구분자 `/`, 앞에 `./` 없음.
- 버전 고정: `web-tree-sitter@0.27.0`, `tree-sitter-php@0.24.2`, `tree-sitter-typescript@0.23.2`. PHP 는 `tree-sitter-php.wasm`(HTML 섞인 PHP 포함 문법), TS/JS 는 모두 `tree-sitter-tsx.wasm`.
- 기존 `tools/codecity/`, `repos/`, `site/`, `composer.*`, dependency-cruiser 는 이 계획에서 지우지 않는다(대조 기준으로 사용).
- 엔진 식별자·코드는 영어, 사용자에게 보이는 문구(역할 설명 등)는 한국어.

## Review Focus

1. 문법 오류가 있는 파일 — tree-sitter 는 부분 트리를 준다. 추출은 계속하고 `failed` 에 `{ path, reason: 'syntax' }` 로 기록(Task 5·7 테스트).
2. PHP 클래스 이름 대소문자 — PHP 는 클래스명을 대소문자 구분 없이 해석한다. 정확 일치 우선, 없으면 소문자 일치로 연결(Task 5 테스트).
3. namespace 없는 PHP 파일·한 파일에 클래스 여러 개 — 전역 이름으로 등록되고 모든 선언이 파일에 매핑(Task 5 테스트).
4. TS 에서 `./x.js` 로 적었지만 실제 파일은 `x.ts`(ESM TS 관례), 폴더 import(`./dir` → `dir/index.tsx`) — 해석되어야 함(Task 6 테스트).
5. `tsconfig` 의 `extends` 순환·없는 파일·주석과 끝 쉼표 — 예외 없이 무시하고 진행(Task 6 테스트).

---

## File Structure

| 파일 | 책임 |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | 앱 뼈대(엔진 단계에 필요한 것만) |
| `src/engine/types.ts` | 엔진 공통 타입 |
| `src/engine/parsers.ts` | web-tree-sitter 초기화, 언어별 Parser 제공 |
| `src/engine/collect.ts` | 건너뛸 폴더·대상 확장자·설정 파일 판별 |
| `src/engine/detect.ts` | 언어·프레임워크·소스 폴더 감지 |
| `src/engine/complexity.ts` | 함수 수·순환 복잡도 |
| `src/engine/php/names.ts` | PHP 이름 해석(namespace·use) |
| `src/engine/php/extract.ts` | PHP 파일 1개 → 선언·참조·Laravel 연결·지표 |
| `src/engine/php/project.ts` | PHP 프로젝트 → `Extraction` |
| `src/engine/ts/resolve.ts` | TS/JS import 경로 해석 |
| `src/engine/ts/extract.ts` | TS/JS 파일 1개 → import 목록·지표 |
| `src/engine/ts/project.ts` | TS/JS 프로젝트 → `Extraction` |
| `src/engine/presets.ts` | Laravel·React·기본 프리셋, 역할 패턴 매칭 |
| `src/engine/architecture.ts` | fan-in/out·불안정도·PageRank·역방향 → `Architecture` |
| `src/engine/analyze.ts` | 전체 파이프라인 + 진행 이벤트 |
| `scripts/compare.ts` | 로컬 폴더를 읽어 엔진 실행, 기준 deps.json 과 대조, `.local/compare/` 에 보고 |
| `tests/engine/*.test.ts`, `tests/fixtures/laravel-mini/`, `tests/fixtures/react-mini/` | 단위·통합 테스트, 가짜 픽스처 |

---

### Task 1: 뼈대 + 파서 로더 + 대조 기준 확보

**Files:**
- Modify: `package.json` (기존 dependency-cruiser 유지, 아래 추가)
- Create: `tsconfig.json`, `vitest.config.ts`, `src/engine/types.ts`, `src/engine/parsers.ts`
- Test: `tests/engine/parsers.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`:
    - `type Lang = 'php' | 'ts'`
    - `interface SourceFile { path: string; text: string }`
    - `interface RepoInput { name: string; files: SourceFile[]; configs: Record<string, string> }` — `configs` 키는 `composer.json`, `package.json`, `tsconfig*.json`, `jsconfig.json` 의 경로
    - `type RefKind = 'inject' | 'type' | 'static-call' | 'new' | 'const' | 'class-ref' | 'extends' | 'implements' | 'trait' | 'catch' | 'instanceof' | 'attribute' | 'other' | 'triggers' | 'binds' | 'import' | 'type-import' | 'dynamic-import' | 're-export' | 'require'`
    - `interface FileNode { id: string; name: string; kind: string; lines: number; functions: number; complexity: number; maxComplexity: number }`
    - `interface Edge { from: string; to: string; weight: number; kinds: Partial<Record<RefKind, number>> }`
    - `interface Extraction { nodes: FileNode[]; edges: Edge[]; routeRefs: Record<string, Record<string, number>>; failed: { path: string; reason: 'syntax' | 'read' }[]; unresolved: number }`
  - `parsers.ts`: `interface Parsers { php: Parser; tsx: Parser }`, `loadParsers(locate: (file: 'web-tree-sitter.wasm' | 'tree-sitter-php.wasm' | 'tree-sitter-tsx.wasm') => string): Promise<Parsers>`, `nodeLocate(file): string` (Node 용, `node_modules` 안 절대경로)

- [ ] **Step 1: 대조 기준 복사** — 기존 파이프라인 산출물을 git 제외 폴더로 보관한다.

```bash
mkdir -p .local/baseline
for n in $(ls .work); do [ -f .work/$n/deps.json ] && mkdir -p .local/baseline/$n && cp .work/$n/deps.json .local/baseline/$n/; done
ls .local/baseline/*/deps.json
```
Expected: 기준 레포마다 `deps.json` 1개. `git status --short .local` 출력 없음(.gitignore 의 `/.local/`).

- [ ] **Step 2: 의존성 추가** — `devDependencies`: `typescript@^5.9`, `vitest@^5`, `tsx@^4`, `@types/node@^22`; `dependencies`: `web-tree-sitter@0.27.0`, `tree-sitter-php@0.24.2`, `tree-sitter-typescript@0.23.2`. `"type": "module"`, scripts `test: vitest run`, `compare: tsx scripts/compare.ts`. `tsconfig.json` 은 `strict: true`, `module: ESNext`, `moduleResolution: Bundler`, `target: ES2022`, `include: ["src", "tests", "scripts"]`. 설치는 `docker run --rm -v "$PWD":/app -w /app node:22-alpine npm install`.

- [ ] **Step 3: 실패하는 테스트**

```ts
// tests/engine/parsers.test.ts
test('parses PHP and TSX without syntax errors', async () => {
  const p = await loadParsers(nodeLocate);
  expect(p.php.parse('<?php namespace A; use B\\{C, D as E}; class X extends C {}')!.rootNode.hasError).toBe(false);
  expect(p.tsx.parse("import type { A } from './a'; const x = <div/>; import('./b');")!.rootNode.hasError).toBe(false);
});
test('loadParsers is memoized', async () => {
  expect(await loadParsers(nodeLocate)).toBe(await loadParsers(nodeLocate));
});
```

- [ ] **Step 4:** `npx vitest run tests/engine/parsers.test.ts` → FAIL(모듈 없음).
- [ ] **Step 5: `loadParsers` 구현** — `Parser.init({ locateFile })` 후 `Language.load(locate(...))` 두 번, 결과를 모듈 변수에 캐시. `nodeLocate` 는 `createRequire(import.meta.url).resolve('<pkg>/<file>')`.
- [ ] **Step 6:** 같은 테스트 → PASS.
- [ ] **Step 7: Commit** — `git add package.json package-lock.json tsconfig.json vitest.config.ts src/engine tests/engine && git commit -m "feat(engine): scaffold engine and tree-sitter parser loader"`

---

### Task 2: 파일 수집 규칙 + 감지

**Files:**
- Create: `src/engine/collect.ts`, `src/engine/detect.ts`
- Test: `tests/engine/collect.test.ts`, `tests/engine/detect.test.ts`

**Interfaces:**
- Produces:
  - `SKIP_DIRS: ReadonlySet<string>` = `node_modules, vendor, .git, dist, build, .next, storage, coverage`
  - `shouldSkipDir(name: string): boolean`, `isSourcePath(path: string): Lang | null` (`.php` → php; `.ts .tsx .js .jsx .mjs .cjs` → ts), `isConfigPath(path: string): boolean` (루트 또는 어느 깊이든 `composer.json`, `package.json`, `tsconfig*.json`, `jsconfig.json`; 단 SKIP_DIRS 안은 제외)
  - `MAX_FILES = 20000`
  - `parseGitignore(text: string): (path: string, isDir: boolean) => boolean` — 지원: `#` 주석, 빈 줄, 이름만(`dist`, 어느 깊이든), `/` 로 시작(루트 고정), `/` 로 끝(폴더만), `*`·`**` glob. `!` 부정 줄은 무시(보수적으로 덜 건너뜀)
  - `interface Detection { lang: Lang; framework: 'laravel' | 'react' | null; sourceDir: string; routeDirs: string[] }`
  - `detect(input: RepoInput, prefer?: Lang): Detection | null` — 대상 파일이 없으면 `null`. `prefer` 가 주어지고 그 언어 파일이 있으면 그 언어로(섞인 레포에서 사용자가 바꾸는 용도)

- [ ] **Step 1: 실패하는 테스트**

```ts
test('skips vendor-like dirs', () => { expect(shouldSkipDir('node_modules')).toBe(true); expect(shouldSkipDir('src')).toBe(false); });
test('classifies source paths', () => { expect(isSourcePath('app/A.php')).toBe('php'); expect(isSourcePath('src/a.d.ts')).toBe('ts'); expect(isSourcePath('a.css')).toBeNull(); });
test('laravel detection', () => {
  const d = detect({ name: 'x', configs: { 'composer.json': '{"require":{"laravel/framework":"^11"}}' }, files: [{ path: 'app/A.php', text: '' }, { path: 'routes/api.php', text: '' }] });
  expect(d).toEqual({ lang: 'php', framework: 'laravel', sourceDir: 'app', routeDirs: ['routes'] });
});
test('react detection with src', () => {
  const d = detect({ name: 'x', configs: { 'package.json': '{"dependencies":{"react":"^19"}}' }, files: [{ path: 'src/main.tsx', text: '' }, { path: 'src/routes/index.tsx', text: '' }] });
  expect(d).toEqual({ lang: 'ts', framework: 'react', sourceDir: 'src', routeDirs: ['src/routes'] });
});
test('mixed repo picks the language with more files', () => { /* 3 php + 1 ts, no manifests → lang php, framework null, sourceDir '' */ });
test('no supported files → null', () => { expect(detect({ name: 'x', configs: {}, files: [] })).toBeNull(); });
test('prefer overrides majority', () => { /* 3 php + 1 ts, prefer 'ts' → lang 'ts' */ });
test('gitignore rules', () => {
  const ig = parseGitignore('# c\n/tmp\nlogs/\n*.gen.ts\n!keep.gen.ts\n');
  expect(ig('tmp', true)).toBe(true); expect(ig('a/tmp', true)).toBe(false); expect(ig('a/logs', true)).toBe(true);
  expect(ig('a/logs', false)).toBe(false); expect(ig('src/x.gen.ts', false)).toBe(true); expect(ig('src/x.ts', false)).toBe(false);
});
```

- [ ] **Step 2:** 실행 → FAIL.
- [ ] **Step 3: 구현** — `sourceDir`: Laravel 은 `app`, React 는 `src` 가 있으면 `src` 아니면 `''`, 그 외 `''`. `routeDirs`: Laravel `['routes']`(존재할 때); React 는 `src/routes`, `src/pages`, `app` 중 존재하는 것. 매니페스트 JSON 파싱 실패는 프레임워크 없음으로 처리.
- [ ] **Step 4:** 실행 → PASS.
- [ ] **Step 5: Commit** — `feat(engine): file collection rules and repo detection`

---

### Task 3: 복잡도

**Files:**
- Create: `src/engine/complexity.ts`
- Test: `tests/engine/complexity.test.ts`

**Interfaces:**
- Consumes: `loadParsers`
- Produces: `measure(root: Node, lang: Lang): { functions: number; complexity: number; maxComplexity: number }`
  - 함수 노드: PHP `function_definition, method_declaration, anonymous_function, arrow_function`; TS `function_declaration, function_expression, arrow_function, method_definition, generator_function_declaration`.
  - 분기 노드(+1): PHP `if_statement, else_if_clause, for_statement, foreach_statement, while_statement, do_statement, case_statement, catch_clause, conditional_expression, match_conditional_expression`, 그리고 `binary_expression` 중 연산자 `&& || and or ??`; TS `if_statement, for_statement, for_in_statement, while_statement, do_statement, switch_case, catch_clause, ternary_expression`, `binary_expression` 중 `&& || ??`.
  - 함수 하나의 복잡도 = 1 + 그 함수 본문 안(중첩 함수 제외) 분기 수. `complexity` = 모든 함수 합, 함수 밖 분기는 합계에만 더함.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('php method complexity', async () => {
  const { php } = await loadParsers(nodeLocate);
  const t = php.parse('<?php class A { function f($a) { if ($a && $b) {} foreach ($x as $y) {} } function g() {} }')!;
  expect(measure(t.rootNode, 'php')).toEqual({ functions: 2, complexity: 5, maxComplexity: 4 });
});
test('ts nested function counted separately', async () => {
  const { tsx } = await loadParsers(nodeLocate);
  const t = tsx.parse('function f(a){ if(a){} const g = () => a ? 1 : 2; }')!;
  expect(measure(t.rootNode, 'ts')).toEqual({ functions: 2, complexity: 4, maxComplexity: 2 });
});
```

- [ ] **Step 2:** FAIL → **Step 3:** 구현(트리 순회, 가장 가까운 함수 조상에 분기 귀속) → **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(engine): cyclomatic complexity per function`

---

### Task 4: PHP 이름 해석

**Files:**
- Create: `src/engine/php/names.ts`
- Test: `tests/engine/php-names.test.ts`

**Interfaces:**
- Produces:
  - `interface PhpScope { namespace: string; classes: Map<string, string>; functions: Map<string, string>; consts: Map<string, string> }` — 키는 별칭 소문자, 값은 FQCN(앞 `\` 없음)
  - `scopeAt(root: Node, node: Node): PhpScope` — 노드가 속한 namespace 블록/구문의 `use` 들로 만든 스코프(파일 단위 캐시)
  - `resolveClassName(raw: string, scope: PhpScope): string` — 규칙: `\A\B` → `A\B`; `namespace\X` → `<ns>\X`; 첫 조각이 별칭이면 치환(`Foo\Bar` 에서 `Foo` 가 별칭); 아니면 `<ns>\raw`; `self/static/parent` 는 `''` 반환(호출 측이 처리)

- [ ] **Step 1: 실패하는 테스트**

```ts
const src = '<?php namespace App\\X; use App\\Models\\User; use App\\Data\\{A, B as Bee}; use function App\\h; class C {}';
test.each([
  ['User', 'App\\Models\\User'], ['Bee', 'App\\Data\\B'], ['A', 'App\\Data\\A'],
  ['\\Other\\Z', 'Other\\Z'], ['namespace\\Y', 'App\\X\\Y'], ['Local', 'App\\X\\Local'],
  ['User\\Sub', 'App\\Models\\User\\Sub'], ['user', 'App\\Models\\User'],
])('resolves %s', async (raw, fq) => { /* parse src, scope = scopeAt(root, classNode); expect(resolveClassName(raw, scope)).toBe(fq) */ });
test('global namespace', async () => { /* '<?php use Foo\\Bar; class C {}' → 'Baz' resolves to 'Baz' */ });
test('bracketed namespaces keep separate scopes', async () => { /* 'namespace A { use X\\Y; } namespace B { class C {} }' → in B, 'Y' → 'B\\Y' */ });
```

- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(engine): php name resolution`

---

### Task 5: PHP 추출 (파일 → 프로젝트)

**Files:**
- Create: `src/engine/php/extract.ts`, `src/engine/php/project.ts`, `tests/fixtures/laravel-mini/**` (가짜 Laravel 앱: Controller 1, Action 1, Model 2, Event 1, Listener 1, EventServiceProvider, AppServiceProvider(bind + `A::class => B::class` 맵), Enum 1, routes/api.php, 문법 오류 파일 1, namespace 없는 파일 1(클래스 2개))
- Test: `tests/engine/php-extract.test.ts`

**Interfaces:**
- Consumes: `Parsers`, `scopeAt`, `resolveClassName`, `measure`, `Detection`
- Produces:
  - `interface PhpFacts { declarations: { fqcn: string; kind: 'class' | 'abstract' | 'interface' | 'trait' | 'enum' }[]; refs: { fqcn: string; kind: RefKind }[]; listen: [event: string, listener: string][]; binds: [abstract: string, concrete: string][]; hasError: boolean; lines: number; functions: number; complexity: number; maxComplexity: number }`
  - `extractPhpFile(parser: Parser, file: SourceFile, isProvider: boolean): PhpFacts`
  - `extractPhpProject(input: RepoInput, detection: Detection, parsers: Parsers, onFile?: (path: string) => void): Extraction` — `onFile` 은 파일 하나 처리 후 호출. 노드는 `sourceDir` 아래 `.php` 만, `kind` 는 첫 선언 종류(없으면 `script`), `name` 은 첫 선언 짧은 이름(없으면 파일명). `routeRefs[target][routeFile]` 는 `routeDirs` 파일의 참조 수. `isProvider` = 경로가 `<sourceDir>/Providers/` 로 시작.
  - 참조 종류 판별(부모 노드 기준): `base_clause` → extends; `class_interface_clause` → implements; `use_declaration`(클래스 본문의 trait use) → trait; `object_creation_expression` → new; `scoped_call_expression`·`scoped_property_access_expression` → static-call; `class_constant_access_expression` 의 상수 이름이 `class` → class-ref, 아니면 const; `binary_expression` 의 `instanceof` → instanceof; `catch_clause` 타입 → catch; `attribute` → attribute; 매개변수 타입이고 메서드 이름이 `__construct` → inject; 매개변수·반환·프로퍼티 타입 → type; 그 밖 → other. `namespace_use_declaration` 안의 이름은 참조가 아님.
  - Laravel: `$listen` 프로퍼티 배열의 `Event::class => [Listener::class, ...]` → `triggers`(event→listener); `->bind|singleton|scoped(A::class, B::class)` → `binds`(A→B); Provider 파일의 모든 `A::class => B::class` 배열 원소 → `binds`.

- [ ] **Step 1: 실패하는 테스트** (픽스처 기준, 정확한 값)

```ts
test('reference kinds', async () => { /* extractPhpFile on fixture Action: refs contain {fqcn:'App\\Models\\User',kind:'inject'}, {..'App\\Models\\Post','new'}, {..'App\\Enums\\Status','const'}, {..'App\\Events\\PostCreated','static-call'}, and no ref from its `use` lines alone */ });
test('laravel wiring edges', async () => { /* project edges include PostCreated→NotifyAuthor kinds {triggers:1}, Contract→Impl kinds {binds:1} */ });
test('route refs', async () => { /* routeRefs['app/Http/Controllers/PostController.php']['routes/api.php'] === 2 */ });
test('case-insensitive class match', async () => { /* fixture refers `new app\\models\\user` → edge to app/Models/User.php */ });
test('multiple classes in global namespace', async () => { /* both declarations map to the same file; a ref to the second creates an edge to that file */ });
test('syntax error recorded but extracted', async () => { /* failed contains {path:'app/Broken.php',reason:'syntax'}; node exists */ });
test('no self edges', async () => { /* no edge where from === to */ });
```

- [ ] **Step 2:** FAIL → **Step 3:** 구현 — 1차: 모든 파일 선언 수집 → `classToFile`(정확 + 소문자 맵). 2차: 참조를 파일로 해석해 간선 누적(`weight` 는 참조 횟수). → **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(engine): php extraction with laravel wiring`

---

### Task 6: TS/JS import 경로 해석

**Files:**
- Create: `src/engine/ts/resolve.ts`
- Test: `tests/engine/ts-resolve.test.ts`

**Interfaces:**
- Produces: `createTsResolver(files: ReadonlySet<string>, configs: Record<string, string>): (fromPath: string, specifier: string) => string | null`
  - 순서: 상대(`./`, `../`) → `paths` 별칭(가장 긴 접두 우선, `*` 치환, 대상 여러 개면 순서대로) → `baseUrl` 기준 → 실패 `null`(외부 패키지 포함).
  - 후보 보완: 그대로 → `.ts .tsx .d.ts .js .jsx .mjs .cjs` 붙이기 → `/index` + 같은 확장자들; 지정자가 `.js/.jsx/.mjs/.cjs` 로 끝나면 `.ts/.tsx/.mts/.cts` 로 바꾼 후보도.
  - 설정: 루트 `tsconfig.json` → 없으면 `jsconfig.json`; `extends` 는 상대경로만 따라가며 방문 집합으로 순환 차단; 루트에 `paths` 가 없고 `references` 가 있으면 참조된 각 설정의 `paths` 를 병합. JSON 은 주석(`//`, `/* */`)·끝 쉼표 제거 후 파싱, 실패하면 그 설정 무시.

- [ ] **Step 1: 실패하는 테스트**

```ts
const files = new Set(['src/a.ts', 'src/dir/index.tsx', 'src/lib/util.ts', 'src/b.tsx']);
test('relative with extension fill', () => { expect(r('src/b.tsx', './a')).toBe('src/a.ts'); });
test('directory index', () => { expect(r('src/b.tsx', './dir')).toBe('src/dir/index.tsx'); });
test('.js specifier to .ts file', () => { expect(r('src/b.tsx', './a.js')).toBe('src/a.ts'); });
test('paths alias', () => { /* configs tsconfig.json {"compilerOptions":{"baseUrl":".","paths":{"@/*":["./src/*"]}}} → r('src/b.tsx','@/lib/util') === 'src/lib/util.ts' */ });
test('references fallback', () => { /* root {"files":[],"references":[{"path":"./tsconfig.app.json"}]} + app has paths → alias works */ });
test('jsonc and cyclic extends tolerated', () => { /* tsconfig with comments + trailing comma, a extends b extends a → no throw, relative still works */ });
test('package import is null', () => { expect(r('src/b.tsx', 'react')).toBeNull(); });
```

- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(engine): ts import resolution with tsconfig paths`

---

### Task 7: TS/JS 추출 (파일 → 프로젝트)

**Files:**
- Create: `src/engine/ts/extract.ts`, `src/engine/ts/project.ts`, `tests/fixtures/react-mini/**` (가짜 React 앱: `tsconfig.json` 에 `@/*` 별칭, `src/main.tsx`, `src/routes/index.tsx`, `src/components/ui/button.tsx`, `src/components/users/UserList.tsx`, `src/components/users/hooks/useUsers.ts`, `src/services/userService.ts`, `src/atoms/user.ts`, `src/types/user.ts`, `src/routeTree.gen.ts`, 문법 오류 파일 1)
- Test: `tests/engine/ts-extract.test.ts`

**Interfaces:**
- Consumes: `Parsers`, `createTsResolver`, `measure`, `Detection`
- Produces:
  - `extractTsFile(parser: Parser, file: SourceFile): { imports: { specifier: string; kind: 'import' | 'type-import' | 'dynamic-import' | 're-export' | 'require' }[]; hasError: boolean; lines: number; functions: number; complexity: number; maxComplexity: number }`
  - 종류: `import type …` 또는 모든 지정자가 `type` 인 import → type-import; `export … from` → re-export(`export type … from` 은 type-import); `import('x')` → dynamic-import; `require('x')` → require; 그 밖 import → import. 문자열 리터럴 지정자만.
  - `extractTsProject(input: RepoInput, detection: Detection, parsers: Parsers, onFile?: (path: string) => void): Extraction` — `onFile` 은 파일 하나 처리 후 호출. 노드는 `sourceDir` 아래 소스 파일에서 `*.gen.ts`·`*.gen.tsx` 제외. `kind`: `.d.ts` → types, `.test.`/`.spec.` → test, `.tsx/.jsx` → component, 그 밖 module. `name`: 확장자 뗀 파일명, `index` 면 `<부모폴더>/index`. `unresolved`: 상대·별칭 지정자인데 해석 실패한 수. `routeRefs` 는 `routeDirs` 안 파일에서 나간 간선 수.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('import kinds', async () => { /* "import type {A} from './a'; import {type B} from './b'; import C from './c'; export * from './d'; export type {E} from './e'; import('./f'); require('./g');" → kinds: type-import, type-import, import, re-export, type-import, dynamic-import, require */ });
test('alias edges in fixture', async () => { /* edge src/components/users/hooks/useUsers.ts → src/services/userService.ts kinds {import:1}; UserList → src/types/user.ts kinds {'type-import':1} */ });
test('generated files excluded', async () => { /* no node 'src/routeTree.gen.ts' */ });
test('route refs', async () => { /* routeRefs['src/components/users/UserList.tsx']['src/routes/index.tsx'] === 1 */ });
test('unresolved counts only local specifiers', async () => { /* fixture has one './missing' import and 'react' → unresolved === 1 */ });
test('syntax error recorded', async () => { /* failed contains the broken file with reason 'syntax' */ });
```

- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(engine): ts/js extraction`

---

### Task 8: 역할 프리셋 + 아키텍처 지표

**Files:**
- Create: `src/engine/presets.ts`, `src/engine/architecture.ts`
- Test: `tests/engine/presets.test.ts`, `tests/engine/architecture.test.ts`

**Interfaces:**
- Consumes: `Extraction`, `Detection`
- Produces:
  - `interface Layer { key: 'entry' | 'application' | 'domain' | 'foundation'; label: string; hint: string }`
  - `interface Role { name: string; layer: 0 | 1 | 2 | 3; patterns: string[]; description: string; color?: string; warning?: string }`
  - `interface Preset { layers: Layer[]; roles: Role[] }`, `presetFor(detection: Detection, paths: string[]): Preset`
    - Laravel·React 역할 목록은 스펙 4.4 그대로(패턴은 `sourceDir` 기준). 마지막 역할은 패턴 `['']` 인 기타(기반). 계층 라벨: 진입점 / 애플리케이션(React 는 "화면·기능") / 도메인·인프라(React 는 "상태·API") / 기반.
    - 기본 프리셋: `sourceDir` 아래 1단계 폴더마다 역할 1개(계층 3), 루트 파일은 기타.
  - `compileRoles(roles: Role[]): (innerPath: string) => number` — 패턴은 앞부분 일치, `*` = `[^/]*`, `**/` = `(?:.*/)?`, 나머지 문자 escape, 먼저 맞는 역할 인덱스
  - `interface ArchNode { path: string; name: string; kind: string; role: number; lines: number; functions: number; complexity: number; maxComplexity: number; fanIn: number; fanOut: number; instability: number; centrality: number; routeRefs: number; routeFiles: string[] }`
  - `interface Architecture { version: 1; name: string; lang: Lang; framework: Detection['framework']; sourceDir: string; generatedAt: string; layers: Layer[]; roles: Role[]; nodes: ArchNode[]; edges: [from: number, to: number, weight: number, kinds: Edge['kinds'], upward: 0 | 1][]; failed: Extraction['failed']; unresolved: number }`
  - `buildArchitecture(ex: Extraction, detection: Detection, preset: Preset, name: string, now: Date): Architecture`
    - `instability = round2(fo / (fi + fo))`, 0 이면 0. `centrality = round2(PageRank × n)`(damping 0.85, 80회, dangling 분배 — `tools/codecity/architecture.mjs` 의 `pageRank` 와 같은 식). `upward = 1` ⇔ 간선 종류가 모두 `binds`/`triggers` 가 아니고 `layer(from) > layer(to)`.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('glob role patterns', () => {
  const m = compileRoles([{ name: 'H', layer: 1, patterns: ['components/**/hooks/'], description: '' }, { name: 'C', layer: 1, patterns: ['components/'], description: '' }, { name: 'X', layer: 3, patterns: [''], description: '' }]);
  expect(m('components/a/b/hooks/useX.ts')).toBe(0); expect(m('components/hooks/y.ts')).toBe(0); expect(m('components/a/x.tsx')).toBe(1); expect(m('main.tsx')).toBe(2);
});
test('pattern escaping', () => { /* pattern 'Http/Kernel.php' matches 'Http/Kernel.php' but not 'Http/KernelXphp' */ });
test('metrics on small graph', () => {
  // a→b, a→c, b→c ; roles put a in layer 0, b in 1, c in 3; plus c→a (upward)
  // expect fanIn(c)=2, fanOut(a)=2, instability(a)=round2(2/3)=0.67, sum(centrality)≈3 (±0.05), c→a upward 1, a→b upward 0
});
test('binds edges never upward', () => { /* edge from layer 3 to 0 with kinds {binds:1} → upward 0 */ });
test('laravel preset maps standard folders', () => { /* 'app/Http/Controllers/X.php' → Controller(layer 0); 'app/Models/U.php' → Model(layer 2); 'app/Foo/Bar.php' → 기타(layer 3) */ });
```

- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(engine): role presets and architecture metrics`

---

### Task 9: 파이프라인 + 진행 이벤트

**Files:**
- Create: `src/engine/analyze.ts`
- Test: `tests/engine/analyze.test.ts`

**Interfaces:**
- Consumes: 위 전부
- Produces:
  - `type Progress = { phase: 'parse'; done: number; total: number; path: string; role: number } | { phase: 'link' } | { phase: 'metrics' }`
  - `analyze(input: RepoInput, parsers: Parsers, onProgress?: (p: Progress) => void, now?: Date): Architecture` — 감지 실패 시 `throw new UnsupportedRepoError()`(같은 파일에서 export). 파일 수가 `MAX_FILES` 초과인지 검사는 호출 측(계획 2)의 몫.
  - 추출기의 `onFile` 로 `parse` 이벤트를 파일마다 1회 보낸다. `role` 은 `compileRoles(preset.roles)` 로 미리 계산(프리셋은 파일 경로만으로 추출 전에 만든다).

- [ ] **Step 1: 실패하는 테스트**

```ts
test('laravel fixture end to end', async () => { /* load tests/fixtures/laravel-mini into RepoInput; a = analyze(...); a.framework==='laravel'; a.nodes.length === <픽스처 php 파일 수>; roles of Controller file is 'Controller' */ });
test('react fixture end to end', async () => { /* framework 'react', no routeTree.gen node */ });
test('progress events', async () => { /* parse events count === source file count, last done === total, then 'link', then 'metrics' */ });
test('unsupported repo', async () => { /* only README.md → throws UnsupportedRepoError */ });
test('output is JSON-serializable and stable', async () => { /* JSON.parse(JSON.stringify(a)) deep-equals a; same input+now → identical */ });
```

- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS. `npx vitest run` 전체도 PASS.
- [ ] **Step 5: Commit** — `feat(engine): analyze pipeline with progress events`

---

### Task 10: 실제 레포 대조 관문

**Files:**
- Create: `scripts/compare.ts`
- (보고서) `.local/compare/<name>.md` — 커밋 안 함

**Interfaces:**
- Consumes: `analyze`, `shouldSkipDir`, `isSourcePath`, `isConfigPath`, `parseGitignore`, `nodeLocate`
- Produces: CLI `npm run compare -- <repoDir> <baselineDepsJson>`
  - 폴더를 재귀로 읽되 `shouldSkipDir` 폴더와 루트 `.gitignore`(`parseGitignore`)에 걸리는 경로는 들어가지 않는다. 대상 레포에는 쓰지 않는다(읽기 전용).
  - 콘솔 출력: `files <engine>/<baseline>  edges <engine>/<baseline>  onlyEngine <n>  onlyBaseline <n>  kindMismatch <n>  failed <n>  unresolved <n>  ms <n>`
  - 보고서: 위 요약 + 차이 간선 각 최대 50개(`from → to  engineKinds | baselineKinds`). 기준 deps.json 형태: `{ nodes: [{ id }], edges: [{ from, to, weight, kinds }] }`.

- [ ] **Step 1: 스크립트 작성 후 실행** — 기준 레포마다:

```bash
npm run compare -- <PHP 기준 레포 경로> .local/baseline/<name>/deps.json
npm run compare -- <TS 기준 레포 경로> .local/baseline/<name>/deps.json
```
Expected: 콘솔 한 줄 요약과 `.local/compare/<name>.md` 생성. 대상 레포 `git status --porcelain` 이 실행 전후 동일.

- [ ] **Step 2: 차이 줄이기** — 통과 기준: `files` 일치. `onlyEngine + onlyBaseline` 가 기준 간선 수의 1% 이하, 남은 차이는 원인(예: 문법 차이, 기준 도구의 버그)이 `.local/compare/<name>.md` 에 적혀 있음. 기준을 못 맞추면 원인이 되는 추출 규칙을 해당 Task 의 테스트에 **가짜 코드로 재현하는 테스트를 먼저 추가**한 뒤 고친다(사내 코드를 테스트에 복사하지 않음).
- [ ] **Step 3: 성능 기록** — 두 레포의 `ms` 를 보고서에 적는다(계획 2 의 로딩 화면 예상 시간 기준).
- [ ] **Step 4: 전체 테스트** — `npx vitest run` PASS.
- [ ] **Step 5: 커밋 전 누출 점검** — 커밋 대상에 사내 정보가 없는지 확인:

```bash
git diff --cached --name-only | grep -E '^\.local/|^site/|^\.work/' && echo LEAK || echo ok
```
Expected: `ok`.
- [ ] **Step 6: Commit** — `git add scripts/compare.ts package.json && git commit -m "feat(engine): add local compare script against baseline"`

---

## 계획 2 예고 (이 계획의 범위 밖)

대조 관문 통과 후 작성: Vite + React 앱 셸, Worker 연결, 첫 화면(시안 A)·로딩 화면(시안 B), 도시·그래프·탐색기·코드 뷰어 이전, IndexedDB 캐시와 폴더 핸들, CSP, cc.json 내려받기, GitHub Pages 배포, 기존 파이프라인 정리와 이력 정리(각각 사용자 확인).
