import { useMemo, useState } from 'react';
import { Header } from './components/Header';
import { PlotList } from './components/PlotList';
import { Summary } from './components/Summary';
import { currentPlots, addPlot } from './store/plotStore';
import { planWeek } from './lib/scheduler';

export function App() {
  const [version, setVersion] = useState(0);
  const plots = useMemo(() => currentPlots(), [version]);
  const plan = useMemo(() => planWeek(plots, { rainy: false, frost: false, weekday: 1 }), [plots]);

  const onAdd = () => {
    addPlot({ id: `p${plots.length + 1}`, name: 'New plot', area: 4, crops: [] });
    setVersion((v) => v + 1);
  };

  return (
    <main className="garden">
      <Header title="Garden planner" count={plots.length} onAdd={onAdd} />
      <PlotList plots={plots} />
      <Summary plan={plan} />
    </main>
  );
}
