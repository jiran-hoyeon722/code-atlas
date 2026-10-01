# code-atlas

**코드베이스를 3D 도시로 보여주는 브라우저 앱.**
레포 폴더를 고르면 파일 간 의존 관계를 분석해서, 어떤 파일이 핵심이고 어디가 얽혀 있는지 한눈에 보여줍니다.

- **설치·서버 없음** — 분석은 전부 브라우저 안에서 끝나고, 코드는 밖으로 나가지 않습니다.
- **로컬 폴더 또는 GitHub 공개 레포** — 내 레포가 없으면 주소를 넣거나 미리 분석한 샘플을 열어 보면 됩니다.
- **지원 언어** — TypeScript/JavaScript, PHP. React·Laravel 프로젝트는 폴더 구조로 역할을 자동 분류합니다.

## 무엇을 보여주나

| 화면 | 보여주는 것 |
|---|---|
| **의존성 도시** (메인) | 파일 = 건물. 높이는 많이 쓰이는 정도(fan-in), 색은 역할. 건물을 누르면 참조 관계가 아치선으로 이어지고 코드를 바로 볼 수 있습니다. |
| **3D 그래프** | 파일을 점으로, 의존을 선으로 그린 네트워크. 이웃만 골라 보거나 역방향 의존을 강조합니다. |
| **아키텍처 탐색기** | 요약 카드, 계층 지도, 역할 간 의존 행렬, "어디부터 봐야 하나" 같은 질문별 파일 순위. |
| **코드시티GTA** (실험) | 도시를 직접 걸어 다니며 건물에 들어가 코드를 보는 게임 모드. |

## 이렇게 읽습니다

```
계층 (진입점 → 화면·기능 → 상태·API → 기반)  =  도로로 나뉜 구역
역할 (Controller, 훅, Model …)               =  블록
파일                                          =  건물
```

- **높은 건물** — 여러 곳에서 가져다 쓰는 파일. 바꾸면 영향이 큽니다.
- **빨간 선** — 아래 계층이 위 계층을 참조하는 역방향 의존. 구조가 꼬인 지점입니다.

## 시작하기

```bash
npm install
npm run dev        # http://localhost:5173
```

폴더 선택은 Chrome·Edge 에서 가장 매끄럽게 동작합니다(File System Access API 사용).

| 명령 | 용도 |
|---|---|
| `npm run build` / `npm run preview` | 정적 빌드와 미리보기 |
| `npx vitest run` | 테스트 |
| `npx tsc --noEmit` · `npm run typecheck:engine` | 타입 체크 |
| `npm run e2e` | 브라우저 E2E (설치된 Chrome 필요) |
| `npm run samples` | 공개 레포 샘플 다시 만들기 |

## 구조

```
src/engine     분석 엔진 (Web Worker 에서 실행, tree-sitter 로 파싱)
src/app        세션·폴더 읽기·Worker 연결
src/storage    분석 결과 캐시 (IndexedDB)
src/features   화면 (landing, city, graph, explorer, walk …)
tests          엔진·앱 테스트
```

기술 스택: React 19 · Three.js · web-tree-sitter(WASM) · Vite

## 보안과 개인정보

- 분석 대상 코드는 브라우저 메모리에서만 다룹니다. 캐시에는 **분석 결과만** 저장하고 소스 본문은 저장하지 않습니다.
- 외부 통신은 사용자가 고른 GitHub 공개 레포를 내려받을 때만 일어납니다(`api.github.com`, `raw.githubusercontent.com`). CSP 로 그 외 연결을 막습니다.
- 파일 경로·코드 내용은 화면에 넣기 전에 항상 escape 합니다.
