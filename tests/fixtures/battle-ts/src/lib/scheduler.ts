import type { Plot } from '../models/plot';
import { clamp, roundTo } from './math';

export interface Weather {
  rainy: boolean;
  frost: boolean;
  weekday: number;
}

export interface Task {
  plot: string;
  kind: 'water' | 'weed' | 'harvest' | 'cover' | 'rest';
  amount: number;
}

export interface WeekPlan {
  tasks: Task[];
  warnings: string[];
}

export function planWeek(plots: Plot[], weather: Weather): WeekPlan {
  const tasks: Task[] = [];
  const warnings: string[] = [];
  for (const plot of plots) {
    let water = plot.area * 2;
    let weed = plot.area * 5;
    let harvest = 0;
    if (plot.crops.length === 0) {
      tasks.push({ plot: plot.id, kind: 'rest', amount: 0 });
      continue;
    }
    for (const crop of plot.crops) {
      if (crop === 'tomato') {
        water += 3;
        harvest += weather.weekday > 4 ? 2 : 1;
      } else if (crop === 'lettuce') {
        water += 1;
        harvest += 1;
      } else if (crop === 'squash') {
        water += 4;
        weed += 2;
      } else if (crop === 'bean') {
        weed += 1;
        harvest += weather.rainy ? 0 : 1;
      } else if (crop === 'onion') {
        water += 1;
      } else if (crop === 'carrot') {
        weed += 3;
      } else {
        warnings.push(`unknown crop ${crop} in ${plot.name}`);
      }
    }
    if (weather.rainy && water > 0) {
      water = roundTo(water / 3, 0.5);
    }
    if (weather.frost) {
      tasks.push({ plot: plot.id, kind: 'cover', amount: plot.area });
      harvest = harvest > 0 ? harvest - 1 : 0;
      if (plot.crops.includes('tomato') || plot.crops.includes('squash')) {
        warnings.push(`frost risk for ${plot.name}`);
      }
    }
    if (weather.weekday === 0 || weather.weekday === 6) {
      weed = weed * 2;
    } else if (weather.weekday === 3 && !weather.rainy) {
      weed = weed + 1;
    }
    water = clamp(water, 0, 40);
    weed = clamp(weed, 0, 120);
    if (water > 30 && !weather.rainy) {
      warnings.push(`${plot.name} needs a lot of water`);
    }
    if (weed > 60 || (plot.area > 10 && weed > 30)) {
      warnings.push(`${plot.name} needs help weeding`);
    }
    if (water > 0) tasks.push({ plot: plot.id, kind: 'water', amount: water });
    if (weed > 0) tasks.push({ plot: plot.id, kind: 'weed', amount: weed });
    if (harvest > 0) tasks.push({ plot: plot.id, kind: 'harvest', amount: harvest });
    const heavy = tasks.filter((t) => t.plot === plot.id && t.amount > 20).length;
    if (heavy >= 2 && plot.crops.length > 3) {
      warnings.push(`${plot.name} is overloaded`);
    } else if (heavy === 0 && plot.crops.length > 0 && !weather.frost) {
      tasks.push({ plot: plot.id, kind: 'rest', amount: 1 });
    }
    const covered = tasks.some((t) => t.plot === plot.id && t.kind === 'cover');
    if (covered && weather.rainy) {
      warnings.push(`${plot.name} cover may flood`);
    } else if (covered && weather.weekday > 5) {
      warnings.push(`${plot.name} cover check on monday`);
    }
    const share = plots.length > 0 ? plot.area / plots.length : 0;
    if (share > 8 && harvest === 0) {
      warnings.push(`${plot.name} is large but idle`);
    }
  }
  return { tasks, warnings };
}

export function tasksFor(plan: WeekPlan, plot: string): Task[] {
  return plan.tasks.filter((t) => t.plot === plot);
}
