import type { Architecture } from '../../engine/architecture';

export const LOT = 14;
export const LOT_DEPTH = 14;
export const LANE = 10;
export const BACK = 3;
export const STREET = 14;
export const AVENUE = 24;
export const FLOOR = 3.5;

/** Font size for a district board name that measured `width` at `size`px, so it fits in `max`px. */
export const boardFontSize = (width: number, size = 84, max = 944): number => (width > max ? Math.floor((size * max) / width) : size);

export type BuildingKind = 'house' | 'apartment' | 'tower';
export interface WalkBuilding { i: number; x: number; z: number; w: number; d: number; h: number; face: 1 | -1; lane: number; district: number; kind: BuildingKind }
export interface WalkStrip { role: number; x: number; z: number; w: number; d: number }
export interface WalkLane { x: number; z: number; w: number }
export interface WalkDistrict { role: number; x: number; z: number; w: number; d: number; row: number }
export interface WalkRow { zMin: number; zMax: number }
export interface WalkLayout {
  buildings: WalkBuilding[];
  strips: WalkStrip[];
  lanes: WalkLane[];
  districts: WalkDistrict[];
  rows: WalkRow[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Floors come from fan-in, so a file nobody uses is a house and a hub becomes an office tower.
export const buildingKind = (floors: number): BuildingKind => (floors <= 2 ? 'house' : floors < 10 ? 'apartment' : 'tower');

// Same reading as the overview city (layer = avenue row, role = district, path order inside), but every building fronts a lane.
export function layoutWalk(arch: Architecture): WalkLayout {
  const byRole: number[][] = arch.roles.map(() => []);
  arch.nodes.forEach((n, i) => byRole[n.role].push(i));
  byRole.forEach((list) => list.sort((p, q) => arch.nodes[p].path.localeCompare(arch.nodes[q].path)));

  const buildings: WalkBuilding[] = [];
  const strips: WalkStrip[] = [];
  const lanes: WalkLane[] = [];
  const districts: WalkDistrict[] = [];
  const rows: WalkRow[] = [];
  const pairDepth = 2 * LOT_DEPTH + LANE;
  let zCursor = 0;

  arch.layers.forEach((_, li) => {
    const roles = arch.roles.map((_, i) => i).filter((i) => arch.roles[i].layer === li && byRole[i].length > 0);
    if (!roles.length) return;
    const shapes = roles.map((ri) => {
      const n = byRole[ri].length;
      const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.4)));
      const pairs = Math.ceil(Math.ceil(n / cols) / 2);
      return { ri, cols, pairs, w: cols * LOT, d: pairs * pairDepth + (pairs - 1) * BACK };
    });
    const width = shapes.reduce((s, v) => s + v.w, 0) + STREET * (shapes.length - 1);
    const depth = Math.max(...shapes.map((s) => s.d));
    let x = -width / 2;
    rows.push({ zMin: zCursor, zMax: zCursor + depth });
    shapes.forEach(({ ri, cols, pairs, w, d }) => {
      const district = districts.length;
      districts.push({ role: ri, x: x + w / 2, z: zCursor + d / 2, w, d, row: rows.length - 1 });
      for (let p = 0; p < pairs; p++) {
        const z0 = zCursor + p * (pairDepth + BACK);
        strips.push({ role: ri, x: x + w / 2, z: z0 + LOT_DEPTH / 2, w, d: LOT_DEPTH });
        strips.push({ role: ri, x: x + w / 2, z: z0 + LOT_DEPTH + LANE + LOT_DEPTH / 2, w, d: LOT_DEPTH });
        lanes.push({ x: x + w / 2, z: z0 + LOT_DEPTH + LANE / 2, w: w + STREET });
      }
      byRole[ri].forEach((i, j) => {
        const n = arch.nodes[i];
        const row = Math.floor(j / cols);
        const pair = Math.floor(row / 2);
        const back = row % 2 === 0;
        const z0 = zCursor + pair * (pairDepth + BACK);
        const size = clamp(5 + Math.sqrt(n.lines) / 3, 6, 12);
        const floors = clamp(1 + Math.round(Math.sqrt(n.fanIn) * 2.2), 1, 40);
        buildings.push({
          i,
          x: x + (j % cols) * LOT + LOT / 2,
          z: back ? z0 + LOT_DEPTH - 2 - size / 2 : z0 + LOT_DEPTH + LANE + 2 + size / 2,
          w: size, d: size, h: floors * FLOOR,
          face: back ? 1 : -1,
          lane: z0 + LOT_DEPTH + LANE / 2,
          district,
          kind: buildingKind(floors),
        });
      });
      x += w + STREET;
    });
    zCursor += depth + AVENUE;
  });

  const totalDepth = Math.max(0, zCursor - AVENUE);
  const flip = (z: number) => totalDepth / 2 - z;
  buildings.forEach((b) => { b.z = flip(b.z); b.lane = flip(b.lane); b.face = (-b.face) as 1 | -1; });
  rows.forEach((r) => { const top = flip(r.zMin); r.zMin = flip(r.zMax); r.zMax = top; });
  strips.forEach((s) => (s.z = flip(s.z)));
  lanes.forEach((l) => (l.z = flip(l.z)));
  districts.forEach((d) => (d.z = flip(d.z)));
  const xs = districts.flatMap((d) => [d.x - d.w / 2, d.x + d.w / 2]);
  return {
    buildings, strips, lanes, districts, rows,
    bounds: { minX: Math.min(0, ...xs) - AVENUE, maxX: Math.max(0, ...xs) + AVENUE, minZ: -totalDepth / 2 - AVENUE, maxZ: totalDepth / 2 + AVENUE },
  };
}
