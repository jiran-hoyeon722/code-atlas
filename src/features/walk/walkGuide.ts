export interface GuideStep {
  title: string;
  /** Plain text; **word** is shown in bold. */
  body: string;
  keys: [string, string][];
  /** HUD pieces (data-el names) to light up while this step shows. */
  spot: string[];
  art: string;
}

export const GUIDE_KEY = 'code-atlas.walk.guide-seen';

const svg = (body: string) => `<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const GUIDE: GuideStep[] = [
  {
    title: '여기는 당신의 코드시티예요',
    body: '올린 소스코드로 만든 도시예요. **건물 하나 = 파일 하나**, 같은 색 구역은 같은 역할이고, **높은 건물일수록 많이 쓰이는 파일**이에요. 왼쪽 아래 지도로 도시 전체를 볼 수 있어요.',
    keys: [['W A S D', '이동'], ['Shift', '달리기'], ['클릭', '시점 돌리기']],
    spot: ['map'],
    art: svg('<path d="M6 56h52"/><rect x="10" y="30" width="10" height="26"/><rect x="24" y="14" width="14" height="42"/><rect x="42" y="24" width="12" height="32"/><path d="M28 22h6M28 30h6M28 38h6M14 38h2M46 32h4M46 40h4"/>'),
  },
  {
    title: '건물에 들어가 코드 보기',
    body: '건물 **문 앞에서 E** 를 누르면 그 파일의 소스코드가 열려요. 찾는 파일이 있으면 **/** 를 눌러 이름을 치면 바로 그 앞으로 가요.',
    keys: [['E', '들어가기'], ['/', '파일 찾기'], ['Esc', '나오기']],
    spot: ['q'],
    art: svg('<rect x="12" y="8" width="40" height="48" rx="3"/><path d="M26 26l-6 6 6 6M38 26l6 6-6 6M34 22l-4 20"/>'),
  },
  {
    title: '라이벌 4명을 잡으세요',
    body: '무기를 든 **라이벌 4명**이 도시 곳곳에 나타나 돌아다녀요. 위쪽 막대에서 남은 라이벌을 확인하고, 모두 쓰러뜨리면 보상으로 **기관총과 폭탄을 단 헬기**가 내려와요.',
    keys: [['F · 클릭', '공격'], ['H', '헬기 타기']],
    spot: ['rivals'],
    art: svg('<circle cx="32" cy="32" r="20"/><circle cx="32" cy="32" r="8"/><path d="M32 4v10M32 50v10M4 32h10M50 32h10"/>'),
  },
  {
    title: '날씨 · 무기 · 탈것',
    body: '**T** 로 날씨를 바꿔요. 처음엔 **주먹뿐**이에요 — 무기는 **길가와 건물 문 앞에서 빛나는 무기**를 밟고 지나가 주우세요. 주운 무기는 **1 ~ 0** 으로 골라요. 세워진 **차나 오토바이** 앞에서 E 로 운전하고, **지나가는 차**에 타면 그 차가 잇는 파일까지 데려다 줘요.',
    keys: [['T', '날씨'], ['1 ~ 0', '무기'], ['E', '운전 · 탑승']],
    spot: ['themes', 'weapons'],
    art: svg('<path d="M8 44h48v-8l-6-10H22l-8 10H8z"/><circle cx="20" cy="46" r="5"/><circle cx="46" cy="46" r="5"/><circle cx="46" cy="12" r="5"/><path d="M46 2v2M46 20v2M36 12h2M54 12h2"/>'),
  },
  {
    title: '바이러스 모드',
    body: '**V** 로 시작하면 한 건물에서 바이러스가 퍼지고 좀비가 몰려와요. **초록 빛기둥이 솟은 근원지** 앞에서 E 를 누르고 버티면 클리어예요. 도시가 다 감염되면 **거대 괴물**이 나타나고, 시간 안에 못 잡으면 **레포가 무너져 분석 기록이 지워져요.**',
    keys: [['V', '시작'], ['E', '백신 주입'], ['하 · 중 · 상', '난이도']],
    spot: ['virus-btn', 'v-diff'],
    art: svg('<circle cx="32" cy="32" r="12"/><path d="M32 6v8M32 50v8M6 32h8M50 32h8M13 13l6 6M45 45l6 6M13 51l6-6M45 19l6-6"/><circle cx="28" cy="29" r="1.5" fill="currentColor"/><circle cx="36" cy="35" r="1.5" fill="currentColor"/>'),
  },
];

/** Escapes the text, then turns **word** into bold. */
export function guideHtml(body: string, esc: (s: string) => string): string {
  return esc(body).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}
