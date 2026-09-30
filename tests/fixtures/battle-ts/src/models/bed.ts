import type { Seed } from './seed';

export interface Bed {
  label: string;
  rows: number;
  rowLength: number;
  sown: Seed[];
}

export function capacity(bed: Bed): number {
  return bed.rows * bed.rowLength;
}

export function isFull(bed: Bed): boolean {
  return bed.sown.length >= bed.rows;
}
