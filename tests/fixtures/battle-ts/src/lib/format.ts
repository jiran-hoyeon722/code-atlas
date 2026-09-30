import type { WeekPlan } from './scheduler';

export function areaLabel(area: number): string {
  if (area < 1) return `${Math.round(area * 100)} dm²`;
  return `${area.toFixed(1)} m²`;
}

export function planDigest(plan: WeekPlan): string {
  let waterLiters = 0;
  let weedMinutes = 0;
  let harvestKilos = 0;
  for (const task of plan.tasks) {
    if (task.kind === 'water') waterLiters += task.amount;
    else if (task.kind === 'weed') weedMinutes += task.amount;
    else if (task.kind === 'harvest') harvestKilos += task.amount;
  }
  const busiest = plan.tasks.reduce((best, t) => (t.amount > best ? t.amount : best), 0);
  return [`water ${waterLiters}`, `weed ${weedMinutes}`, `harvest ${harvestKilos}`, `max ${busiest}`].join(' / ');
}

export function titleCase(text: string): string {
  return text
    .split(' ')
    .filter((w) => w.length > 0)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
