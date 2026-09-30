import type { Role } from '../engine/presets';

export const LAYER_TINT = ['#4c6ef5', '#12b886', '#9775fa', '#8a929c'];

const LAYER_HSL: [number, number, number][] = [[228, 78, 9], [164, 62, 9], [262, 72, 9], [200, 30, 28]];

export function roleColors<R extends Pick<Role, 'layer' | 'color'>>(arch: { roles: R[] }): string[] {
  const seen = [0, 0, 0, 0];
  return arch.roles.map((role) => {
    const k = seen[role.layer]++;
    if (role.color) return role.color;
    const [hue, sat, step] = LAYER_HSL[role.layer];
    return `hsl(${(hue + k * step) % 360}, ${sat}%, ${56 + (k % 3) * 8}%)`;
  });
}
