import type { Architecture } from '../../engine/architecture';

export const CELL = 4;
export const ROAD = 8;
export const AVENUE = 22;

export interface CityBuilding { i: number; x: number; z: number; w: number; d: number }
export interface CityBlock { role: number; x: number; z: number; w: number; d: number }
export interface CityLayout {
  buildings: CityBuilding[];
  blocks: CityBlock[];
  bounds: { w: number; d: number };
}

export const footprint = (lines: number) => Math.min(3.4, Math.max(1.3, 0.9 + Math.sqrt(lines) / 10));

// One row (street) per layer, one square district per role, files in path order; x/z are centres, entry row at +z.
export function layoutCity(arch: Architecture): CityLayout {
  const byRole: number[][] = arch.roles.map(() => []);
  arch.nodes.forEach((n, i) => byRole[n.role].push(i));
  byRole.forEach((list) => list.sort((p, q) => arch.nodes[p].path.localeCompare(arch.nodes[q].path)));

  const cells: { i: number; x: number; z: number }[] = [];
  const districts: { role: number; x: number; z: number; w: number; d: number }[] = [];
  let zCursor = 0;
  let maxWidth = 0;
  arch.layers.forEach((_, li) => {
    const roles = arch.roles.map((_, i) => i).filter((i) => arch.roles[i].layer === li);
    if (!roles.length) return;
    const sides = roles.map((ri) => Math.max(1, Math.ceil(Math.sqrt(byRole[ri].length))));
    const depth = Math.max(...roles.map((ri, k) => Math.ceil(byRole[ri].length / sides[k]))) * CELL;
    const width = sides.reduce((s, v) => s + v * CELL, 0) + ROAD * (roles.length - 1);
    let x = -width / 2;
    roles.forEach((ri, k) => {
      const side = sides[k];
      districts.push({ role: ri, x, z: zCursor, w: side * CELL, d: Math.ceil(byRole[ri].length / side) * CELL });
      byRole[ri].forEach((i, j) => {
        cells.push({ i, x: x + (j % side) * CELL + CELL / 2, z: zCursor + Math.floor(j / side) * CELL + CELL / 2 });
      });
      x += side * CELL + ROAD;
    });
    maxWidth = Math.max(maxWidth, width);
    zCursor += depth + AVENUE;
  });
  const totalDepth = Math.max(0, zCursor - AVENUE);
  const flipZ = (z: number) => totalDepth / 2 - z;

  return {
    buildings: cells.map(({ i, x, z }) => {
      const fp = footprint(arch.nodes[i].lines);
      return { i, x, z: flipZ(z), w: fp, d: fp };
    }),
    blocks: districts.map((b) => ({ role: b.role, x: b.x + b.w / 2, z: flipZ(b.z + b.d / 2), w: b.w, d: b.d })),
    bounds: { w: maxWidth, d: totalDepth },
  };
}
