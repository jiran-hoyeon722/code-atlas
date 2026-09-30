import { currentPlots } from './plotStore';

type Listener = (kind: string, id: string, total: number) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit(kind: string, id: string): void {
  const total = currentPlots().length;
  for (const l of listeners) l(kind, id, total);
}
