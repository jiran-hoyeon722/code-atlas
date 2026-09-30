import type { WeekPlan } from '../lib/scheduler';

interface SummaryProps {
  plan: WeekPlan;
}

function totalsOf(plan: WeekPlan) {
  let waterLiters = 0;
  let weedMinutes = 0;
  let harvestKilos = 0;
  for (const task of plan.tasks) {
    if (task.kind === 'water') waterLiters += task.amount;
    else if (task.kind === 'weed') weedMinutes += task.amount;
    else if (task.kind === 'harvest') harvestKilos += task.amount;
  }
  const busiest = plan.tasks.reduce((best, t) => (t.amount > best ? t.amount : best), 0);
  return { waterLiters, weedMinutes, harvestKilos, busiest };
}

export function Summary({ plan }: SummaryProps) {
  const totals = totalsOf(plan);
  return (
    <section className="summary">
      <h2>This week</h2>
      <dl>
        <dt>Water</dt>
        <dd>{totals.waterLiters} L</dd>
        <dt>Weeding</dt>
        <dd>{totals.weedMinutes} min</dd>
        <dt>Harvest</dt>
        <dd>{totals.harvestKilos} kg</dd>
        <dt>Largest task</dt>
        <dd>{totals.busiest}</dd>
      </dl>
      {plan.warnings.map((w) => (
        <p key={w} className="summary-warning">
          {w}
        </p>
      ))}
    </section>
  );
}
