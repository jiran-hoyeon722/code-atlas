# code-atlas

레포별 의존성·소스 구조를 시각화하는 사이트. 새 레포도 아래 패턴 그대로 만든다.

## 원칙 (반드시)

- 분석 대상 레포는 **읽기 전용**. 파일 쓰기·git 변경 금지. 분석 도구는 docker 로 돌리고 대상 레포는 `:ro` 로 마운트한다. 대상 레포에 도구·산출물을 두지 않는다.
- 산출물은 `site/<name>/`(웹 루트), 중간 산출물은 `.work/<name>/`. 둘 다 git 제외(`.gitignore`). 생성 데이터·소스 사본은 커밋하지 않는다.
- 로컬 서버는 `127.0.0.1` 에만 바인딩한다. 소스는 `sourceDir` 만 `:ro` 로 웹 루트 밖(`/srv/src/<name>`)에 마운트하고 nginx `alias` 로 `/<name>/src/` 에 연결한다. `site/` 안에 마운트 지점을 만들지 않는다.
- 배포·push·공개 범위 결정은 매번 사용자 확인. 소스 본문이 들어간 페이지는 접근 제한 없이 배포하지 않는다.

## 구조

| 경로 | 역할 |
|---|---|
| `repos/<name>.json` | 레포 설정: `path`, `language`(php / typescript / javascript), `extensions`, `sourceDir`, `routesDir`, `exclude`(생성 파일 등 정규식), `tsConfig`, `layers`, `roles`, `roleColors`, `roleWarnings`, `legacyImport` |
| `tools/codecity/build.sh <name>` | 전체 파이프라인 (한 명령으로 재생성) |
| `tools/codecity/serve.sh` | 빌드된 모든 레포를 `http://127.0.0.1:9400/` 에서 서빙 (nginx) |
| `tools/codecity/pages/` | city / graph / explorer 페이지 원본 (빌드 시 `site/<name>/` 로 복사) |
| `site/index.html` | 첫 화면 레포 목록 (`site/repos.json` 을 읽음) |

## 레포마다 만드는 것

1. 코드 지표 — 파일별 줄 수, 복잡도, 함수당 최대 복잡도 (CodeCharta unifiedparser).
2. git 지표 — 최근 6개월과 전체 이력 두 벌. 커밋 수, 작성자 수, fix 비율, temporal coupling.
3. 코드 의존성 — 언어별 추출기로 파일 간 참조와 참조 종류(주입/타입/정적 호출/new/상속/구현 등). 프레임워크의 숨은 연결(DI 바인딩, 이벤트→리스너) 보완. 라우트 등 진입점 참조 수. PHP 는 `deps.php`(nikic/php-parser, code-atlas 의 `vendor/`), JS/TS 는 `deps-js.mjs`(dependency-cruiser, code-atlas 의 `node_modules/`; 참조 종류 import / type-import / dynamic-import / re-export / require). 둘 다 같은 `deps.json` 형태를 낸다. 새 언어는 이 형태로 추출기를 추가하고 `build.sh` 의 `case` 에 연결한다.
4. 역할·계층 분류 — 경로 패턴으로 역할, 역할을 4계층(진입점 → 애플리케이션 → 도메인·인프라 → 기반)에 배치. `repos/<name>.json` 에 둔다. 패턴은 `sourceDir` 기준 앞부분 일치이고 `*`(한 폴더)·`**/`(여러 폴더) glob 을 쓸 수 있다(예: `components/**/hooks/`). 먼저 맞는 규칙이 이긴다. `roleColors` 에 없는 역할은 계층 색조로 자동 배색된다.
5. 파생 지표 — fan-in, fan-out, 불안정도 = fo/(fi+fo), PageRank 중심도(평균 1.0 배수), 역방향 의존(강: 도메인·기반 → 애플리케이션·진입점, 약: 기반 → 도메인), 핫스팟 = 최근 커밋 × 함수 최대 복잡도, 참조 없음 파일.
6. 리포트 — 핫스팟 Top 20, 레거시 패턴 잔존 파일 등 (`hotspots.md` / `hotspots.csv`).

## 레포마다 만드는 화면 (중요도 순)

1. **3D 의존성 도시 `city.html` (메인)** — 계층 = 도로로 나뉜 줄, 역할 = 블록, 파일 = 건물(블록 안은 경로순). 높이·색 지표 드롭다운(기본 높이 fan-in, 기본 색 역할, 레거시 역할은 튀는 색). 클릭 시 참조 아치선(파랑 = 나를 쓰는 곳, 주황 = 내가 쓰는 것, 빨강 = 역방향), 흐르는 점선으로 방향, 무관한 건물은 어둡게. 오른쪽 패널에 지표 8개·양방향 목록·코드 보기(문법 강조 + 줄 번호, 참조 클래스 이름은 링크 → 해당 건물로 이동). 검색(`/`), 역할 토글, `#file=경로&code` 딥링크.
2. **3D 그래프 `graph.html`** — 점 = 파일(크기 fan-in, 색 역할), 계층·역할별 force 배치, 이웃만 보기, 역방향 강조.
3. **아키텍처 탐색기 `explorer.html`** — 요약 카드, 계층 지도(SVG), 역할 간 의존 행렬, 질문별 파일 순위 탭, 파일 상세 패널(자동 해석 문장).
4. **CodeCharta 지도** — 질문별 프리셋 링크(리팩터 우선순위, 핫스팟, 버그 잦은 곳, 지식 쏠림, 레거시 전환, 3개월 전 대비 delta, 의존성 도시, 중심 파일).

공통 UI: 한국어 문구, 지표마다 한 줄 풀이, 다크 톤 글래스 패널, 역할 색 팔레트 통일, VS Code 열기 링크, 화면 간 상호 링크(레포 목록 포함).

## 검증 습관

- 페이지를 바꾸면 헤드리스 Chrome 으로 실제 렌더링을 스크린샷 확인한다 (WebGL 은 `--use-angle=swiftshader`, 별도 `--user-data-dir`). 3D 페이지는 `--virtual-time-budget` 이 애니메이션 루프 때문에 끝나지 않으므로 CDP 로 일정 시간 대기 후 캡처한다.
- 사용자에게 "확인한 것 / 직접 눌러봐야 하는 것"을 나눠서 보고한다.
