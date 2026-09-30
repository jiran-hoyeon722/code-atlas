import { useEffect, useRef, useState } from 'react';
import type { Quality } from '../../engine/battle/types';
import type { BattleDeps } from './deps';
import { BattleScreen, BriefingScreen, ResultScreen } from './Placeholder';
import { SelectScreen } from './select/SelectScreen';

export type { BattleDeps } from './deps';

type Pair = { a: Quality; b: Quality };

export type Screen =
  | { name: 'select'; pair?: Pair }
  | ({ name: 'briefing' | 'battle' | 'result' } & Pair);

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
      view = <SelectScreen deps={deps} initial={screen.pair} onBrief={(a, b) => setScreen({ name: 'briefing', a, b })} />;
      break;
    case 'briefing': {
      const { a, b } = screen;
      view = <BriefingScreen a={a} b={b} onBack={() => setScreen({ name: 'select', pair: { a, b } })} onNext={() => setScreen({ name: 'battle', a, b })} />;
      break;
    }
    case 'battle': {
      const { a, b } = screen;
      view = <BattleScreen a={a} b={b} onBack={() => setScreen({ name: 'briefing', a, b })} onNext={() => setScreen({ name: 'result', a, b })} />;
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
