export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}
