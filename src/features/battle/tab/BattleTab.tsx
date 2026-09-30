import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BattleResult } from '../../../engine/battle/sim';
import type { Prediction } from '../../../engine/battle/sim/types';
import type { Quality } from '../../../engine/battle/types';
import type { BattleAccess, ViewerEnv } from '../../viewer-env';
import { BriefingScreen } from '../briefing/BriefingScreen';
import type { BattleDeps, FixesJob } from '../deps';
import { EngageScreen } from '../engage/EngageScreen';
import { priorShares } from '../prior';
import { ResultScreen } from '../result/ResultScreen';
import { startFixes, startPredict } from '../worker/client';
import { loadErrorText } from './loadError';
import { PickOpponent, SELF_KEY, type SelfState } from './PickOpponent';
import '../theme.css';
import './tab.css';

export type BattleJobs = Pick<BattleDeps, 'predict' | 'fixes'>;

type Pair = { a: Quality; b: Quality; mirror: boolean };

type Screen =
  | { name: 'pick' }
  | ({ name: 'briefing'; match: number; prior: Prediction | null } & Pair)
  | ({ name: 'battle'; match: number; prior: Prediction } & Pair)
  | ({ name: 'result'; match: number; prior: Prediction; result: BattleResult } & Pair);

const workerJobs: BattleJobs = {
  predict: (a, b, onProgress) => startPredict(a, b, { onProgress }),
  fixes: (loser, winner, loserSide) => startFixes(loser, winner, loserSide),
};

export interface BattleTabProps {
  env: ViewerEnv;
  /** Tests swap the battle worker for fakes. */
  jobs?: BattleJobs;
}

export function BattleTab({ env, jobs = workerJobs }: BattleTabProps) {
  if (!env.battle) {
    return (
      <div className="rb-root rb-tab">
        <div className="rb-screen rb-tab-empty">
          <div className="rb-tab-empty-card" role="status">
            <h1 className="rb-tab-empty-title">대결을 준비할 수 없어요</h1>
            <p className="rb-tab-empty-sub">대결은 분석한 레포끼리 코드 품질로 겨루는 화면이에요. 지금 연 레포로는 대결 데이터를 만들 수 없어서, 레포를 다시 열어 분석하면 쓸 수 있어요.</p>
          </div>
        </div>
      </div>
    );
  }
  return <BattleFlow env={env} access={env.battle} jobs={jobs} />;
}

function BattleFlow({ env, access, jobs }: { env: ViewerEnv; access: BattleAccess; jobs: BattleJobs }) {
  const [screen, setScreen] = useState<Screen>({ name: 'pick' });
  const [self, setSelf] = useState<SelfState>({ kind: 'loading' });
  const [selfAttempt, setSelfAttempt] = useState(0);
  const loaded = useMemo(() => new Map<string, Quality>(), [access]);
  const root = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const fixJob = useRef<FixesJob | null>(null);

  useEffect(() => {
    let live = true;
    setSelf({ kind: 'loading' });
    access.loadSelf().then(
      (quality) => live && setSelf({ kind: 'ready', quality }),
      (e: unknown) => live && setSelf({ kind: 'error', message: loadErrorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [access, selfAttempt]);

  useEffect(() => {
    // keyboard and screen-reader users land on the new screen's heading, not on a removed button
    if (first.current) {
      first.current = false;
      return;
    }
    root.current?.querySelector<HTMLElement>('[data-screen-focus]')?.focus();
  }, [screen.name]);

  // leaving the result screen stops a fix-candidate job that may still be replaying battles
  useEffect(() => {
    if (screen.name !== 'result') return;
    return () => {
      fixJob.current?.cancel();
      fixJob.current = null;
    };
  }, [screen]);

  const onChoose = useCallback(
    (key: string, b: Quality) => {
      if (self.kind !== 'ready') return;
      const a = self.quality;
      const mirror = key === SELF_KEY;
      // the same object on both sides would show one name twice on every screen
      const other = mirror ? { ...b, name: `${b.name} (미러)` } : b;
      setScreen({ name: 'briefing', a, b: other, mirror, match: 1, prior: null });
    },
    [self],
  );

  let view;
  switch (screen.name) {
    case 'pick':
      view = <PickOpponent access={access} self={self} onRetrySelf={() => setSelfAttempt((n) => n + 1)} loaded={loaded} onChoose={onChoose} />;
      break;
    case 'briefing': {
      const { a, b, match, prior } = screen;
      view = (
        <BriefingScreen
          deps={jobs}
          a={a}
          b={b}
          match={match}
          prior={prior}
          onPrior={(p) => setScreen((s) => (s.name === 'briefing' && s.a === a && s.b === b ? { ...s, prior: p } : s))}
          onMatch={(m) => setScreen({ ...screen, match: m })}
          onBack={() => setScreen({ name: 'pick' })}
          backLabel="상대 다시 고르기"
          onStart={() => prior && setScreen({ ...screen, name: 'battle', prior })}
        />
      );
      break;
    }
    case 'battle': {
      const { a, b, match, prior } = screen;
      view = (
        <EngageScreen
          a={a}
          b={b}
          match={match}
          prior={priorShares(prior)}
          onBack={() => setScreen({ ...screen, name: 'briefing' })}
          onDone={(result) => setScreen({ ...screen, name: 'result', result })}
        />
      );
      break;
    }
    case 'result': {
      const { a, b, match, prior, result, mirror } = screen;
      const loadFixes = () => {
        const w = result.winner;
        if (!w) return Promise.resolve([]);
        fixJob.current?.cancel();
        const job = w === 'a' ? jobs.fixes(b, a, 'b') : jobs.fixes(a, b, 'a');
        fixJob.current = job;
        return job.result;
      };
      const open = (path: string) => env.goto('city', { file: path, code: true });
      view = (
        <ResultScreen
          a={a}
          b={b}
          match={match}
          prior={priorShares(prior)}
          result={result}
          loadFixes={loadFixes}
          // side A is the open repo; a mirror match puts the same repo on side B too
          openFile={(side) => (side === 'a' || mirror ? open : null)}
          onRematch={() => setScreen({ name: 'battle', a, b, mirror, match: match + 1, prior })}
          onHome={() => setScreen({ name: 'pick' })}
        />
      );
      break;
    }
  }

  return (
    <div className="rb-root rb-tab" ref={root}>
      {view}
    </div>
  );
}
