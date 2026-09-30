import { useEffect, useRef, useState } from 'react';
import type { Prediction } from '../../engine/battle/sim/types';
import type { Quality } from '../../engine/battle/types';
import { BriefingScreen } from './briefing/BriefingScreen';
import type { BattleDeps } from './deps';
import { BattleScreen, ResultScreen } from './Placeholder';
import { SelectScreen } from './select/SelectScreen';

export type { BattleDeps } from './deps';

type Pair = { a: Quality; b: Quality };

export type Screen =
  | { name: 'select'; pair?: Pair }
  | ({ name: 'briefing'; match: number; prior: Prediction | null } & Pair)
  | ({ name: 'battle'; match: number; prior: Prediction } & Pair)
  | ({ name: 'result' } & Pair);

export function BattleApp({ deps }: { deps: BattleDeps }) {
  const [screen, setScreen] = useState<Screen>({ name: 'select' });
  const root = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => {
    // keyboard and screen-reader users land on the new screen's heading, not on a removed button
    if (first.current) {
      first.current = false;
      return;
    }
    root.current?.querySelector<HTMLElement>('[data-screen-focus]')?.focus();
  }, [screen.name]);

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
        <BattleScreen
          a={a}
          b={b}
          match={match}
          onBack={() => setScreen({ name: 'briefing', a, b, match, prior })}
          onNext={() => setScreen({ name: 'result', a, b })}
        />
      );
      break;
    }
    case 'result': {
      const { a, b } = screen;
      view = <ResultScreen a={a} b={b} onBack={() => setScreen({ name: 'select', pair: { a, b } })} />;
      break;
    }
  }

  return (
    <div className="rb-root" ref={root}>
      {view}
    </div>
  );
}
