import { expect, test } from 'vitest';
import { GAIT, decay, follow, nextGait, separation, shakeOffset, turnToward, within, wrapAngle, type Gait } from '../../src/features/walk/walkMotion';

test('a speed hovering around a threshold keeps the same gait', () => {
  let gait: Gait = 'Idle';
  const seen = new Set<Gait>();
  for (let k = 0; k < 60; k++) {
    gait = nextGait(gait, GAIT.walkOn - 0.05 + (k % 2) * 0.1);
    if (k > 0) seen.add(gait);
  }
  expect([...seen]).toEqual(['Walking']);
  gait = 'Walking';
  for (let k = 0; k < 60; k++) expect(gait = nextGait(gait, GAIT.runOn - 0.3 + (k % 2) * 0.2)).toBe('Walking');
  gait = 'Running';
  for (let k = 0; k < 60; k++) expect(gait = nextGait(gait, GAIT.runOff + 0.1 + (k % 2) * 0.6)).toBe('Running');
});

test('gaits switch once the speed clearly crosses', () => {
  expect(nextGait('Idle', 0.3)).toBe('Idle');
  expect(nextGait('Idle', 3)).toBe('Walking');
  expect(nextGait('Walking', 0.1)).toBe('Idle');
  expect(nextGait('Walking', 9)).toBe('Running');
  expect(nextGait('Running', 4)).toBe('Walking');
  expect(nextGait('Running', 0)).toBe('Idle');
  expect(nextGait('Idle', 11)).toBe('Running');
});

test('within holds its state between enter and exit', () => {
  expect(within(false, 2.1, 2, 2.6)).toBe(false);
  expect(within(false, 1.9, 2, 2.6)).toBe(true);
  expect(within(true, 2.5, 2, 2.6)).toBe(true);
  expect(within(true, 2.7, 2, 2.6)).toBe(false);
});

test('turning takes the short way and is rate limited', () => {
  const next = turnToward(Math.PI - 0.1, -Math.PI + 0.1, 1 / 60, 10, 12);
  expect(next).toBeGreaterThan(Math.PI - 0.1);
  let h = 0;
  h = turnToward(h, Math.PI * 0.99, 1 / 60, 50, 12);
  expect(h).toBeCloseTo(12 / 60);
  for (let k = 0; k < 120; k++) h = turnToward(h, 1, 1 / 60, 10, 12);
  expect(wrapAngle(h - 1)).toBeCloseTo(0, 4);
});

test('knockback fades the same way at any frame rate', () => {
  let slow = 7, fast = 7;
  for (let k = 0; k < 30; k++) slow = decay(slow, 6, 1 / 30);
  for (let k = 0; k < 60; k++) fast = decay(fast, 6, 1 / 60);
  expect(slow).toBeCloseTo(fast, 6);
  expect(fast).toBeLessThan(0.02);
});

test('separation pushes overlapping bodies apart to the minimum gap', () => {
  expect(separation(3, 0, 0, 0, 1.1, 0)).toEqual([0, 0]);
  const [sx, sz] = separation(0.5, 0, 0, 0, 1.1, 0);
  expect(sx).toBeCloseTo(0.6);
  expect(sz).toBeCloseTo(0);
  const [fx, fz] = separation(0, 0, 0, 0, 1.1, Math.PI / 2);
  expect(Math.hypot(fx, fz)).toBeCloseTo(1.1);
  expect(fx).toBeCloseTo(1.1);
});

test('follow closes the same share of the gap over one second at any frame rate', () => {
  const after = (hz: number) => {
    let x = 0;
    for (let k = 0; k < hz; k++) x += (1 - x) * follow(6, 1 / hz);
    return x;
  };
  expect(after(60)).toBeCloseTo(after(144), 6);
  expect(follow(6, 0)).toBe(0);
  expect(follow(6, 10)).toBeLessThanOrEqual(1);
});

test('a shake is zero at rest, smooth from frame to frame and bounded', () => {
  expect(Object.values(shakeOffset(3.2, 0)).map(Math.abs)).toEqual([0, 0, 0]);
  let max = 0;
  let jump = 0;
  let prev = shakeOffset(0, 1);
  for (let t = 1 / 120; t < 2; t += 1 / 120) {
    const s = shakeOffset(t, 1);
    max = Math.max(max, Math.abs(s.x), Math.abs(s.y));
    jump = Math.max(jump, Math.abs(s.x - prev.x));
    prev = s;
  }
  expect(max).toBeLessThanOrEqual(0.45);
  expect(jump).toBeLessThan(0.1);
  expect(Math.abs(shakeOffset(1, 0.3).x)).toBeLessThan(Math.abs(shakeOffset(1, 1).x) + 1e-9);
});
