export function estimateRemaining(samples: { t: number; done: number }[], total: number): number | null {
  const recent = samples.slice(-5);
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const dt = last.t - first.t;
  const dd = last.done - first.done;
  if (dt <= 0 || dd <= 0) return null;
  const left = Math.max(0, total - last.done);
  return Math.ceil(left / (dd / dt) / 1000);
}
