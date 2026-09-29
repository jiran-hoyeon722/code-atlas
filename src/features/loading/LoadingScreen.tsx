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
  onCancel(): void;
}

const LABELS = ['파일 찾기', '코드 읽기', '참조 연결', '도시 짓기'];
const ACTIVE = { list: 0, read: 1, parse: 1, link: 2, metrics: 3 } as const;
const MARK = { done: '✓', current: '●', waiting: '○' } as const;

export function LoadingScreen({ name, framework, sourceDir, roles, step, onCancel }: LoadingScreenProps) {
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
      lastDone.current = step.done;
      cityApi.current?.add(colors[step.role] ?? '#8b93a3');
    }
    const list = samples.current;
    if (!list.length || list[list.length - 1].done !== step.done) {
      list.push({ t: performance.now(), done: step.done });
      if (list.length > 5) list.shift();
    }
  }, [step, colors]);

  const active = ACTIVE[step.phase];
  const counted = step.phase === 'read' || step.phase === 'parse' ? step : null;
  const ratio = counted && counted.total > 0 ? counted.done / counted.total : step.phase === 'link' || step.phase === 'metrics' ? 1 : 0;
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
          {LABELS.map((label, i) => {
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
        <p className="cc-load-path">{step.phase === 'parse' ? step.path : ' '}</p>
        <p className="cc-load-eta">{eta !== null ? `약 ${eta}초 남음` : ' '}</p>
        <button type="button" className="cc-load-cancel" onClick={onCancel}>취소</button>
      </section>
      <div className="cc-load-city" ref={cityRef} aria-hidden="true" />
    </div>
  );
}
