import * as THREE from 'three';
import type { Architecture } from '../../engine/architecture';
import { AVENUE, STREET, type WalkBuilding, type WalkLayout } from './walkLayout';

const AMBIENT = 15;
const PER_SIDE = 10;
const CAPACITY = AMBIENT + PER_SIDE * 2;
const IN = '#4dabf7';
const OUT = '#ffa94d';
const SPEED = 11;
const KEEP_RIGHT = 1.6;
const LABELS = 4;

type P = [number, number];

// Manhattan route over the road grid: own lane → side street → avenue (→ perimeter road → avenue) → side street → target lane.
export function routeBetween(layout: WalkLayout, a: WalkBuilding, b: WalkBuilding): P[] {
  const da = layout.districts[a.district];
  const db = layout.districts[b.district];
  if (a.district === b.district && a.lane === b.lane) return [[a.x, a.lane], [b.x, b.lane]];
  const ends = (d: typeof da) => [d.x - d.w / 2 - STREET / 2, d.x + d.w / 2 + STREET / 2];
  const nearestEnd = (d: typeof da, towardX: number) => ends(d).reduce((best, x) => (Math.abs(x - towardX) < Math.abs(best - towardX) ? x : best));
  const rows = layout.rows;
  const above = (r: number) => rows[r].zMax + AVENUE / 2;
  const below = (r: number) => rows[r].zMin - AVENUE / 2;
  const pts: P[] = [[a.x, a.lane]];
  if (da.row === db.row) {
    const xa = nearestEnd(da, b.x);
    const xb = nearestEnd(db, a.x);
    const av = Math.abs(above(da.row) - a.lane) + Math.abs(above(da.row) - b.lane) < Math.abs(below(da.row) - a.lane) + Math.abs(below(da.row) - b.lane) ? above(da.row) : below(da.row);
    pts.push([xa, a.lane], [xa, av], [xb, av], [xb, b.lane]);
  } else {
    const down = db.row > da.row;
    const avA = down ? below(da.row) : above(da.row);
    const avB = down ? above(db.row) : below(db.row);
    const edge = a.x + b.x < 0 ? layout.bounds.minX + AVENUE / 2 : layout.bounds.maxX - AVENUE / 2;
    const xa = nearestEnd(da, edge);
    const xb = nearestEnd(db, edge);
    pts.push([xa, a.lane], [xa, avA], [edge, avA], [edge, avB], [xb, avB], [xb, b.lane]);
  }
  pts.push([b.x, b.lane]);
  return pts.filter((p, k) => k === 0 || p[0] !== pts[k - 1][0] || p[1] !== pts[k - 1][1]);
}

function keepRight(pts: P[]): P[] {
  const right = (p: P, q: P): P => {
    const dx = q[0] - p[0], dz = q[1] - p[1];
    const len = Math.hypot(dx, dz) || 1;
    return [-dz / len, dx / len];
  };
  return pts.map((p, k) => {
    const rin = k > 0 ? right(pts[k - 1], p) : null;
    const rout = k < pts.length - 1 ? right(p, pts[k + 1]) : null;
    const r = rin && rout && (rin[0] !== rout[0] || rin[1] !== rout[1]) ? [rin[0] + rout[0], rin[1] + rout[1]] : (rin ?? rout ?? [0, 0]);
    return [p[0] + r[0] * KEEP_RIGHT, p[1] + r[1] * KEEP_RIGHT];
  });
}

export interface Traffic {
  update(dt: number, player: THREE.Vector3): void;
  /** Show the cars of this file's references (blue = files that use it, orange = files it uses); null keeps only ambient traffic. */
  setFocus(node: number | null): void;
  /** The closest passing car within reach, for hitching a ride. */
  nearest(x: number, z: number, reach: number): RideCar | null;
  /** Rides `car` along its reference route; `arrived` fires at the used file's door. */
  board(car: RideCar, arrived: (car: RideCar) => void): void;
  leave(): void;
  readonly riding: RideCar | null;
  dispose(): void;
}

export interface RideCar { readonly f: number; readonly t: number; readonly x: number; readonly z: number; readonly dx: number; readonly dz: number; readonly speed: number }

type Car = { f: number; t: number; kind: 'ambient' | 'in' | 'out'; pts: P[]; cum: number[]; total: number; s: number; speed: number; x: number; z: number; dx: number; dz: number };

export function createTraffic(scene: THREE.Scene, layout: WalkLayout, arch: Architecture, roleColor: (role: number) => string, random: () => number): Traffic {
  const byNode = new Map(layout.buildings.map((b) => [b.i, b]));
  const valid = arch.edges.filter(([f, t]) => f !== t && byNode.has(f) && byNode.has(t));
  const makeCar = (f: number, t: number, kind: Car['kind']): Car | null => {
    const pts = keepRight(routeBetween(layout, byNode.get(f)!, byNode.get(t)!));
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    const total = cum[cum.length - 1];
    if (total <= 1) return null;
    return { f, t, kind, pts, cum, total, s: random() * total, speed: SPEED, x: pts[0][0], z: pts[0][1], dx: 0, dz: 1 };
  };
  const ambient = [...valid].sort((p, q) => q[2] - p[2]).slice(0, AMBIENT).map(([f, t]) => makeCar(f, t, 'ambient')).filter((c): c is Car => !!c);
  let cars: Car[] = [...ambient];

  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, cast = false) => {
    const m = new THREE.InstancedMesh(keep(geo), keep(mat), CAPACITY);
    m.castShadow = cast;
    m.frustumCulled = false;
    scene.add(m);
    owned.push(m);
    return m;
  };
  const body = mesh(new THREE.BoxGeometry(1.9, 0.62, 4.3).translate(0, 0.55, 0), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.55 }), true);
  const cabin = mesh(new THREE.BoxGeometry(1.62, 0.5, 2.2).translate(0, 1.1, -0.25), new THREE.MeshStandardMaterial({ color: '#10131b', roughness: 0.1, metalness: 0.8 }), true);
  const heads = mesh(new THREE.BoxGeometry(1.5, 0.14, 0.06).translate(0, 0.62, 2.16), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2d8').multiplyScalar(2.4) }));
  const tails = mesh(new THREE.BoxGeometry(1.5, 0.12, 0.06).translate(0, 0.66, -2.16), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a2a').multiplyScalar(1.8) }));
  const beams = mesh(new THREE.PlaneGeometry(2.6, 7).rotateX(-Math.PI / 2).translate(0, 0.03, 5.6), new THREE.MeshBasicMaterial({ color: '#fff0c8', transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending }));
  const all = [body, cabin, heads, tails, beams];
  const tint = new THREE.Color();
  const colorOf = (c: Car) => (c.kind === 'in' ? tint.set(IN) : c.kind === 'out' ? tint.set(OUT) : tint.set(roleColor(arch.nodes[c.f].role)).multiplyScalar(0.55));
  const recolor = () => {
    all.forEach((m) => (m.count = cars.length));
    cars.forEach((c, k) => body.setColorAt(k, colorOf(c)));
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
  };
  recolor();

  const labels = Array.from({ length: LABELS }, () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 72;
    const tex = keep(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })));
    sprite.scale.set(4.2, 0.6, 1);
    sprite.visible = false;
    scene.add(sprite);
    return { canvas, tex, sprite, car: null as Car | null };
  });
  const paintLabel = (label: (typeof labels)[number], c: Car) => {
    const ctx = label.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 512, 72);
    ctx.fillStyle = 'rgba(10,12,18,.85)';
    ctx.beginPath();
    ctx.roundRect(4, 6, 504, 60, 14);
    ctx.fill();
    ctx.fillStyle = c.kind === 'in' ? IN : c.kind === 'out' ? OUT : '#5c6270';
    ctx.fillRect(4, 58, 504, 8);
    ctx.font = '600 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eceef3';
    const text = `${arch.nodes[c.f].name} → ${arch.nodes[c.t].name}`;
    let shown = text;
    while (shown.length > 6 && ctx.measureText(shown).width > 480) shown = shown.slice(0, -2);
    ctx.fillText(shown === text ? text : `${shown}…`, 256, 44);
    label.tex.needsUpdate = true;
    label.car = c;
  };

  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  let labelClock = 0;
  let focus: number | null = null;
  let riding: Car | null = null;
  let arrived: ((car: RideCar) => void) | null = null;
  return {
    get riding() { return riding; },
    nearest(x, z, reach) {
      let best: Car | null = null;
      let bestD = reach;
      cars.forEach((c) => {
        const d = Math.hypot(c.x - x, c.z - z);
        if (d < bestD) { bestD = d; best = c; }
      });
      return best;
    },
    board(car, done) {
      riding = cars.find((c) => c === car) ?? null;
      arrived = done;
    },
    leave() {
      riding = null;
      arrived = null;
    },
    setFocus(node) {
      if (node === focus) return;
      focus = node;
      const related: Car[] = [];
      if (node !== null) {
        const pick = (list: typeof valid, kind: Car['kind']) => [...list].sort((p, q) => q[2] - p[2]).slice(0, PER_SIDE).forEach(([f, t]) => {
          const c = makeCar(f, t, kind);
          if (c) related.push(c);
        });
        pick(valid.filter(([, t]) => t === node), 'in');
        pick(valid.filter(([f]) => f === node), 'out');
      }
      const busy = new Set(related.map((c) => `${c.f}>${c.t}`));
      cars = [...related, ...ambient.filter((c) => !busy.has(`${c.f}>${c.t}`))].slice(0, CAPACITY);
      if (riding && !cars.includes(riding)) cars = [riding, ...cars].slice(0, CAPACITY);
      labels.forEach((l) => { l.sprite.visible = false; l.car = null; });
      recolor();
    },
    update(dt, player) {
      cars.forEach((c, k) => {
        const ahead = (player.x - c.x) * c.dx + (player.z - c.z) * c.dz;
        const side = Math.abs((player.x - c.x) * c.dz - (player.z - c.z) * c.dx);
        const target = c !== riding && ahead > 0 && ahead < 7 && side < 1.8 && player.y < 2 ? 0 : SPEED;
        c.speed += (target - c.speed) * Math.min(1, dt * (target ? 1.5 : 6));
        if (c === riding && c.s + c.speed * dt >= c.total) {
          c.s = c.total - 0.001;
          const done = arrived;
          riding = null;
          arrived = null;
          done?.(c);
        } else c.s = (c.s + c.speed * dt) % c.total;
        let seg = 1;
        while (seg < c.cum.length - 1 && c.cum[seg] < c.s) seg++;
        const [x0, z0] = c.pts[seg - 1];
        const [x1, z1] = c.pts[seg];
        const len = c.cum[seg] - c.cum[seg - 1] || 1;
        const t = (c.s - c.cum[seg - 1]) / len;
        c.x = x0 + (x1 - x0) * t;
        c.z = z0 + (z1 - z0) * t;
        c.dx += ((x1 - x0) / len - c.dx) * Math.min(1, dt * 8);
        c.dz += ((z1 - z0) / len - c.dz) * Math.min(1, dt * 8);
        q.setFromAxisAngle(up, Math.atan2(c.dx, c.dz));
        matrix.compose(v.set(c.x, 0, c.z), q, one);
        all.forEach((m) => m.setMatrixAt(k, matrix));
      });
      all.forEach((m) => (m.instanceMatrix.needsUpdate = true));

      labelClock -= dt;
      if (labelClock <= 0) {
        labelClock = 0.3;
        const near = cars.map((c) => ({ c, d: (c.x - player.x) ** 2 + (c.z - player.z) ** 2 })).filter((e) => e.d < 26 * 26).sort((a, b) => a.d - b.d).slice(0, LABELS).map((e) => e.c);
        const wanted = new Set(near);
        const free = labels.filter((l) => !l.car || !wanted.has(l.car));
        near.forEach((c) => {
          if (labels.some((l) => l.car === c)) return;
          const l = free.pop();
          if (l) paintLabel(l, c);
        });
        free.forEach((l) => { l.sprite.visible = false; l.car = null; });
      }
      labels.forEach((l) => {
        if (!l.car) return;
        l.sprite.position.set(l.car.x, 2.3, l.car.z);
        l.sprite.visible = true;
      });
    },
    dispose() {
      owned.forEach((o) => o.dispose());
    },
  };
}
