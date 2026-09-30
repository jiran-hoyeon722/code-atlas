import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import 'highlight.js/styles/github-dark.css';
import './walk.css';
import type { MountViewer } from '../viewer-env';
import { esc } from '../escape';
import { roleColors } from '../palette';
import { renderCode } from '../code-viewer/highlight';
import { FLOOR, LANE, STREET, layoutWalk, type WalkBuilding } from './walkLayout';
import { BUILDING_FRAG, BUILDING_VERT, SKY_FRAG, SKY_VERT } from './walkShaders';
import { createModelHero, type Emote } from './walkHero';
import { createTraffic } from './walkTraffic';
import { createRain } from './walkRain';
import robotUrl from './assets/RobotExpressive.glb?url';

const WALK = 4.2;
const RUN = 11;
const ACCEL = 22;
const GRAVITY = 18;
const JUMP = 6;
const RADIUS = 0.4;
const REACH = 3;
const SIGNS = 20;
const LAMP_LIGHTS = 6;
const GRID = 16;
const HORIZON = new THREE.Color('#1a1d36');
const ZENITH = new THREE.Color('#030409');
const fmt = (n: number) => Number(n).toLocaleString('ko-KR');

const MARKUP = `
<div class="wk-hud glass">
    <h1 data-el="title"></h1>
    <div class="keys"><b>WASD</b> 이동 · <b>Shift</b> 달리기 · <b>Space</b> 점프 · <b>클릭</b> 후 마우스로 시점 · <b>휠</b> 거리 · <b>E</b> 들어가기 · <b>/</b> 검색 · <b>R</b> 비 · <b>1~3</b> 인사·엄지·춤</div>
    <div class="search"><input data-el="q" type="search" placeholder="파일 이름으로 순간 이동 ( / )" autocomplete="off"></div>
</div>
<canvas class="wk-map glass" data-el="map" width="200" height="200" title="클릭하면 그 위치로 이동"></canvas>
<div class="wk-prompt glass" data-el="prompt"></div>
<div class="wk-fade" data-el="fade"></div>
<section class="wk-detail glass" data-el="detail" aria-label="건물 상세">
    <div class="head"><div class="title"><b data-el="d-name"></b><div class="path" data-el="d-path"></div></div><button data-el="d-close">나가기 (Esc)</button></div>
    <div class="metrics" data-el="d-metrics"></div>
    <div class="code-body"><pre class="gutter" data-el="d-gutter"></pre><pre class="source"><code class="hljs" data-el="d-src"></code></pre></div>
</section>`;

function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const mountWalk: MountViewer = (root, arch, env) => {
  root.classList.add('wk-walk');
  root.innerHTML = MARKUP;
  const $ = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-el="${name}"]`)!;
  const cleanups: (() => void)[] = [];
  const listen = <K extends keyof HTMLElementEventMap>(target: HTMLElement | Window | Document, type: K, fn: (ev: HTMLElementEventMap[K]) => void) => {
    target.addEventListener(type, fn as EventListener);
    cleanups.push(() => target.removeEventListener(type, fn as EventListener));
  };
  $('title').textContent = `${arch.name} — 걷기 (시험)`;
  const reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const palette = roleColors(arch);
  const roleColor = (role: number) => palette[role] ?? '#b8bfc7';
  const layout = layoutWalk(arch);
  const { bounds } = layout;
  const byNode = new Map(layout.buildings.map((b) => [b.i, b]));
  const indexOf = new Map(layout.buildings.map((b, k) => [b, k]));
  const random = rng(arch.nodes.length * 7919 + 17);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  root.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON, 80, 430);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 2000);
  scene.add(new THREE.HemisphereLight('#7f93d8', '#1c1d26', 0.75));
  const moon = new THREE.DirectionalLight('#b9c6ff', 0.9);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  Object.assign(moon.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 260 });
  moon.shadow.bias = -0.0006;
  scene.add(moon, moon.target);

  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => keep(new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra }));
  const glow = (color: string, boost: number) => keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(boost) }));
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  type Item = { x: number; y: number; z: number; sx?: number; sy?: number; sz?: number; ry?: number };
  function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: Item[], opts: { cast?: boolean; receive?: boolean } = {}) {
    const mesh = new THREE.InstancedMesh(keep(geo), mat, Math.max(1, items.length));
    mesh.count = items.length;
    items.forEach((it, k) => {
      q.setFromAxisAngle(up, it.ry ?? 0);
      mesh.setMatrixAt(k, matrix.compose(v.set(it.x, it.y, it.z), q, s.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1)));
    });
    mesh.castShadow = !!opts.cast;
    mesh.receiveShadow = !!opts.receive;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    disposables.push(mesh);
    return mesh;
  }

  // ---- sky ----
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(1500, 32, 16)), keep(new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uHorizon: { value: HORIZON }, uZenith: { value: ZENITH }, uGlow: { value: new THREE.Color('#3b2f5c') } },
  })));
  scene.add(sky);
  const starPos = new Float32Array(1800 * 3);
  for (let k = 0; k < 1800; k++) {
    const a = random() * Math.PI * 2;
    const h = 0.08 + random() * 0.92;
    const r = Math.sqrt(1 - h * h);
    starPos.set([Math.cos(a) * r * 1400, h * 1400, Math.sin(a) * r * 1400], k * 3);
  }
  const starGeo = keep(new THREE.BufferGeometry());
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, keep(new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })));
  scene.add(stars);
  const moonDisc = new THREE.Mesh(keep(new THREE.SphereGeometry(28, 24, 16)), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4dc').multiplyScalar(1.6), fog: false })));
  const moonDir = new THREE.Vector3(0.45, 0.55, -0.7).normalize();
  moonDisc.position.copy(moonDir).multiplyScalar(1200);
  scene.add(moonDisc);

  // ---- ground, lots, lanes ----
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(bounds.maxX - bounds.minX + 400, bounds.maxZ - bounds.minZ + 400)), std('#1a1c24', { roughness: 0.42, metalness: 0.15 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  const lots = instanced(new THREE.BoxGeometry(1, 1, 1), std('#ffffff', { roughness: 0.8 }), layout.strips.map((st) => ({ x: st.x, y: 0.08, z: st.z, sx: st.w, sy: 0.16, sz: st.d })), { receive: true });
  layout.strips.forEach((st, k) => lots.setColorAt(k, new THREE.Color('#2a2d35').lerp(new THREE.Color(roleColor(st.role)), 0.1)));
  if (lots.instanceColor) lots.instanceColor.needsUpdate = true;
  instanced(new THREE.BoxGeometry(1, 1, 1), std('#5a5f6b'), layout.strips.flatMap((st) => [-1, 1].map((side) => ({ x: st.x, y: 0.09, z: st.z + side * (st.d / 2 - 0.12), sx: st.w, sy: 0.18, sz: 0.24 }))), { receive: true });

  const dashes = layout.lanes.flatMap((l) => Array.from({ length: Math.floor(l.w / 6) }, (_, k) => ({ x: l.x - l.w / 2 + 3 + k * 6, y: 0.015, z: l.z, sx: 2.2, sy: 0.02, sz: 0.16 })));
  instanced(new THREE.BoxGeometry(1, 1, 1), std('#c9b35a', { emissive: '#2a2410' }), dashes);
  const zebra = layout.lanes.flatMap((l) => [-1, 1].flatMap((side) => {
    const x = l.x + side * (l.w / 2 - STREET / 2 + 2.2);
    return Array.from({ length: 6 }, (_, k) => ({ x, y: 0.015, z: l.z - LANE / 2 + 1.1 + k * ((LANE - 2.2) / 5), sx: 3, sy: 0.02, sz: 0.6 }));
  }));
  instanced(new THREE.BoxGeometry(1, 1, 1), std('#d9dbe0', { roughness: 0.6 }), zebra);

  // ---- lamps, benches, trees ----
  const lampSpots = layout.lanes.flatMap((l) => Array.from({ length: Math.max(1, Math.floor(l.w / 22)) }, (_, k) => [
    { x: l.x - l.w / 2 + 11 + k * 22, z: l.z - LANE / 2 - 0.5, side: -1 },
    { x: l.x - l.w / 2 + 22 + k * 22, z: l.z + LANE / 2 + 0.5, side: 1 },
  ]).flat());
  instanced(new THREE.CylinderGeometry(0.07, 0.11, 5.2, 8), std('#2d3139', { metalness: 0.6, roughness: 0.4 }), lampSpots.map((p) => ({ ...p, y: 2.6 })), { cast: true });
  instanced(new THREE.BoxGeometry(0.12, 0.1, 1.1), std('#2d3139', { metalness: 0.6, roughness: 0.4 }), lampSpots.map((p) => ({ ...p, y: 5.15, z: p.z - p.side * 0.5 })));
  instanced(new THREE.BoxGeometry(0.34, 0.12, 0.5), glow('#ffd29a', 2.2), lampSpots.map((p) => ({ ...p, y: 5.05, z: p.z - p.side * 0.95 })));
  const pool = keep(new THREE.MeshBasicMaterial({ color: '#ffb866', transparent: true, opacity: 0.035, depthWrite: false, blending: THREE.AdditiveBlending }));
  instanced(new THREE.CircleGeometry(4.5, 28).rotateX(-Math.PI / 2), pool, lampSpots.map((p) => ({ ...p, y: 0.2, z: p.z - p.side * 0.95 })));
  const lampLights = Array.from({ length: LAMP_LIGHTS }, () => {
    const l = new THREE.PointLight('#ffc27a', 0, 14, 1.8);
    scene.add(l);
    return l;
  });

  const benchSpots = lampSpots.filter(() => random() < 0.45).map((p) => ({ x: p.x + 2.2, z: p.z + p.side * 0.6, side: p.side }));
  instanced(new THREE.BoxGeometry(1.8, 0.08, 0.5), std('#6b4a32'), benchSpots.map((p) => ({ ...p, y: 0.62 })), { cast: true });
  instanced(new THREE.BoxGeometry(1.8, 0.4, 0.06), std('#6b4a32'), benchSpots.map((p) => ({ ...p, y: 0.85, z: p.z + p.side * 0.22 })), { cast: true });
  instanced(new THREE.BoxGeometry(0.08, 0.6, 0.45), std('#2d3139'), benchSpots.flatMap((p) => [-0.8, 0.8].map((dx) => ({ x: p.x + dx, y: 0.46, z: p.z }))));

  const treeSpots = layout.districts.flatMap((d) => {
    const out: { x: number; z: number; k: number }[] = [];
    for (let x = d.x - d.w / 2 + 4; x <= d.x + d.w / 2 - 4; x += 9) out.push({ x, z: d.z - d.d / 2 - 3.5, k: random() }, { x, z: d.z + d.d / 2 + 3.5, k: random() });
    return out;
  });
  const trunkItems = treeSpots.map((p) => ({ ...p, y: 1.1 }));
  const crownItems = treeSpots.map((p) => ({ ...p, y: 3.2 + p.k * 0.5, sx: 1 + p.k * 0.3, sy: 1.15 + p.k * 0.3, sz: 1 + p.k * 0.3, ry: p.k * 6 }));
  const trunks = instanced(new THREE.CylinderGeometry(0.13, 0.19, 2.2, 7), std('#3e3024'), trunkItems, { cast: true });
  const crowns = instanced(new THREE.IcosahedronGeometry(1.5, 1), std('#27583e', { flatShading: true }), crownItems, { cast: true });
  const hiddenTrees = new Set<number>();
  const seg = new THREE.Line3();
  const closest = new THREE.Vector3();
  const place = (mesh: THREE.InstancedMesh, it: Item, k: number, shown: boolean) => {
    q.setFromAxisAngle(up, it.ry ?? 0);
    mesh.setMatrixAt(k, matrix.compose(v.set(it.x, it.y, it.z), q, shown ? s.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1) : s.setScalar(0.0001)));
  };
  // Trees between the camera and the hero would hide the hero, so they step aside while in the way.
  function clearView(from: THREE.Vector3, to: THREE.Vector3) {
    seg.set(from, to);
    let changed = false;
    treeSpots.forEach((t, k) => {
      if (Math.abs(t.x - to.x) > 30 || Math.abs(t.z - to.z) > 30) { if (!hiddenTrees.has(k)) return; }
      seg.closestPointToPoint(v.set(t.x, crownItems[k].y, t.z), true, closest);
      const block = closest.distanceTo(v) < 2.4 && Math.abs(t.x - to.x) <= 30 && Math.abs(t.z - to.z) <= 30;
      if (block === hiddenTrees.has(k)) return;
      if (block) hiddenTrees.add(k); else hiddenTrees.delete(k);
      place(trunks, trunkItems[k], k, !block);
      place(crowns, crownItems[k], k, !block);
      changed = true;
    });
    if (changed) { trunks.instanceMatrix.needsUpdate = true; crowns.instanceMatrix.needsUpdate = true; }
  }

  // ---- buildings: tall ones get a set-back upper tier ----
  type Part = { k: number; b: WalkBuilding; x: number; z: number; w: number; d: number; h: number; base: number };
  const parts: Part[] = [];
  const roofs: Item[] = [];
  const tallest = [...layout.buildings].sort((a, c) => c.h - a.h).slice(0, Math.max(1, Math.ceil(layout.buildings.length * 0.04)));
  layout.buildings.forEach((b, k) => {
    const floors = Math.round(b.h / FLOOR);
    const tiered = floors >= 8;
    const lower = tiered ? Math.round(floors * 0.62) * FLOOR : b.h;
    parts.push({ k, b, x: b.x, z: b.z, w: b.w, d: b.d, h: lower, base: 0 });
    let top = { w: b.w, d: b.d, h: lower };
    if (tiered) {
      const shrink = 0.62 + random() * 0.15;
      top = { w: b.w * shrink, d: b.d * shrink, h: b.h };
      parts.push({ k, b, x: b.x, z: b.z - b.face * b.d * 0.08, w: top.w, d: top.d, h: b.h - lower, base: lower });
    }
    const units = 1 + Math.floor(random() * 3);
    for (let u = 0; u < units; u++) {
      const sx = 0.8 + random() * 1.6;
      roofs.push({ x: b.x + (random() - 0.5) * top.w * 0.55, y: top.h + 0.16 + sx * 0.3, z: b.z + (random() - 0.5) * top.d * 0.55, sx, sy: sx * 0.6, sz: 0.8 + random() * 1.2, ry: random() < 0.5 ? 0 : Math.PI / 2 });
    }
  });
  const bgeo = keep(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const pc = parts.length;
  const attr = (size: number) => new Float32Array(Math.max(1, pc) * size);
  const aSize = attr(3), aColor = attr(3), aSeed = attr(1), aFace = attr(1), aBase = attr(1);
  const tmpColor = new THREE.Color();
  parts.forEach((p, j) => {
    aSize.set([p.w, p.h, p.d], j * 3);
    tmpColor.set(roleColor(arch.nodes[p.b.i].role));
    aColor.set([tmpColor.r, tmpColor.g, tmpColor.b], j * 3);
    aSeed[j] = p.k;
    aFace[j] = p.b.face;
    aBase[j] = p.base;
  });
  bgeo.setAttribute('aSize', new THREE.InstancedBufferAttribute(aSize, 3));
  bgeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3));
  bgeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
  bgeo.setAttribute('aFace', new THREE.InstancedBufferAttribute(aFace, 1));
  bgeo.setAttribute('aBase', new THREE.InstancedBufferAttribute(aBase, 1));
  const uniforms = { uFog: { value: HORIZON }, uFocus: { value: -1 }, uTime: { value: 0 } };
  const bmat = keep(new THREE.ShaderMaterial({ vertexShader: BUILDING_VERT, fragmentShader: BUILDING_FRAG, uniforms }));
  const buildings = new THREE.InstancedMesh(bgeo, bmat, Math.max(1, pc));
  buildings.count = pc;
  parts.forEach((p, j) => buildings.setMatrixAt(j, matrix.compose(v.set(p.x, 0.16 + p.base, p.z), q.identity(), s.set(p.w, p.h, p.d))));
  buildings.computeBoundingSphere();
  buildings.castShadow = true;
  scene.add(buildings);
  disposables.push(buildings);
  instanced(new THREE.BoxGeometry(1, 1, 1), std('#3a3e48', { metalness: 0.3, roughness: 0.6 }), roofs, { cast: true });
  const beacons = instanced(new THREE.SphereGeometry(0.35, 10, 8), glow('#ff3b3b', 3), tallest.map((b) => ({ x: b.x, y: b.h + 4.6, z: b.z })));
  instanced(new THREE.CylinderGeometry(0.05, 0.08, 4.4, 6), std('#6b7080', { metalness: 0.7 }), tallest.map((b) => ({ x: b.x, y: b.h + 2.4, z: b.z })));

  // ---- district boards: role name on two posts facing the avenue ----
  const boardTextures: THREE.CanvasTexture[] = [];
  layout.districts.forEach((d) => {
    const role = arch.roles[d.role];
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 192;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = 'rgba(10,12,18,.9)';
    ctx.fillRect(0, 0, 1024, 192);
    ctx.fillStyle = roleColor(d.role);
    ctx.fillRect(0, 0, 1024, 12);
    ctx.fillStyle = '#f2f3f7';
    ctx.font = '700 84px system-ui, sans-serif';
    ctx.fillText(role.name, 40, 118);
    ctx.fillStyle = '#9aa0ad';
    ctx.font = '500 34px system-ui, sans-serif';
    ctx.fillText(role.description.slice(0, 40), 40, 170);
    const tex = keep(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    boardTextures.push(tex);
    const mat = keep(new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.1, 1.1, 1.1), side: THREE.DoubleSide }));
    [1, -1].forEach((side) => {
      const board = new THREE.Mesh(keep(new THREE.PlaneGeometry(9, 1.7)), mat);
      board.position.set(d.x, 4.2, d.z + side * (d.d / 2 + 5.5));
      board.rotation.y = side > 0 ? 0 : Math.PI;
      scene.add(board);
    });
    instanced(new THREE.BoxGeometry(0.16, 5, 0.16), std('#2d3139', { metalness: 0.6 }), [1, -1].flatMap((side) => [-4.3, 4.3].map((dx) => ({ x: d.x + dx, y: 2.5, z: d.z + side * (d.d / 2 + 5.5) }))), { cast: true });
  });

  // ---- collision grid ----
  const grid = new Map<string, WalkBuilding[]>();
  const key = (gx: number, gz: number) => `${gx},${gz}`;
  layout.buildings.forEach((b) => {
    for (let gx = Math.floor((b.x - b.w / 2) / GRID); gx <= Math.floor((b.x + b.w / 2) / GRID); gx++)
      for (let gz = Math.floor((b.z - b.d / 2) / GRID); gz <= Math.floor((b.z + b.d / 2) / GRID); gz++) {
        const list = grid.get(key(gx, gz)) ?? [];
        list.push(b);
        grid.set(key(gx, gz), list);
      }
  });
  const nearby = (x: number, z: number, r: number) => {
    const out = new Set<WalkBuilding>();
    for (let gx = Math.floor((x - r) / GRID); gx <= Math.floor((x + r) / GRID); gx++)
      for (let gz = Math.floor((z - r) / GRID); gz <= Math.floor((z + r) / GRID); gz++) grid.get(key(gx, gz))?.forEach((b) => out.add(b));
    return out;
  };
  const gap = (b: WalkBuilding, x: number, z: number) => Math.hypot(Math.max(0, Math.abs(x - b.x) - b.w / 2), Math.max(0, Math.abs(z - b.z) - b.d / 2));
  const insideBuilding = (p: THREE.Vector3) => {
    for (const b of nearby(p.x, p.z, 1)) if (gap(b, p.x, p.z) < 0.4 && p.y < b.h + 0.5) return true;
    return false;
  };
  const blocked = (x: number, z: number) => {
    for (const b of nearby(x, z, RADIUS + 1)) if (gap(b, x, z) < RADIUS) return true;
    return x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ;
  };

  // ---- shop signs on the awning, pooled to the nearest buildings ----
  const signGeo = keep(new THREE.PlaneGeometry(1, 1));
  const signs = Array.from({ length: SIGNS }, () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 64;
    const tex = keep(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(signGeo, keep(new THREE.MeshBasicMaterial({ map: tex, transparent: true })));
    mesh.visible = false;
    scene.add(mesh);
    return { canvas, tex, mesh, owner: -1 };
  });
  function paintSign(sign: (typeof signs)[number], b: WalkBuilding) {
    const ctx = sign.canvas.getContext('2d');
    if (!ctx) return;
    const n = arch.nodes[b.i];
    ctx.clearRect(0, 0, 512, 64);
    ctx.fillStyle = 'rgba(8,10,16,.92)';
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = roleColor(n.role);
    ctx.fillRect(0, 60, 512, 4);
    ctx.fillStyle = '#f4f5f8';
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    let name = n.name;
    while (name.length > 4 && ctx.measureText(name).width > 490) name = name.slice(0, -2);
    ctx.fillText(name === n.name ? name : `${name}…`, 256, 46);
    sign.tex.needsUpdate = true;
    sign.owner = b.i;
  }
  function updateSigns(x: number, z: number) {
    const near = [...nearby(x, z, 56)].map((b) => ({ b, dist: gap(b, x, z) })).sort((a, c) => a.dist - c.dist).slice(0, SIGNS).map((e) => e.b);
    const wanted = new Set(near.map((b) => b.i));
    const free = signs.filter((sg) => !wanted.has(sg.owner));
    near.forEach((b) => {
      let sign = signs.find((sg) => sg.owner === b.i);
      if (!sign) {
        sign = free.pop();
        if (!sign) return;
        paintSign(sign, b);
      }
      sign.mesh.position.set(b.x, 3.24, b.z + b.face * (b.d / 2 + 0.03));
      sign.mesh.rotation.y = b.face > 0 ? 0 : Math.PI;
      sign.mesh.scale.set(Math.min(b.w * 0.9, 7), Math.min(b.w * 0.9, 7) / 8, 1);
      sign.mesh.visible = true;
    });
    free.forEach((sg) => { sg.mesh.visible = false; sg.owner = -1; });
  }
  function updateLampLights(x: number, z: number) {
    lampSpots.map((p) => ({ p, d: (p.x - x) ** 2 + (p.z - z) ** 2 })).sort((a, c) => a.d - c.d).slice(0, LAMP_LIGHTS)
      .forEach(({ p }, k) => { lampLights[k].position.set(p.x, 4.8, p.z - p.side * 0.95); lampLights[k].intensity = 6; });
  }

  // ---- character ----
  const hero = createModelHero(robotUrl, () => {});
  scene.add(hero.root);
  const traffic = createTraffic(scene, layout, arch, roleColor, random);
  const rain = createRain(scene, ground, HORIZON, random);
  const applyWeather = () => {
    const on = rain.enabled;
    stars.visible = !on;
    moonDisc.visible = !on;
    moon.intensity = on ? 0.35 : 0.9;
    (scene.fog as THREE.Fog).near = on ? 50 : 80;
    (scene.fog as THREE.Fog).far = on ? 330 : 430;
    (sky.material as THREE.ShaderMaterial).uniforms.uGlow.value.set(on ? '#22263a' : '#3b2f5c');
  };
  applyWeather();
  const blobTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
      g.addColorStop(0, 'rgba(0,0,0,.55)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    }
    return keep(new THREE.CanvasTexture(c));
  })();
  const blob = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2)), keep(new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })));
  scene.add(blob);

  const frontOf = (b: WalkBuilding) => new THREE.Vector3(b.x, 0, b.z + b.face * (b.d / 2 + 2.6));
  const start = byNode.get(arch.nodes.findIndex((n) => n.path === env.selection.file))
    ?? [...layout.buildings].sort((a, c) => arch.nodes[c.i].centrality - arch.nodes[a.i].centrality)[0];
  const pos = start ? frontOf(start) : new THREE.Vector3(0, 0, bounds.maxZ - 10);
  const vel = new THREE.Vector3();
  let vy = 0;
  let footY = 0;
  let heading = start ? (start.face > 0 ? Math.PI : 0) : Math.PI;
  let turnRate = 0;
  let yaw = heading + Math.PI;
  let pitch = 0.3;
  let distance = 7.5;
  let fov = 58;
  const camPos = new THREE.Vector3();
  const lookAt = new THREE.Vector3(pos.x, 1.6, pos.z);
  camera.position.set(pos.x - Math.sin(heading) * 8, 4, pos.z - Math.cos(heading) * 8);
  const keys = new Set<string>();

  // ---- entering a building ----
  let focus: WalkBuilding | null = null;
  let detailOpen = false;
  let entering: { t0: number; dur: number; b: WalkBuilding; from: THREE.Vector3; fromLook: THREE.Vector3 } | null = null;
  let codeRequest = 0;
  function setFocus(b: WalkBuilding | null) {
    focus = b;
    uniforms.uFocus.value = b ? indexOf.get(b) ?? -1 : -1;
    const prompt = $('prompt');
    if (b) prompt.innerHTML = `<b>E</b> 들어가기 — ${esc(arch.nodes[b.i].name)}`;
    prompt.classList.toggle('open', !!b && !detailOpen);
  }
  function enter(b: WalkBuilding) {
    keys.clear();
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
    heading = b.face > 0 ? Math.PI : 0;
    $('prompt').classList.remove('open');
    if (reduceMotion) { void openDetail(b); return; }
    entering = { t0: performance.now(), dur: 900, b, from: camera.position.clone(), fromLook: lookAt.clone() };
    root.classList.add('entering');
  }
  async function openDetail(b: WalkBuilding) {
    const n = arch.nodes[b.i];
    detailOpen = true;
    $('d-name').textContent = n.name;
    $('d-path').textContent = n.path;
    const metric = (value: number, label: string) => `<div class="metric"><b>${esc(fmt(value))}</b><span>${esc(label)}</span></div>`;
    $('d-metrics').innerHTML = `<span class="chip" style="--c:${esc(roleColor(n.role))}">${esc(arch.roles[n.role].name)}</span>`
      + metric(n.fanIn, 'fan-in') + metric(n.fanOut, 'fan-out') + metric(n.lines, '줄 수') + metric(n.functions, '함수 수') + metric(n.maxComplexity, '최대 복잡도');
    const src = $('d-src');
    src.className = 'hljs';
    src.textContent = '불러오는 중…';
    $('d-gutter').textContent = '';
    $('detail').classList.add('open');
    env.onSelect({ file: n.path });
    const request = ++codeRequest;
    const source = await env.readSource(n.path).catch(() => null);
    if (disposed || request !== codeRequest) return;
    if (source === null) { src.textContent = '소스를 읽지 못했어요. 폴더를 다시 연결해 주세요.'; return; }
    src.className = `hljs language-${arch.lang === 'ts' ? 'typescript' : 'php'}`;
    renderCode(src, source, arch.lang);
    $('d-gutter').textContent = source.split('\n').map((_, k) => k + 1).join('\n');
  }
  function leave() {
    detailOpen = false;
    entering = null;
    codeRequest++;
    root.classList.remove('entering');
    $('detail').classList.remove('open');
    setFocus(focus);
  }
  listen($('d-close'), 'click', leave);

  // ---- input ----
  const typing = () => document.activeElement instanceof HTMLInputElement;
  listen(window, 'keydown', (e) => {
    if (typing()) { if (e.key === 'Escape') (document.activeElement as HTMLElement).blur(); return; }
    if (e.key === 'Escape' && (detailOpen || entering)) { leave(); return; }
    if (detailOpen || entering) return;
    if (e.key === '/') { e.preventDefault(); $('q').focus(); return; }
    if ((e.key === 'e' || e.key === 'E' || e.key === 'ㄷ') && focus) { enter(focus); return; }
    if (e.code === 'KeyR') { rain.set(!rain.enabled); applyWeather(); return; }
    const emote = ({ Digit1: 'Wave', Digit2: 'ThumbsUp', Digit3: 'Dance' } as Record<string, Emote>)[e.code];
    if (emote) { hero.emote(emote); return; }
    if (e.code === 'Space') {
      e.preventDefault();
      if (footY <= 0.001) vy = JUMP;
      return;
    }
    keys.add(e.code);
    if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  listen(window, 'keyup', (e) => keys.delete(e.code));
  listen(window, 'blur', () => keys.clear());
  listen(renderer.domElement, 'click', () => { if (!detailOpen && !entering) renderer.domElement.requestPointerLock?.(); });
  let dragging = false;
  listen(renderer.domElement, 'pointerdown', () => (dragging = true));
  listen(window, 'pointerup', () => (dragging = false));
  listen(document, 'mousemove', (e) => {
    if (detailOpen || entering) return;
    if (document.pointerLockElement !== renderer.domElement && !dragging) return;
    yaw -= e.movementX * 0.0032;
    pitch = Math.min(1.15, Math.max(-0.05, pitch + e.movementY * 0.0026));
  });
  listen(renderer.domElement, 'wheel', (e) => {
    e.preventDefault();
    distance = Math.min(22, Math.max(2.5, distance + e.deltaY * 0.01));
  });

  function teleport(to: THREE.Vector3) {
    pos.copy(to);
    vel.set(0, 0, 0);
    for (let r = 0; r < 30 && blocked(pos.x, pos.z); r++) pos.z += 1;
    updateLampLights(pos.x, pos.z);
  }
  listen($<HTMLInputElement>('q'), 'keydown', (e) => {
    if (e.key !== 'Enter') return;
    const text = (e.target as HTMLInputElement).value.trim().toLowerCase();
    if (!text) return;
    const hit = layout.buildings.find((b) => arch.nodes[b.i].name.toLowerCase().includes(text)) ?? layout.buildings.find((b) => arch.nodes[b.i].path.toLowerCase().includes(text));
    if (!hit) return;
    teleport(frontOf(hit));
    heading = hit.face > 0 ? Math.PI : 0;
    yaw = heading + Math.PI;
    (e.target as HTMLInputElement).blur();
  });

  // ---- minimap ----
  const map = $<HTMLCanvasElement>('map');
  const mapCtx = map.getContext('2d');
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const toMap = (x: number, z: number) => [((x - bounds.minX) / span) * 200, ((z - bounds.minZ) / span) * 200];
  const base = document.createElement('canvas');
  base.width = base.height = 200;
  const baseCtx = base.getContext('2d');
  if (baseCtx) {
    baseCtx.fillStyle = '#0f1116';
    baseCtx.fillRect(0, 0, 200, 200);
    layout.buildings.forEach((b) => {
      const [x, y] = toMap(b.x - b.w / 2, b.z - b.d / 2);
      baseCtx.fillStyle = roleColor(arch.nodes[b.i].role);
      baseCtx.fillRect(x, y, Math.max(1, (b.w / span) * 200), Math.max(1, (b.d / span) * 200));
    });
  }
  listen(map, 'click', (e) => {
    const r = map.getBoundingClientRect();
    const x = bounds.minX + ((e.clientX - r.left) / r.width) * span;
    const z = bounds.minZ + ((e.clientY - r.top) / r.height) * span;
    const lane = layout.lanes.reduce((best, l) => (Math.abs(l.z - z) < Math.abs(best.z - z) ? l : best), layout.lanes[0]);
    if (lane) teleport(new THREE.Vector3(x, 0, lane.z));
  });
  function drawMap() {
    if (!mapCtx) return;
    mapCtx.drawImage(base, 0, 0);
    const [x, y] = toMap(pos.x, pos.z);
    mapCtx.save();
    mapCtx.translate(x, y);
    mapCtx.rotate(Math.PI - heading);
    mapCtx.fillStyle = '#ffffff';
    mapCtx.beginPath();
    mapCtx.moveTo(0, -6); mapCtx.lineTo(4, 5); mapCtx.lineTo(-4, 5);
    mapCtx.fill();
    mapCtx.restore();
  }

  // ---- post-processing ----
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.35, 0.82);
  composer.addPass(bloom);
  const output = new OutputPass();
  composer.addPass(output);

  const size = () => ({ w: Math.max(1, root.clientWidth), h: Math.max(1, root.clientHeight) });
  const resize = () => {
    const { w, h } = size();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    rain.resize(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(root);
  resize();
  updateLampLights(pos.x, pos.z);

  (window as unknown as { __walkView?: (y: number, p: number, d: number) => void }).__walkView = (y, p, d) => { yaw += y; pitch = p; distance = d; };
  let disposed = false;
  let last = performance.now();
  let slowClock = 0;
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const wish = new THREE.Vector3();
  const doorPoint = new THREE.Vector3();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const time = now / 1000;
    uniforms.uTime.value = time;
    const input = (a: string[], b: string[]) => (a.some((k) => keys.has(k)) ? 1 : 0) - (b.some((k) => keys.has(k)) ? 1 : 0);
    const fz = input(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
    const fx = input(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);
    const running = keys.has('ShiftLeft') || keys.has('ShiftRight');
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(-forward.z, 0, forward.x);
    wish.set(0, 0, 0).addScaledVector(forward, fz).addScaledVector(right, fx);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(running ? RUN : WALK);
    const airborne = footY > 0.001 || vy > 0;
    vel.lerp(wish, Math.min(1, dt * (airborne ? ACCEL * 0.15 : ACCEL) / Math.max(1, vel.distanceTo(wish))));
    if (vel.lengthSq() < 0.0004 && wish.lengthSq() === 0) vel.set(0, 0, 0);
    if (!blocked(pos.x + vel.x * dt, pos.z)) pos.x += vel.x * dt; else vel.x = 0;
    if (!blocked(pos.x, pos.z + vel.z * dt)) pos.z += vel.z * dt; else vel.z = 0;
    vy -= GRAVITY * dt;
    footY = Math.max(0, footY + vy * dt);
    if (footY === 0 && vy < 0) vy = 0;
    const speed = Math.hypot(vel.x, vel.z);
    const prev = heading;
    if (speed > 0.3) {
      const target = Math.atan2(vel.x, vel.z);
      const delta = Math.atan2(Math.sin(target - heading), Math.cos(target - heading));
      heading += delta * Math.min(1, dt * 10);
    }
    turnRate += ((Math.atan2(Math.sin(heading - prev), Math.cos(heading - prev)) / Math.max(dt, 1e-3)) - turnRate) * Math.min(1, dt * 8);
    const run = Math.max(0, Math.min(1, (speed - WALK) / (RUN - WALK)));
    hero.animate({ speed, run, airborne: footY > 0.05, turn: turnRate, dt, time });
    hero.root.position.set(pos.x, footY + 0.16, pos.z);
    hero.root.rotation.y = heading;
    blob.position.set(pos.x, 0.18, pos.z);
    blob.scale.setScalar(1 / (1 + footY * 0.6));

    if (entering) {
      const b = entering.b;
      doorPoint.set(b.x, 1.9, b.z + b.face * (b.d / 2));
      const t = Math.min(1, (now - entering.t0) / entering.dur);
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      camPos.set(doorPoint.x + 1.2, 2.4, doorPoint.z + b.face * 3.6);
      camera.position.lerpVectors(entering.from, camPos, k);
      lookAt.lerpVectors(entering.fromLook, doorPoint, k);
      camera.lookAt(lookAt);
      $('fade').style.opacity = String(Math.max(0, (t - 0.55) / 0.45) * 0.55);
      if (t === 1 && !detailOpen) void openDetail(b);
    } else {
      $('fade').style.opacity = '0';
      let reach = distance;
      do {
        camPos.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(reach).add(v.set(pos.x, 1.7 + footY * 0.5, pos.z));
        reach -= 0.5;
      } while (reach > 1.5 && insideBuilding(camPos));
      camPos.y = Math.max(0.6, camPos.y) + (reduceMotion ? 0 : Math.sin(time * speed * 2.6) * 0.035 * run);
      camera.position.lerp(camPos, Math.min(1, dt * 9));
      lookAt.lerp(v.set(pos.x, 1.6 + footY * 0.4, pos.z), Math.min(1, dt * 14));
      camera.lookAt(lookAt);
    }
    const targetFov = 58 + run * 10;
    if (Math.abs(targetFov - fov) > 0.01) {
      fov += (targetFov - fov) * Math.min(1, dt * 4);
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    moon.position.set(pos.x + moonDir.x * 120, moonDir.y * 120, pos.z + moonDir.z * 120);
    moon.target.position.set(pos.x, 0, pos.z);
    sky.position.copy(camera.position);
    stars.position.copy(camera.position);
    moonDisc.position.copy(moonDir).multiplyScalar(1200).add(camera.position);
    (beacons.material as THREE.MeshBasicMaterial).color.setScalar(Math.sin(time * 2.4) > 0.2 ? 3 : 0.3).multiply(tmpColor.set('#ff3b3b'));

    slowClock -= dt;
    if (slowClock <= 0) {
      slowClock = 0.2;
      updateSigns(pos.x, pos.z);
      updateLampLights(pos.x, pos.z);
      if (!entering && !detailOpen) {
        let best: WalkBuilding | null = null;
        let bestGap = REACH;
        for (const b of nearby(pos.x, pos.z, REACH + 1)) {
          const g = gap(b, pos.x, pos.z);
          if (g < bestGap) { bestGap = g; best = b; }
        }
        if (best !== focus) setFocus(best);
      }
      drawMap();
    }
    traffic.update(dt, pos);
    rain.update(time, camera.position);
    clearView(camera.position, v.set(pos.x, 1.4 + footY, pos.z));
    composer.render();
  });

  return () => {
    disposed = true;
    renderer.setAnimationLoop(null);
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
    resizeObserver.disconnect();
    cleanups.forEach((fn) => fn());
    hero.dispose();
    traffic.dispose();
    rain.dispose();
    lampLights.forEach((l) => l.dispose());
    moon.dispose();
    bloom.dispose();
    output.dispose();
    composer.dispose();
    disposables.forEach((d) => d.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    root.innerHTML = '';
    root.classList.remove('wk-walk', 'entering');
  };
};
