import { useEffect, useRef, useState } from 'react';
import { LIMITS } from '../../../engine/battle/rules';
import type { Quality } from '../../../engine/battle/types';
import type { BattleAccess, BattleLoadStep, OpponentReadiness, OpponentSummary } from '../../viewer-env';
import { codeLines, langLabel } from '../format';
import { loadErrorText } from './loadError';
import './pick.css';

export const SELF_KEY = '@self';

export type SelfState = { kind: 'loading' } | { kind: 'ready'; quality: Quality } | { kind: 'error'; message: string };

export interface PickOpponentProps {
  access: BattleAccess;
  self: SelfState;
  onRetrySelf(): void;
  /** Opponents already loaded this session, so going back does not ask for permission again. */
  loaded: Map<string, Quality>;
  onChoose(key: string, b: Quality): void;
}

export const READINESS_TEXT: Record<OpponentReadiness, string> = {
  ready: '바로 싸울 수 있어요',
  'needs-permission': '폴더 읽기 권한을 한 번 더 물어봐요',
  refetch: 'GitHub 에서 다시 받아요',
  reanalyze: '폴더를 다시 열어 분석해야 해요',
};

export const STEP_TEXT: Record<BattleLoadStep, string> = {
  permission: '폴더 권한 확인 중',
  reading: '파일 읽는 중',
  measuring: '품질 재는 중',
};

const WARNING: Record<Quality['warnings'][number], string> = {
  shaky: '코드가 적어 결과가 흔들릴 수 있어요',
  'excluded-heavy': `측정에서 뺀 코드가 ${Math.round(LIMITS.excludedWarn * 100)}%를 넘어요`,
};

type ListState = { kind: 'loading' } | { kind: 'ready'; list: OpponentSummary[] } | { kind: 'error' };
type Pending =
  | { key: string; kind: 'loading'; step: BattleLoadStep | null }
  | { key: string; kind: 'error'; message: string }
  | { key: string; kind: 'ready'; quality: Quality };

const fmt = (n: number) => n.toLocaleString('ko-KR');

function analyzedDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleDateString('ko-KR', { dateStyle: 'medium' })} 분석`;
}

function SelfCard({ name, self, onRetry }: { name: string; self: SelfState; onRetry(): void }) {
  return (
    <section className="rb-pick-self" aria-label="A · 지금 연 레포" data-state={self.kind}>
      <h2 className="rb-pick-label">
        <span className="rb-dot rb-dot-a" aria-hidden="true" />
        A · 지금 연 레포
      </h2>
      <p className="rb-pick-self-name" title={name}>{name}</p>
      {self.kind === 'loading' && (
        <div className="rb-pick-self-wait" role="status">
          <p className="rb-pick-sub">품질 데이터를 불러오는 중이에요</p>
          <div className="rb-pick-bar" aria-hidden="true">
            <div />
          </div>
        </div>
      )}
      {self.kind === 'ready' && (
        <>
          <p className="rb-pick-sub">{`${langLabel(self.quality.lang)} · ${codeLines(self.quality.totals.prodLines)}`}</p>
          {self.quality.warnings.length > 0 && (
            <ul className="rb-pick-warns" aria-label="주의할 점">
              {self.quality.warnings.map((w) => (
                <li key={w}>
                  <span className="rb-warn-dot" aria-hidden="true" />
                  {WARNING[w] ?? w}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {self.kind === 'error' && (
        <div className="rb-pick-error" role="alert">
          <p>
            <span className="rb-warn-dot" aria-hidden="true" />
            {self.message}
          </p>
          <button type="button" className="rb-btn rb-btn-secondary" onClick={onRetry}>다시 시도</button>
        </div>
      )}
    </section>
  );
}

interface RowProps {
  title: string;
  meta: string | null;
  chip: string | null;
  status: string;
  tone: 'go' | 'ask' | 'off' | 'busy';
  disabled: boolean;
  onPick(): void;
  error: string | null;
  onRetry(): void;
}

function Row({ title, meta, chip, status, tone, disabled, onPick, error, onRetry }: RowProps) {
  return (
    <li className="rb-pick-item">
      <button type="button" className="rb-pick-row" data-tone={tone} disabled={disabled} onClick={onPick}>
        <span className="rb-pick-row-main">
          <span className="rb-pick-row-title">
            <span className="rb-pick-row-name" title={title}>{title}</span>
            {chip && <span className="rb-pick-chip">{chip}</span>}
          </span>
          {meta && <span className="rb-pick-row-meta">{meta}</span>}
        </span>
        <span className="rb-pick-row-status" aria-live={tone === 'busy' ? 'polite' : undefined}>{status}</span>
      </button>
      {error && (
        <div className="rb-pick-row-error" role="alert">
          <p>
            <span className="rb-warn-dot" aria-hidden="true" />
            {error}
          </p>
          <button type="button" className="rb-btn rb-btn-secondary" onClick={onRetry}>다시 시도</button>
        </div>
      )}
    </li>
  );
}

export function PickOpponent({ access, self, onRetrySelf, loaded, onChoose }: PickOpponentProps) {
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [listAttempt, setListAttempt] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const req = useRef(0);
  const alive = useRef(true);
  const choose = useRef(onChoose);
  choose.current = onChoose;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    setList({ kind: 'loading' });
    access.listOpponents().then(
      (all) => live && setList({ kind: 'ready', list: all.filter((o) => o.key !== access.self.key) }),
      () => live && setList({ kind: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [access, listAttempt]);

  useEffect(() => {
    if (pending?.kind === 'ready' && self.kind === 'ready') choose.current(pending.key, pending.quality);
  }, [pending, self]);

  const load = (key: string) => {
    const hit = loaded.get(key);
    if (hit) {
      setPending({ key, kind: 'ready', quality: hit });
      return;
    }
    const id = ++req.current;
    const current = () => alive.current && req.current === id;
    setPending({ key, kind: 'loading', step: null });
    access
      .loadOpponent(key, (step) => current() && setPending({ key, kind: 'loading', step }))
      .then(
        (quality) => {
          if (!current()) return;
          loaded.set(key, quality);
          setPending({ key, kind: 'ready', quality });
        },
        (e: unknown) => current() && setPending({ key, kind: 'error', message: loadErrorText(e) }),
      );
  };

  const busy = pending?.kind === 'loading';
  const statusOf = (key: string, idle: string): { status: string; tone: RowProps['tone'] | null; error: string | null } => {
    if (pending?.key !== key) return { status: idle, tone: null, error: null };
    if (pending.kind === 'loading') return { status: pending.step ? STEP_TEXT[pending.step] : '불러오는 중', tone: 'busy', error: null };
    if (pending.kind === 'error') return { status: idle, tone: null, error: pending.message };
    return { status: self.kind === 'ready' ? '준비됐어요' : '준비됐어요 · A 를 기다리는 중', tone: 'busy', error: null };
  };

  const selfRow = statusOf(SELF_KEY, self.kind === 'ready' ? READINESS_TEXT.ready : 'A 를 불러오면 고를 수 있어요');

  let rest;
  if (list.kind === 'loading') {
    rest = (
      <li className="rb-pick-note" role="status">
        등록된 레포를 찾는 중이에요
      </li>
    );
  } else if (list.kind === 'error') {
    rest = (
      <li className="rb-pick-row-error" role="alert">
        <p>
          <span className="rb-warn-dot" aria-hidden="true" />
          등록된 레포 목록을 불러오지 못했어요
        </p>
        <button type="button" className="rb-btn rb-btn-secondary" onClick={() => setListAttempt((n) => n + 1)}>다시 시도</button>
      </li>
    );
  } else if (list.list.length === 0) {
    rest = <li className="rb-pick-note">다른 레포를 한 번 분석하면 여기서 고를 수 있어요</li>;
  } else {
    rest = list.list.map((o) => {
      const off = o.readiness === 'reanalyze';
      const st = statusOf(o.key, READINESS_TEXT[o.readiness]);
      return (
        <Row
          key={o.key}
          title={o.name}
          meta={`${langLabel(o.lang)} · 파일 ${fmt(o.files)}개 · ${analyzedDate(o.analyzedAt)}`}
          chip={o.source === 'github' ? 'GitHub' : '로컬'}
          status={st.status}
          tone={st.tone ?? (off ? 'off' : o.readiness === 'ready' ? 'go' : 'ask')}
          disabled={off || busy}
          onPick={() => load(o.key)}
          error={st.error}
          onRetry={() => load(o.key)}
        />
      );
    });
  }

  return (
    <div className="rb-screen rb-pick">
      <header className="rb-top">
        <h1 className="rb-brand" tabIndex={-1} data-screen-focus>레포 전쟁</h1>
      </header>
      <main className="rb-pick-main">
        <div className="rb-pick-intro">
          <p className="rb-pick-lead">코드 양이 아니라 품질로 싸워요</p>
          <p className="rb-pick-sub">읽기 쉬운 함수, 얽히지 않은 구조, 복붙 없는 코드, 테스트가 군대의 힘이 돼요</p>
        </div>
        <div className="rb-pick-grid">
          <SelfCard name={access.self.name} self={self} onRetry={onRetrySelf} />
          <section className="rb-pick-list" aria-label="B · 상대 고르기">
            <h2 className="rb-pick-label">
              <span className="rb-dot rb-dot-b" aria-hidden="true" />
              B · 상대 고르기
            </h2>
            <ul className="rb-pick-rows">
              <Row
                title="자기 자신과 대결"
                meta="지금 연 레포를 양쪽에 세워요"
                chip={null}
                status={selfRow.status}
                tone={selfRow.tone ?? (self.kind === 'ready' ? 'go' : 'off')}
                disabled={self.kind !== 'ready' || busy}
                onPick={() => self.kind === 'ready' && setPending({ key: SELF_KEY, kind: 'ready', quality: self.quality })}
                error={null}
                onRetry={() => undefined}
              />
              {rest}
            </ul>
          </section>
        </div>
        <p className="rb-note">코드는 이 브라우저 밖으로 나가지 않아요</p>
      </main>
    </div>
  );
}
