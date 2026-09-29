# Code Atlas 앱(화면·캐시·배포) Implementation Plan (계획 2/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 완성된 분석 엔진(`src/engine`) 위에, 폴더를 끌어다 놓으면 브라우저 안에서 분석해 3D 의존성 도시·그래프·탐색기·코드 뷰어를 보여 주는 정적 웹 앱을 만들고 GitHub Pages 로 배포할 준비를 한다.

**Architecture:** Vite + React 앱. 메인 스레드는 폴더 순회·캐시·화면, 분석은 Web Worker 에서 `analyze()`. 기존 페이지(`tools/codecity/pages/*.html`)의 DOM·Three.js 로직은 `mountX(root, arch, env) → dispose` 모듈로 옮기고 React 는 그 컨테이너만 관리한다. 캐시는 IndexedDB(분석 결과만, 소스 본문 제외).

**Tech Stack:** Vite ^8, React ^19, @vitejs/plugin-react ^6, three ^0.186, 3d-force-graph 1.80.0, highlight.js ^11.12, Vitest ^5 + jsdom + @testing-library/react, fake-indexeddb(테스트), playwright-core(E2E, 설치된 Chrome 사용).

**Spec:** `docs/superpowers/specs/2026-09-29-code-atlas-browser-design.md` (계획 1: `docs/superpowers/plans/2026-09-29-code-atlas-engine.md`, 완료)

## Global Constraints

- 레포·배포물에 분석 대상 레포의 소스·경로·클래스명·구조 설명·분석 수치를 넣지 않는다. 테스트·E2E 는 `tests/fixtures/laravel-mini`, `tests/fixtures/react-mini` 같은 가짜 코드만.
- 파일 내용·분석 결과를 외부로 보내는 코드 금지(업로드, 원격 로깅, 분석 도구, 에러 리포팅 SDK). 런타임 CDN 로드 금지 — 모든 JS·CSS·WASM 은 번들 또는 같은 origin 정적 파일.
- 빌드 결과 `index.html` 에 CSP meta: `default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'` (개발 서버에는 넣지 않음 — HMR 때문).
- 분석 대상의 코드·파일 이름은 신뢰하지 않는다. DOM 에 넣을 때 escape(`innerHTML` 에는 highlight.js 결과나 escape 된 문자열만). 파일 내용 실행 금지.
- 캐시에는 소스 본문을 저장하지 않는다.
- 결과 화면은 기존 페이지의 레이아웃·색·문구·인터랙션을 유지한다. git 지표(`commits`)는 1차 범위 밖이라 제거하고 `functions`(함수 수)로 대체.
- 한국어 UI 문구, 지표마다 한 줄 풀이, 다크 글래스 패널(탐색기는 기존처럼 밝은 톤).
- 지원 브라우저 Chrome·Edge. Safari·Firefox 는 드래그 앤 드롭·숨은 `<input webkitdirectory>` 경로로 동작.
- 파일 삭제·git 이력 변경·푸시·Pages 활성화는 해당 Task 에서 사용자 확인 후.

## Review Focus

1. 파일 이름·코드에 HTML(`<img src=x onerror=…>`)이 들어 있는 레포 — 텍스트로만 보이고 실행되지 않아야 함 (Task 7 테스트).
2. 폴더가 아닌 파일 하나를 끌어다 놓음, 또는 지원 파일이 0개인 폴더 — 첫 화면에 안내, 앱이 멈추지 않음 (Task 10 테스트).
3. 수 MB 짜리 번들·minified 파일이 커밋된 레포 — 2MB 초과 파일은 건너뛰고 목록으로 알림, 분석 계속 (Task 2 테스트).
4. 같은 폴더를 다시 넣음 — 내용이 같으면 캐시에서 즉시, 바뀌었으면 다시 분석 (Task 4·10 테스트).
5. 캐시에서 연 분석에서 "코드 보기" — 폴더 권한이 없으면 다시 연결 버튼, 오류로 죽지 않음 (Task 9 테스트).

---

## File Structure

| 파일 | 책임 |
|---|---|
| `index.html`, `vite.config.ts`, `scripts/copy-wasm.mjs` | 앱 진입, CSP 주입(빌드), WASM 을 `public/wasm/` 로 복사 |
| `src/main.tsx`, `src/app/App.tsx`, `src/app/app.css` | 앱 상태(첫 화면 → 로딩 → 분석 → 오류), 전역 스타일 토큰 |
| `src/features/viewer-env.ts`, `src/features/palette.ts`, `src/features/escape.ts` | 화면 모듈 공통 계약, 역할 색, escape |
| `src/app/files/*` | 폴더 순회(디렉터리 핸들·드롭 엔트리·파일 목록) → `RepoInput` |
| `src/app/analysis/*` | Worker 와 클라이언트(진행·취소) |
| `src/storage/cache.ts` | IndexedDB 캐시 |
| `src/features/city/*`, `graph/*`, `explorer/*` | 기존 세 화면 이전 |
| `src/features/loading/*` | 로딩 화면(단계 목록 + 미리보기 도시) |
| `src/features/landing/*` | 첫 화면 |
| `src/features/shell/*` | 분석 화면 상단 바·탭·VS Code 경로·cc.json |
| `tests/app/*`, `tests/e2e/*` | 단위·컴포넌트·E2E |
| `.github/workflows/pages.yml` | Pages 배포 |

---

### Task 1: 앱 뼈대 + 공통 계약

**Files:**
- Modify: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` (`/dist/`, `/public/wasm/`, `/test-results/`)
- Create: `index.html`, `vite.config.ts`, `scripts/copy-wasm.mjs`, `src/main.tsx`, `src/app/App.tsx`, `src/app/app.css`, `src/features/viewer-env.ts`, `src/features/palette.ts`, `src/features/escape.ts`
- Test: `tests/app/build.test.ts`, `tests/app/palette.test.ts`, `tests/app/escape.test.ts`

**Interfaces:**
- Produces:
  - `viewer-env.ts`: `type TabId = 'city' | 'graph' | 'explorer'`; `interface Selection { file?: string; code?: boolean }`; `interface ViewerEnv { readSource(path: string): Promise<string | null>; vscodeHref(path: string): string | null; requestVscodeSetup(): void; selection: Selection; onSelect(sel: Selection): void; goto(tab: TabId, sel?: Selection): void }`; `type MountViewer = (root: HTMLElement, arch: Architecture, env: ViewerEnv) => () => void`
  - `palette.ts`: `roleColors(arch: Pick<Architecture, 'roles'>): string[]` — 역할에 `color` 가 있으면 그 값, 없으면 기존 페이지 식: 계층별 `[hue, sat, step] = [[228,78,9],[164,62,9],[262,72,9],[200,30,28]]`, 같은 계층 k 번째 역할은 `hsl(${(hue + k*step) % 360}, ${sat}%, ${56 + (k % 3) * 8}%)` (Three.js 호환 쉼표 형식). `LAYER_TINT = ['#4c6ef5', '#12b886', '#9775fa', '#8a929c']`
  - `escape.ts`: `esc(s: unknown): string` (`& < > " '` 치환)
  - npm scripts: `dev`, `build`(= `node scripts/copy-wasm.mjs && vite build`), `preview`, `predev`(copy-wasm)

- [ ] **Step 1: 의존성** — `dependencies`: `react@^19`, `react-dom@^19`, `three@^0.186`, `3d-force-graph@1.80.0`, `highlight.js@^11.12`; `devDependencies`: `vite@^8`, `@vitejs/plugin-react@^6`, `@types/react`, `@types/react-dom`, `@types/three`, `jsdom`, `@testing-library/react`, `fake-indexeddb`, `playwright-core`. 호스트 `npm install`.
- [ ] **Step 2: 실패하는 테스트**

```ts
// tests/app/build.test.ts (timeout 120s) — runs `npm run build` once
test('build emits CSP meta and wasm', () => {
  const html = readFileSync('dist/index.html', 'utf8');
  expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'">`);
  for (const f of ['web-tree-sitter.wasm', 'tree-sitter-php.wasm', 'tree-sitter-tsx.wasm']) expect(existsSync(`dist/wasm/${f}`)).toBe(true);
  expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
});
// tests/app/palette.test.ts
test('configured color wins, others follow layer hue', () => {
  const c = roleColors({ roles: [{ name: 'A', layer: 0, patterns: [], description: '' }, { name: 'B', layer: 0, patterns: [], description: '', color: '#123456' }, { name: 'C', layer: 3, patterns: [], description: '' }] });
  expect(c).toEqual(['hsl(228, 78%, 56%)', '#123456', 'hsl(200, 30%, 56%)']);
});
// tests/app/escape.test.ts
test('escapes html', () => { expect(esc('<img src=x onerror="a">&\'')).toBe('&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;'); });
```
  (k = 같은 계층 안에서 그 역할의 순번. 색 지정 여부와 무관하게 센다.)
- [ ] **Step 3:** FAIL 확인 → **Step 4: 구현** — `vite.config.ts`: `base: './'`, React 플러그인, `transformIndexHtml` 에서 `command === 'build'` 일 때만 CSP meta 를 `<head>` 첫 자식으로 삽입, worker `format: 'es'`. `App.tsx` 는 `<h1>Code Atlas</h1>` 만. `vitest.config.ts`: 기본 environment node, `tests/app/**/*.test.tsx` 는 jsdom.
- [ ] **Step 5:** `npx vitest run`, `npx tsc --noEmit`, `npm run typecheck:engine` PASS
- [ ] **Step 6: Commit** — `feat(app): vite react scaffold with csp and shared viewer contract`

---

### Task 2: 폴더 읽기

**Files:**
- Create: `src/app/files/types.ts`, `src/app/files/walk.ts`, `src/app/files/sources.ts`
- Test: `tests/app/walk.test.ts`

**Interfaces:**
- Consumes: `shouldSkipDir`, `isSourcePath`, `isConfigPath`, `parseGitignore`, `MAX_FILES` (`src/engine/collect.ts`), `RepoInput`
- Produces:
  - `interface DirNode { name: string; kind: 'directory'; children(): AsyncIterable<DirNode | FileNode> }`, `interface FileNode { name: string; kind: 'file'; size: number; lastModified: number; text(): Promise<string> }` (이름 충돌 방지를 위해 `export type { DirNode as FsDir, FileNode as FsFile }`)
  - `interface Listing { name: string; sources: Entry[]; configs: Entry[]; tooLarge: string[] }`, `interface Entry { path: string; size: number; lastModified: number; file: FsFile }`
  - `listRepo(root: FsDir): Promise<Listing>` — 들어가기 전에 `shouldSkipDir`·루트 `.gitignore`(폴더 단위로 가지치기) 적용; `size > MAX_FILE_BYTES (2 * 1024 * 1024)` 인 소스는 `tooLarge` 로
  - `loadRepo(listing: Listing, onRead?: (done: number, total: number) => void): Promise<RepoInput>` — 읽기 실패 파일은 제외하고 계속
  - 어댑터: `fromDirectoryHandle(h: FileSystemDirectoryHandle): FsDir`, `fromEntry(e: FileSystemDirectoryEntry): FsDir` (`readEntries` 를 빈 배열이 나올 때까지 반복), `fromFileList(files: FileList | File[]): FsDir` (`webkitRelativePath` 로 트리 구성)
  - `isTooMany(listing: Listing): boolean` — `listing.sources.length > MAX_FILES`

- [ ] **Step 1: 실패하는 테스트** — 메모리 가짜 트리 헬퍼 `tree({ 'src/a.ts': 'x', 'node_modules/p/i.js': 'y', '.gitignore': 'gen/\n', 'gen/b.ts': 'z', 'big.js': 3_000_000 })`(숫자는 크기만 가진 파일):

```ts
test('skips vendor dirs, gitignored dirs and records too-large files', async () => {
  const l = await listRepo(tree(...));
  expect(l.sources.map((e) => e.path)).toEqual(['src/a.ts']);
  expect(l.tooLarge).toEqual(['big.js']);
});
test('ignored dirs are never descended', async () => { /* children() of node_modules and gen never called (spy) */ });
test('readEntries batching', async () => { /* fake FileSystemDirectoryEntry returning 250 entries in batches of 100 → 250 listed */ });
test('fromFileList builds tree from webkitRelativePath', async () => { /* ['repo/src/a.ts','repo/package.json'] → name 'repo', sources ['src/a.ts'], configs ['package.json'] */ });
test('loadRepo skips unreadable files and reports progress', async () => { /* one text() rejects → files length 1 less; onRead last call (n, n) */ });
test('isTooMany', () => { /* 20001 sources → true, 20000 → false */ });
```
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5: Commit** — `feat(app): folder walking with skip rules and size cap`

---

### Task 3: 분석 Worker + 엔진 옵션 객체·단계 콜백

**Files:**
- Modify: `src/engine/analyze.ts`, `src/engine/php/project.ts`, `src/engine/ts/project.ts`, `tests/engine/analyze.test.ts`, `scripts/compare.ts`
- Create: `src/app/analysis/protocol.ts`, `src/app/analysis/worker.ts`, `src/app/analysis/client.ts`, `src/app/analysis/wasm.ts`
- Test: `tests/app/analysis.test.ts`

**Interfaces:**
- Produces:
  - 엔진: `analyze(input: RepoInput, parsers: Parsers, options?: { onProgress?: (p: Progress) => void; now?: Date; prefer?: Lang }): Architecture` (위치 인자 버전 제거, 호출부 전부 갱신). 추출기에 `onLink?: () => void` 추가 — 모든 파일 파싱이 끝나고 간선 연결을 시작하기 직전에 호출, `analyze` 는 거기서 `{ phase: 'link' }` 를 보낸다.
  - `protocol.ts`: `type ToWorker = { type: 'analyze'; input: RepoInput; prefer?: Lang; wasmBase: string }`; `type FromWorker = { type: 'progress'; progress: Progress } | { type: 'done'; architecture: Architecture } | { type: 'error'; code: 'unsupported' | 'failed'; message: string }`
  - `worker.ts`: `handle(msg: ToWorker, post: (m: FromWorker) => void, locate?: (base: string) => (f: WasmFile) => string): Promise<void>` (테스트용 export) + `self.onmessage` 연결
  - `wasm.ts`: `wasmLocate(base: string): (file: WasmFile) => string` — `${base}wasm/${file}`
  - `client.ts`: `startAnalysis(input: RepoInput, opts: { prefer?: Lang; onProgress: (p: Progress) => void; createWorker?: () => Worker }): { result: Promise<Architecture>; cancel(): void }` — 기본 워커는 `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`, `wasmBase = new URL('./', document.baseURI).href`. `cancel()` 은 `terminate()` 후 `result` 를 `AnalysisCancelled` 로 reject. `UnsupportedRepoError` 는 `code: 'unsupported'` 로 전달되어 `UnsupportedRepo` 에러로 reject.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('handle posts progress then done for laravel fixture', async () => { /* handle({type:'analyze', input: fixture, wasmBase:''}, post, () => nodeLocate) → first 'progress' parse, contains {phase:'link'} after last parse, last message 'done' with architecture.framework 'laravel' */ });
test('handle maps UnsupportedRepoError', async () => { /* empty input → {type:'error', code:'unsupported'} */ });
test('client cancel terminates worker and rejects', async () => { /* fake Worker with terminate spy; cancel() → terminate called once, result rejects AnalysisCancelled */ });
test('analyze options object', async () => { /* analyze(input, parsers, { prefer: 'ts', now }) on mixed input picks ts */ });
```
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** `npx vitest run`(엔진 테스트 포함), `npm run typecheck:engine`, `npm run compare` 는 인자 없이 usage 출력만 확인
- [ ] **Step 5: Commit** — `feat(app): analysis worker; engine options object and link phase`

---

### Task 4: IndexedDB 캐시

**Files:**
- Create: `src/storage/cache.ts`
- Test: `tests/app/cache.test.ts` (`import 'fake-indexeddb/auto'`)

**Interfaces:**
- Consumes: `Listing` (Task 2), `Architecture`
- Produces:
  - `interface CacheSummary { key: string; name: string; framework: string | null; lang: Lang; files: number; analyzedAt: string }`
  - `interface CacheEntry extends CacheSummary { architecture: Architecture; handle?: FileSystemDirectoryHandle }`
  - `cacheKey(listing: Listing): Promise<string>` — `name` + 정렬된 `path|size|lastModified` 줄들의 SHA-256 hex(`crypto.subtle`)
  - `saveAnalysis(e: CacheEntry)`, `listAnalyses(): Promise<CacheSummary[]>`(최신순), `loadAnalysis(key): Promise<CacheEntry | undefined>`, `deleteAnalysis(key)`, `clearAnalyses()`
  - DB 이름 `code-atlas`, 버전 1, store `analyses`(keyPath `key`)

- [ ] **Step 1: 실패하는 테스트**

```ts
test('same listing → same key; changed mtime → different key', async () => { … });
test('save/list/load/delete/clear roundtrip, newest first', async () => { … });
test('stored record never contains source text', async () => { /* save entry built from a RepoInput-derived Architecture; read raw record via indexedDB API; JSON.stringify(raw) does not contain a marker string that exists only in fixture source text */ });
```
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5: Commit** — `feat(app): indexeddb cache for analysis results`

---

### Task 5: 3D 의존성 도시 이전

**Files:**
- Create: `src/features/city/mountCity.ts`, `src/features/city/layout.ts`, `src/features/city/city.css`, `src/features/code-viewer/highlight.ts`
- Source to port: `tools/codecity/pages/city.html` (마크업 113 줄 이후 body, CSS 7–111, 스크립트)
- Test: `tests/app/city-layout.test.ts`

**Interfaces:**
- Consumes: `MountViewer`, `ViewerEnv`, `roleColors`, `LAYER_TINT`, `esc`, `Architecture`
- Produces:
  - `mountCity: MountViewer`
  - `layoutCity(arch: Architecture): { buildings: { i: number; x: number; z: number; w: number; d: number }[]; blocks: { role: number; x: number; z: number; w: number; d: number }[]; bounds: { w: number; d: number } }` — 기존 스크립트의 배치 계산을 그대로 옮긴 순수 함수(상수 `CELL = 4, ROAD = 8, AVENUE = 22`)
  - `highlight(code: string, lang: Lang): string` — `highlight.js/lib/core` + `php`·`typescript` 언어만 등록, `'php' → 'php'`, `'ts' → 'typescript'`
- 이전 규칙: CDN → npm import(`three`, `three/examples/jsm/controls/OrbitControls.js`, highlight.js CSS `highlight.js/styles/github-dark.css`); `fetch('architecture.json')` → 인자 `arch`; `fetch('src/…')` → `env.readSource(path)`(null 이면 코드 창에 `폴더 접근 권한이 없어요. 상단의 "폴더 다시 연결"을 눌러 주세요.`); `A.title` → `arch.name`; `A.language` → `arch.lang`; VS Code 링크 → `env.vscodeHref(path)`(null 이면 링크 대신 `env.requestVscodeSetup()` 버튼); `location.hash` 읽기·쓰기 → `env.selection` / `env.onSelect`; 다른 페이지 링크 → `env.goto`. 높이 드롭다운의 `commits` 옵션을 `functions`(`함수 수`) 로, 파일 패널의 `최근 커밋` 칸을 `함수 수` 로. CSS 는 루트 `.cc-city` 아래로 범위 한정. dispose: rAF 취소, 리스너 제거, `renderer.dispose()`, geometry/material dispose, DOM 비우기.

- [ ] **Step 1: 실패하는 테스트** — 픽스처 분석 결과(`analyze` on laravel-mini, Node)로:

```ts
test('one building per node, inside bounds, no overlaps', () => { … });
test('blocks ordered by layer rows (entry row first)', () => { … });
test('layout is deterministic', () => { expect(layoutCity(a)).toEqual(layoutCity(a)); });
```
- [ ] **Step 2:** FAIL → **Step 3:** `layout.ts` 추출 후 `mountCity` 이전 → **Step 4:** PASS, `npx tsc --noEmit`
- [ ] **Step 5: Commit** — `feat(app): port 3d dependency city`

---

### Task 6: 3D 그래프 이전

**Files:**
- Create: `src/features/graph/mountGraph.ts`, `src/features/graph/data.ts`, `src/features/graph/graph.css`
- Source to port: `tools/codecity/pages/graph.html`
- Test: `tests/app/graph-data.test.ts`

**Interfaces:**
- Consumes: Task 1 계약, `roleColors`, `esc`
- Produces: `mountGraph: MountViewer`; `graphData(arch: Architecture): { nodes: { id: number; path: string; name: string; role: number; layer: number; val: number; color: string }[]; links: { source: number; target: number; weight: number; upward: boolean; kinds: Edge['kinds'] }[] }` (`val` = 기존 식의 fan-in 기반 크기)
- 이전 규칙: CDN → `import ForceGraph3D from '3d-force-graph'`; Task 5 와 같은 치환 규칙(`arch`, `env.*`, CSS 범위 `.cc-graph`); dispose 에서 `graph._destructor()`.

- [ ] **Step 1: 실패하는 테스트** — `graphData` 가 노드 수 = `arch.nodes.length`, 링크 수 = `arch.edges.length`, `upward` 가 `edges[i][4] === 1` 과 일치, 색이 `roleColors(arch)[role]`.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5: Commit** — `feat(app): port 3d dependency graph`

---

### Task 7: 아키텍처 탐색기 이전

**Files:**
- Create: `src/features/explorer/mountExplorer.ts`, `src/features/explorer/explorer.css`
- Source to port: `tools/codecity/pages/explorer.html`
- Test: `tests/app/explorer.test.tsx` (jsdom)

**Interfaces:**
- Consumes: Task 1 계약, `esc`
- Produces: `mountExplorer: MountViewer`
- 이전 규칙: Task 5 치환 규칙 + CSS 범위 `.cc-explorer`; 파일 상세 지표의 `최근 커밋` → `함수 수`, `public 메서드 N개` → `함수 N개`; 라우트 참조 풀이의 `A.routesDir` → 파일의 `routeFiles` 표시; `A.repo` 기반 링크 → `env.vscodeHref`.

- [ ] **Step 1: 실패하는 테스트**

```tsx
test('renders summary cards from architecture', () => { /* mount with laravel-mini analysis → card shows node count formatted ko-KR */ });
test('selection opens file detail and reports back', () => { /* env.selection {file: X} → detail shows X; clicking another file calls env.onSelect */ });
test('hostile file names render as text', () => { /* arch with node path '<img src=x onerror=alert(1)>.ts' → no <img> element inside root; textContent contains the literal */ });
test('dispose removes listeners and DOM', () => { /* after dispose root is empty; keydown '/' does nothing */ });
```
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5: Commit** — `feat(app): port architecture explorer`

---

### Task 8: 로딩 화면 (시안 B)

**Files:**
- Create: `src/features/loading/LoadingScreen.tsx`, `src/features/loading/miniCity.ts`, `src/features/loading/eta.ts`, `src/features/loading/loading.css`
- Test: `tests/app/loading.test.tsx`, `tests/app/eta.test.ts`

**Interfaces:**
- Consumes: `Progress`, `roleColors`
- Produces:
  - `<LoadingScreen name: string; framework: string | null; sourceDir: string; roles: Role[]; step: LoadStep; onCancel(): void />`, `type LoadStep = { phase: 'list'; found: number } | { phase: 'read'; done: number; total: number } | { phase: 'parse'; done: number; total: number; path: string; role: number } | { phase: 'link' } | { phase: 'metrics' }`
  - 단계 목록 문구: `파일 찾기` → `코드 읽기` → `참조 연결` → `도시 짓기` (완료 ✓, 진행 ●, 대기 ○; 코드 읽기는 read·parse 를 합친 단계, 오른쪽에 `N / 전체`)
  - `estimateRemaining(samples: { t: number; done: number }[], total: number): number | null` — 최근 5개 표본의 평균 속도, 표본 2개 미만이면 null. 표시 `약 N초 남음`
  - `mountMiniCity(root: HTMLElement): { add(color: string): void; dispose(): void }` — Three.js, 호출마다 건물 하나가 솟는 애니메이션(0.4s), 최대 600개 이후에는 기존 건물 높이만 갱신

- [ ] **Step 1: 실패하는 테스트** — 단계 표시(각 phase 에서 ✓●○ 상태), 진행률 바 width 비율, 현재 경로 표시(escape), 취소 버튼 → `onCancel`; `estimateRemaining` 수치 케이스. (WebGL 없는 jsdom 에서는 `mountMiniCity` 를 `vi.mock`.)
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5: Commit** — `feat(app): loading screen with step list and growing city`

---

### Task 9: 분석 화면 셸 (상단 바·탭·VS Code·cc.json·재연결)

**Files:**
- Create: `src/features/shell/ViewerShell.tsx`, `src/features/shell/webgl.ts`, `src/features/shell/hash.ts`, `src/features/shell/vscode.ts`, `src/features/shell/codecharta.ts`, `src/features/shell/shell.css`
- Test: `tests/app/shell.test.tsx`, `tests/app/hash.test.ts`, `tests/app/codecharta.test.ts`

**Interfaces:**
- Consumes: `mountCity`, `mountGraph`, `mountExplorer`, `ViewerEnv`, `TabId`, `Selection`
- Produces:
  - `<ViewerShell arch: Architecture; readSource(path): Promise<string | null>; canReconnect: boolean; onReconnect(): void; onReanalyze(): void; onOpenOther(): void />`
  - `parseHash(h: string): { tab: TabId; sel: Selection }` / `formatHash(tab, sel): string` — 형식 `#city&file=<encodeURIComponent 경로>&code`; 알 수 없는 탭은 `city`
  - `vscode.ts`: `getRepoRoot(name: string): string | null` / `setRepoRoot(name, path)` (localStorage `code-atlas:vscode:<name>`, try/catch), `vscodeHref(root: string, path: string): string` = `vscode://file` + root(끝 `/` 정규화) + `/` + path
  - `toCodeCharta(arch: Architecture): object` — `{ projectName: arch.name, apiVersion: '1.3', nodes: [{ name: 'root', type: 'Folder', attributes: {}, children }], edges: [{ fromNodeName: '/root/<path>', toNodeName: '/root/<path>', attributes: { code_dependency: weight } }], attributeTypes: { nodes: { rloc: 'absolute', fan_in: 'absolute', fan_out: 'absolute', instability: 'relative', centrality: 'absolute', max_complexity_per_function: 'absolute', functions: 'absolute' }, edges: { code_dependency: 'absolute' } } }` — 파일 노드 attributes 는 `rloc = lines`, `fan_in`, `fan_out`, `instability = round(instability*100)`, `centrality = round(centrality*100)`, `max_complexity_per_function = maxComplexity`, `functions`. 파일명 `<name>.cc.json` 으로 Blob 다운로드.
  - 상단 바: 레포 이름·프레임워크·파일 수·분석 시각, 탭 `도시 / 그래프 / 탐색기`, `다시 분석`, `cc.json 내려받기`, `다른 레포 열기`, `canReconnect` 이면 `폴더 다시 연결`. `failed.length > 0` 이면 `N개 파일을 읽지 못했어요` 펼침 목록, `unresolved > 0` 이면 `해석하지 못한 import N개`.
  - 탭 전환은 이전 탭 dispose 후 새 탭 mount(재분석 없음), 해시 동기화.
  - `hasWebGL(): boolean`(`shell/webgl.ts`, 캔버스로 `webgl2`/`webgl` 컨텍스트 확인). false 면 기본 탭을 탐색기로, 도시·그래프 탭은 `이 브라우저에서는 3D 화면을 쓸 수 없어요. 탐색기에서 같은 정보를 볼 수 있어요.` 안내.

- [ ] **Step 1: 실패하는 테스트** — `parseHash`/`formatHash` 왕복(경로에 `&`·공백·한글), `toCodeCharta` 가 폴더 트리를 만들고 edges 수 = arch.edges 수, VS Code 경로 미설정 시 `vscodeHref` null → 설정 후 값, `hasWebGL` false 면 탐색기 탭이 기본이고 도시 탭에 안내 문구, 탭 클릭 시 이전 mount 의 dispose 호출(각 mount 를 `vi.mock`), `readSource` 가 null 인 상태에서 `폴더 다시 연결` 버튼 → `onReconnect`.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5: Commit** — `feat(app): viewer shell with tabs, deep links, vscode and cc.json export`

---

### Task 10: 첫 화면 (시안 A) + 앱 흐름

**Files:**
- Create: `src/features/landing/Landing.tsx`, `src/features/landing/landing.css`, `src/app/useRepoSession.ts`
- Modify: `src/app/App.tsx`
- Test: `tests/app/app-flow.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`listRepo`, `loadRepo`, 어댑터, `isTooMany`), Task 3 (`startAnalysis`), Task 4 (캐시), Task 8 (`LoadingScreen`), Task 9 (`ViewerShell`)
- Produces:
  - `<Landing recent: CacheSummary[]; onPickFolder(): void; onDrop(items: DataTransferItemList): void; onFiles(files: FileList): void; onOpenRecent(key): void; onDeleteRecent(key): void; onClearAll(): void; notice?: string />` — 문구: 제목 `Code Atlas`, 드롭존 `레포 폴더를 여기에 끌어다 놓으세요`, 보조 `PHP (Laravel) · TypeScript / JavaScript (React)`, 버튼 `폴더 선택`, 안심 `🔒 파일은 브라우저 밖으로 나가지 않아요`, 최근 카드 `이름 / 프레임워크 · N 파일 · 날짜`, `캐시 지우기`. 숨은 `<input type="file" webkitdirectory data-testid="folder-input">` 항상 존재(`showDirectoryPicker` 없으면 버튼이 이것을 연다).
  - `useRepoSession()` 상태 기계: `landing → listing → (tooMany 확인) → reading → analyzing → viewer`, 오류 시 `landing` + notice. 흐름: 목록 작성 → `cacheKey` → 캐시 hit 이면 바로 viewer, miss 면 읽기·분석 → 저장(핸들이 있으면 함께). 드롭은 `item.getAsFileSystemHandle?.()` 가 있으면 핸들(캐시 재연결 가능), 없으면 `webkitGetAsEntry()`.
  - 언어가 섞인 폴더(PHP·TS 소스가 둘 다 있음): 분석 전에 `이 폴더에는 PHP 와 TypeScript 가 함께 있어요. 어느 쪽으로 볼까요?` 선택(기본 = 파일 수가 많은 쪽) → `startAnalysis` 의 `prefer`.
  - `showDirectoryPicker` 가 없는 브라우저: 드롭존 아래 `이 브라우저에서는 폴더를 끌어다 놓거나 "폴더 선택"으로 골라 주세요. 다시 열 때 코드 보기는 폴더를 한 번 더 넣어야 해요.`
  - 안내 문구: 폴더가 아님 `폴더를 끌어다 놓아 주세요. 파일 하나로는 분석할 수 없어요.`; 지원 파일 없음 `PHP·TS/JS 파일을 찾지 못했어요.`; 너무 많음 확인창 `파일이 N개예요. 소스 폴더(예: src)만 골라서 다시 열면 더 빨라요. 그대로 진행할까요?`; 큰 파일 건너뜀 viewer 상단 `2MB 가 넘는 파일 N개는 건너뛰었어요.`

- [ ] **Step 1: 실패하는 테스트** (jsdom, `startAnalysis`·캐시는 가짜 구현 주입)

```tsx
test('dropping a single file shows notice', …);
test('folder without supported files shows notice', …);
test('fresh folder: listing → loading screen → viewer, result cached', …);
test('same folder again opens from cache without analysing', …);
test('changed folder re-analyses', …);
test('mixed php+ts folder asks which language and passes prefer', …);
test('cancel during analysis returns to landing', …);
test('recent card opens cached analysis; delete and clear update the list', …);
```
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5: Commit** — `feat(app): landing screen and repo session flow`

---

### Task 11: E2E — 실제 브라우저에서 흐름·CSP·외부 요청 없음 확인

**Files:**
- Create: `tests/e2e/app.e2e.ts`, `playwright.config.ts` (또는 스크립트 `scripts/e2e.mjs`), npm script `e2e`
- (산출물) 스크린샷 `test-results/`(git 제외)

**Interfaces:**
- Consumes: 빌드 결과(`npm run build` → `vite preview --port 4173 --strictPort`)
- Produces: `npm run e2e` — playwright-core `chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })`

- [ ] **Step 1: 테스트 작성**
  - `tests/fixtures/react-mini` 를 `setInputFiles('[data-testid=folder-input]', <dir>)` 로 넣으면 로딩 화면(`코드 읽기`)이 보였다가 도시 탭이 뜬다.
  - 도시·그래프·탐색기 탭을 차례로 열고 각 스크린샷 저장.
  - 도시에서 검색(`/`)으로 픽스처 파일을 골라 코드 보기 → 코드 창에 픽스처 소스 일부가 보인다.
  - 새로고침 후 첫 화면 최근 카드 1개 → 누르면 분석 없이 도시.
  - 전체 과정에서 `page.on('request')` 의 URL 은 모두 `http://localhost:4173/` 로 시작, `page.on('console')` 에 error 없음, CSP 위반(`securitypolicyviolation`) 0건.
  - `tests/fixtures/laravel-mini` 로도 도시가 뜬다.
- [ ] **Step 2:** `npm run e2e` → PASS, 스크린샷 6장 이상.
- [ ] **Step 3: 스크린샷 확인** — 컨트롤러가 스크린샷을 열어 첫 화면(시안 A)·로딩(시안 B)·세 화면이 기존 페이지와 같은 모습인지 확인하고, 사용자 보고용으로 "확인한 것 / 직접 눌러 봐야 하는 것"을 정리.
- [ ] **Step 4: Commit** — `test(app): end-to-end flow, csp and no external requests`

---

### Task 12: GitHub Pages 배포 워크플로 (활성화는 사용자 확인 후)

**Files:**
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Produces: `main` 푸시 시 `npm ci` → `npx vitest run` → `npm run build` → `actions/upload-pages-artifact@v3`(path `dist`) → `actions/deploy-pages@v4`. `permissions: pages: write, id-token: write, contents: read`, Node 22, `concurrency: pages`. E2E 는 CI 에서 돌리지 않는다(Chrome 채널 의존).

- [ ] **Step 1:** 워크플로 작성 → YAML 파싱 확인 `npx --yes js-yaml .github/workflows/pages.yml > /dev/null` 이 오류 없이 끝남.
- [ ] **Step 2: Commit** — `ci: deploy static build to github pages`
- [ ] **Step 3: 사용자 확인 항목으로 남김** — Pages 소스를 "GitHub Actions" 로 설정, 푸시 여부. 이 Task 에서는 푸시·설정하지 않는다.

---

### Task 13: 기존 파이프라인 정리 + 문서 갱신 (삭제는 사용자 확인 후)

**Files:**
- Delete (확인 후): `tools/codecity/`, `repos/`, `site/`, `composer.json`, `composer.lock`, `vendor/`, `.work/`, `.cache/`, package.json 의 `dependency-cruiser`
- Modify: `CLAUDE.md`(새 구조·실행 방법·원칙: 소스 비포함, 브라우저 전용, CSP, 검증 습관), `package.json` `name`/`description`, `.gitignore`

- [ ] **Step 1:** 삭제 목록과 각 경로의 크기·추적 여부를 사용자에게 보여 주고 확인받는다.
- [ ] **Step 2:** 삭제·수정 후 `npx vitest run`, `npm run build`, `npm run e2e` PASS.
- [ ] **Step 3:** 누출 점검 — `git ls-files | grep -E '^(repos|site|\.work|\.local)/'` 출력 없음.
- [ ] **Step 4: Commit** — `chore: remove legacy docker pipeline and update project docs`

---

## 계획 밖(실행 시점에 사용자 확인)

- 원격 푸시 전, 이력의 `repos/api.json` 제거(이력 재작성) — 파괴적 작업이므로 별도 확인.
- 푸시와 Pages 활성화.
