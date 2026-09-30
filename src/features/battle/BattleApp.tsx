import { useEffect, useRef, useState } from 'react';
import type { BattleResult } from '../../engine/battle/sim';
import type { Prediction } from '../../engine/battle/sim/types';
import type { Quality } from '../../engine/battle/types';
import { BriefingScreen } from './briefing/BriefingScreen';
import type { BattleDeps, FixesJob } from './deps';
import { EngageScreen } from './engage/EngageScreen';
import { priorShares } from './prior';
import { ResultScreen } from './result/ResultScreen';
import { SelectScreen } from './select/SelectScreen';

export type { BattleDeps } from './deps';

type Pair = { a: Quality; b: Quality };

export type Screen =
  | { name: 'select'; pair?: Pair }
  | ({ name: 'briefing'; match: number; prior: Prediction | null } & Pair)
  | ({ name: 'battle'; match: number; prior: Prediction } & Pair)
  | ({ name: 'result'; match: number; prior: Prediction; result: BattleResult } & Pair);

export { priorShares };

export function BattleApp({ deps }: { deps: BattleDeps }) {
  const [screen, setScreen] = useState<Screen>({ name: 'select' });
  const root = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const fixJob = useRef<FixesJob | null>(null);

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

  let view;
  switch (screen.name) {
    case 'select':
      view = <SelectScreen deps={deps} initial={screen.pair} onBrief={(a, b) => setScreen({ name: 'briefing', a, b, match: 1, prior: null })} />;
      break;
    case 'briefing': {
      const { a, b, match, prior } = screen;
      view = (
        <BriefingScreen
          deps={deps}
          a={a}
          b={b}
          match={match}
          prior={prior}
          onPrior={(p) => setScreen((s) => (s.name === 'briefing' && s.a === a && s.b === b ? { ...s, prior: p } : s))}
          onMatch={(m) => setScreen({ ...screen, match: m })}
          onBack={() => setScreen({ name: 'select', pair: { a, b } })}
          onStart={() => prior && setScreen({ name: 'battle', a, b, match, prior })}
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
          onBack={() => setScreen({ name: 'briefing', a, b, match, prior })}
          onDone={(result) => setScreen({ name: 'result', a, b, match, prior, result })}
        />
      );
      break;
    }
    case 'result': {
      const { a, b, match, prior, result } = screen;
      const loadFixes = () => {
        const w = result.winner;
        if (!w) return Promise.resolve([]);
        fixJob.current?.cancel();
        const job = w === 'a' ? deps.fixes(b, a, 'b') : deps.fixes(a, b, 'a');
        fixJob.current = job;
        return job.result;
      };
      view = (
        <ResultScreen
          a={a}
          b={b}
          match={match}
          prior={priorShares(prior)}
          result={result}
          loadFixes={loadFixes}
          onRematch={() => setScreen({ name: 'battle', a, b, match: match + 1, prior })}
          onHome={() => setScreen({ name: 'select', pair: { a, b } })}
        />
      );
      break;
    }
  }

  return (
    <div className="rb-root" ref={root}>
      {view}
    </div>
  );
}
