# 여러 언어를 한 도시에 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여러 언어가 섞인 레포를 언어마다 따로 분석해 하나의 도시·그래프·탐색기로 합쳐 보여 준다 (언어 사이 의존선은 없음).

**Architecture:** 엔진은 그대로 언어 하나씩 `analyze()` 하고, 새 `mergeArchitectures()` 가 결과를 한 `Architecture` 로 합친다(노드·엣지 인덱스 이동, 역할 이름에 언어 접두어, 노드마다 `lang`). Worker 는 언어 목록을 받아 주 언어는 기존 `analyzeWithQuality` 로(배틀 데이터 포함), 나머지는 `analyze` 로 돌려 합친다. 앱은 언어 선택 창을 없애고, 섞여 있으면 항상 모두 함께 연다.

**Tech Stack:** TypeScript, web-tree-sitter, React, vitest, Playwright 기반 `scripts/e2e.mjs`

**Spec:** 별도 설계 문서 없음 — 대화에서 합의한 A안(언어별 분석 → 한 도시, 언어 간 연결 없음)과 아래 Global Constraints·Review Focus 가 스펙이다.

**작업 위치:** worktree `../code-atlas-wt/mixed-langs`, 브랜치 `feat/mixed-langs` (main `0d11d6f` 에서 분리).

## Global Constraints

- 언어 하나짜리 레포의 분석 결과·화면·배틀은 지금과 바이트 단위로 같아야 한다 (`Architecture` 에 새 필드를 넣지 않는다).
- `Architecture.version` 은 1 그대로. 새 필드는 전부 선택(optional): `Architecture.langs?: Lang[]` (합친 경우에만, 주 언어가 첫 번째), `ArchNode.lang?: Lang` (합친 경우에만). 없으면 `arch.lang` 을 쓴다 — 예전 캐시가 그대로 열려야 한다.
- 합친 결과의 `lang` = 주 언어, `framework` = `null`, `sourceDir` = `''`.
- 주 언어: PHP·TS 가 둘 다 있고 Laravel/React 판정(`frameworkLang`)이 하나를 고르면 그 언어, 아니면 `pickLang` 의 `lang`(파일 최다).
- 합칠 언어 목록 = `pickLang(counts).ask` (셸은 다른 언어가 없을 때만 — 기존 규칙 유지). 주 언어를 맨 앞으로.
- 역할 이름: 합친 경우 `${LANGS[l].label} · ${원래 이름}` (예: `Python · 진입점`). 계층(layers)은 `layers('애플리케이션', '도메인·인프라')` 공용 라벨 4개.
- 배틀 데이터는 주 언어만 잰다 (지금처럼 언어 하나). 배틀 탭 표시는 주 언어 기준.
- 언어 선택 창은 없앤다 (`chooseLang` 단계·`ChoiceDialog` 언어 분기·`langChoices` 상태 삭제). 후보가 2개 이상이면 묻지 않고 전부 합친다. php+ts 의 Laravel/React 판정은 주 언어를 정하는 데만 쓴다.
- 헤더·랜딩 표시: 합친 경우 `langs` 의 이름을 ` + ` 로 연결 (예: `Python + Go`). 단일 언어는 지금 그대로 (프레임워크 이름 우선).
- 분석 대상 문자열은 DOM 에 넣기 전 항상 escape. 외부 리소스 금지. 테스트는 가짜 픽스처만.
- 주석은 비자명한 WHY 한 줄만. 태스크마다 커밋. 머신 부하가 높으면 `npx vitest run --testTimeout=60000`.

## Review Focus

1. **예전 캐시 기록** (`langs`·노드 `lang` 없음) — 그대로 열리고 코드 강조는 `arch.lang` 으로 → Task 3 테스트 `old single-language architecture still highlights by arch.lang`.
2. **역할 이름이 언어마다 같음** (`진입점` 이 둘) — 합친 뒤 서로 다른 역할로 남고 색도 각자 → Task 1 테스트 `same role names in two languages stay separate roles`.
3. **합칠 언어 중 하나가 노드 0개** (예: 파일이 전부 빌드 스크립트·생성 파일이라 대상 없음 → `UnsupportedRepoError`) — 그 언어만 빠지고 나머지는 열림 → Task 2 테스트 `a language with nothing to analyze is skipped`.
4. **진행률이 언어를 넘어가며 거꾸로 감** — `done/total` 은 전체 합계 기준으로 단조 증가 → Task 2 테스트 `progress counts across languages`.
5. **GitHub 파일 수 제한** — 합칠 때는 합칠 언어들의 파일 수 합으로 비교 → Task 3 테스트 `github cap counts every merged language`.

---

### Task 1: 결과 합치기 `mergeArchitectures`

**Files:**
- Create: `src/engine/merge.ts`
- Modify: `src/engine/architecture.ts` (`Architecture.langs?`, `ArchNode.lang?` 추가만), `src/engine/presets.ts` (`layers` export)
- Test: `tests/engine/merge.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** parts[0] 이 주 언어. parts 가 하나면 그대로 돌려준다(새 필드 없음). */
  export function mergeArchitectures(parts: Architecture[]): Architecture;
  /** 로딩 화면이 분석 전에 쓰는 합친 역할 목록 — mergeArchitectures 와 같은 이름·순서 규칙. */
  export function mergeRoles(parts: { lang: Lang; roles: Role[] }[]): Role[];
  ```
  규칙: 노드는 parts 순서대로 이어 붙이고 각 노드에 `lang: part.lang`, `role` 은 앞 part 들의 역할 수만큼 더한다. 엣지 `from/to` 는 앞 part 들의 노드 수만큼 더한다(`upward` 그대로). `roles` = 각 part 역할에 이름 접두어(`${label} · `), `layers` = 공용 4개. `failed` 는 이어 붙이고 `unresolved` 는 합. `name`·`generatedAt` 은 parts[0] 것. `langs` = parts 의 lang 순서.

- [ ] **Step 1: 실패 테스트** — 손으로 만든 작은 `Architecture` 두 개(py 노드 2·엣지 1, go 노드 3·엣지 2)로:
  ```ts
  test('nodes, roles and edges are offset per part', …)          // go 노드 role += py 역할 수, go 엣지 from/to += 2
  test('each node remembers its language and langs lists parts', …) // nodes[0].lang==='py', nodes[2].lang==='go', langs ['py','go']
  test('role names get the language label', …)                     // 'Python · 진입점', 'Go · 진입점'
  test('same role names in two languages stay separate roles', …)  // 두 '진입점' → 인덱스 다르고 이름 다름 (Review Focus 2)
  test('failed are concatenated and unresolved summed', …)
  test('one part comes back unchanged', …)                         // toEqual(parts[0]), 'langs' in result === false
  test('mergeRoles matches the merged roles', …)                   // mergeRoles(...) toEqual(mergeArchitectures(...).roles)
  ```
- [ ] **Step 2:** `npx vitest run tests/engine/merge.test.ts` → FAIL
- [ ] **Step 3:** 구현. `lang`/`framework`/`sourceDir` 는 Global Constraints 값.
- [ ] **Step 4:** `npx vitest run && npx tsc --noEmit && npm run typecheck:engine` → PASS
- [ ] **Step 5:** 커밋 `feat(engine): merge per-language analyses into one architecture`

### Task 2: 여러 언어 분석 `analyzeLangs` 와 Worker

**Files:**
- Create: `src/engine/analyzeLangs.ts`
- Modify: `src/app/analysis/protocol.ts` (`ToWorker.langs?: Lang[]`), `src/app/analysis/worker.ts`, `src/app/analysis/client.ts` (옵션 전달)
- Test: `tests/engine/analyze-langs.test.ts`, 기존 worker 테스트 파일(`tests/app/analysis.test.ts` 등)

**Interfaces:**
- Consumes: `mergeArchitectures` (Task 1), `analyze`, `analyzeWithQuality`
- Produces:
  ```ts
  /** langs[0] = 주 언어(배틀 데이터 대상). 분석할 게 없는 언어(UnsupportedRepoError)는 건너뛴다; 주 언어가 그러면 다음 언어가 주 언어가 된다. 전부 없으면 UnsupportedRepoError. */
  export function analyzeLangs(input: RepoInput, parsers: Parsers, langs: Lang[], opts?: AnalyzeWithQualityOptions): AnalysisWithQuality;
  ```
  주 언어는 `analyzeWithQuality(input, parsers, { ...opts, prefer })`, 나머지는 `analyze(input, parsers, { prefer: l, … })`. 진행률: 시작 전에 언어별 대상 파일 수(`sourcesFor(detect(input, l), input.files).length`)를 모두 더해 `total` 로 쓰고, 각 언어의 `done` 에 앞 언어들 파일 수를 더하며, `role` 에는 앞 언어들 역할 수를 더한다(로딩 화면 색이 `mergeRoles` 와 맞도록). `link`·`metrics` 단계는 언어마다 그대로 전달.
  Worker: `msg.langs` 가 2개 이상이면 `loadParsers(locate, msg.langs)` 후 `analyzeLangs`, 아니면 지금 경로 그대로.

- [ ] **Step 1: 실패 테스트** — 픽스처 `tests/fixtures/py-mini` + `go-mini` 파일을 한 `RepoInput` 으로 합쳐(경로 앞에 `api/`, `svc/` 를 붙이고 go.mod config 도 `svc/go.mod` 로):
  ```ts
  test('two languages become one architecture', …)   // langs ['py','go'], 노드 수 = 각 단독 분석 합, 엣지 수 = 합, 언어 사이 엣지 없음
  test('battle data is measured for the primary language only', …) // quality.lang === 'py'
  test('a language with nothing to analyze is skipped', …)        // langs ['go','kotlin'] + build.gradle.kts 하나뿐 → langs 결과 그대로 go 단독과 같음 (Review Focus 3)
  test('progress counts across languages', …)        // parse 이벤트 total 일정, done 1..total 단조 증가 (Review Focus 4)
  test('one language is the same as analyzeWithQuality', …)
  ```
  worker 테스트: `langs: ['py','go']` 메시지 → `done` 의 `architecture.langs` 가 `['py','go']`.
- [ ] **Step 2:** 실패 확인 → 구현 → `npx vitest run && npx tsc --noEmit && npm run typecheck:engine` → PASS
- [ ] **Step 3:** 커밋 `feat(engine): analyze several languages of one repo in a single job`

### Task 3: 앱 — 선택 창 없이 합쳐 열기, 표시, 파일별 코드 강조, e2e

**Files:**
- Modify: `src/app/useRepoSession.ts`, `src/app/App.tsx` (언어 선택 창 제거), `src/app/files/walk.ts` (`forLangs`), `src/storage/cache.ts` (`CacheSummary.langs?: Lang[]`), `src/features/landing/Landing.tsx`, `src/features/shell/ViewerShell.tsx`, 로딩 화면이 역할 목록을 받는 곳, `src/engine/architecture.ts` (`nodeLang`), `src/features/city/mountCity.ts:558,573`, `src/features/walk/mountWalk.ts:1157-1158` (지금 php/ts 만 아는 하드코딩도 같이 고침), `scripts/e2e.mjs`, `CLAUDE.md`
- Create: `src/features/lang-label.ts`, `tests/fixtures/mixed-mini/` (py 파일 3~4개 + go 파일 3~4개 + `go.mod`, 가짜 코드)
- Test: `tests/app/app-flow.test.tsx`, `tests/app/walk.test.ts`, `tests/app/lang-label.test.ts`, 도시 코드 보기 테스트

**Interfaces:**
- Consumes: `mergeRoles` (Task 1), `ToWorker.langs` / client 옵션 (Task 2)
- Produces:
  ```ts
  export function forLangs(listing: Listing, langs: Lang[]): Listing;   // 기존 forLang 규칙(빌드 스크립트 제외, php/ts 쌍)을 언어 여러 개로
  export function repoLabel(r: { lang: Lang; langs?: Lang[]; framework: string | null }): string; // 합친 경우 'Python + Go', 아니면 지금 규칙
  export const nodeLang = (arch: Architecture, i: number): Lang => arch.nodes[i].lang ?? arch.lang;
  ```
  흐름: `countLangs` → `pickLang` → 주 언어(Global Constraints) → `langs = [주 언어, ...ask 의 나머지]` (ask 가 비면 `[주 언어]`). 읽기는 `forLangs(listing, langs)`, GitHub 제한은 그 합계와 비교. 로딩 화면 역할은 언어마다 `presetFor(detect(input, l), …).roles` 를 `mergeRoles` 로 합친 것. `langs` 가 2개 이상이면 worker 에 넘기고 `CacheSummary.langs` 도 저장. 헤더·랜딩 최근 목록·샘플 카드는 `repoLabel`. 코드 강조는 도시·걷기 모두 `nodeLang`.

- [ ] **Step 1: 실패 테스트**
  - `lang-label.test.ts`: `repoLabel({lang:'py', langs:['py','go'], framework:null})` → `'Python + Go'`; `repoLabel({lang:'php', framework:'laravel'})` → `'Laravel'`; 알 수 없는 lang → 그 문자열.
  - `walk.test.ts`: `forLangs` 가 py+go 파일만 남기고 `build.gradle.kts` 를 빼며, `['php']` 는 기존처럼 ts 도 남긴다.
  - `app-flow.test.tsx`:
    - `mixed folder opens every language together without asking` — py+go 폴더 → 선택 창 없음, 헤더 `Python + Go ·`, worker 에 `langs ['py','go']`.
    - `laravel repo with ts opens both with php first` — php+ts(Laravel) → 창 없음, `langs[0] === 'php'`.
    - `github cap counts every merged language` — 언어별로는 제한 아래지만 합치면 넘는 GitHub 레포 → 제한 안내 (Review Focus 5).
    - 기존 `go+sh does not ask` 는 그대로, 기존 "창이 뜬다" 테스트들은 새 동작으로 바꾼다.
  - 도시 코드 보기: `merged city highlights each file in its own language` (py → `language-python`, go → `language-go`), `old single-language architecture still highlights by arch.lang` (Review Focus 1).
- [ ] **Step 2:** 실패 확인 → 구현 → `npx vitest run --testTimeout=60000 && npx tsc --noEmit` → PASS
- [ ] **Step 3:** e2e 단계 `mixed-mini: one city with both languages` 추가: 폴더 선택 → 창 없이 도시 → 헤더 `Python + Go` → 검색으로 py 파일 하나·go 파일 하나 열어 `language-python`·`language-go` 확인, 스크린샷 `mixed-city.png`. 기존 e2e 에 언어 선택 창을 쓰는 단계가 있으면 새 동작으로 고친다. `npm run e2e` → 전부 PASS, 스크린샷을 직접 열어 두 언어 구역이 같이 보이는지 확인.
- [ ] **Step 4:** `CLAUDE.md` 지원 언어 줄 뒤에 "여러 언어가 섞이면 묻지 않고 언어별로 분석해 한 도시에 합친다(언어 간 의존선 없음, 배틀은 주 언어만)" 한 줄.
- [ ] **Step 5:** `npx vitest run --testTimeout=60000 && npx tsc --noEmit && npm run typecheck:engine && npm run build && npm run e2e` → PASS
- [ ] **Step 6:** 커밋 `feat: open a mixed-language repo as one city`

---

## 계획 밖 (후속)
- 언어 사이 의존선 (Java↔Kotlin, TS→Python API 호출 등).
- 배틀을 여러 언어 합계로 재기.
- 도시에서 언어별로 켜고 끄는 토글 (지금은 역할 토글로 대신).
- 한 언어만 골라 보는 방법 (선택 창을 없앴으므로 역할 토글로 대신).
