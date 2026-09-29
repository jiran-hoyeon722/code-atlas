import type { Detection } from './detect';

export interface Layer {
  key: 'entry' | 'application' | 'domain' | 'foundation';
  label: string;
  hint: string;
}

export interface Role {
  name: string;
  layer: 0 | 1 | 2 | 3;
  patterns: string[];
  description: string;
  color?: string;
  warning?: string;
}

export interface Preset {
  layers: Layer[];
  roles: Role[];
}

const layers = (application: string, domain: string): Layer[] => [
  { key: 'entry', label: '진입점', hint: '요청·화면이 처음 들어오는 곳' },
  { key: 'application', label: application, hint: '진입점의 요청을 처리하는 작업 흐름' },
  { key: 'domain', label: domain, hint: '핵심 데이터와 외부 시스템 연동' },
  { key: 'foundation', label: '기반', hint: '어디서나 가져다 쓰는 공용 코드' },
];

const r = (name: string, layer: Role['layer'], patterns: string[], description: string): Role => ({ name, layer, patterns, description });

const LARAVEL_ROLES: Role[] = [
  r('Controller', 0, ['Http/Controllers/'], 'HTTP 요청을 받는 컨트롤러'),
  r('Middleware', 0, ['Http/Middleware/'], '요청이 컨트롤러에 닿기 전후에 실행되는 필터'),
  r('Request', 0, ['Http/Requests/'], '요청 데이터의 검증 규칙을 담은 폼 리퀘스트'),
  r('Resource', 0, ['Http/Resources/'], '모델을 응답 JSON 으로 변환하는 리소스'),
  r('Console', 0, ['Console/'], '아티즌 명령과 스케줄 작업'),
  r('Provider', 0, ['Providers/'], '서비스 컨테이너 바인딩과 부트스트랩'),
  r('Job', 1, ['Jobs/'], '큐에서 비동기로 실행되는 작업'),
  r('Listener', 1, ['Listeners/'], '이벤트를 받아 처리하는 리스너'),
  r('Observer', 1, ['Observers/'], '모델 생명주기 이벤트를 관찰하는 옵저버'),
  r('Mail', 1, ['Mail/'], '메일 발송 클래스'),
  r('Notification', 1, ['Notifications/'], '여러 채널로 보내는 알림'),
  r('Policy', 1, ['Policies/'], '모델별 권한 판단 정책'),
  r('Actions', 1, ['Actions/'], '하나의 업무 동작을 캡슐화한 액션 클래스'),
  r('Services', 1, ['Services/'], '업무 로직을 모은 서비스 클래스'),
  r('Model', 2, ['Models/'], 'DB 테이블에 대응하는 Eloquent 모델'),
  r('Event', 2, ['Events/'], '시스템에서 일어난 일을 알리는 이벤트'),
  r('Repository', 2, ['Repositories/'], '데이터 조회·저장을 감싼 저장소'),
  r('Enum', 3, ['Enums/'], '고정된 값의 집합'),
  r('Exception', 3, ['Exceptions/'], '사용자 정의 예외와 예외 처리'),
  r('Cast', 3, ['Casts/'], '모델 속성의 변환 규칙'),
  r('Rule', 3, ['Rules/'], '사용자 정의 검증 규칙'),
  r('기타', 3, [''], '위 역할에 속하지 않는 나머지 코드'),
];

// Order matters (first match wins): specific folders come before the broader `components/` role.
const REACT_ROLES: Role[] = [
  r('라우트/페이지', 0, ['routes/', 'pages/', 'app/'], '주소에 대응하는 화면과 라우팅 정의'),
  r('레이아웃', 0, ['layouts/'], '여러 화면이 공유하는 틀'),
  r('진입 파일', 0, ['main.tsx', 'main.ts', 'main.jsx', 'index.tsx', 'index.jsx', 'App.tsx', 'App.jsx'], '앱을 시작하고 최상위를 구성하는 파일'),
  r('기능 모듈', 1, ['features/'], '기능 단위로 묶인 화면·상태·로직'),
  r('기능 훅', 1, ['components/**/hooks/'], '컴포넌트 옆에 두는 전용 훅'),
  r('훅', 1, ['hooks/'], '여러 곳에서 쓰는 공용 커스텀 훅'),
  r('UI 컴포넌트', 3, ['components/ui/'], '버튼·입력창 같은 기본 UI 조각'),
  r('공용 컴포넌트', 3, ['components/common/', 'components/shared/', 'common/', 'shared/'], '여러 화면에서 재사용하는 컴포넌트'),
  r('기능 컴포넌트', 1, ['components/', 'containers/', 'views/', 'screens/'], '화면을 구성하는 컴포넌트'),
  r('상태 관리', 2, ['store/', 'stores/', 'atoms/', 'state/', 'contexts/', 'context/'], '전역 상태를 담는 저장소'),
  r('서비스/API', 2, ['services/', 'service/', 'api/', 'apis/'], '서버와 통신하는 호출 함수'),
  r('API 클라이언트', 2, ['client/', 'clients/', 'http/'], 'HTTP 클라이언트 설정과 공통 요청 처리'),
  r('타입', 3, ['types/', 'interfaces/', 'models/'], '타입과 인터페이스 정의'),
  r('상수', 3, ['constants/', 'config/'], '상수와 설정값'),
  r('유틸/라이브러리', 3, ['utils/', 'util/', 'lib/', 'helpers/'], '순수 함수와 공용 유틸'),
  r('기타', 3, [''], '위 역할에 속하지 않는 나머지 코드'),
];

const inner = (path: string, sourceDir: string) =>
  sourceDir === '' ? path : path.startsWith(sourceDir + '/') ? path.slice(sourceDir.length + 1) : path;

export function presetFor(detection: Detection, paths: string[]): Preset {
  if (detection.framework === 'laravel') return { layers: layers('애플리케이션', '도메인·인프라'), roles: LARAVEL_ROLES };
  if (detection.framework === 'react') return { layers: layers('화면·기능', '상태·API'), roles: REACT_ROLES };

  const folders: string[] = [];
  for (const p of paths) {
    if (detection.sourceDir !== '' && !p.startsWith(detection.sourceDir + '/')) continue;
    const rel = inner(p, detection.sourceDir);
    const i = rel.indexOf('/');
    if (i > 0 && !folders.includes(rel.slice(0, i))) folders.push(rel.slice(0, i));
  }
  return {
    layers: layers('애플리케이션', '도메인·인프라'),
    roles: [
      ...folders.map((f) => r(f, 3, [f + '/'], `${f} 폴더의 파일`)),
      r('기타', 3, [''], '폴더에 속하지 않는 루트 파일'),
    ],
  };
}

const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

export function compileRoles(roles: Role[]): (innerPath: string) => number {
  const matchers = roles.map((role) =>
    role.patterns.map(
      (pattern) =>
        new RegExp(
          '^' +
            pattern
              .split(/(\*\*\/|\*)/)
              .map((part) => (part === '**/' ? '(?:.*/)?' : part === '*' ? '[^/]*' : escape(part)))
              .join(''),
        ),
    ),
  );
  return (innerPath) => matchers.findIndex((ps) => ps.some((re) => re.test(innerPath)));
}
