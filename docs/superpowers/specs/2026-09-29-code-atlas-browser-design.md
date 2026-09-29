# Code Atlas — 브라우저 단독 코드 시각화 도구 설계

- 작성일: 2026-09-29
- 상태: 설계 합의 완료, 사용자 검토 대기

## 1. 목적

사용자가 자기 레포 폴더를 브라우저에 끌어다 놓으면, 그 자리에서 소스코드를 분석해 3D 의존성 도시·3D 그래프·아키텍처 탐색기·코드 뷰어를 그려 주는 정적 웹 앱.

- 사용자: 팀원들이 URL 로 접속해 각자 자기 레포를 넣어 본다.
- 성공 기준: 레포 폴더를 넣으면 수 초 안에 3D 도시가 뜨고, 건물을 누르면 참조 관계와 코드가 보인다. 결과 화면은 기존 code-city 페이지(도시·그래프·탐색기)의 모습과 인터랙션을 그대로 유지한다.

## 2. 최우선 원칙: 소스 비포함

code-atlas 는 **소스코드 기반 3D 시각자료를 만드는 프로그램**일 뿐이다. 어떤 레포의 데이터도 담지 않는다.

1. code-atlas 레포(커밋·이슈·문서·테스트·설정)와 배포물에 **분석 대상 레포의 소스, 파일 경로, 클래스·모듈 이름, 폴더 구조 설명, 분석 결과 수치를 넣지 않는다.**
2. 분석은 **사용자 브라우저 안에서만** 일어난다. 파일 내용·분석 결과를 서버나 외부 서비스로 보내는 코드(업로드, 원격 로깅, 분석 도구, 에러 리포팅 SDK)를 넣지 않는다.
3. 역할 프리셋은 공개된 프레임워크 관례(Laravel, React 생태계)만으로 작성한다. 특정 레포에서 가져온 규칙·설명 문구는 쓰지 않는다.
4. 테스트 예제는 직접 만든 가짜 코드만 쓴다.
5. 실제 레포와의 대조는 경로를 인자로 받는 로컬 스크립트로만 하고, 결과·기준 수치는 git 제외 폴더(`.local/`)에 둔다.
6. 외부 리소스는 빌드에 번들한다(런타임 CDN 로드 금지). 분석 중인 페이지가 제3자 서버에 요청을 보내지 않게 하기 위함.

## 3. 범위

| 포함 (1차) | 제외 (다음 버전) |
|---|---|
| 폴더 드래그 앤 드롭 / 폴더 선택 | git 지표(커밋 수, 작성자, fix 비율, 핫스팟, temporal coupling) |
| PHP(Laravel 프리셋), TS/JS(React 프리셋) | 그 밖의 언어 |
| 코드 지표: 줄 수, 함수 수, 함수별 복잡도·최대값 | 역할 규칙 편집 UI |
| 의존성·참조 종류·프레임워크 숨은 연결 | CodeCharta 앱 내장 (cc.json 내려받기로 대체) |
| 파생 지표: fan-in/out, 불안정도, PageRank, 역방향 의존, 참조 없음 | 모바일 지원 (안내만) |
| 분석 결과 캐시(IndexedDB, 소스 본문 제외) | |

지원 브라우저: Chrome·Edge 기준. Safari·Firefox 는 드래그 앤 드롭으로 동작하며, 캐시에서 연 뒤 코드 보기에는 폴더를 다시 넣어야 한다.

## 4. 구조

```
[폴더 드롭/선택] → [파일 수집] → [Worker: 파싱·해석·지표] → [캐시 저장] → [화면: 도시·그래프·탐색기]
```

기술: Vite + React + TypeScript. 3D 는 Three.js(도시)·3d-force-graph(그래프), 코드 강조는 highlight.js, 파싱은 web-tree-sitter(PHP·TSX 문법 WASM). 모두 npm 의존성으로 번들한다.

| 폴더 | 역할 |
|---|---|
| `src/app/` | 화면 전환(첫 화면 → 로딩 → 분석), 상단 바, 앱 상태 |
| `src/features/landing` | 드롭존, 최근 분석 카드, 캐시 지우기 |
| `src/features/loading` | 단계 목록 + 자라나는 도시 미리보기, 진행률, 취소 |
| `src/features/city`, `graph`, `explorer`, `code-viewer` | 기존 페이지 로직을 모듈로 옮긴 화면 |
| `src/engine/` | Worker 에서 도는 순수 TS 분석 엔진 (React 비의존) |
| `src/storage/` | IndexedDB 캐시, 폴더 핸들 보관 |

### 4.1 파일 수집 (메인 스레드)

- `showDirectoryPicker` 가 있으면 사용(순회하며 디렉터리를 건너뛸 수 있음), 없으면 드롭된 `DataTransferItem.webkitGetAsEntry` 로 순회.
- 항상 건너뜀: `node_modules`, `vendor`, `.git`, `dist`, `build`, `.next`, `storage`, `coverage`. 루트 `.gitignore` 의 단순 패턴도 적용.
- 대상 확장자: `.php`, `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` (`.d.ts` 포함). 설정 파일 `composer.json`, `package.json`, `tsconfig*.json`, `jsconfig.json` 도 읽는다.
- 파일 수가 20,000 을 넘으면 분석 전에 경고하고 소스 폴더를 좁힐지 묻는다.

### 4.2 감지

- `composer.json` 의 `require` 에 `laravel/framework` → Laravel 프리셋, 소스 폴더 `app/`, 라우트 폴더 `routes/`.
- `package.json` 의 의존성에 `react` → React 프리셋, 소스 폴더 `src/`(없으면 루트).
- 둘 다 아니면 언어만 판별하고 "소스 폴더 1단계 = 역할" 기본 규칙.
- PHP·TS 가 섞여 있으면 파일 수가 많은 쪽을 주 언어로 고르고, 첫 화면에서 바꿀 수 있게 한다.

### 4.3 분석 엔진 (Worker)

모든 언어 추출기는 같은 중간 형태를 낸다: `{ nodes: [{ id, name, kind, lines, functions, maxComplexity, complexity }], edges: [{ from, to, weight, kinds }], entryRefs }`.

| 모듈 | 내용 |
|---|---|
| `parsers/php` | 선언(클래스/인터페이스/트레이트/enum)과 `namespace`·`use` 해석 후, 이름 참조를 종류별로 분류: 생성자 주입, 타입, 정적 호출, new, 상수, `::class`, 상속, 구현, 트레이트, catch, instanceof, 어트리뷰트 |
| `parsers/ts` | import / type-import / dynamic-import / re-export / require 추출 |
| `resolve/php` | 프로젝트 안에서 선언된 클래스 전체 이름 → 파일. 외부 패키지 참조는 버림 |
| `resolve/ts` | 상대경로, 확장자·`index` 보완, `tsconfig`/`jsconfig` 의 `baseUrl`·`paths`(주석 허용 JSON, `extends` 추적) |
| `framework/laravel` | 이벤트→리스너(`$listen` 배열), 컨테이너 바인딩(`bind`/`singleton`/`scoped` 및 Provider 의 `A::class => B::class` 맵), `routes/*.php` 에서의 참조 수 |
| `framework/react` | 라우트 폴더(`src/routes`, `src/pages`, `app/`)에서의 참조 수. 생성 파일(`*.gen.ts`)은 기본 제외 |
| `metrics` | 줄 수, 함수 수, 함수별 순환 복잡도(분기 노드 수 + 1)와 최대값·합계; fan-in, fan-out, 불안정도 = fo/(fi+fo), PageRank(평균 1.0 배수), 역방향 의존(강: 도메인·기반 → 애플리케이션·진입점, 약: 기반 → 도메인; 바인딩·이벤트 간선은 제외), 참조 없음 |
| `presets` | 역할 = 경로 패턴(`*` 한 폴더, `**/` 여러 폴더, 앞부분 일치, 먼저 맞는 규칙 우선) + 4계층 배치 + 역할 설명 + 선택적 색 |

진행 이벤트(단계, 처리한 파일 수, 현재 파일, 파일별 역할)를 메인 스레드로 보내 로딩 화면이 건물을 하나씩 올린다. 파싱에 실패한 파일은 목록에 모으고 분석은 계속한다.

### 4.4 역할 프리셋 (공개 관례 기반)

- Laravel: `Http/Controllers`, `Http/Middleware`, `Http/Requests`, `Http/Resources`, `Console`, `Providers`(진입점) / `Jobs`, `Listeners`, `Observers`, `Mail`, `Notifications`, `Policies`, `Actions`, `Services`(애플리케이션) / `Models`, `Events`, `Repositories`(도메인·인프라) / `Enums`, `Exceptions`, `Casts`, `Rules`, 기타(기반).
- React: `routes/`·`pages/`·`app/`, `layouts/`, 진입 파일(진입점) / `features/**`, `components/**/hooks/`, 기능 컴포넌트, `hooks/`(화면·기능) / `store`·`atoms`·`state`, `services`·`api`, API 클라이언트(상태·API) / `components/ui`, 공용 컴포넌트, `types`, `constants`, `utils`·`lib`(기반).
- 설명 문구는 프레임워크 일반 설명만 쓴다.

### 4.5 캐시 (IndexedDB)

- 저장: 분석 결과(노드·간선·지표·역할·레포 이름·분석 시각)만. 소스 본문은 저장하지 않는다.
- Chrome·Edge: `FileSystemDirectoryHandle` 도 함께 저장해, 캐시에서 연 뒤 "코드 보기" 때 권한만 다시 묻는다.
- 키: 폴더 이름 + (파일 경로·크기·수정 시각) 요약 해시. 다시 넣었을 때 달라졌으면 새로 분석해 덮어쓴다.
- 첫 화면에 저장 날짜 표시와 개별/전체 "캐시 지우기".
- 주의: `*.github.io` 사용자 사이트 아래의 Pages 는 같은 origin 을 공유한다. 전용 도메인을 쓰지 않으면 같은 계정의 다른 Pages 가 이 저장소를 읽을 수 있다.

## 5. 화면

공통: 한국어 문구, 지표마다 한 줄 풀이, 다크 글래스 패널(탐색기는 기존처럼 밝은 톤), 역할 색 팔레트 통일(프리셋 색 → 없으면 계층 색조 자동 배색).

1. **첫 화면 (시안 A)**: 가운데 큰 드롭존 + "폴더 선택" 버튼 + "파일은 브라우저 밖으로 나가지 않아요" 문구, 지원 언어 표시, 아래에 최근 분석 카드(레포명·프레임워크·파일 수·날짜)와 캐시 지우기.
2. **로딩 화면 (시안 B)**: 왼쪽에 4단계 목록(파일 찾기 N개 → 코드 읽기 N/전체 → 참조 연결 → 도시 짓기), 진행률 바, 현재 파일 경로, 예상 남은 시간, 취소. 오른쪽에 파싱된 파일마다 역할 색 건물이 하나씩 솟는 Three.js 미리보기. 완료되면 도시 화면으로 전환.
3. **분석 화면**: 상단 바(레포 정보, 탭: 도시·그래프·탐색기, 다시 분석, cc.json 내려받기, 다른 레포 열기). 탭 전환은 다시 로드하지 않는다.
   - 3D 의존성 도시(기본 탭): 계층 = 도로로 나뉜 줄, 역할 = 블록, 파일 = 건물. 높이·색 드롭다운(기본 높이 fan-in, 기본 색 역할). 클릭 시 참조 아치선(파랑 나를 쓰는 곳, 주황 내가 쓰는 것, 빨강 역방향), 흐르는 점선, 무관한 건물 어둡게. 오른쪽 패널에 지표 8칸(fan-in, fan-out, 중심도, 불안정도, 진입점 참조, 함수 수, 함수 최대 복잡도, 줄 수)과 양방향 목록. 코드 보기(문법 강조, 줄 번호, 참조 이름 링크 → 해당 건물). 검색(`/`), 역할 토글, `#file=경로&code` 딥링크.
   - 3D 그래프: 점 = 파일(크기 fan-in, 색 역할), 계층·역할별 force 배치, 이웃만 보기, 역방향 강조.
   - 아키텍처 탐색기: 요약 카드, 계층 지도(SVG), 역할 간 의존 행렬, 질문별 파일 순위 탭, 파일 상세(자동 해석 문장).
   - VS Code 열기: 처음 누를 때 로컬 경로를 한 번 입력받아 레포별로 localStorage 에 기억.

## 6. 오류 처리

| 상황 | 동작 |
|---|---|
| 지원 언어 파일이 없음 | 첫 화면에 안내 |
| 일부 파일 파싱 실패 | 분석 계속, 완료 후 실패 목록 |
| 폴더 권한 거부 / 캐시에서 열었는데 폴더가 없음 | 코드 보기만 비활성화, 다시 연결 버튼 |
| 파일 20,000 개 초과 | 분석 전 경고, 소스 폴더 좁히기 선택 |
| 분석 중 취소 | Worker 종료, 첫 화면으로 |
| WebGL 미지원 | 탐색기 탭만 열고 안내 |

## 7. 테스트

- 엔진 단위 테스트(Vitest): 직접 만든 PHP·TS 예제로 참조 종류, 경로 별칭 해석, Laravel 숨은 연결, 지표 계산, 역할 패턴 매칭.
- 실제 레포 대조: `scripts/compare.ts <폴더>` 가 엔진을 Node 에서 돌려 요약(파일 수, 간선 수, 역방향 수, 간선 차이 목록)을 `.local/` 에 쓴다. 기준값(기존 docker 파이프라인 결과)도 `.local/` 에만 둔다. 기준과 파일·간선 수가 일치하거나 차이 원인이 설명되어야 통과.
- 화면 확인: 헤드리스 Chrome(WebGL 은 swiftshader, CDP 로 대기 후 캡처)으로 첫 화면·로딩·도시·그래프·탐색기 스크린샷, 콘솔 오류 없음.
- 보고: "확인한 것 / 직접 눌러 봐야 하는 것"을 나눈다.

## 8. 배포

- GitHub Actions 로 빌드한 정적 파일만 GitHub Pages 에 배포.
- 푸시 전 정리: 기존 로컬 커밋에 들어 있는 레포별 설정(`repos/*.json`)을 이력에서 제거하고, 기존 docker 파이프라인(`tools/codecity`, `site/`, `composer.*`, dependency-cruiser)은 대조 검증이 끝난 뒤 삭제한다. 각각 실행 전에 사용자 확인.
- 푸시·Pages 활성화는 실행 시점에 사용자 확인.
