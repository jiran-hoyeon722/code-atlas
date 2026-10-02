import { expect, test } from 'vitest';
import { createSound } from '../../src/features/walk/walkSound';

test('without Web Audio every call is a harmless no-op', () => {
  const s = createSound(null, undefined);
  expect(() => { s.unlock(); s.play('boom'); s.dispose(); }).not.toThrow();
  expect(s.muted).toBe(false);
});

test('a stored "off" starts muted and the toggle flips it', () => {
  const s = createSound('off', undefined);
  expect(s.muted).toBe(true);
  s.setMuted(false);
  expect(s.muted).toBe(false);
});

test('nothing plays before a gesture unlocks the audio', () => {
  let made = 0;
  class Fake { constructor() { made++; } }
  const s = createSound(null, Fake as unknown as typeof AudioContext);
  s.play('shot');
  expect(made).toBe(0);
});
