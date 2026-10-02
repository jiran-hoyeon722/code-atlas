import * as THREE from 'three';
import { expect, test } from 'vitest';
import { BOMB_GRAVITY, createHeliArms, dropPoint, fall, rayHit, shakeAt, stepFall } from '../../src/features/walk/walkHeliArms';
import { clearance, ease } from '../../src/features/walk/walkHeli';
import { HELI_BOSS_BONUS } from '../../src/features/walk/walkHorde';
import { splash, type Tracers } from '../../src/features/walk/walkWeapons';
import type { Heli } from '../../src/features/walk/walkHeli';
import type { Sparks } from '../../src/features/walk/walkFx';

const flat = () => 0;
// One 10-high block spanning x 20..30.
const block = (x: number) => (x >= 20 && x <= 30 ? 10 : 0);

test('a dropped bomb falls for sqrt(2h/g) and carries the heli speed forward', () => {
  const hit = dropPoint({ x: 0, y: 48, z: 0, vx: 0, vy: 0, vz: 10 }, flat);
  const t = Math.sqrt((2 * 48) / BOMB_GRAVITY);
  expect(hit.t).toBeCloseTo(t, 1);
  expect(hit.z).toBeCloseTo(10 * t, 0);
  expect(hit.x).toBeCloseTo(0);
  expect(hit.y).toBe(0);
});

test('the fall is the same whatever the frame rate', () => {
  const a = { x: 0, y: 30, z: 0, vx: 4, vy: 2, vz: 0 };
  const b = { ...a };
  fall(a, 1);
  for (let k = 0; k < 60; k++) fall(b, 1 / 60);
  expect(b.y).toBeCloseTo(a.y, 6);
  expect(b.x).toBeCloseTo(a.x, 6);
});

test('a bomb stops on a roof, and one flying into a wall stops at the wall', () => {
  const roof = dropPoint({ x: 25, y: 40, z: 0, vx: 0, vy: 0, vz: 0 }, (x) => block(x));
  expect(roof.y).toBeCloseTo(10, 5);
  const wall = { x: 19.5, y: 5, z: 0, vx: 30, vy: 0, vz: 0 };
  const hit = stepFall(wall, 0.05, (x) => block(x));
  expect(hit).not.toBeNull();
  expect(hit!.x).toBeCloseTo(19.5);
  expect(hit!.y).toBeCloseTo(5);
  expect(stepFall({ x: 0, y: 20, z: 0, vx: 0, vy: 0, vz: 0 }, 0.05, flat)).toBeNull();
});

test('the aim ray meets the ground at h / sin(pitch) and stops at buildings in the way', () => {
  const p = 0.5;
  const d = rayHit(0, 20, 0, Math.cos(p), -Math.sin(p), 0, 200, flat);
  expect(d).toBeCloseTo(20 / Math.sin(p), 0);
  const wall = rayHit(0, 5, 0, 1, 0, 0, 200, (x) => block(x));
  expect(wall).toBeGreaterThan(19.5);
  expect(wall).toBeLessThan(20.5);
  expect(rayHit(0, 50, 0, 1, 0, 0, 100, flat)).toBe(100);
});

test('area damage is full near the centre, fades out and stops at the radius', () => {
  expect(splash(10, 0, 10)).toBe(10);
  expect(splash(10, 4, 10)).toBe(10);
  expect(splash(10, 7, 10)).toBeLessThan(10);
  expect(splash(10, 9.9, 10)).toBe(1);
  expect(splash(10, 10.1, 10)).toBe(0);
  for (let d = 0; d < 10; d += 0.5) expect(splash(10, d + 0.5, 10)).toBeLessThanOrEqual(splash(10, d, 10));
  expect(splash(1, 1.5, 1.6)).toBe(1);
});

test('blasts shake the camera less the farther away they are', () => {
  expect(shakeAt(0)).toBeGreaterThan(1);
  expect(shakeAt(40)).toBeLessThan(shakeAt(10));
  expect(shakeAt(100)).toBe(0);
});

test('the heli looks ahead for tall buildings along its velocity', () => {
  const floorAt = (x: number) => (x > 20 ? 30 : 0);
  expect(clearance(floorAt, 0, 0, 0, 0)).toBe(0);
  expect(clearance(floorAt, 0, 0, 30, 0)).toBe(30);
  expect(clearance(floorAt, 0, 0, -30, 0)).toBe(0);
  expect(ease(4, 0)).toBe(0);
  expect(ease(4, 0.1)).toBeCloseTo(1 - Math.exp(-0.4));
});

test('heli bombs hit the giant with the heli bonus, the hero\'s explosives with none', () => {
  const bonuses: number[] = [];
  const arms = createHeliArms(new THREE.Scene(), {} as Heli, {
    surfaceAt: flat,
    hit: (_x, _y, _z, _r, _d, _fx, _fz, bossBonus) => (bonuses.push(bossBonus), 0),
    blast: () => {},
    sparks: { burst: () => {} } as unknown as Sparks,
    tracers: {} as Tracers,
  });
  arms.explode({ x: 0, y: 0, z: 0 });
  arms.explode({ x: 0, y: 0, z: 0 }, 6, 12, 1);
  expect(bonuses).toEqual([HELI_BOSS_BONUS, 1]);
  arms.dispose();
});
