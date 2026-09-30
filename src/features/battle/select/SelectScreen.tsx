import type { Quality } from '../../../engine/battle/types';
import type { BattleDeps } from '../deps';
import { RepoCard } from './RepoCard';
import { useSlot } from './useSlot';
import './select.css';

export interface SelectScreenProps {
  deps: BattleDeps;
  initial?: { a: Quality; b: Quality };
  onBrief(a: Quality, b: Quality): void;
}

export function SelectScreen({ deps, initial, onBrief }: SelectScreenProps) {
  const a = useSlot(deps, initial?.a);
  const b = useSlot(deps, initial?.b);
  const hasPicker = deps.pickDirectory !== null;
  const ready = a.state.kind === 'ready' && b.state.kind === 'ready';

  return (
    <div className="rb-screen rb-select">
      <header className="rb-top">
        <h1 className="rb-brand" tabIndex={-1} data-screen-focus>레포 전쟁</h1>
      </header>
      <main className="rb-select-main">
        <div className="rb-select-intro">
          <p className="rb-select-lead">코드 양이 아니라 품질로 싸워요</p>
          <p className="rb-select-sub">두 레포를 고르면 읽기 쉬운 함수, 얽히지 않은 구조, 복붙 없는 코드, 테스트가 군대의 힘이 돼요</p>
        </div>
        <div className="rb-select-cards">
          {([['a', a], ['b', b]] as const).map(([side, slot]) => (
            <RepoCard
              key={side}
              side={side}
              state={slot.state}
              hasPicker={hasPicker}
              onPickNative={slot.pickNative}
              onFiles={slot.onFiles}
              onDrop={slot.onDrop}
              onReset={slot.reset}
            />
          ))}
        </div>
        <div className="rb-select-foot">
          <button
            type="button"
            className="rb-btn rb-btn-primary"
            disabled={!ready}
            onClick={() => {
              if (a.state.kind === 'ready' && b.state.kind === 'ready') onBrief(a.state.quality, b.state.quality);
            }}
          >
            작전 브리핑 보기
          </button>
          <p className="rb-note">코드는 이 브라우저 밖으로 나가지 않아요</p>
        </div>
      </main>
    </div>
  );
}
