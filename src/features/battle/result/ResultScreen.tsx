import { useEffect, useMemo, useRef, useState } from 'react';
import { buildCommentary, type CommentaryEntry } from '../../../engine/battle/commentary';
import type { FixCandidate } from '../../../engine/battle/fixes';
import { ARMY, PREDICTION_RUNS } from '../../../engine/battle/rules';
import { buildArmy, victoryLabel, type BattleResult, type Side } from '../../../engine/battle/sim';
import type { Quality } from '../../../engine/battle/types';
import { FIX_REASON_TEXT, LABEL_TEXT, REASON_TEXT, metricRows, other, percent, pointDelta } from './format';
import './result.css';

export interface ResultScreenProps {
  a: Quality;
  b: Quality;
  match: number;
  prior: { a: number; b: number };
  result: BattleResult;
  loadFixes(): Promise<FixCandidate[]>;
  onRematch(): void;
  onHome(): void;
}

const SIDES: readonly Side[] = ['a', 'b'];
const MAX_HIGHLIGHTS = 5;

function Name({ side, name }: { side: Side; name: string }) {
  return <span className={`rb-res-name rb-res-name-${side}`}>{name}</span>;
}

function Verdict({ a, b, prior, result }: Pick<ResultScreenProps, 'a' | 'b' | 'prior' | 'result'>) {
  const q = { a, b };
  const w = result.winner;
  const wins = (s: Side) => Math.round(prior[s] * PREDICTION_RUNS);
  return (
    <section className="rb-res-card rb-res-verdict" aria-labelledby="rb-res-verdict-title">
      <div className="rb-res-verdict-main">
        {w && <span className="rb-res-chip">{LABEL_TEXT[victoryLabel(prior[w])]}</span>}
        <h2 id="rb-res-verdict-title" className="rb-res-headline">
          {w ? (
            <>
              <Name side={w} name={q[w].name} /> 승리
            </>
          ) : (
            '무승부'
          )}
        </h2>
        <p className="rb-res-lead">
          {w
            ? `시뮬레이션 ${PREDICTION_RUNS}번 중 ${wins(w)}번 이긴 쪽이에요`
            : `시뮬레이션 ${PREDICTION_RUNS}번 중 ${q.a.name} ${wins('a')}번, ${q.b.name} ${wins('b')}번 이겼어요`}
        </p>
        <p className="rb-res-sub">끝난 이유 · {REASON_TEXT[result.reason]}</p>
      </div>
      <div className="rb-res-survivors">
        {SIDES.map((s) => (
          <div key={s} className="rb-res-tile" data-side={s}>
            <p className="rb-res-tile-head">
              <span className={`rb-res-dot rb-res-dot-${s}`} aria-hidden="true" />
              <span className="rb-res-tile-name">{q[s].name}</span>
            </p>
            <p className="rb-res-big">
              {result.survivors[s]}
              <span className="rb-res-big-unit">명</span>
            </p>
            <p className="rb-res-sub">살아남은 병사 · {ARMY.soldiers}명 중</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function WhyTable({ a, b, draw }: { a: Quality; b: Quality; draw: boolean }) {
  const rows = useMemo(() => metricRows(a, b), [a, b]);
  const q = { a, b };
  return (
    <section className="rb-res-card" aria-labelledby="rb-res-why-title">
      <h2 id="rb-res-why-title" className="rb-res-title">{draw ? '무엇이 달랐나' : '왜 이겼나'}</h2>
      <p className="rb-res-sub">이 표는 차이를 설명할 뿐이에요. 승패는 전투 결과로만 정해져요.</p>
      <table className="rb-res-table">
        <thead>
          <tr>
            <th scope="col" className="rb-res-th-metric"><span className="rb-visually-hidden">지표</span></th>
            {SIDES.map((s) => (
              <th key={s} scope="col" className="rb-res-th-side">
                <span className={`rb-res-dot rb-res-dot-${s}`} aria-hidden="true" />
                <span className="rb-res-th-name">{q[s].name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-metric={r.id}>
              <th scope="row" className="rb-res-metric">
                <span className="rb-res-metric-label">{r.label}</span>
                <span className="rb-res-metric-hint">{r.hint}</span>
                {r.note && <span className="rb-res-metric-note">{r.note}</span>}
              </th>
              {SIDES.map((s) => {
                const lead = r.better === s;
                const muted = r.cells[s].rank === null;
                return (
                  <td
                    key={s}
                    data-side={s}
                    data-better={lead ? 'true' : undefined}
                    className={`rb-res-value${lead ? ' rb-res-value-lead' : ''}${muted ? ' rb-res-value-muted' : ''}`}
                  >
                    <span>{r.cells[s].text}</span>
                    {lead && <span className="rb-res-lead-tag">앞섬</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

type FixState = { kind: 'loading' } | { kind: 'ready'; list: FixCandidate[] } | { kind: 'error' };

function splitPath(path: string): { dir: string; base: string } {
  const at = path.lastIndexOf('/');
  return at < 0 ? { dir: '', base: path } : { dir: path.slice(0, at + 1), base: path.slice(at + 1) };
}

function FixList({ loserName, loadFixes }: { loserName: string; loadFixes(): Promise<FixCandidate[]> }) {
  const [state, setState] = useState<FixState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // A parent that re-renders with a fresh closure must not restart a long worker job.
  const load = useRef(loadFixes);
  load.current = loadFixes;

  useEffect(() => {
    let live = true;
    setState({ kind: 'loading' });
    load.current().then(
      (list) => live && setState({ kind: 'ready', list }),
      () => live && setState({ kind: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  let body;
  if (state.kind === 'loading') {
    body = (
      <div className="rb-res-fix-wait" role="status">
        <p className="rb-res-sub">파일마다 20번씩 다시 싸워 보는 중이에요</p>
        <div className="rb-res-skeleton" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => <span key={i} />)}
        </div>
      </div>
    );
  } else if (state.kind === 'error') {
    body = (
      <div className="rb-res-fix-error" role="alert">
        <p>고칠 곳을 계산하지 못했어요</p>
        <button type="button" className="rb-btn rb-btn-secondary" onClick={() => setAttempt((n) => n + 1)}>
          다시 계산하기
        </button>
      </div>
    );
  } else if (state.list.length === 0) {
    body = <p className="rb-res-empty">눈에 띄게 손볼 파일이 없어요</p>;
  } else {
    const baseline = state.list[0].baseline;
    body = (
      <>
        <ol className="rb-res-fixes">
          {state.list.map((f) => {
            const { dir, base } = splitPath(f.path);
            const n = Math.round(f.delta * 100);
            return (
              <li key={f.path} className="rb-res-fix" data-path={f.path}>
                <div className="rb-res-fix-file">
                  <p className="rb-res-fix-path" title={f.path}>
                    <span className="rb-res-fix-base">{base}</span>
                    {dir && <span className="rb-res-fix-dir">{dir}</span>}
                  </p>
                  <p className="rb-res-fix-why">{f.reasons.map((r) => FIX_REASON_TEXT[r]).join(' · ')}</p>
                </div>
                <p className={`rb-res-fix-delta${n > 0 ? ' rb-res-fix-up' : ''}`}>{pointDelta(f.delta)}</p>
              </li>
            );
          })}
        </ol>
        {state.list.every((f) => Math.round(f.delta * 100) === 0) && (
          <p className="rb-res-empty">차이가 커서 파일 하나만 고쳐서는 결과가 바뀌지 않았어요. 위 파일부터 여러 개를 함께 손보는 게 좋아요.</p>
        )}
        <p className="rb-res-sub">지금 그대로 다시 싸우면 이길 확률은 {percent(baseline)}예요. 숫자는 그 파일 하나만 고쳤을 때의 변화예요.</p>
      </>
    );
  }

  return (
    <section className="rb-res-card" aria-labelledby="rb-res-fix-title">
      <h2 id="rb-res-fix-title" className="rb-res-title">고칠 곳</h2>
      <p className="rb-res-sub">
        <span className="rb-res-strong">{loserName}</span>에서 병사를 가장 약하게 만든 파일이에요. 그 파일이 깔끔하다고 가정하고 다시 싸운 승률 변화를 보여 줘요.
      </p>
      {body}
    </section>
  );
}

function DrawFixes() {
  return (
    <section className="rb-res-card" aria-labelledby="rb-res-fix-title">
      <h2 id="rb-res-fix-title" className="rb-res-title">고칠 곳</h2>
      <p className="rb-res-empty">비겨서 진 쪽이 없어요. 고칠 곳은 승부가 난 대결에서 보여 줘요.</p>
    </section>
  );
}

function Highlights({ entries, names }: { entries: CommentaryEntry[]; names: Record<Side, string> }) {
  return (
    <section className="rb-res-card" aria-labelledby="rb-res-scene-title">
      <h2 id="rb-res-scene-title" className="rb-res-title">명장면</h2>
      {entries.length === 0 ? (
        <p className="rb-res-empty">눈에 띄는 장면 없이 끝났어요</p>
      ) : (
        <ol className="rb-res-scenes">
          {entries.map((e) => (
            <li key={e.id} className="rb-res-scene">
              <p className="rb-res-scene-when">
                {e.time} · {e.laneLabel}
                {e.side && (
                  <>
                    {' · '}
                    <Name side={e.side} name={names[e.side]} />
                  </>
                )}
              </p>
              <p className="rb-res-scene-title">{e.title}</p>
              <p className="rb-res-scene-body">{e.body}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Settings({ a, b, ruleVersion }: { a: Quality; b: Quality; ruleVersion: string }) {
  const q = { a, b };
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : '없음');
  return (
    <section className="rb-res-card rb-res-settings" aria-labelledby="rb-res-set-title">
      <h2 id="rb-res-set-title" className="rb-res-title">설정 공개</h2>
      <div className="rb-res-set-grid">
        {SIDES.map((s) => (
          <div key={s} className="rb-res-set" data-side={s}>
            <p className="rb-res-set-head">
              <span className={`rb-res-dot rb-res-dot-${s}`} aria-hidden="true" />
              <span className="rb-res-tile-name">{q[s].name}</span>
            </p>
            <dl>
            <div>
              <dt>측정에서 뺀 파일</dt>
              <dd>{list(q[s].config.exclude)}</dd>
            </div>
            <div>
              <dt>테스트로 본 파일</dt>
              <dd>{list(q[s].config.testPatterns)}</dd>
            </div>
            <div>
              <dt>측정 규칙 버전</dt>
              <dd>{q[s].ruleVersion}</dd>
            </div>
            </dl>
          </div>
        ))}
      </div>
      <p className="rb-res-sub">전투 규칙 버전 {ruleVersion}</p>
    </section>
  );
}

export function ResultScreen({ a, b, match, prior, result, loadFixes, onRematch, onHome }: ResultScreenProps) {
  const highlights = useMemo(() => {
    const armies = { a: buildArmy(a), b: buildArmy(b) };
    return buildCommentary({ result, armies, quality: { a, b }, prior }).highlights
      // the verdict card already says how the battle ended
      .filter((e) => e.id !== 'end')
      .slice(0, MAX_HIGHLIGHTS);
  }, [a, b, result, prior]);
  const w = result.winner;
  const q = { a, b };

  return (
    <div className="rb-screen rb-result">
      <header className="rb-top">
        <h1 className="rb-brand" tabIndex={-1} data-screen-focus>결과</h1>
        <p className="rb-note">대결 #{match}</p>
      </header>
      <main className="rb-res-main">
        <Verdict a={a} b={b} prior={prior} result={result} />
        <div className="rb-res-grid">
          <WhyTable a={a} b={b} draw={!w} />
          {w ? <FixList loserName={q[other(w)].name} loadFixes={loadFixes} /> : <DrawFixes />}
          <Highlights entries={highlights} names={{ a: a.name, b: b.name }} />
          <Settings a={a} b={b} ruleVersion={result.ruleVersion} />
        </div>
        <div className="rb-res-actions">
          <button type="button" className="rb-btn rb-btn-primary rb-res-rematch" onClick={onRematch}>
            다시 싸우기
          </button>
          <button type="button" className="rb-btn rb-btn-secondary rb-res-home" onClick={onHome}>
            처음으로
          </button>
          <p className="rb-note">다시 싸우면 대결 #{match + 1} 로 새 전투를 해요</p>
        </div>
      </main>
    </div>
  );
}
