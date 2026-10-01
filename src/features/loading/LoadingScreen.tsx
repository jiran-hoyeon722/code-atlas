import { useEffect, useMemo, useRef } from 'react';
import type { Role } from '../../engine/presets';
import { roleColors } from '../palette';
import { estimateRemaining } from './eta';
import { mountMiniCity } from './miniCity';
import './loading.css';

export type LoadStep =
  | { phase: 'list'; found: number }
  | { phase: 'read'; done: number; total: number }
  | { phase: 'parse'; done: number; total: number; path: string; role: number }
  | { phase: 'link' }
  | { phase: 'metrics' };

export interface LoadingScreenProps {
  name: string;
  framework: string | null;
  sourceDir: string;
  roles: Role[];
  step: LoadStep;
  /** files are downloaded (GitHub) rather than read from disk */
  remote?: boolean;
  onCancel(): void;
}

const LABELS = ['파일 찾기', '코드 읽기', '참조 연결', '도시 짓기'];
const REMOTE_LABELS = ['파일 목록 받기', 'GitHub 에서 코드 받기', '참조 연결', '도시 짓기'];
const ACTIVE = { list: 0, read: 1, parse: 1, link: 2, metrics: 3 } as const;
// one bar for the whole run: reading files is quick I/O, parsing is most of the wait
const SPAN = { list: [0, 0], read: [0, 0.2], parse: [0.2, 0.9], link: [0.9, 0.9], metrics: [0.95, 0.95] } as const;
const MARK = { done: '✓', current: '●', waiting: '○' } as const;

export function LoadingScreen({ name, framework, sourceDir, roles, step, remote = false, onCancel }: LoadingScreenProps) {
  const cityRef = useRef<HTMLDivElement>(null);
  const cityApi = useRef<ReturnType<typeof mountMiniCity> | null>(null);
  const lastDone = useRef(0);
  const samples = useRef<{ t: number; done: number }[]>([]);
  const colors = useMemo(() => roleColors({ roles }), [roles]);

  useEffect(() => {
    if (!cityRef.current) return;
    cityApi.current = mountMiniCity(cityRef.current);
    return () => { cityApi.current?.dispose(); cityApi.current = null; };
  }, []);

  useEffect(() => {
    if (step.phase !== 'parse' && step.phase !== 'read') return;
    if (step.phase === 'parse' && step.done > lastDone.current) {
      const color = colors[step.role] ?? '#8b93a3';
      for (let n = lastDone.current; n < step.done; n++) cityApi.current?.add(color);
      lastDone.current = step.done;
    }
    const list = samples.current;
    if (!list.length || list[list.length - 1].done !== step.done) {
      list.push({ t: performance.now(), done: step.done });
      if (list.length > 5) list.shift();
    }
  }, [step, colors]);

  const active = ACTIVE[step.phase];
  const counted = step.phase === 'read' || step.phase === 'parse' ? step : null;
  const part = counted && counted.total > 0 ? Math.min(1, Math.max(0, counted.done / counted.total)) : 0;
  const ratio = SPAN[step.phase][0] + (SPAN[step.phase][1] - SPAN[step.phase][0]) * part;
  const pct = Math.round(ratio * 100);
  const eta = step.phase === 'parse' || step.phase === 'read' ? estimateRemaining(samples.current, step.total) : null;
  const meta = [framework, sourceDir].filter(Boolean).join(' · ');

  const detail = (i: number) => {
    if (i === 0 && step.phase === 'list') return `${step.found}개`;
    if (i === 1 && counted) return `${counted.done} / ${counted.total}`;
    return '';
  };

  return (
    <div className="cc-load">
      <section className="cc-load-panel">
        <h2 className="cc-load-title">{name}</h2>
        {meta && <p className="cc-load-meta">{meta}</p>}
        <ol className="cc-load-steps">
          {(remote ? REMOTE_LABELS : LABELS).map((label, i) => {
            const state = i < active ? 'done' : i === active ? 'current' : 'waiting';
            return (
              <li key={label} data-state={state}>
                <span className="cc-load-mark" aria-hidden="true">{MARK[state]}</span>
                <span className="cc-load-label">{label}</span>
                <span className="cc-load-count">{detail(i)}</span>
              </li>
            );
          })}
        </ol>
        <div className="cc-load-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <p className="cc-load-path" title={step.phase === 'parse' ? step.path : undefined}>
          {step.phase === 'parse' ? (
            <>
              <span className="cc-load-dir">{step.path.slice(0, step.path.lastIndexOf('/') + 1)}</span>
              <span className="cc-load-file">{step.path.slice(step.path.lastIndexOf('/') + 1)}</span>
            </>
          ) : ' '}
        </p>
        <p className="cc-load-eta">{eta !== null ? `약 ${eta}초 남음` : ' '}</p>
        <button type="button" className="cc-load-cancel" onClick={onCancel}>취소</button>
      </section>
      <div className="cc-load-city" ref={cityRef} aria-hidden="true" />
    </div>
  );
}
