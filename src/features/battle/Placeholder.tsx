import type { Quality } from '../../engine/battle/types';

export interface StageProps {
  a: Quality;
  b: Quality;
  onBack(): void;
  onNext?(): void;
}

function Stage({ title, back, next, a, b, onBack, onNext }: StageProps & { title: string; back: string; next?: string }) {
  return (
    <div className="rb-screen rb-stage">
      <header className="rb-top">
        <h1 className="rb-brand" tabIndex={-1} data-screen-focus>{title}</h1>
        <button type="button" className="rb-btn rb-btn-secondary" onClick={onBack}>{back}</button>
      </header>
      <main className="rb-stage-main">
        <p className="rb-stage-vs">
          <span className="rb-stage-a">{a.name}</span>
          <span className="rb-stage-sep">대</span>
          <span className="rb-stage-b">{b.name}</span>
        </p>
        <p className="rb-note">이 화면은 준비 중이에요</p>
        {next && onNext && <button type="button" className="rb-btn rb-btn-primary rb-stage-next" onClick={onNext}>{next}</button>}
      </main>
    </div>
  );
}

export const BriefingScreen = (p: StageProps) => <Stage {...p} title="작전 브리핑" back="레포 다시 고르기" next="전투 시작하기" />;
export const BattleScreen = (p: StageProps) => <Stage {...p} title="전투" back="브리핑으로" next="결과 보기" />;
export const ResultScreen = (p: StageProps) => <Stage {...p} title="결과" back="레포 다시 고르기" />;
