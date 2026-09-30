import type { Plot } from '../models/plot';
import { areaLabel } from '../lib/format';

interface PlotListProps {
  plots: Plot[];
}

function PlotRow({ plot }: { plot: Plot }) {
  const crops = plot.crops.length > 0 ? plot.crops.join(', ') : 'empty';
  return (
    <li className="plot-row">
      <strong>{plot.name}</strong>
      <span>{areaLabel(plot.area)}</span>
      <em>{crops}</em>
    </li>
  );
}

export function PlotList({ plots }: PlotListProps) {
  if (plots.length === 0) {
    return <p className="plot-empty">No plots yet.</p>;
  }
  const sorted = [...plots].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <ul className="plot-list">
      {sorted.map((plot) => (
        <PlotRow key={plot.id} plot={plot} />
      ))}
    </ul>
  );
}
