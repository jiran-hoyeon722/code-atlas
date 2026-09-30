import * as THREE from 'three';
import type { Arena, BattleEvent, Side } from '../../../engine/battle/sim';
import { COMMANDER } from '../../../engine/battle/sim';
import { ease } from './clock';
import { CMD_SLOT, LANE_Z, MODE_DEAD, MODE_STAGED, SIDES, SLOTS, blendedPos, type Replay } from './replay';

const COLORS = {
  panel: 0x16181d,
  table: 0x1d2027,
  a: 0x3cc4b4,
  b: 0xf2a541,
};

const TABLE = { w: 96, d: 52 } as const;
const FOV = 38;
/** Camera elevation above the table plane. */
const PITCH = (54 * Math.PI) / 180;
const FOCUS_MS = 480;
const HIT_MS = 120;
const FADE_MS = 480;
const DEATH_FLASH_MS = 480;
const FLASH_POOL = 96;

export interface FieldHandle {
  draw(replay: Replay, now: number): void;
  effects(events: readonly BattleEvent[], replay: Replay, now: number): void;
  focus(arena: Arena | null, now: number): void;
  /** Screen position (px, relative to the container) of a table point, or null when off screen. */
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  dispose(): void;
}

interface SideMeshes {
  sprint: THREE.InstancedMesh;
  heavy: THREE.InstancedMesh;
  commander: THREE.Mesh;
  ring: THREE.Mesh;
  /** Soldier index → [mesh, instance]. */
  slot: { heavy: boolean; at: number }[];
}

export function mountField(container: HTMLElement, replay: Replay): FieldHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(COLORS.panel, 1);
  renderer.domElement.className = 'rb-eng-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 600);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x303640, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-20, 60, 30);
  scene.add(sun);

  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(d: T) => (disposables.push(d), d);

  // Table, grid and lane marks: flat colours kept out of tone mapping so they match the UI tokens exactly.
  const tableMat = keep(new THREE.MeshBasicMaterial({ color: COLORS.table, toneMapped: false }));
  const table = new THREE.Mesh(keep(roundedPlane(TABLE.w, TABLE.d, 3)), tableMat);
  table.rotation.x = -Math.PI / 2;
  scene.add(table);

  const gridPts: number[] = [];
  const step = 4;
  for (let x = -TABLE.w / 2 + step; x < TABLE.w / 2 - 0.01; x += step) gridPts.push(x, 0.01, -TABLE.d / 2, x, 0.01, TABLE.d / 2);
  for (let z = -TABLE.d / 2 + step; z < TABLE.d / 2 - 0.01; z += step) gridPts.push(-TABLE.w / 2, 0.01, z, TABLE.w / 2, 0.01, z);
  scene.add(lines(gridPts, 0.035));
  const laneEdge = LANE_Z.bottom / 2;
  scene.add(lines([-TABLE.w / 2, 0.02, -laneEdge, TABLE.w / 2, 0.02, -laneEdge, -TABLE.w / 2, 0.02, laneEdge, TABLE.w / 2, 0.02, laneEdge], 0.09));
  scene.add(lines([0, 0.02, -TABLE.d / 2, 0, 0.02, TABLE.d / 2], 0.07));

  function lines(pts: number[], opacity: number): THREE.LineSegments {
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = keep(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity, toneMapped: false, depthWrite: false }));
    return new THREE.LineSegments(g, m);
  }

  // Units: one instanced mesh per side and body.
  const sprintGeo = keep(new THREE.OctahedronGeometry(0.34, 0));
  sprintGeo.scale(1, 1.35, 1);
  sprintGeo.translate(0, 0.46, 0);
  const heavyGeo = keep(new THREE.BoxGeometry(0.72, 0.62, 0.72));
  heavyGeo.translate(0, 0.31, 0);
  const cmdGeo = keep(new THREE.OctahedronGeometry(0.85, 0));
  cmdGeo.scale(1, 1.5, 1);
  cmdGeo.translate(0, 1.28, 0);
  const ringGeo = keep(new THREE.RingGeometry(1.35, 1.55, 48));
  ringGeo.rotateX(-Math.PI / 2);
  ringGeo.translate(0, 0.03, 0);
  const unitMat = keep(new THREE.MeshLambertMaterial({ color: 0xffffff }));

  const teamColor: Record<Side, THREE.Color> = { a: new THREE.Color(COLORS.a), b: new THREE.Color(COLORS.b) };
  const tableColor = new THREE.Color(COLORS.table);
  const white = new THREE.Color(0xffffff);

  const meshes = {} as Record<Side, SideMeshes>;
  for (const side of SIDES) {
    const army = replay.battle.armies[side];
    const slot: SideMeshes['slot'] = [];
    let nh = 0;
    let ns = 0;
    for (const s of army.soldiers) {
      const heavy = army.squads[s.squad].body === 'heavy';
      slot.push({ heavy, at: heavy ? nh++ : ns++ });
    }
    const sprint = new THREE.InstancedMesh(sprintGeo, unitMat, Math.max(1, ns));
    const heavy = new THREE.InstancedMesh(heavyGeo, unitMat, Math.max(1, nh));
    sprint.count = ns;
    heavy.count = nh;
    for (const m of [sprint, heavy]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, teamColor[side]);
      m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
    }
    const cmdMat = keep(new THREE.MeshLambertMaterial({ color: teamColor[side] }));
    const commander = new THREE.Mesh(cmdGeo, cmdMat);
    const ringMat = keep(new THREE.MeshBasicMaterial({ color: teamColor[side], transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false }));
    const ring = new THREE.Mesh(ringGeo, ringMat);
    scene.add(commander, ring);
    meshes[side] = { sprint, heavy, commander, ring, slot };
    disposables.push(sprint, heavy);
  }

  // Death flashes: additive discs, so an instance colour of black is invisible and brightness works as alpha.
  const flashGeo = keep(new THREE.RingGeometry(0.78, 1, 40));
  flashGeo.rotateX(-Math.PI / 2);
  const flashMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const flashes = new THREE.InstancedMesh(flashGeo, flashMat, FLASH_POOL);
  flashes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  flashes.setColorAt(0, new THREE.Color(0));
  flashes.frustumCulled = false;
  scene.add(flashes);
  disposables.push(flashes);
  const flashState = Array.from({ length: FLASH_POOL }, () => ({ at: -Infinity, x: 0, z: 0, side: 'a' as Side, big: false }));
  let flashNext = 0;

  const hitAt: Record<Side, Float64Array> = { a: new Float64Array(SLOTS).fill(-Infinity), b: new Float64Array(SLOTS).fill(-Infinity) };
  const deadAt: Record<Side, Float64Array> = { a: new Float64Array(SLOTS).fill(-Infinity), b: new Float64Array(SLOTS).fill(-Infinity) };
  const deadSeen: Record<Side, Uint8Array> = { a: new Uint8Array(SLOTS), b: new Uint8Array(SLOTS) };

  // Camera: overview framing is refit on resize; focus moves ease between two framings.
  let width = 1;
  let height = 1;
  interface View {
    tx: number;
    tz: number;
    dist: number;
  }
  let overview: View = { tx: 0, tz: 0, dist: 120 };
  let focusArena: Arena | null = null;
  let from: View = overview;
  let to: View = overview;
  let moveStart = -Infinity;

  function fitOverview(): View {
    // Search the distance at which every table corner lands inside the band left free by the HUD and controls.
    const corners = [
      [-TABLE.w / 2, -TABLE.d / 2],
      [TABLE.w / 2, -TABLE.d / 2],
      [-TABLE.w / 2, TABLE.d / 2],
      [TABLE.w / 2, TABLE.d / 2],
    ];
    const band = { x: 0.95, top: 1 - (2 * 150) / height, bottom: -1 + (2 * 110) / height };
    const tz = 0;
    const fits = (dist: number) => {
      placeCamera({ tx: 0, tz, dist });
      camera.updateProjectionMatrix();
      return corners.every(([x, z]) => {
        const p = new THREE.Vector3(x, 0, z).project(camera);
        return Math.abs(p.x) <= band.x && p.y <= band.top && p.y >= band.bottom;
      });
    };
    let lo = 20;
    let hi = 600;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return { tx: 0, tz, dist: hi };
  }

  function viewFor(arena: Arena | null): View {
    if (arena === null) return overview;
    if (arena === 'final') return { tx: 0, tz: 0.5, dist: overview.dist * 0.62 };
    return { tx: 0, tz: LANE_Z[arena] - 4, dist: overview.dist * 0.52 };
  }

  function currentView(now: number): View {
    const k = ease(Math.min(1, (now - moveStart) / FOCUS_MS));
    return { tx: from.tx + (to.tx - from.tx) * k, tz: from.tz + (to.tz - from.tz) * k, dist: from.dist + (to.dist - from.dist) * k };
  }

  function placeCamera(v: View): void {
    camera.position.set(v.tx, Math.sin(PITCH) * v.dist, v.tz + Math.cos(PITCH) * v.dist);
    camera.lookAt(v.tx, 0, v.tz);
    camera.updateMatrixWorld();
  }

  function resize(): void {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    overview = fitOverview();
    from = viewFor(focusArena);
    to = from;
    moveStart = -Infinity;
    placeCamera(to);
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();

  function unitLook(side: Side, i: number, mode: number, now: number): { scale: number } {
    col.copy(teamColor[side]);
    let scale = 1;
    if (mode === MODE_STAGED) {
      col.lerp(tableColor, 0.62);
      scale = 0.72;
    } else if (mode === MODE_DEAD) {
      const k = Math.min(1, (now - deadAt[side][i]) / FADE_MS);
      const flash = Math.max(0, 1 - (now - deadAt[side][i]) / HIT_MS);
      col.lerp(tableColor, ease(k));
      if (flash > 0) col.lerp(white, 0.8 * flash);
      scale = 1 - 0.6 * ease(k);
      if (k >= 1) scale = 0;
    }
    const hit = Math.max(0, 1 - (now - hitAt[side][i]) / HIT_MS);
    if (hit > 0 && mode !== MODE_DEAD) col.lerp(white, 0.45 * hit);
    return { scale };
  }

  function draw(r: Replay, now: number): void {
    const t = r.blend;
    for (const side of SIDES) {
      const prev = r.prev[side];
      const cur = r.cur[side];
      const m = meshes[side];
      for (let i = 0; i < CMD_SLOT; i++) {
        const mode = cur.mode[i];
        if (mode === MODE_DEAD && !deadSeen[side][i]) {
          deadSeen[side][i] = 1;
          deadAt[side][i] = r.jumped || prev.mode[i] === MODE_DEAD ? now - FADE_MS : now;
        }
        const [x, z] = blendedPos(prev, cur, i, t);
        const { scale } = unitLook(side, i, mode, now);
        pos.set(x, 0, z);
        scl.setScalar(scale);
        m4.compose(pos, q, scl);
        const s = m.slot[i];
        const mesh = s.heavy ? m.heavy : m.sprint;
        mesh.setMatrixAt(s.at, m4);
        mesh.setColorAt(s.at, col);
      }
      for (const mesh of [m.sprint, m.heavy]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      const kmode = cur.mode[CMD_SLOT];
      if (kmode === MODE_DEAD && !deadSeen[side][CMD_SLOT]) {
        deadSeen[side][CMD_SLOT] = 1;
        deadAt[side][CMD_SLOT] = r.jumped ? now - FADE_MS : now;
      }
      const [kx, kz] = blendedPos(prev, cur, CMD_SLOT, t);
      const { scale } = unitLook(side, CMD_SLOT, kmode, now);
      m.commander.position.set(kx, 0, kz);
      m.commander.scale.setScalar(Math.max(0.0001, scale));
      m.commander.visible = scale > 0;
      (m.commander.material as THREE.MeshLambertMaterial).color.copy(col);
      m.ring.position.set(kx, 0, kz);
      m.ring.visible = kmode !== MODE_DEAD;
    }

    for (let j = 0; j < FLASH_POOL; j++) {
      const f = flashState[j];
      const k = (now - f.at) / DEATH_FLASH_MS;
      if (k < 0 || k >= 1) {
        m4.makeScale(0, 0, 0);
        flashes.setMatrixAt(j, m4);
        continue;
      }
      const e = ease(k);
      const size = (f.big ? 1.6 : 0.5) + (f.big ? 4 : 1.1) * e;
      pos.set(f.x, 0.05, f.z);
      scl.set(size, 1, size);
      m4.compose(pos, q, scl);
      flashes.setMatrixAt(j, m4);
      col.copy(teamColor[f.side]).multiplyScalar(0.8 * (1 - e));
      flashes.setColorAt(j, col);
    }
    flashes.instanceMatrix.needsUpdate = true;
    if (flashes.instanceColor) flashes.instanceColor.needsUpdate = true;

    placeCamera(currentView(now));
    renderer.render(scene, camera);
  }

  function effects(events: readonly BattleEvent[], r: Replay, now: number): void {
    if (r.jumped) return;
    for (const e of events) {
      if (e.kind === 'hit') {
        hitAt[e.target.side][e.target.index === COMMANDER ? CMD_SLOT : e.target.index] = now;
      } else if (e.kind === 'death') {
        const i = e.unit.index === COMMANDER ? CMD_SLOT : e.unit.index;
        const f = flashState[flashNext];
        flashNext = (flashNext + 1) % FLASH_POOL;
        f.at = now;
        f.x = r.cur[e.unit.side].x[i];
        f.z = r.cur[e.unit.side].z[i];
        f.side = e.unit.side;
        f.big = i === CMD_SLOT;
      }
    }
  }

  function focus(arena: Arena | null, now: number): void {
    from = currentView(now);
    focusArena = arena;
    to = viewFor(arena);
    moveStart = now;
  }

  const v = new THREE.Vector3();
  function project(x: number, y: number, z: number): { x: number; y: number } | null {
    v.set(x, y, z).project(camera);
    if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) return null;
    return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
  }

  function dispose(): void {
    ro.disconnect();
    for (const d of disposables) d.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }

  return { draw, effects, focus, project, dispose };
}

function roundedPlane(w: number, h: number, r: number): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return new THREE.ShapeGeometry(s, 8);
}
