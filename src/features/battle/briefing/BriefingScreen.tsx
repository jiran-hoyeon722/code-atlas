import { useEffect, useMemo, useRef, useState } from 'react';
import { PREDICTION_RUNS } from '../../../engine/battle/rules';
import type { Prediction } from '../../../engine/battle/sim/types';
import type { Quality } from '../../../engine/battle/types';
import type { BattleDeps } from '../deps';
import { Field } from './Field';
import { briefingView, type CountsView, type SideView } from './view';
import './briefing.css';

export interface BriefingScreenProps {
  deps: BattleDeps;
  a: Quality;
  b: Quality;
  match: number;
  /** Prediction kept from an earlier visit; the screen runs one when null. */
  prior: Prediction | null;
  onPrior(p: Prediction): void;
  onMatch(match: number): void;
  onBack(): void;
  onStart(): void;
}

type Run = { kind: 'running'; done: number; runs: number } | { kind: 'error' } | { kind: 'done' };

function Counts({ counts, run, names, onRetry }: { counts: CountsView | null; run: Run; names: [string, string]; onRetry(): void }) {
  if (counts) {
    const pct = (n: number) => `${(n / Math.max(1, counts.runs)) * 100}%`;
    return (
      <section className="rb-brief-counts" data-state="done" aria-label={`시뮬레이션 ${counts.runs}번 중 이긴 횟수`}>
        <p className="rb-brief-caption">{`시뮬레이션 ${counts.runs}번 중 이긴 횟수`}</p>
        <div className="rb-brief-score">
          <div className="rb-brief-team rb-brief-team-a">
            <p className="rb-brief-team-name" title={names[0]}>{names[0]}</p>
            <p className="rb-brief-num">{counts.a}<span>번</span></p>
          </div>
          <div className="rb-brief-verdict">
            <p>{counts.verdict}</p>
            {counts.draws > 0 && <p className="rb-brief-draws">{`비김 ${counts.draws}번`}</p>}
          </div>
          <div className="rb-brief-team rb-brief-team-b">
            <p className="rb-brief-team-name" title={names[1]}>{names[1]}</p>
            <p className="rb-brief-num">{counts.b}<span>번</span></p>
          </div>
        </div>
        <div className="rb-brief-split" aria-hidden="true">
          {counts.a > 0 && <div className="rb-brief-split-a" style={{ width: pct(counts.a) }} />}
          {counts.draws > 0 && <div className="rb-brief-split-draw" style={{ width: pct(counts.draws) }} />}
          {counts.b > 0 && <div className="rb-brief-split-b" />}
        </div>
      </section>
    );
  }
  if (run.kind === 'error') {
    return (
      <section className="rb-brief-counts" data-state="error" role="alert">
        <p className="rb-brief-caption">
          <span className="rb-warn-dot" aria-hidden="true" />
          시뮬레이션을 돌리지 못했어요
        </p>
        <button type="button" className="rb-btn rb-btn-secondary" onClick={onRetry}>다시 돌리기</button>
      </section>
    );
  }
  const runs = run.kind === 'running' ? run.runs : PREDICTION_RUNS;
  const done = run.kind === 'running' ? run.done : 0;
  const pct = Math.round((done / Math.max(1, runs)) * 100);
  return (
    <section className="rb-brief-counts" data-state="running" aria-live="polite">
      <p className="rb-brief-caption">{`시뮬레이션 ${runs}번 돌리는 중 · ${done}/${runs}`}</p>
      <div className="rb-brief-wait" role="progressbar" aria-label="시뮬레이션" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div style={{ width: `${pct}%` }} />
      </div>
    </section>
  );
}

function SideCard({ view }: { view: SideView }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const panelId = `rb-brief-config-${view.side}`;
  return (
    <section className={`rb-brief-side rb-brief-side-${view.side}`} aria-label={view.name}>
      <div className="rb-brief-side-head">
        <div className="rb-brief-side-title">
          <span className={`rb-dot rb-dot-${view.side}`} aria-hidden="true" />
          <h2 className="rb-brief-side-name" title={view.name}>{view.name}</h2>
        </div>
        <div className="rb-brief-side-meta">
          <p className="rb-brief-side-sub">{view.sub}</p>
          <button
            ref={toggle}
            type="button"
            className="rb-brief-config-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
          >
            측정 설정
          </button>
        </div>
        {view.warnings.map((w) => (
          <p key={w} className="rb-brief-warn">
            <span className="rb-warn-dot" aria-hidden="true" />
            {w}
          </p>
        ))}
      </div>
      <ul className="rb-brief-rows" aria-label="품질 지표">
        {view.rows.map((r) => (
          <li key={r.key} className={`rb-brief-row${r.fill === null ? ' rb-brief-row-muted' : ''}`}>
            <div className="rb-brief-row-line">
              <span className="rb-brief-row-label">
                {r.label}
                {r.note && <span className="rb-brief-row-note">{r.note}</span>}
              </span>
              <span className="rb-brief-row-value">{r.value}</span>
            </div>
            {r.fill !== null && (
              <div className="rb-brief-bar" aria-hidden="true">
                <div style={{ width: `${r.fill * 100}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="rb-brief-commander">
        <span className="rb-brief-commander-label">커맨더</span>
        <span className="rb-brief-commander-name" title={view.commander}>{view.commander}</span>
      </div>
      {open && (
        <div className="rb-brief-config" id={panelId}>
          <div className="rb-brief-config-head">
            <h3>측정 설정</h3>
            <button
              type="button"
              className="rb-brief-config-toggle"
              onClick={() => {
                setOpen(false);
                toggle.current?.focus();
              }}
            >
              닫기
            </button>
          </div>
          <dl>
            <dt>소스 폴더</dt>
            <dd>{view.config.sourceDir}</dd>
            <dt>측정에서 뺀 파일</dt>
            <dd>{view.config.exclude.length ? view.config.exclude.map((p) => <code key={p}>{p}</code>) : '없음'}</dd>
            <dt>테스트로 본 파일</dt>
            <dd>{view.config.testPatterns.length ? view.config.testPatterns.map((p) => <code key={p}>{p}</code>) : '없음'}</dd>
            <dt>뺀 코드</dt>
            <dd>{view.config.excluded}</dd>
          </dl>
        </div>
      )}
    </section>
  );
}

export function BriefingScreen({ deps, a, b, match, prior, onPrior, onMatch, onBack, onStart }: BriefingScreenProps) {
  const [run, setRun] = useState<Run>(prior ? { kind: 'done' } : { kind: 'running', done: 0, runs: PREDICTION_RUNS });
  const [attempt, setAttempt] = useState(0);
  const view = useMemo(() => briefingView(a, b, prior, match), [a, b, prior, match]);

  useEffect(() => {
    if (prior) return;
    let alive = true;
    setRun({ kind: 'running', done: 0, runs: PREDICTION_RUNS });
    const job = deps.predict(a, b, (done, runs) => alive && setRun({ kind: 'running', done, runs }));
    job.result.then(
      (p) => {
        if (!alive) return;
        setRun({ kind: 'done' });
        onPrior(p);
      },
      () => alive && setRun({ kind: 'error' }),
    );
    return () => {
      alive = false;
      job.cancel();
    };
    // onPrior is a fresh closure each render; the job only depends on the pair and retries
  }, [deps, a, b, prior, attempt]);

  const [sa, sb] = view.sides;
  const squads = view.lanes.reduce((n, l) => n + l.a.length, 0);
  return (
    <div className="rb-screen rb-brief">
      <header className="rb-top">
        <h1 className="rb-brief-title" tabIndex={-1} data-screen-focus>
          <span className="rb-brand">레포 전쟁</span>{' '}
          <span className="rb-brief-match">{`대결 #${match}`}</span>
        </h1>
        <div className="rb-brief-actions">
          <button type="button" className="rb-btn rb-btn-ghost" onClick={onBack}>레포 다시 고르기</button>
          <button type="button" className="rb-btn rb-btn-quiet" onClick={() => onMatch(match + 1)}>다른 전개 보기</button>
        </div>
      </header>
      <main className="rb-brief-main" aria-label="작전 브리핑">
        <Counts counts={view.counts} run={run} names={[a.name, b.name]} onRetry={() => setAttempt((n) => n + 1)} />
        <div className="rb-brief-grid">
          <SideCard view={sa} />
          <section className="rb-brief-field" aria-label="부대 배치">
            <div className="rb-brief-field-head">
              <h2>부대 배치</h2>
              <p>{`양쪽 ${squads}개 부대 · ${view.lanes.length}개 레인`}</p>
            </div>
            <Field lanes={view.lanes} />
            <ul className="rb-brief-vanguard">
              {view.lanes.map((l) => (
                <li key={l.lane}>
                  <p className="rb-brief-vanguard-label">{l.label}</p>
                  <p className="rb-brief-vanguard-name" title={l.a[0]}>
                    <span className="rb-dot rb-dot-a" aria-hidden="true" />
                    <span>{l.a[0] ?? '없음'}</span>
                  </p>
                  <p className="rb-brief-vanguard-name" title={l.b[0]}>
                    <span className="rb-dot rb-dot-b" aria-hidden="true" />
                    <span>{l.b[0] ?? '없음'}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
          <SideCard view={sb} />
        </div>
        <div className="rb-brief-foot">
          <button type="button" className="rb-btn rb-btn-primary" disabled={!view.counts} onClick={onStart}>전투 시작하기</button>
          <p className="rb-note">{`대결 #${match} 로 싸워요. 다른 전개 보기를 누르면 운만 바뀌어요`}</p>
        </div>
      </main>
    </div>
  );
}
