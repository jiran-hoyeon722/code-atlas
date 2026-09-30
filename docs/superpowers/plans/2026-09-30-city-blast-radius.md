# 의존성 도시 폭발 반경 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도시 화면에서 선택한 파일을 고쳤을 때 간접까지 번지는 영향권을 단계별 충격파와 패널 요약으로 보여 준다.

**Architecture:** 계산은 `src/features/city/blast.ts` 순수 함수(역방향 BFS)로 분리하고, `mountCity.ts` 가 패널 버튼·섹션·색·애니메이션을 담당한다. 엔진·캐시는 바꾸지 않고, 딥링크는 `Selection.blast` 플래그로 기존 해시 동기화에 얹는다.

**Tech Stack:** TypeScript, three.js (InstancedMesh), vitest + jsdom, Playwright 기반 `scripts/e2e.mjs`

**Spec:** `docs/superpowers/specs/2026-09-30-city-blast-radius-design.md`

## Global Constraints

- 화면 문구는 한국어. 파일명·경로 등 분석 대상에서 온 문자열은 DOM 에 넣기 전 항상 `esc()`.
- 엔진(`src/engine`)·캐시(`src/storage`) 변경 금지. 외부 리소스·CDN 금지.
- 테스트 데이터는 가짜 경로만(`tests/fixtures` 또는 테스트 안 인라인). 실제 레포 이름·경로 금지.
- 타입 전용 참조 = `kinds` 키가 전부 `type`, `type-import` 중 하나인 참조.
- 단계 간격 0.4초. 단계당 목록 최대 40개 + `외 N개`.
- 요약 문구 형식: `직접 {1단계 수} · 간접 {나머지} · 도시의 {P}% · 최대 {K}단계`, 라우트 줄: `영향권 중 라우트가 직접 쓰는 파일 {N}개`.
- 영향 0개 문구: `이 파일을 쓰는 곳이 없습니다 — 고쳐도 다른 파일에 번지지 않습니다`.
- 버튼 문구: `💥 폭발 반경`, 토글 문구: `타입 참조 제외`.
- 주석은 비자명한 WHY 한 줄만.

## Review Focus

1. 폭발 반경 목록의 악의적 파일명(`<img onerror>`) — 텍스트로만 보여야 함 → Task 3 테스트.
2. 폭발 반경이 켜진 채 색 지표 드롭다운을 바꿈 — 폭발 반경 상태·색이 유지되어야 함 → Task 3 테스트.
3. 코드 보기가 열린 상태에서 `Esc` — 첫 번째는 코드만 닫고 폭발 반경 유지, 두 번째에 선택 해제 → Task 3 테스트.
4. 딥링크 `&blast` 인데 파일이 도시에 없음 — 아무 일도 없이 기본 화면 → Task 3 테스트.
5. 영향 파일이 한 단계에 40개 초과(허브 파일) — 40개 + `외 N개` → Task 3 테스트.

역할 토글로 숨긴 건물도 계산에는 포함한다(보기와 무관하게 영향은 실제로 있음). 숨긴 건물은 계속 숨긴다.

---

### Task 1: 폭발 반경 계산

**Files:**
- Create: `src/features/city/blast.ts`
- Test: `tests/app/city-blast.test.ts`

**Interfaces:**
- Consumes: `Architecture['edges']` from `src/engine/architecture.ts` (`[from, to, weight, kinds, upward]`, from 이 to 를 쓴다)
- Produces:
  ```ts
  export interface BlastResult { depth: Int32Array; levels: number[][]; maxDepth: number; affected: number; routeFiles: number }
  export const TYPE_ONLY_KINDS: ReadonlySet<string>; // {'type','type-import'}
  export function blastRadius(count: number, edges: Architecture['edges'], start: number, routeRefs: ArrayLike<number>, opts: { skipTypeOnly: boolean }): BlastResult;
  export function blastPercent(affected: number, count: number): number; // Math.round(affected / (count-1) * 100), count<=1 → 0
  ```

- [ ] **Step 1: Write the failing tests** (`tests/app/city-blast.test.ts`)

  엣지 헬퍼 `e(from, to, kinds = { import: 1 })` → `[from, to, 1, kinds, 0]`.
  - `chain`: 파일 0,1,2, 엣지 `e(1,0)`, `e(2,1)`, start 0 → `levels` `[[1],[2]]`, `maxDepth` 2, `affected` 2, `Array.from(depth)` `[0,1,2]`.
  - `cycle terminates and counts once`: 엣지 `e(1,0)`, `e(2,1)`, `e(0,2)` (0→2→1→0 순환) → `affected` 2, `Array.from(depth)` `[0,1,2]`, `levels` `[[1],[2]]`.
  - `nearest level wins`: 엣지 `e(1,0)`, `e(2,1)`, `e(2,0)` → `depth[2]` 1, `levels` `[[1,2]]`.
  - `type-only skipped when asked`: 엣지 `e(1,0,{type:1})`, `e(2,0,{'type-import':2})` → skipTypeOnly false: affected 2; true: affected 0, levels `[]`, maxDepth 0.
  - `mixed kinds kept`: 엣지 `e(1,0,{type:1, new:1})` → skipTypeOnly true 여도 affected 1.
  - `unused file`: 파일 2개, 엣지 `e(0,1)`, start 0 → affected 0, maxDepth 0, `depth[1]` -1.
  - `routeFiles`: chain + routeRefs `[5,0,3]` → routeFiles 1 (시작 파일 제외).
  - `blastPercent`: `(2,3)` → 100, `(1,4)` → 33, `(0,1)` → 0.

- [ ] **Step 2: Run to verify fail**
  Run: `npx vitest run tests/app/city-blast.test.ts`
  Expected: FAIL — cannot resolve `../../src/features/city/blast`

- [ ] **Step 3: Implement `blastRadius` / `blastPercent`**
  역방향 인접 리스트(to → from 목록)를 한 번 만들고 큐 기반 BFS. `levels[k-1]` 에 k단계 파일을 방문 순서대로 넣는다(정렬은 화면 책임).

- [ ] **Step 4: Run to verify pass**
  Run: `npx vitest run tests/app/city-blast.test.ts` → PASS
  Run: `npx tsc --noEmit` → 에러 없음

- [ ] **Step 5: Commit**
  ```bash
  git add src/features/city/blast.ts tests/app/city-blast.test.ts
  git commit -m "feat(city): compute blast radius over reverse references"
  ```

### Task 2: 딥링크 `blast` 플래그

**Files:**
- Modify: `src/features/viewer-env.ts` (`Selection`)
- Modify: `src/features/shell/hash.ts`
- Test: `tests/app/hash.test.ts`

**Interfaces:**
- Produces: `Selection { file?: string; code?: boolean; blast?: boolean }`. `formatHash` 순서는 `&file=…` → `&code` → `&blast`.

- [ ] **Step 1: Write the failing tests** (기존 describe 안에 추가)
  - `formats blast after code`: `formatHash('city', { file: 'a.ts', blast: true })` → `'#city&file=a.ts&blast'`; `{ file: 'a.ts', code: true, blast: true }` → `'#city&file=a.ts&code&blast'`.
  - `round-trips blast`: 네 조합(code/blast 각 true·생략)을 `parseHash(formatHash('city', sel))` 로 왕복해 `toEqual({ tab: 'city', sel })`.
  - `blast without file is dropped`: `parseHash('#city&blast')` → `{ tab: 'city', sel: {} }`; `formatHash('city', { blast: true })` → `'#city'`.

- [ ] **Step 2: Run to verify fail**
  Run: `npx vitest run tests/app/hash.test.ts` → FAIL (blast 누락)

- [ ] **Step 3: Implement** — `parseHash` 에 `part === 'blast'` 분기, `file` 없으면 `code` 와 함께 `blast` 삭제. `formatHash` 에 `${sel.blast ? '&blast' : ''}`.

- [ ] **Step 4: Run to verify pass**
  Run: `npx vitest run tests/app/hash.test.ts tests/app/shell.test.tsx` → PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/features/viewer-env.ts src/features/shell/hash.ts tests/app/hash.test.ts
  git commit -m "feat(shell): carry the blast flag in the deep link"
  ```

### Task 3: 패널 버튼·요약·목록·색 (정적 상태)

애니메이션 없이 최종 상태를 즉시 그리는 단계까지. 애니메이션은 Task 4.

**Files:**
- Modify: `src/features/city/mountCity.ts`
- Modify: `src/features/city/city.css`
- Test: `tests/app/city-mount.test.tsx`

**Interfaces:**
- Consumes: `blastRadius`, `blastPercent`, `BlastResult` (Task 1), `Selection.blast` (Task 2)
- Produces (Task 4 가 씀): `state.blast: { result: BlastResult; skipTypeOnly: boolean; startedAt: number } | null`, `function blastColor(level: number, maxDepth: number): THREE.Color`, `function setBlast(on: boolean): void`
- DOM 훅: 버튼 `[data-blast]` (켜지면 `aria-pressed="true"`), 섹션 `[data-el=blast]`, 토글 `input[data-blast-types]`, 요약 `.blast-summary`, 라우트 줄 `.blast-routes`

- [ ] **Step 1: Write the failing tests** (`tests/app/city-mount.test.tsx`, 기존 mock·헬퍼 재사용)

  테스트용 arch `blastArch()`: 노드 0 `lib/core.ts`, 1 `HOSTILE`(routeRefs 2), 2 `a/Page.ts`, 3 `types/only.ts`; 엣지 `[1,0,1,{import:1},0]`, `[2,1,1,{import:1},0]`, `[3,0,1,{'type-import':1},0]`. 선택은 `env({ selection: { file: 'lib/core.ts' } })` 로 마운트해 시작.
  - `blast button shows summary and levels`: `[data-blast]` 클릭 → `.blast-summary` 텍스트 `직접 2 · 간접 1 · 도시의 100% · 최대 2단계`, `.blast-routes` 텍스트 `영향권 중 라우트가 직접 쓰는 파일 1개`, `[data-el=blast]` 안에 HOSTILE 이 `textContent` 로 있고 `querySelector('img')` 는 null, `onSelect` 마지막 호출 `{ file: 'lib/core.ts', blast: true }`.
  - `type toggle recomputes`: 켠 뒤 `input[data-blast-types]` 체크 → 요약 `직접 1 · 간접 1 · 도시의 67% · 최대 2단계`.
  - `unused file message`: `a/Page.ts` 선택 후 켬 → 섹션에 `이 파일을 쓰는 곳이 없습니다 — 고쳐도 다른 파일에 번지지 않습니다`.
  - `release`: 버튼 재클릭 → 섹션 없음, `aria-pressed="false"`, `onSelect` 마지막 `{ file: 'lib/core.ts' }`. 닫기 버튼 → 섹션 없음. 목록의 파일 버튼 클릭 → 새 파일 선택, 섹션 없음.
  - `color dropdown keeps blast` (Review Focus 2): 켠 뒤 `[data-el=color]` 를 `maxComplexity` 로 change → 섹션과 `aria-pressed="true"` 유지.
  - `escape closes code first` (Review Focus 3): `selection: { file: 'lib/core.ts', code: true, blast: true }` 로 마운트, `readSource` 가 `'x'` 반환. 코드 열림 대기 후 `Escape` → 코드 닫힘·섹션 유지·`onSelect` 마지막 `{ file, blast: true }`; 다시 `Escape` → 패널 닫힘.
  - `deep link starts with blast`: `selection: { file: 'lib/core.ts', blast: true }` → 마운트 직후 섹션 있음, `onSelect` 호출 없음(restore 는 조용해야 함).
  - `deep link to missing file` (Review Focus 4): `selection: { file: 'nope.ts', blast: true }` → 패널 닫힘, throw 없음.
  - `hub level truncates` (Review Focus 5): 노드 0 + 45개가 0을 직접 쓰는 arch → 1단계 버튼 40개, `외 5개` 문구.

- [ ] **Step 2: Run to verify fail**
  Run: `npx vitest run tests/app/city-mount.test.tsx` → 새 테스트 FAIL (`[data-blast]` 없음)

- [ ] **Step 3: Implement in `mountCity.ts`**
  - 선택 보고를 한곳으로: `function currentSelection(): Selection` (`file`, 코드 열려 있고 같은 파일이면 `code`, `state.blast` 면 `blast`). `select`·`openCode`·`closeCode`·`setBlast` 가 모두 이것으로 `reporter.report`.
  - `select(n)` 는 항상 `state.blast = null` 로 시작(다른 건물 선택 = 해제).
  - `setBlast(on)`: 켜면 `blastRadius(nodes.length, arch.edges, sel.i, routeRefs, { skipTypeOnly })` 결과 저장, `drawArcs(null)`, `applyColors()`, 패널 다시 그림; 끄면 `drawArcs(state.selected)` 복원. `skipTypeOnly` 는 켜 있는 동안만 기억(해제 시 false 로 초기화).
  - `applyColors`: `state.blast` 가 있으면 시작 건물은 `baseColor`, `depth>0` 은 `blastColor(depth, maxDepth)`, 나머지는 `baseColor.lerp(gray, 0.88)`.
  - `blastColor(level, maxDepth)`: `t = maxDepth <= 1 ? 0 : (level-1)/(maxDepth-1)`, `setHSL(0.14 * t, 0.85, 0.5 + 0.12 * t)`.
  - `renderPanel`: actions 에 `<button data-blast aria-pressed>💥 폭발 반경</button>`; 켜 있으면 metrics 아래 `<div class="sec blast" data-el="blast">` — 요약, 라우트 줄, 토글, 단계별 `<h4>{k}단계</h4>` + 기존 `.item` 버튼(`data-select`), 단계 안 정렬 fan-in 내림차순 → 이름순, 40개 제한.
  - 패널 클릭 핸들러 selector 에 `[data-blast]` 추가, 토글은 `change` 이벤트로 `skipTypeOnly` 갱신 후 재계산.
  - Esc: 코드 열림 → `closeCode()` 만(폭발 유지); 아니면 `select(null)`.
  - 복원: `reporter.restore` 안에서 `select(linked, true)` 후 `env.selection.blast` 면 `setBlast(true)`.
  - `city.css`: `[data-blast][aria-pressed=true]` 강조(빨강 계열 테두리), `.blast-summary` 굵게, `.blast-routes` 보조 색. 기존 `.sec`·`.item` 재사용.

- [ ] **Step 4: Run to verify pass**
  Run: `npx vitest run tests/app` → PASS
  Run: `npx tsc --noEmit && npm run typecheck:engine` → 에러 없음

- [ ] **Step 5: Commit**
  ```bash
  git add src/features/city/mountCity.ts src/features/city/city.css tests/app/city-mount.test.tsx
  git commit -m "feat(city): blast radius panel, colors and deep link"
  ```

### Task 4: 충격파 애니메이션과 e2e 스크린샷

**Files:**
- Modify: `src/features/city/mountCity.ts` (렌더 루프, 링 메시, dispose)
- Modify: `scripts/e2e.mjs`
- Test: `tests/app/city-mount.test.tsx`

**Interfaces:**
- Consumes: `state.blast`, `blastColor`, `setBlast` (Task 3)

- [ ] **Step 1: Write the failing test**
  - `reduced motion paints final state at once`: `window.matchMedia` 를 `(q) => ({ matches: q.includes('reduce') })` 로 stub, 켠 뒤 `root.querySelector('.cc-city')?.dataset.blastDone` 가 `'1'`. matchMedia 없는 기본 jsdom 에서도 켜기가 throw 하지 않음(기존 Task 3 테스트가 그대로 통과).

- [ ] **Step 2: Run to verify fail**
  Run: `npx vitest run tests/app/city-mount.test.tsx -t "reduced motion"` → FAIL

- [ ] **Step 3: Implement**
  - `const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches`.
  - 켤 때 `startedAt = performance.now()`, `root.dataset.blastDone` 삭제; reduced motion 이면 즉시 최종 색 + `blastDone='1'`, 링 숨김.
  - 루프: `shown = min(maxDepth, floor(elapsed / 400) + 1)` 단계까지 `blastColor`, 그 외 영향 건물은 아직 어둡게. `shown` 이 바뀐 프레임에만 `instanceColor` 갱신. 방금 나타난 단계 건물은 300ms 동안 y 스케일 `1 + 0.15 * sin(π·p)` 펄스(해당 인스턴스 행렬만 갱신, 끝나면 원래 높이). 마지막 단계 펄스가 끝나면 `blastDone='1'` 로 두고 루프 작업 중단.
  - 링: `RingGeometry` + 빨강 `MeshBasicMaterial({ transparent: true, side: DoubleSide, depthWrite: false })` 하나를 만들어 재사용, 바닥에 눕힘. 반지름은 `maxDepth * 400ms` 동안 0 → (시작 건물에서 가장 먼 영향 건물까지 거리 + 10), 투명도 0.6 → 0. 영향 0개면 링 없음.
  - 해제·다른 선택 시 링 숨기고 펄스 중인 행렬은 `applyHeights()` 로 복구. dispose 는 기존 `scene.traverse` 가 링도 정리하는지 확인.
  - `scripts/e2e.mjs`: 코드 보기 스텝 다음에 `city: blast radius` 스텝 — `Escape` 로 코드 닫기, `[data-blast]` 클릭, `.cc-city[data-blast-done]` 대기(10초), `.blast-summary` 가 `직접` 으로 시작하는지 assert, `city-blast.png` 저장.

- [ ] **Step 4: Verify**
  Run: `npx vitest run` → 전부 PASS
  Run: `npx tsc --noEmit && npm run typecheck:engine` → 에러 없음
  Run: `npm run e2e` → 모든 스텝 passed, `test-results/e2e/city-blast.png` 를 직접 열어 붉은 단계 색·요약 패널이 보이는지 확인(기존 `city.png`·`city-code.png` 도 달라진 곳 없는지 확인)

- [ ] **Step 5: Commit**
  ```bash
  git add src/features/city/mountCity.ts scripts/e2e.mjs tests/app/city-mount.test.tsx
  git commit -m "feat(city): animate the blast radius shockwave"
  ```
