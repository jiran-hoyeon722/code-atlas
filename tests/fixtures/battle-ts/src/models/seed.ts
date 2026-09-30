import type { Bed } from './bed';

export interface Seed {
  name: string;
  daysToSprout: number;
  spacing: number;
  preferredBed?: Bed;
}

export function sproutsBy(seed: Seed, sownOn: number): number {
  return sownOn + seed.daysToSprout;
}

export function perRow(seed: Seed, rowLength: number): number {
  return seed.spacing <= 0 ? 0 : Math.floor(rowLength / seed.spacing);
}
