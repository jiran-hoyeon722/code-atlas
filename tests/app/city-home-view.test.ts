import { describe, expect, it } from 'vitest';
import { homeView } from '../../src/features/city/homeView';

describe('homeView', () => {
  it('keeps the original fixed view for large cities', () => {
    const size = 900;
    const v = homeView({ w: size, d: 700 }, 500, 1.6);
    expect(v.position.toArray()).toEqual([-size * 0.3, size * 0.62, size * 1.02]);
    expect(v.target.toArray()).toEqual([size * 0.06, 0, size * 0.08]);
    expect(v.fogNear).toBe(size * 1.1);
    expect(v.fogFar).toBe(size * 3.2);
    expect(v.far).toBe(size * 8);
  });

  it('fits small cities on screen and centres on the labelled extent', () => {
    const v = homeView({ w: 100, d: 80 }, 130, 1.6);
    expect(v.target.x).toBeCloseTo((130 - 50) / 2);
    expect(v.target.y).toBe(0);
    expect(v.distance).toBeGreaterThanOrEqual(60);
    expect(v.position.distanceTo(v.target)).toBeCloseTo(v.distance);
    expect(v.fogFar).toBeGreaterThan(v.distance);
  });
});
