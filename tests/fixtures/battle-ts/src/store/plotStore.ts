import type { Plot } from '../models/plot';
import { emit } from './plotEvents';

const plots: Plot[] = [];

export function currentPlots(): Plot[] {
  return [...plots];
}

export function addPlot(plot: Plot): void {
  plots.push(plot);
  emit('added', plot.id);
}

export function removePlot(id: string): boolean {
  const i = plots.findIndex((p) => p.id === id);
  if (i < 0) return false;
  plots.splice(i, 1);
  emit('removed', id);
  return true;
}
