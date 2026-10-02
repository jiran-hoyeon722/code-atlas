import { expect, test } from 'vitest';
import { DIFFICULTIES, DIFFICULTY } from '../../src/features/walk/walkVirus';
import { SHELL, TANK, aimTurret, createTankQuest, driveTank, tankDamage, tankQuestText } from '../../src/features/walk/walkTank';

test('the tank quest runs only on 지옥 and 신, with 40 and 60 kills', () => {
  expect(DIFFICULTIES.filter((d) => DIFFICULTY[d].tank)).toEqual(['hell', 'god']);
  expect(DIFFICULTY.hell.tankKills).toBe(40);
  expect(DIFFICULTY.god.tankKills).toBe(60);
  const q = createTankQuest();
  for (const d of ['easy', 'normal', 'hard'] as const) {
    q.start(DIFFICULTY[d]);
    expect(q.active).toBe(false);
    expect(Array.from({ length: 100 }, () => q.kill()).some(Boolean)).toBe(false);
  }
});

test('the tank quest triggers exactly once, on the kill that reaches the goal', () => {
  const q = createTankQuest();
  q.start(DIFFICULTY.hell);
  const fired = Array.from({ length: 90 }, () => q.kill());
  expect(fired.indexOf(true)).toBe(39);
  expect(fired.filter(Boolean)).toHaveLength(1);
  expect(q.done).toBe(true);
  expect(q.count).toBe(40);
  expect(tankQuestText(q)).toContain('완료');
  q.start(DIFFICULTY.god);
  expect(q.done).toBe(false);
  expect(tankQuestText(q)).toBe('탱크 퀘스트: 바이러스 0 / 60 처치');
  q.stop();
  expect(q.active).toBe(false);
  expect(q.kill()).toBe(false);
});

test('tank driving builds speed slowly and clamps to the top speed both ways', () => {
  const m = { x: 0, z: 0, heading: 0, speed: 0 };
  driveTank(m, { throttle: 1, turn: 0 }, 1);
  expect(m.speed).toBeCloseTo(TANK.accel);
  expect(m.speed).toBeLessThan(TANK.top);
  for (let k = 0; k < 600; k++) driveTank(m, { throttle: 1, turn: 0 }, 1 / 60);
  expect(m.speed).toBe(TANK.top);
  expect(TANK.top).toBe(8);
  expect(m.z).toBeGreaterThan(0);
  for (let k = 0; k < 600; k++) driveTank(m, { throttle: -1, turn: 0 }, 1 / 60);
  expect(m.speed).toBe(-TANK.reverse);
  for (let k = 0; k < 600; k++) driveTank(m, { throttle: 0, turn: 0 }, 1 / 60);
  expect(m.speed).toBe(0);
});

test('tank hull turns on the spot and stops at walls', () => {
  const m = { x: 0, z: 0, heading: 0, speed: 0 };
  driveTank(m, { throttle: 0, turn: 1 }, 0.5);
  expect(m.heading).toBeCloseTo(TANK.turn * 0.5);
  const wall = { x: 0, z: 0, heading: 0, speed: TANK.top };
  const bump = driveTank(wall, { throttle: 1, turn: 0 }, 0.1, (_x, z) => z < 0.5);
  expect(wall.z).toBeLessThan(0.5);
  expect(bump).toBeGreaterThan(0);
});

test('the turret follows the look direction the short way round, at a limited rate', () => {
  expect(aimTurret(0, 0.1, 1)).toBeCloseTo(0.1);
  expect(aimTurret(0, 2, 0.1)).toBeCloseTo(TANK.turretRate * 0.1);
  // From just left of behind to just right of behind is a short hop, not a full turn.
  const near = aimTurret(Math.PI - 0.05, -Math.PI + 0.05, 1);
  expect(Math.cos(near - (-Math.PI + 0.05))).toBeCloseTo(1);
  let a = 0;
  for (let k = 0; k < 120; k++) a = aimTurret(a, 5, 1 / 60);
  expect(Math.cos(a - 5)).toBeCloseTo(1);
});

test('a tank shell hits hard over a wide area', () => {
  expect(SHELL).toEqual({ damage: 25, radius: 8 });
  expect(TANK.reload).toBe(1.2);
});

test('the tank armour takes a fraction of zombie and elite hits, the giant in full, and a wreck stays gone', () => {
  expect(TANK.hp).toBe(400);
  expect(tankDamage(20, 'zombie')).toBeCloseTo(20 * TANK.minorTake);
  expect(tankDamage(20, 'elite')).toBeCloseTo(20 * TANK.minorTake);
  expect(tankDamage(20, 'boss')).toBe(20);
  expect(TANK.minorTake).toBeLessThan(1);
  const q = createTankQuest();
  q.start(DIFFICULTY.hell);
  q.wreck();
  expect(q.wrecked).toBe(false);
  for (let k = 0; k < 40; k++) q.kill();
  q.wreck();
  expect(q.wrecked).toBe(true);
  expect(tankQuestText(q)).toContain('파괴');
  expect(q.kill()).toBe(false);
  q.start(DIFFICULTY.hell);
  expect(q.wrecked).toBe(false);
});
