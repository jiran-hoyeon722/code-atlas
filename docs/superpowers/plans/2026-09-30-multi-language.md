# 다중 언어 지원 (Python · Go · Java · Kotlin · Shell · Swift) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지금 PHP·TypeScript 만 분석하는 엔진이 Python, Go, Java, Kotlin, Shell, Swift 레포도 도시·그래프·탐색기로 보여 주게 한다.

**Architecture:** 언어별 정보(확장자·wasm·복잡도 노드·강조 이름)를 `src/engine/langs.ts` 한 표로 모으고, 문법 wasm 은 레포 언어에 필요한 것만 늦게 받는다. 새 언어는 `LangModule`(파일 하나에서 사실 뽑기 + import 해석)만 구현하면 공용 연결기 `src/engine/link.ts` 가 노드·엣지·미해결 수를 만든다. PHP·TS 추출기는 그대로 두고 호출 방식만 바꾼다.

**Tech Stack:** TypeScript, web-tree-sitter 0.27 (wasm), vitest, highlight.js, Playwright 기반 `scripts/e2e.mjs`

**Spec:** 별도 설계 문서 없음 — 대화에서 합의한 요구(아래 Global Constraints·Review Focus)가 스펙이다.

**작업 위치:** worktree `../code-atlas-wt/multi-lang`, 브랜치 `feat/multi-lang` (main `9da2c0d` 에서 분리). 처음 한 번 `npm install`.

## Global Constraints

- 분석은 전부 브라우저 Worker 에서. 외부 전송·CDN 금지. wasm 은 `public/wasm/` 에서 같은 출처로 내려준다 (`scripts/copy-wasm.mjs`).
- `src/engine` 은 DOM/Node API 금지 (`npm run typecheck:engine`). Node 전용은 `src/engine/node.ts` 만.
- 테스트는 `tests/fixtures/<lang>-mini/` 의 **가짜 코드**만. 실제 레포 이름·경로·클래스명 금지.
- 추가 의존성은 정확한 버전으로 고정: `tree-sitter-python@0.25.0`, `tree-sitter-go@0.25.0`, `tree-sitter-java@0.23.5`, `@tree-sitter-grammars/tree-sitter-kotlin@1.1.0`, `tree-sitter-bash@0.25.1`. 네이티브 빌드가 실패하면 `--ignore-scripts` (wasm 만 쓴다). Swift 는 npm 에 wasm 이 없어 Task 9 에서 따로 마련.
- `Lang` 값: `'php' | 'ts' | 'py' | 'go' | 'java' | 'kotlin' | 'shell' | 'swift'`. 화면 이름: `PHP`, `TypeScript`, `Python`, `Go`, `Java`, `Kotlin`, `Shell`, `Swift`.
- 확장자: py=`.py` / go=`.go` / java=`.java` / kotlin=`.kt` `.kts` / shell=`.sh` `.bash` / swift=`.swift`.
- 기존 PHP·TS 분석 결과는 바이트 단위로 같아야 한다 (기존 테스트 전부 그대로 통과, `deps-reference.json` 대조 포함).
- 배틀(`src/engine/battle`)의 PHP·TS 복잡도 표는 고정. 새 언어만 `LANGS` 표를 쓴다.
- 화면 문구는 한국어. 주석은 비자명한 WHY 한 줄만. 태스크마다 커밋.

## Review Focus

1. **다른 언어 레포 안의 셸 스크립트** — Go 레포에 `scripts/*.sh` 가 있어도 언어 선택 창 없이 Go 로 분석해야 함 → Task 10 테스트 `shell only wins when nothing else is there`.
2. **Python `from . import x`** — `x` 가 모듈 파일이면 그 파일로, 아니면 패키지 `__init__.py` 로 이어져야 함 → Task 4 테스트.
3. **Go 외부 모듈 import** (`github.com/…`, 표준 라이브러리) — 미해결로 세지 않아야 하고, 중첩 `go.mod` 에선 가장 긴 모듈 경로가 이겨야 함 → Task 5 테스트.
4. **Java 와일드카드·static·중첩 클래스 import** (`a.b.*`, `import static a.b.C.m`, `a.b.Outer.Inner`) — 모두 선언 파일로 이어져야 함 → Task 6 테스트.
5. **예전 캐시·샘플** (`lang: 'php' | 'ts'`) — 그대로 열려야 함 → Task 10 테스트 `cached php/ts entries still open`.

---

### Task 1: 언어 표 `LANGS` 와 복잡도 일반화

**Files:**
- Create: `src/engine/langs.ts`
- Modify: `src/engine/types.ts` (`Lang` 을 `langs.ts` 에서 re-export), `src/engine/collect.ts` (`isSourcePath`), `src/engine/complexity.ts`, `src/engine/battle/functions.ts`, `src/engine/battle/graph.ts`
- Test: `tests/engine/langs.test.ts`, 기존 `tests/engine/complexity.test.ts`·`collect.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Lang = 'php' | 'ts' | 'py' | 'go' | 'java' | 'kotlin' | 'shell' | 'swift';
  export type WasmFile = 'web-tree-sitter.wasm' | 'tree-sitter-php.wasm' | 'tree-sitter-tsx.wasm'
    | 'tree-sitter-python.wasm' | 'tree-sitter-go.wasm' | 'tree-sitter-java.wasm'
    | 'tree-sitter-kotlin.wasm' | 'tree-sitter-bash.wasm' | 'tree-sitter-swift.wasm';
  export interface LangSpec {
    label: string; exts: readonly string[]; wasm: WasmFile; hljs: string;
    functions: ReadonlySet<string>;   // 함수 하나로 세는 노드
    branches: ReadonlySet<string>;    // 그 자체로 분기 +1
    logical?: { node: string; ops: ReadonlySet<string>; caseInsensitive?: boolean }; // 연산자 필드로 판정하는 노드
  }
  export const LANGS: Record<Lang, LangSpec>;
  export const ALL_LANGS: readonly Lang[];   // 위 Lang 순서
  ```
  `isSourcePath(path): Lang | null` 는 `LANGS[*].exts` 로 판정. `measure(root, lang)` 는 `LANGS[lang]` 를 읽는다.

- [ ] **Step 1: 실패 테스트** — `tests/engine/langs.test.ts`
  ```ts
  test('extensions map to languages', () => {
    expect(isSourcePath('a/b.py')).toBe('py');
    expect(isSourcePath('cmd/main.go')).toBe('go');
    expect(isSourcePath('A.java')).toBe('java');
    expect(isSourcePath('A.kt')).toBe('kotlin');
    expect(isSourcePath('build.gradle.kts')).toBe('kotlin');
    expect(isSourcePath('deploy.sh')).toBe('shell');
    expect(isSourcePath('V.swift')).toBe('swift');
    expect(isSourcePath('x.pyc')).toBeNull();
    expect(isSourcePath('a.tsx')).toBe('ts');
  });
  test('every language names a wasm file and a highlight.js language', () => {
    for (const l of ALL_LANGS) { expect(LANGS[l].wasm).toMatch(/\.wasm$/); expect(LANGS[l].hljs).not.toBe(''); }
  });
  ```
- [ ] **Step 2:** `npx vitest run tests/engine/langs.test.ts` → FAIL (모듈 없음)
- [ ] **Step 3:** `langs.ts` 작성. php/ts 항목은 `complexity.ts` 의 현재 표를 그대로 옮긴다 (php 는 `logical: { node: 'binary_expression', ops: {'&&','||','and','or','??'}, caseInsensitive: true }`, ts 는 `{'&&','||','??'}`). hljs 이름: php=`php`, ts=`typescript`, py=`python`, go=`go`, java=`java`, kotlin=`kotlin`, shell=`bash`, swift=`swift`. 새 언어의 `functions/branches/logical` 은 **초기값**으로 두고 각 언어 태스크에서 실제 트리로 확정한다 — py: functions `function_definition`,`lambda` / branches `if_statement`,`elif_clause`,`for_statement`,`while_statement`,`except_clause`,`conditional_expression`,`case_clause`,`boolean_operator` / logical 없음. go·java: logical `binary_expression` + `&&`,`||`. `complexity.ts` 는 표 대신 `LANGS` 를 읽고, `battle/functions.ts` 는 php·ts 고정 표를 `Partial<Record<Lang,…>>` 로 두고 없으면 `LANGS[lang]` 로 폴백, `battle/graph.ts` `TYPE_ONLY` 도 `Partial` + 빈 집합 폴백.
- [ ] **Step 4:** `npx vitest run && npx tsc --noEmit && npm run typecheck:engine` → 전부 PASS (기존 테스트 변화 없음)
- [ ] **Step 5:** 커밋 `refactor(engine): one language table for extensions, wasm and complexity`

### Task 2: 문법 wasm 을 필요한 것만 늦게 받기

**Files:**
- Modify: `src/engine/parsers.ts`, `src/engine/node.ts`, `scripts/copy-wasm.mjs`, `package.json`, `src/app/analysis/worker.ts`, `src/features/battle/worker/worker.ts`, `src/engine/php/project.ts`, `src/engine/ts/project.ts`, `src/engine/battle/quality.ts`, `scripts/samples.ts`, `scripts/compare.ts`
- Test: `tests/engine/parsers.test.ts`, `tests/app/*worker*.test.ts`(있는 것)

**Interfaces:**
- Consumes: `Lang`, `WasmFile`, `LANGS`, `ALL_LANGS` (Task 1)
- Produces:
  ```ts
  export interface Parsers { get(lang: Lang): Parser }  // 안 불러온 언어면 Error(`parser for ${lang} is not loaded`)
  export function loadParsers(locate: (f: WasmFile) => string, langs?: readonly Lang[]): Promise<Parsers>; // 생략 = ALL_LANGS
  ```
  `Parser.init` 는 한 번, 문법은 파일별로 메모. 한 문법 로드 실패는 그 문법만 캐시에서 지운다.

- [ ] **Step 1:** 5개 패키지 설치 (Global Constraints 버전), `copy-wasm.mjs` 와 `node.ts` `PACKAGE_OF` 에 추가 (Swift 는 Task 9).
- [ ] **Step 2: 실패 테스트** — `parsers.test.ts` 를 바꾼다:
  ```ts
  test.each(['php','ts','py','go','java','kotlin','shell'] as const)('%s grammar loads and parses', async (lang) => {
    const p = await loadParsers(nodeLocate, [lang]);
    expect(p.get(lang).parse(SAMPLE[lang])!.rootNode.hasError).toBe(false);
  });
  test('asking for an unloaded language throws', async () => {
    const p = await loadParsers(nodeLocate, ['php']);
    expect(() => p.get('go')).toThrow('parser for go is not loaded');
  });
  test('loadParsers is memoized per grammar', async () => {
    expect((await loadParsers(nodeLocate, ['py'])).get('py')).toBe((await loadParsers(nodeLocate, ['py'])).get('py'));
  });
  ```
  `SAMPLE` 은 언어별 한 줄 (예: py `from .a import b\ndef f(x):\n  return x and 1\n`). 이 단계에서 **web-tree-sitter 0.27 과 각 wasm 의 호환성**이 확인된다. 호환 안 되는 문법이 있으면 멈추고 사용자에게 보고.
- [ ] **Step 3:** `npx vitest run tests/engine/parsers.test.ts` → FAIL
- [ ] **Step 4:** `parsers.ts` 구현, 호출부를 `parsers.get('php')` / `parsers.get('ts')` 로 교체. 두 worker 는 `detect(input, prefer)` 를 먼저 불러 `loadParsers(locate, [detection.lang])` (감지 실패면 기존처럼 `unsupported`).
- [ ] **Step 5:** `npx vitest run && npx tsc --noEmit && npm run typecheck:engine && npm run build` → PASS, `public/wasm/` 에 7개 파일
- [ ] **Step 6:** 커밋 `feat(engine): load only the grammar the repo needs`

### Task 3: 공용 연결기 `extractProject` 와 언어 분기표

**Files:**
- Create: `src/engine/link.ts`
- Modify: `src/engine/analyze.ts` (분기를 `EXTRACTORS: Record<Lang, …>` 로), `src/engine/detect.ts` (새 언어는 `{ lang, framework: null, sourceDir: '', routeDirs: [] }`), `UnsupportedRepoError` 메시지
- Test: `tests/engine/link.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FileFacts {
    name: string; kind: string;                      // 노드 이름·종류 ('module' | 'class' | 'test' | 'script' …)
    imports: { specifier: string; kind: RefKind }[];
    scope: string;                                   // Java/Kotlin 패키지, Swift 모듈, 그 외 ''
    declares: string[];                              // 이 파일이 선언한 최상위 이름
    mentions: string[];                              // 이름으로 참조한 타입 (중복 허용 = 가중치)
    wildcards: string[];                             // `import a.b.*` 로 연 scope
    hasError: boolean; lines: number; functions: number; complexity: number; maxComplexity: number;
  }
  export interface ProjectIndex {
    paths: ReadonlySet<string>;                      // 분석 대상 파일
    configs: Record<string, string>;
    byDir: ReadonlyMap<string, string[]>;            // 'a/b' → 그 폴더의 대상 파일 (경로순)
    bySymbol: ReadonlyMap<string, string[]>;         // 선언 이름 → 파일
    facts: ReadonlyMap<string, FileFacts>;
  }
  export interface LangModule {
    extractFile(parser: Parser, file: SourceFile): FileFacts;
    /** 대상 파일 목록. [] = 프로젝트 밖(무시), null = 프로젝트 안인데 못 찾음(미해결 +1). */
    resolveImport(from: string, specifier: string, index: ProjectIndex): string[] | null;
    symbolLinks: boolean;                            // mentions 로도 엣지를 만들지
  }
  export function extractProject(lang: Lang, mod: LangModule, input: RepoInput, detection: Detection,
    parsers: Parsers, onFile?: (path: string) => void, onLink?: () => void): Extraction;
  ```
  규칙: 1패스로 모든 파일 `extractFile` (예외 → `failed: read` + 빈 노드, `hasError` → `failed: syntax`) 후 인덱스를 만들고, 2패스로 import·mentions 를 엣지로 합친다. mentions 는 `symbolLinks` 일 때만, 대상 파일의 `scope` 가 내 `scope` 와 같거나 내 `wildcards` 에 있을 때만 `class-ref` 로. 자기 자신 제외. 엣지 가중치 = 참조 횟수, `kinds` 는 종류별 횟수. `routeRefs` 는 `{}`.

- [ ] **Step 1: 실패 테스트** — 가짜 `LangModule` (텍스트를 줄 단위로 읽는 장난감 모듈)로:
  ```ts
  test('imports become weighted edges and self-imports are dropped', …)   // a→b 두 번 → weight 2, kinds.import 2
  test('null counts as unresolved, [] is ignored', …)                    // unresolved === 1
  test('one import can fan out to several files', …)                     // resolve → ['p/x','p/y'] → 엣지 2개
  test('mentions link only inside the same scope or an opened wildcard', …)
  test('a file that throws is kept as a node and reported as read failure', …)
  ```
- [ ] **Step 2:** `npx vitest run tests/engine/link.test.ts` → FAIL
- [ ] **Step 3:** `link.ts` 구현, `analyze.ts` 는 php/ts 는 기존 추출기, 나머지는 `extractProject(lang, MODULES[lang], …)` (이 태스크에선 `MODULES` 가 비어 있고 새 언어는 `UnsupportedRepoError` — 각 언어 태스크가 채운다).
- [ ] **Step 4:** `npx vitest run && npm run typecheck:engine` → PASS
- [ ] **Step 5:** 커밋 `feat(engine): shared linker for import-based languages`

> **언어 태스크 공통 형식 (Task 4~9)** — 각 태스크는 같은 순서로 진행한다.
> 1. `tests/fixtures/<lang>-mini/` 가짜 레포 작성 (파일 6~10개, 아래 "픽스처가 담을 것" 전부 포함).
> 2. **노드 이름 확인**: 픽스처 파일 하나를 `parser.parse(text).rootNode.toString()` 로 찍어 import·선언·분기 노드 이름을 확인하고 `LANGS[lang]` 의 `functions/branches/logical` 을 확정한다 (추측한 이름을 그대로 쓰지 않는다).
> 3. `tests/engine/<lang>-extract.test.ts` 실패 테스트 → 구현 `src/engine/<lang>/module.ts` (`export const <lang>Module: LangModule`) → 통과.
> 4. `tests/engine/analyze.test.ts` 에 `<lang> fixture end to end` 추가: `a.lang`, 노드 수, 기대 엣지 목록(`from→to` 문자열 배열로 정확히), `unresolved` 수, 역할 분포.
> 5. `presets.ts` 에 언어 프리셋 추가 + `tests/engine/presets.test.ts` 에 경로→역할 3~5개.
> 6. `analyze.ts` 의 `MODULES` 에 등록, 전체 테스트·타입 체크, 커밋 `feat(engine): <Lang> support`.

### Task 4: Python

**Files:** Create `src/engine/py/module.ts`, `tests/fixtures/py-mini/`, `tests/engine/py-extract.test.ts` · Modify `analyze.ts`, `presets.ts`, `langs.ts`

**Interfaces:** Produces `pyModule: LangModule` (`symbolLinks: false`)

- 사실 뽑기: `import a.b` → specifier `a.b`. `from X import n1, n2` → specifier `X.n1`, `X.n2` (별표 `from X import *` 는 `X`). 상대 import 는 앞의 점을 그대로 유지 (`.`, `..pkg`).
- 해석: 소스 루트 후보 `''` 과 `src/`. 모듈 `m.a.b` → `m/a/b.py` 또는 `m/a/b/__init__.py`, 없으면 마지막 조각을 떼고 다시 (이름 import 는 모듈로 떨어진다). 상대 import 는 현재 파일 폴더 기준, 점 하나 더마다 한 단계 위. 절대 import 가 끝까지 없으면 `[]`(외부), 상대 import 가 없으면 `null`.
- 이름·종류: 파일 이름에서 `.py` 뗀 것, `__init__.py` 는 `<폴더>/__init__`. `test_*.py`·`*_test.py`·`tests/` 아래는 `test`, 나머지 `module`.
- 프리셋 (첫 일치 우선, 경로 어디서든 — `**/` 접두): 진입점 `views/`,`views.py`,`urls.py`,`api/`,`routers/`,`cli/`,`__main__.py`,`manage.py` / 애플리케이션 `services/`,`tasks/`,`handlers/` / 도메인 `models/`,`models.py`,`schemas/`,`serializers.py`,`repositories/`,`db/` / 기반 `utils/`,`core/`,`config/`,`settings.py`, 테스트 `tests/` / `기타`.
- **픽스처가 담을 것:** `from . import sibling`(모듈), `from . import helper_fn`(패키지 `__init__` 로), `from ..core import x`, `import pkg.sub.mod`, 외부 `import requests`, 없는 상대 모듈 1개(미해결 1), `src/` 레이아웃 패키지 1개, 문법 오류 파일 1개.
- 테스트 `relative from-import picks the module file, else the package __init__` (Review Focus 2).

### Task 5: Go

**Files:** Create `src/engine/go/module.ts`, `tests/fixtures/go-mini/`, `tests/engine/go-extract.test.ts` · Modify `collect.ts` (`isConfigPath` 가 `go.mod` 도 모음), `analyze.ts`, `presets.ts`, `langs.ts`

**Interfaces:** Produces `goModule: LangModule` (`symbolLinks: false`)

- 사실 뽑기: `import_spec` 의 문자열 경로 전부 (그룹 import 포함, 별칭·`_`·`.` 무시하고 경로만).
- 해석: `configs` 의 모든 `go.mod` 에서 `module <path>` 줄을 읽어 (모듈 경로, go.mod 폴더) 목록을 만든다. import 가 어떤 모듈 경로와 같거나 `경로/` 로 시작하면 **가장 긴 것** 선택 → 폴더 = go.mod 폴더 + 나머지 → `byDir` 의 파일 중 `_test.go` 가 아닌 것 전부. 폴더에 파일이 없으면 `null`. 어느 모듈에도 안 걸리면 `[]` (표준 라이브러리·외부).
- 이름·종류: 파일 이름에서 `.go` 뗀 것. `_test.go` 는 `test`, `package main` 파일은 `main`, 나머지 `module`.
- 같은 패키지 안 파일끼리의 참조는 v1 에선 잇지 않는다 (import 가 없어 이름 색인이 필요 — 후속 과제로 남김).
- 프리셋: 진입점 `cmd/`,`main.go`,`api/`,`handler/`,`handlers/`,`server/` / 애플리케이션 `service/`,`services/`,`usecase/` / 도메인 `model/`,`models/`,`domain/`,`repository/`,`store/`,`db/` / 기반 `pkg/`,`util/`,`utils/`,`config/`,`internal/` (앞의 것이 먼저 걸리므로 `internal/handler/` 는 진입점) / `기타`.
- **픽스처가 담을 것:** 루트 `go.mod` (`module example.com/mini`) + 중첩 모듈 `tools/go.mod` (`module example.com/mini/tools`), 그룹 import, 별칭 import, 표준 라이브러리 `fmt`, 외부 `github.com/x/y`, 없는 내부 패키지 1개(미해결 1), `_test.go` 1개.
- 테스트 `external and std imports are not unresolved; the longest module path wins` (Review Focus 3).

### Task 6: Java

**Files:** Create `src/engine/jvm/resolve.ts` (Java·Kotlin 공용), `src/engine/java/module.ts`, `tests/fixtures/java-mini/`, `tests/engine/java-extract.test.ts` · Modify `analyze.ts`, `presets.ts`, `langs.ts`

**Interfaces:**
- Produces `javaModule: LangModule` (`symbolLinks: true`)
- Produces `resolveJvmImport(specifier: string, index: ProjectIndex): string[] | null` — Task 7 도 쓴다. `specifier` 는 점 구분 전체 이름 (static 이면 멤버까지, 와일드카드는 `a.b.*`).

- 사실 뽑기: `scope` = `package` 선언 (없으면 ''). `declares` = 최상위 class/interface/enum/record/annotation 이름. `mentions` = `type_identifier` 전부 + `Foo.bar()`·`Foo.CONST` 의 대문자로 시작하는 식별자. `wildcards` = `import a.b.*` 의 `a.b`. import 는 `import`, `import static` 모두 specifier 로.
- `resolveJvmImport`: 끝에서부터 조각을 하나씩 떼며 `(scope, 이름)` 쌍으로 `bySymbol` 을 찾는다 — `a.b.C` → (a.b, C); `a.b.C.m`(static) → (a.b.C, m) 실패 → (a.b, C); `a.b.Outer.Inner` → (a.b, Outer). 와일드카드는 `[]` (링크는 mentions 가 담당). 못 찾았을 때, specifier 가 프로젝트 안 어떤 `scope` 로 시작하면 `null`, 아니면 `[]` (JDK·외부 라이브러리).
- 이름·종류: 파일 이름에서 `.java` 뗀 것. `src/test/` 아래거나 이름이 `Test`/`Tests` 로 끝나면 `test`, `interface` 만 선언하면 `interface`, 나머지 `class`.
- 프리셋 (Spring 관례, 경로 어디서든): 진입점 `controller/`,`controllers/`,`web/`,`api/`,`*Application.java` / 애플리케이션 `service/`,`services/`,`usecase/`,`application/` / 도메인 `domain/`,`entity/`,`entities/`,`model/`,`repository/`,`dto/` / 기반 `config/`,`util/`,`utils/`,`common/`,`exception/` / `기타`.
- **픽스처가 담을 것:** 두 패키지, 같은 패키지 안 import 없는 참조, `import a.b.*`, `import static a.b.C.m`, 중첩 클래스 import, JDK import `java.util.List`, 없는 프로젝트 클래스 import 1개(미해결 1).
- 테스트 `wildcard, static and nested-class imports all reach the declaring file` (Review Focus 4).

### Task 7: Kotlin

**Files:** Create `src/engine/kotlin/module.ts`, `tests/fixtures/kotlin-mini/`, `tests/engine/kotlin-extract.test.ts` · Modify `analyze.ts`, `presets.ts`(Java 프리셋 재사용 + `ui/`,`viewmodel/`,`activity/`,`fragment/` 진입점 추가), `langs.ts`

**Interfaces:** Consumes `resolveJvmImport` (Task 6). Produces `kotlinModule: LangModule` (`symbolLinks: true`)

- Java 와 같되: `declares` 에 최상위 `class`/`object`/`interface`/`typealias` 와 **최상위 함수**까지. `import a.b.foo as bar` 는 별칭 무시. 한 파일에 여러 선언, 파일 이름 ≠ 클래스 이름이 흔하므로 이름은 파일 이름에서 `.kt`/`.kts` 뗀 것.
- `build.gradle.kts`·`settings.gradle.kts` 는 분석 대상에서 제외 (빌드 스크립트).
- **픽스처가 담을 것:** 한 파일에 클래스 둘 + 최상위 함수, 최상위 함수 import, 별칭 import, `import a.b.*`, 같은 패키지 참조, 표준 라이브러리 `kotlin.collections.List`, `build.gradle.kts`(대상 아님 확인).

### Task 8: Shell

**Files:** Create `src/engine/shell/module.ts`, `tests/fixtures/shell-mini/`, `tests/engine/shell-extract.test.ts` · Modify `analyze.ts`, `langs.ts` (프리셋은 기존 폴더별 기본값 사용)

**Interfaces:** Produces `shellModule: LangModule` (`symbolLinks: false`)

- 사실 뽑기: 명령 이름이 `source` 또는 `.` 이면 첫 인자 → `import`. 명령 이름이 `./`·`../` 로 시작하거나 `.sh` 로 끝나면 그 자체 → `other`. `bash x.sh`·`sh x.sh` 는 첫 인자 → `other`. 인자에 `$`·`` ` `` 가 있으면 건너뛴다.
- 해석: 현재 파일 폴더 기준 → 없으면 레포 루트 기준. 둘 다 없으면 `null`.
- 이름·종류: 파일 이름 그대로 (확장자 포함), 종류 `script`.
- **픽스처가 담을 것:** `source ./lib/common.sh`, `. ../env.sh`, `./build.sh`, `bash scripts/deploy.sh`, `source "$DIR/x.sh"`(무시), 없는 스크립트 1개(미해결 1), 함수와 `if`/`case`/`&&` 가 있는 파일(복잡도 확인).

### Task 9: Swift

**Files:** Create `vendor/wasm/tree-sitter-swift.wasm`, `vendor/wasm/README.md`(출처·버전·라이선스), `src/engine/swift/module.ts`, `tests/fixtures/swift-mini/`, `tests/engine/swift-extract.test.ts` · Modify `scripts/copy-wasm.mjs`·`src/engine/node.ts`(vendor 경로 지원), `analyze.ts`, `presets.ts`, `langs.ts`

**Interfaces:** Produces `swiftModule: LangModule` (`symbolLinks: true`)

- [ ] **Step 1: wasm 마련** — 순서대로 시도: (a) `alex-pinkus/tree-sitter-swift` GitHub 릴리스 첨부 wasm, (b) 그 저장소 태그를 받아 `npx tree-sitter-cli build --wasm` (emscripten 또는 Docker 필요). Task 2 의 파싱 테스트에 `swift` 를 넣어 web-tree-sitter 0.27 호환 확인. **둘 다 안 되면 멈추고 사용자에게 보고** (Swift 만 빼고 나머지를 먼저 병합할지 결정 필요).
- 사실 뽑기: `scope` = SwiftPM 이면 `Sources/<타깃>/`, 아니면 '' (Xcode 프로젝트 = 한 모듈로 간주). `declares` = 최상위 class/struct/enum/protocol/actor/typealias/함수. `extension Foo` 는 `mentions` 에 `Foo`. `mentions` = 타입 이름 노드 + 대문자로 시작하는 호출 이름 (`Foo(...)`, `Foo.bar`). `import UIKit` 등은 엣지를 만들지 않는다 (`resolveImport` 는 항상 `[]`).
- 이름·종류: 파일 이름에서 `.swift` 뗀 것. `Tests/` 아래 `test`, 이름이 `View`/`ViewController` 로 끝나면 `view`, 나머지 `type`.
- 프리셋 (iOS 관례): 진입점 `App/`,`*App.swift`,`AppDelegate.swift`,`SceneDelegate.swift`,`Views/`,`Screens/`,`Scenes/` / 애플리케이션 `ViewModels/`,`ViewModel/`,`Coordinators/`,`Features/` / 도메인 `Models/`,`Model/`,`Services/`,`Network/`,`Networking/`,`Repositories/` / 기반 `Extensions/`,`Utils/`,`Utilities/`,`Helpers/`,`Resources/` / `기타`.
- **픽스처가 담을 것:** SwiftPM 타깃 두 개(스코프가 다르면 서로 안 이어짐 확인), 한 타깃 안 import 없는 참조, `extension`, `protocol` 채택.

### Task 10: 언어 선택·화면 표시

**Files:**
- Create: `src/engine/pick.ts`
- Modify: `src/engine/detect.ts`, `src/app/useRepoSession.ts`, `src/app/App.tsx`, `src/features/landing/Landing.tsx`, `src/features/shell/ViewerShell.tsx`, `src/features/battle/select/format.ts`, `src/features/code-viewer/highlight.ts`, `src/features/city/mountCity.ts`, `scripts/read-repo.ts`, `src/app/files/walk.ts`(`isConfigPath` 는 Task 5 에서 이미 확장), `CLAUDE.md`(지원 언어 한 줄)
- Test: `tests/engine/pick.test.ts`, `tests/app/*.test.tsx`(언어 선택 흐름), `tests/app/cache.test.ts`, `scripts/e2e.mjs`

**Interfaces:**
- Produces:
  ```ts
  /** 파일 수로 고른 기본 언어와, 사용자에게 물어야 할 후보(2개 이상일 때만). */
  export function pickLang(counts: Partial<Record<Lang, number>>): { lang: Lang | null; ask: Lang[] };
  ```
  규칙: 파일이 있는 언어 중 가장 많은 것이 기본값 (동률이면 `ALL_LANGS` 순서). `shell` 은 다른 언어 파일이 하나도 없을 때만 후보. 후보 = 파일이 있는 언어 (shell 규칙 적용), 2개 이상이면 `ask` 에 파일 수 내림차순으로.
  `detect(input, prefer)` 는 `pickLang` 의 `lang` 을 쓴다 (php/ts 의 Laravel·React 판정은 그대로).

- [ ] **Step 1: 실패 테스트** — `pick.test.ts`
  ```ts
  test('shell only wins when nothing else is there', () => {
    expect(pickLang({ go: 40, shell: 12 })).toEqual({ lang: 'go', ask: [] });
    expect(pickLang({ shell: 3 })).toEqual({ lang: 'shell', ask: [] });
  });
  test('two real languages ask, biggest first', () => {
    expect(pickLang({ java: 10, kotlin: 30 })).toEqual({ lang: 'kotlin', ask: ['kotlin', 'java'] });
  });
  test('php and ts keep the old tie rule', () => {
    expect(pickLang({ php: 5, ts: 5 }).lang).toBe('php');
  });
  test('nothing supported', () => { expect(pickLang({})).toEqual({ lang: null, ask: [] }); });
  ```
  캐시 테스트 `cached php/ts entries still open` (Review Focus 5): 예전 형태 레코드(`lang: 'ts'`)를 넣고 읽어 그대로 나오는지.
- [ ] **Step 2:** 실패 확인 → 구현. `useRepoSession` 은 `counts: Partial<Record<Lang, number>>` 로 세고, php·ts 둘 다일 때의 Laravel/React 우선 규칙(`frameworkLang`)은 유지한 뒤 `pickLang(...).ask` 가 2개 이상이면 선택 창. `App.tsx` 선택 창은 `ask` 순서대로 `${LANGS[l].label} · N개` 버튼, 질문 문구 `이 폴더에는 여러 언어가 함께 있어요. 어느 쪽으로 볼까요?`.
- [ ] **Step 3:** 언어 이름 표시는 전부 `LANGS[lang].label`, 코드 강조는 `LANGS[lang].hljs` (highlight.js 에 python·go·java·kotlin·bash·swift 등록, class 는 `language-${LANGS[lang].hljs}`). 랜딩 부제: `PHP · TypeScript/JavaScript · Python · Go · Java · Kotlin · Swift · Shell`.
- [ ] **Step 4:** e2e 에 `py-mini: city` 와 `go-mini: city` 단계 추가 (laravel-mini 단계와 같은 방식, 도시가 뜨고 검색으로 픽스처 파일 코드가 보이는지). `npm run e2e` → 전부 PASS, 스크린샷 `test-results/e2e/py-city.png`·`go-city.png` 를 직접 열어 확인.
- [ ] **Step 5:** `npx vitest run && npx tsc --noEmit && npm run typecheck:engine && npm run build && npm run e2e` → PASS
- [ ] **Step 6:** 커밋 `feat: pick among all supported languages and show them in the UI`

### Task 11: 공개 레포 샘플 (선택)

**Files:** Modify `scripts/samples.ts`, `public/samples/`

- [ ] **Step 1:** 언어별 GitHub **공개** 레포 후보를 사용자에게 제시하고 승인받는다 (회사·비공개 레포 금지, CLAUDE.md).
- [ ] **Step 2:** `SAMPLES` 에 추가, `npm run samples` → 결과 크기·엣지 수 출력 확인, 랜딩 카드 표시 e2e (`landing: GitHub form and sample gallery`) PASS.
- [ ] **Step 3:** 커밋 `feat(samples): add public repos for the new languages`

---

## 후속 과제 (이 계획 밖)
- Go 같은 패키지 안 파일끼리의 참조 (이름 색인).
- Java+Kotlin 혼합 레포를 한 번에 분석 (지금은 둘 중 하나 선택).
- Python 동적 import (`importlib`), Shell 변수 경로.
