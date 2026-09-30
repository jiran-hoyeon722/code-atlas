import { useRef, useState, type DragEvent } from 'react';
import { LIMITS } from '../../../engine/battle/rules';
import type { Quality } from '../../../engine/battle/types';
import { codeLines, langLabel } from './format';
import type { SlotState } from './useSlot';

export type Side = 'a' | 'b';

const WARNING: Record<Quality['warnings'][number], string> = {
  shaky: '코드가 적어 결과가 흔들릴 수 있어요',
  'excluded-heavy': `측정에서 뺀 코드가 ${Math.round(LIMITS.excludedWarn * 100)}%를 넘어요`,
};

export interface RepoCardProps {
  side: Side;
  state: SlotState;
  hasPicker: boolean;
  onPickNative(): void;
  onFiles(files: FileList): void;
  onDrop(items: DataTransferItemList): void;
  onReset(): void;
}

function Body({ state, onPick, onStop, onAgain }: { state: SlotState; onPick(): void; onStop(): void; onAgain(): void }) {
  switch (state.kind) {
    case 'empty':
      return (
        <div className="rb-card-body rb-card-center">
          <p className="rb-card-title">레포 폴더를 골라 주세요</p>
          <p className="rb-card-sub">폴더를 여기로 끌어다 놓아도 돼요</p>
          <button type="button" className="rb-btn rb-btn-secondary" onClick={onPick}>폴더 고르기</button>
        </div>
      );
    case 'reading': {
      const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
      return (
        <div className="rb-card-body rb-card-center" aria-live="polite">
          <p className="rb-card-title">{state.total === null ? '폴더를 살펴보는 중이에요' : `파일 ${state.total.toLocaleString('ko-KR')}개 읽는 중`}</p>
          <div className="rb-progress" role="progressbar" aria-label="파일 읽기" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="rb-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="rb-card-sub">{state.total === null ? '코드 파일을 찾고 있어요' : `${state.done.toLocaleString('ko-KR')} / ${state.total.toLocaleString('ko-KR')}`}</p>
          <button type="button" className="rb-btn rb-btn-secondary" onClick={onStop}>그만두기</button>
        </div>
      );
    }
    case 'measuring':
      return (
        <div className="rb-card-body rb-card-center" aria-live="polite">
          <p className="rb-card-title">품질을 재는 중</p>
          <p className="rb-card-sub">{state.step}</p>
          <button type="button" className="rb-btn rb-btn-secondary" onClick={onStop}>그만두기</button>
        </div>
      );
    case 'ready': {
      const q = state.quality;
      return (
        <div className="rb-card-body">
          <div className="rb-card-repo">
            <p className="rb-card-name" title={q.name}>{q.name}</p>
            <p className="rb-card-sub">{`${langLabel(q.lang)} · ${codeLines(q.totals.prodLines)}`}</p>
          </div>
          {q.warnings.length > 0 && (
            <ul className="rb-chips" aria-label="주의할 점">
              {q.warnings.map((w) => (
                <li key={w} className="rb-chip">
                  <span className="rb-warn-dot" aria-hidden="true" />
                  {WARNING[w] ?? w}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="rb-btn rb-btn-secondary rb-card-again" onClick={onAgain}>다시 고르기</button>
        </div>
      );
    }
    case 'error':
      return (
        <div className="rb-card-body rb-card-center" role="alert">
          <p className="rb-card-title">
            <span className="rb-warn-dot" aria-hidden="true" />
            {state.message}
          </p>
          {state.detail && <p className="rb-card-sub">{state.detail}</p>}
          <button type="button" className="rb-btn rb-btn-secondary" onClick={onAgain}>다시 고르기</button>
        </div>
      );
  }
}

export function RepoCard({ side, state, hasPicker, onPickNative, onFiles, onDrop, onReset }: RepoCardProps) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const label = side === 'a' ? '레포 A' : '레포 B';
  const busy = state.kind === 'reading' || state.kind === 'measuring';

  const pick = () => (hasPicker ? onPickNative() : input.current?.click());

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    if (busy) return;
    depth.current++;
    setOver(true);
  };
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = busy ? 'none' : 'copy';
  };
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  };
  const onDropCard = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    if (!busy && e.dataTransfer?.items) onDrop(e.dataTransfer.items);
  };

  return (
    <section
      className={`rb-card rb-card-${side}${over ? ' rb-card-over' : ''}`}
      aria-label={label}
      data-state={state.kind}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDropCard}
    >
      <h2 className="rb-card-head">
        <span className={`rb-dot rb-dot-${side}`} aria-hidden="true" />
        {label}
      </h2>
      <Body
        state={state}
        onPick={pick}
        onStop={onReset}
        onAgain={() => {
          onReset();
          pick();
        }}
      />
      <input
        ref={input}
        type="file"
        className="rb-hidden-input"
        data-testid={`folder-input-${side}`}
        tabIndex={-1}
        aria-hidden="true"
        // non-standard attributes React does not know about
        {...{ webkitdirectory: '', directory: '' }}
        multiple
        onChange={(e) => {
          const files = e.currentTarget.files;
          if (files) onFiles(files);
          e.currentTarget.value = '';
        }}
      />
    </section>
  );
}
