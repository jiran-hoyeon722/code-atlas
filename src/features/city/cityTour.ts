export interface TourStep {
  title: string;
  /** Plain text; **word** is shown in bold. */
  body: string;
  /** Building to fly to and select; null shows the whole city. */
  focus: number | null;
  /** City pieces (data-el names) to light up while this step shows. */
  spot: string[];
}

export const TOUR_KEY = 'code-atlas.city.tour-seen';

interface Pick { i: number; name: string; count: number }

export interface TourInput {
  name: string;
  files: number;
  layers: string[];
  /** The entry-layer file that pulls in the most others. */
  entry: Pick | null;
  /** The file the most others rely on. */
  hub: Pick | null;
}

const n = (v: number) => v.toLocaleString('ko-KR');

export function cityTour({ name, files, layers, entry, hub }: TourInput): TourStep[] {
  const steps: TourStep[] = [{
    title: '건물 하나가 파일 하나예요',
    body: `**${name}** 의 파일 ${n(files)}개를 건물로 세웠어요. **높을수록 많이 쓰이는 파일**이고, 같은 색은 같은 역할이에요. 도로는 앞줄부터 **${layers.join(' → ')}** 순서로 계층을 나눠요.`,
    focus: null,
    spot: ['legend'],
  }];
  if (entry) {
    steps.push({
      title: `진입점 — ${entry.name}`,
      body: `요청이나 화면이 처음 들어오는 파일이에요. **주황 선**이 이 파일이 쓰는 ${n(entry.count)}개 파일로 이어지고, 점선이 흐르는 방향이 참조 방향이에요.`,
      focus: entry.i,
      spot: [],
    });
  }
  if (hub && hub.i !== entry?.i) {
    steps.push({
      title: `가장 많이 쓰이는 파일 — ${hub.name}`,
      body: `**파랑 선**은 이 파일을 쓰는 곳이에요. ${n(hub.count)}개 파일이 기대고 있어서 바꾸면 파급이 커요. 오른쪽 패널에서 **코드 보기**와 **폭발 반경**(바꾸면 영향받는 범위)을 볼 수 있어요.`,
      focus: hub.i,
      spot: ['panel'],
    });
  }
  steps.push({
    title: '이제 직접 둘러보세요',
    body: '건물을 클릭하면 참조선이 떠요. **/** 로 파일을 찾고, **높이·색** 메뉴로 다른 지표를 볼 수 있어요. 길을 잃으면 **Home** 으로 처음 시점에 돌아와요.',
    focus: null,
    spot: ['top'],
  });
  return steps;
}
