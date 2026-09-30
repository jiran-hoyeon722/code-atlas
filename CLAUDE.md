# code-atlas

로컬 레포 폴더를 브라우저에서 분석해 의존성 도시·그래프·아키텍처 탐색기로 보여주는 정적 앱. 서버 없이 브라우저 안에서만 동작한다.

## 원칙 (반드시)

- **소스 비포함.** 레포·배포물에 분석 대상 레포의 소스·경로·클래스명·구조 설명·수치를 넣지 않는다. 테스트는 `tests/fixtures` 의 가짜 코드만 쓴다. 실제 레포와 대조한 결과는 `.local/` 에만 둔다(git 제외).
  - 예외: `public/samples/` 의 **GitHub 공개 레포** 분석 결과(샘플). `scripts/samples.ts` 로만 만들고, 소스 본문은 넣지 않는다(코드 보기는 GitHub raw 에서 받는다). 회사·비공개 레포는 절대 샘플로 쓰지 않는다.
- **브라우저 전용.** 분석은 전부 브라우저(Worker)에서 하고 외부로 전송하지 않는다. CDN·외부 리소스 금지.
  - 예외: 사용자가 고른 **GitHub 공개 레포**를 `api.github.com`·`raw.githubusercontent.com` 에서 내려받는 것만 허용한다(받기만 하고 보내지 않는다).
- **CSP** (`vite.config.ts` 가 빌드 시 `index.html` 에 주입):
  `default-src 'self'; connect-src 'self' https://api.github.com https://raw.githubusercontent.com; img-src 'self' data: blob:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'`
- **분석 대상 코드는 신뢰하지 않는다.** 파일 경로·클래스명·소스 본문은 화면에 넣기 전에 항상 escape 한다.
- **캐시는 분석 결과만.** IndexedDB 에 소스 본문을 저장하지 않는다.
- 배포·push·공개 범위 결정은 매번 사용자 확인.

## 구조

| 경로 | 역할 |
|---|---|
| `src/engine` | Worker/Node 공용 분석 엔진. `npm run typecheck:engine` 으로 DOM/Node API 사용 금지를 유지한다 |
| `src/app` | 세션, 폴더 읽기, Worker 클라이언트 |
| `src/storage` | IndexedDB (분석 결과 캐시) |
| `src/features` | landing, loading, city, graph, explorer, shell, code-viewer |
| `tests` | engine / app 테스트, `fixtures/` 가짜 코드 |
| `scripts` | `copy-wasm`, `e2e`, `compare`, `samples`(공개 레포 샘플 생성) |
| `.github/workflows/pages.yml` | 정적 빌드를 GitHub Pages 로 배포 |

## 화면 요구 (유지해야 할 것)

- **첫 화면(시안 A)** — 폴더를 고르는 랜딩. 최근 분석한 레포 목록과 함께 보여준다. 내 레포가 없는 사용자를 위해 GitHub 공개 레포 주소 입력과 미리 분석한 인기 레포 샘플 카드를 함께 둔다.
- **로딩(시안 B)** — 분석 단계별 진행 상황 표시.
1. **3D 의존성 도시 `city` (메인)** — 계층 = 도로로 나뉜 줄, 역할 = 블록, 파일 = 건물(블록 안은 경로순). 높이·색 지표 드롭다운(기본 높이 fan-in, 기본 색 역할, 레거시 역할은 튀는 색). 클릭 시 참조 아치선(파랑 = 나를 쓰는 곳, 주황 = 내가 쓰는 것, 빨강 = 역방향), 흐르는 점선으로 방향, 무관한 건물은 어둡게. 오른쪽 패널에 지표 8개·양방향 목록·코드 보기(문법 강조 + 줄 번호, 참조 클래스 이름은 링크 → 해당 건물로 이동). 검색(`/`), 역할 토글, `#file=경로&code` 딥링크.
2. **3D 그래프 `graph`** — 점 = 파일(크기 fan-in, 색 역할), 계층·역할별 force 배치, 이웃만 보기, 역방향 강조.
3. **아키텍처 탐색기 `explorer`** — 요약 카드, 계층 지도(SVG), 역할 간 의존 행렬, 질문별 파일 순위 탭, 파일 상세 패널(자동 해석 문장).

v1 에는 git 지표가 없다. 최근 커밋 대신 **함수 수**를 쓴다.

공통 UI: 한국어 문구, 지표마다 한 줄 풀이, 다크 톤 글래스 패널, 역할 색 팔레트 통일, 화면 간 상호 링크.

## 명령

- `npm run dev` / `npm run build` / `npm run preview`
- `npx vitest run` — 테스트
- `npx tsc --noEmit`, `npm run typecheck:engine` — 타입 체크
- `npm run e2e` — 설치된 Chrome 필요, 스크린샷은 `test-results/e2e/`
- `npm run samples` — `public/samples/` 의 공개 레포 샘플을 다시 만든다(엔진이 바뀌면 실행). 클론은 `.local/samples-src/`
- `npm run compare -- <폴더> <baseline deps.json>` — 엔진 결과를 기준 deps.json 과 대조. 결과는 `.local/` 에 둔다.

## 검증 습관

- 화면을 바꾸면 `npm run e2e` 스크린샷(`test-results/e2e/`)을 직접 열어 확인한다.
- 사용자에게 "확인한 것 / 직접 눌러봐야 하는 것"을 나눠서 보고한다.
