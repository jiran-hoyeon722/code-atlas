import * as THREE from 'three';
import 'highlight.js/styles/github-dark.css';
import './walk.css';
import type { MountViewer } from '../viewer-env';
import { esc } from '../escape';
import { roleColors } from '../palette';
import { renderCode } from '../code-viewer/highlight';
import { LANE, layoutWalk, type WalkBuilding } from './walkLayout';

const WALK = 5;
const RUN = 14;
const RADIUS = 0.45;
const REACH = 3;
const SIGNS = 16;
const GRID = 16;
const SKY = new THREE.Color('#0b0d12');
const fmt = (n: number) => Number(n).toLocaleString('ko-KR');

const MARKUP = `
<div class="wk-hud glass">
    <h1 data-el="title"></h1>
    <div class="keys"><b>WASD</b> 이동 · <b>Shift</b> 달리기 · <b>클릭</b> 후 마우스로 시점 · <b>휠</b> 거리 · <b>E</b> 상세 보기 · <b>/</b> 검색</div>
    <div class="search"><input data-el="q" type="search" placeholder="파일 이름으로 순간 이동 ( / )" autocomplete="off"></div>
</div>
<canvas class="wk-map glass" data-el="map" width="200" height="200" title="클릭하면 그 위치로 이동"></canvas>
<div class="wk-prompt glass" data-el="prompt"></div>
<section class="wk-detail glass" data-el="detail" aria-label="건물 상세">
    <div class="head"><div class="title"><b data-el="d-name"></b><div class="path" data-el="d-path"></div></div><button data-el="d-close">닫기 (Esc)</button></div>
    <div class="metrics" data-el="d-metrics"></div>
    <div class="code-body"><pre class="gutter" data-el="d-gutter"></pre><pre class="source"><code class="hljs" data-el="d-src"></code></pre></div>
</section>`;

const VERT = /* glsl */ `
attribute vec3 aSize;
attribute vec3 aColor;
attribute float aSeed;
attribute float aFace;
varying vec3 vLocal; varying vec3 vN; varying vec3 vColor; varying vec3 vSize; varying vec3 vWorld; varying float vSeed; varying float vFace;
void main() {
  vLocal = position; vSize = aSize; vColor = aColor; vSeed = aSeed; vFace = aFace;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform vec3 uFog; uniform float uFocus;
varying vec3 vLocal; varying vec3 vN; varying vec3 vColor; varying vec3 vSize; varying vec3 vWorld; varying float vSeed; varying float vFace;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 n = normalize(vN);
  float light = 0.32 + 0.55 * max(dot(n, normalize(vec3(0.35, 0.85, 0.25))), 0.0);
  vec3 col = vColor * 0.5 * light;
  float side = 1.0 - step(0.9, abs(n.y));
  vec2 f = abs(n.x) > 0.5 ? vec2(vLocal.z * vSize.z, vLocal.y * vSize.y) : vec2(vLocal.x * vSize.x, vLocal.y * vSize.y);
  vec2 g = fract(f / vec2(3.0, 3.5));
  vec2 cell = floor(f / vec2(3.0, 3.5));
  float win = step(0.22, g.x) * step(g.x, 0.78) * step(0.28, g.y) * step(g.y, 0.78) * step(3.5, f.y) * step(f.y, vSize.y - 0.6);
  float lit = step(0.52, hash(cell + vec2(vSeed * 13.1, n.x * 7.0 + n.z * 3.0)));
  vec3 glass = mix(vec3(0.05, 0.07, 0.11), vec3(1.0, 0.8, 0.48) * (0.7 + 0.3 * hash(cell + vSeed)), lit);
  col = mix(col, glass, win * side);
  float front = step(0.5, n.z * vFace);
  float door = front * step(abs(f.x), 1.1) * step(f.y, 2.7);
  col = mix(col, vec3(1.0, 0.72, 0.4), door);
  float band = front * step(2.9, f.y) * step(f.y, 3.3);
  col = mix(col, vColor, band);
  if (n.y > 0.9) col = vColor * 0.18 + 0.03;
  if (abs(vSeed - uFocus) < 0.5) col += vec3(0.12, 0.14, 0.2);
  col = mix(col, uFog, smoothstep(90.0, 420.0, distance(vWorld, cameraPosition)));
  gl_FragColor = vec4(col, 1.0);
}`;

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

  const palette = roleColors(arch);
  const layout = layoutWalk(arch);
  const { bounds } = layout;
  const byNode = new Map(layout.buildings.map((b) => [b.i, b]));

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  root.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = SKY;
  scene.fog = new THREE.Fog(SKY, 90, 420);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1200);
  scene.add(new THREE.HemisphereLight('#9fb4ff', '#1a1c22', 0.9));
  const sun = new THREE.DirectionalLight('#ffffff', 0.6);
  sun.position.set(60, 120, 40);
  scene.add(sun);

  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => keep(new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra }));
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: { x: number; y: number; z: number; sx?: number; sy?: number; sz?: number; ry?: number }[]) {
    const mesh = new THREE.InstancedMesh(keep(geo), mat, Math.max(1, items.length));
    mesh.count = items.length;
    items.forEach((it, k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.ry ?? 0);
      matrix.compose(v.set(it.x, it.y, it.z), q, s.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1));
      mesh.setMatrixAt(k, matrix);
    });
    scene.add(mesh);
    disposables.push(mesh);
    return mesh;
  }

  // ---- ground, lots, lanes ----
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(bounds.maxX - bounds.minX + 200, bounds.maxZ - bounds.minZ + 200)), std('#1a1d24'));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
  scene.add(ground);

  const lots = instanced(new THREE.BoxGeometry(1, 1, 1), std('#ffffff'), layout.strips.map((st) => ({ x: st.x, y: 0.08, z: st.z, sx: st.w, sy: 0.16, sz: st.d })));
  layout.strips.forEach((st, k) => lots.setColorAt(k, new THREE.Color('#2c3039').lerp(new THREE.Color(palette[st.role] ?? '#888'), 0.12)));
  if (lots.instanceColor) lots.instanceColor.needsUpdate = true;

  const dashes = layout.lanes.flatMap((l) => Array.from({ length: Math.floor(l.w / 6) }, (_, k) => ({ x: l.x - l.w / 2 + 3 + k * 6, y: 0.02, z: l.z, sx: 2.2, sy: 0.02, sz: 0.18 })));
  instanced(new THREE.BoxGeometry(1, 1, 1), std('#8f8250', { emissive: '#3a3420' }), dashes);

  const lampSpots = layout.lanes.flatMap((l) => Array.from({ length: Math.max(1, Math.floor(l.w / 24)) }, (_, k) => [
    { x: l.x - l.w / 2 + 12 + k * 24, z: l.z - LANE / 2 + 0.6 },
    { x: l.x - l.w / 2 + 24 + k * 24, z: l.z + LANE / 2 - 0.6 },
  ]).flat());
  instanced(new THREE.CylinderGeometry(0.08, 0.1, 5, 6), std('#3b3f48'), lampSpots.map((p) => ({ ...p, y: 2.5 })));
  instanced(new THREE.SphereGeometry(0.28, 10, 8), keep(new THREE.MeshBasicMaterial({ color: '#ffd9a0' })), lampSpots.map((p) => ({ ...p, y: 5.1 })));
  const pool = keep(new THREE.MeshBasicMaterial({ color: '#ffb866', transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending }));
  instanced(new THREE.CircleGeometry(4, 24).rotateX(-Math.PI / 2), pool, lampSpots.map((p) => ({ ...p, y: 0.19 })));

  const treeSpots = layout.districts.flatMap((d) => {
    const out: { x: number; z: number }[] = [];
    for (let x = d.x - d.w / 2; x <= d.x + d.w / 2; x += 10) out.push({ x, z: d.z - d.d / 2 - 3 }, { x, z: d.z + d.d / 2 + 3 });
    return out;
  });
  instanced(new THREE.CylinderGeometry(0.15, 0.2, 2, 6), std('#4a3a2c'), treeSpots.map((p) => ({ ...p, y: 1 })));
  instanced(new THREE.ConeGeometry(1.4, 3.2, 7), std('#2f6b4a'), treeSpots.map((p, k) => ({ ...p, y: 3.4, ry: k })));

  // ---- buildings ----
  const bgeo = keep(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const count = layout.buildings.length;
  const attr = (size: number) => new Float32Array(Math.max(1, count) * size);
  const aSize = attr(3), aColor = attr(3), aSeed = attr(1), aFace = attr(1);
  const tmpColor = new THREE.Color();
  layout.buildings.forEach((b, k) => {
    aSize.set([b.w, b.h, b.d], k * 3);
    tmpColor.set(palette[arch.nodes[b.i].role] ?? '#b8bfc7');
    aColor.set([tmpColor.r, tmpColor.g, tmpColor.b], k * 3);
    aSeed[k] = k;
    aFace[k] = b.face;
  });
  bgeo.setAttribute('aSize', new THREE.InstancedBufferAttribute(aSize, 3));
  bgeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3));
  bgeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
  bgeo.setAttribute('aFace', new THREE.InstancedBufferAttribute(aFace, 1));
  const bmat = keep(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uFog: { value: SKY }, uFocus: { value: -1 } } }));
  const buildings = new THREE.InstancedMesh(bgeo, bmat, Math.max(1, count));
  buildings.count = count;
  layout.buildings.forEach((b, k) => buildings.setMatrixAt(k, matrix.compose(v.set(b.x, 0.16, b.z), q.identity(), s.set(b.w, b.h, b.d))));
  buildings.computeBoundingSphere();
  scene.add(buildings);
  disposables.push(buildings);

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

  // ---- signs: a small pool re-pointed at the nearest buildings ----
  const signs = Array.from({ length: SIGNS }, () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const tex = keep(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })));
    sprite.scale.set(4.3, 0.8, 1);
    sprite.visible = false;
    scene.add(sprite);
    return { canvas, tex, sprite, owner: -1 };
  });
  function paintSign(sign: (typeof signs)[number], b: WalkBuilding) {
    const ctx = sign.canvas.getContext('2d');
    if (!ctx) return;
    const n = arch.nodes[b.i];
    ctx.clearRect(0, 0, 512, 96);
    ctx.fillStyle = 'rgba(12,14,20,.82)';
    ctx.fillRect(0, 8, 512, 80);
    ctx.fillStyle = palette[n.role] ?? '#b8bfc7';
    ctx.fillRect(0, 8, 10, 80);
    ctx.fillStyle = '#eceef3';
    ctx.font = '600 38px system-ui, sans-serif';
    let name = n.name;
    while (name.length > 4 && ctx.measureText(name).width > 470) name = name.slice(0, -2);
    ctx.fillText(name === n.name ? name : `${name}…`, 24, 62);
    sign.tex.needsUpdate = true;
    sign.owner = b.i;
  }
  function updateSigns(x: number, z: number) {
    const near = [...nearby(x, z, 48)].map((b) => ({ b, dist: gap(b, x, z) })).sort((a, c) => a.dist - c.dist).slice(0, SIGNS).map((e) => e.b);
    const wanted = new Set(near.map((b) => b.i));
    const free = signs.filter((sg) => !wanted.has(sg.owner));
    near.forEach((b) => {
      let sign = signs.find((sg) => sg.owner === b.i);
      if (!sign) {
        sign = free.pop();
        if (!sign) return;
        paintSign(sign, b);
      }
      sign.sprite.position.set(b.x, 3.55, b.z + b.face * (b.d / 2 + 0.4));
      sign.sprite.visible = true;
    });
    free.forEach((sg) => { sg.sprite.visible = false; sg.owner = -1; });
  }

  // ---- character ----
  const body = std('#7c93f5');
  const skin = std('#e8c8a8');
  const dark = std('#2b2f3a');
  const hero = new THREE.Group();
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number, parent: THREE.Object3D = hero) => {
    const m = new THREE.Mesh(keep(geo), mat);
    m.position.y = y;
    parent.add(m);
    return m;
  };
  part(new THREE.BoxGeometry(0.52, 0.68, 0.3), body, 1.2);
  part(new THREE.SphereGeometry(0.17, 16, 12), skin, 1.72);
  const limb = (x: number, y: number, len: number, w: number, mat: THREE.Material) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    hero.add(pivot);
    part(new THREE.BoxGeometry(w, len, w), mat, -len / 2, pivot);
    return pivot;
  };
  const legL = limb(-0.13, 0.86, 0.86, 0.18, dark);
  const legR = limb(0.13, 0.86, 0.86, 0.18, dark);
  const armL = limb(-0.34, 1.5, 0.66, 0.13, body);
  const armR = limb(0.34, 1.5, 0.66, 0.13, body);
  scene.add(hero);

  function frontOf(b: WalkBuilding) {
    return new THREE.Vector3(b.x, 0, b.z + b.face * (b.d / 2 + 2.5));
  }
  const start = byNode.get(arch.nodes.findIndex((n) => n.path === env.selection.file))
    ?? [...layout.buildings].sort((a, c) => arch.nodes[c.i].centrality - arch.nodes[a.i].centrality)[0];
  const pos = start ? frontOf(start) : new THREE.Vector3(0, 0, bounds.maxZ - 10);
  let heading = start ? (start.face > 0 ? Math.PI : 0) : Math.PI;
  let yaw = heading + Math.PI;
  let pitch = 0.38;
  let distance = 9;
  let phase = 0;
  let moving = 0;
  const camPos = new THREE.Vector3();
  const keys = new Set<string>();

  // ---- detail panel ----
  let focus: WalkBuilding | null = null;
  let detailOpen = false;
  let codeRequest = 0;
  async function openDetail(b: WalkBuilding) {
    const n = arch.nodes[b.i];
    detailOpen = true;
    keys.clear();
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
    $('d-name').textContent = n.name;
    $('d-path').textContent = n.path;
    const metric = (value: number, label: string) => `<div class="metric"><b>${esc(fmt(value))}</b><span>${esc(label)}</span></div>`;
    $('d-metrics').innerHTML = `<span class="chip" style="--c:${esc(palette[n.role] ?? '#b8bfc7')}">${esc(arch.roles[n.role].name)}</span>`
      + metric(n.fanIn, 'fan-in') + metric(n.fanOut, 'fan-out') + metric(n.lines, '줄 수') + metric(n.functions, '함수 수') + metric(n.maxComplexity, '최대 복잡도');
    const src = $('d-src');
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
  function closeDetail() {
    detailOpen = false;
    codeRequest++;
    $('detail').classList.remove('open');
  }
  listen($('d-close'), 'click', closeDetail);
  function setFocus(b: WalkBuilding | null) {
    focus = b;
    bmat.uniforms.uFocus.value = b ? layout.buildings.indexOf(b) : -1;
    const prompt = $('prompt');
    if (b) prompt.innerHTML = `<b>E</b> 상세 보기 — ${esc(arch.nodes[b.i].name)}`;
    prompt.classList.toggle('open', !!b);
  }

  // ---- input ----
  const typing = () => document.activeElement instanceof HTMLInputElement;
  listen(window, 'keydown', (e) => {
    if (typing()) { if (e.key === 'Escape') (document.activeElement as HTMLElement).blur(); return; }
    if (e.key === 'Escape' && detailOpen) { closeDetail(); return; }
    if (detailOpen) return;
    if (e.key === '/') { e.preventDefault(); $('q').focus(); return; }
    if ((e.key === 'e' || e.key === 'E' || e.key === 'ㄷ') && focus) { void openDetail(focus); return; }
    keys.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  });
  listen(window, 'keyup', (e) => keys.delete(e.code));
  listen(window, 'blur', () => keys.clear());
  listen(renderer.domElement, 'click', () => { if (!detailOpen) renderer.domElement.requestPointerLock?.(); });
  let dragging = false;
  listen(renderer.domElement, 'pointerdown', () => (dragging = true));
  listen(window, 'pointerup', () => (dragging = false));
  listen(document, 'mousemove', (e) => {
    if (document.pointerLockElement !== renderer.domElement && !dragging) return;
    yaw -= e.movementX * 0.0035;
    pitch = Math.min(1.2, Math.max(-0.1, pitch + e.movementY * 0.0028));
  });
  listen(renderer.domElement, 'wheel', (e) => {
    e.preventDefault();
    distance = Math.min(24, Math.max(3, distance + e.deltaY * 0.01));
  });

  function teleport(to: THREE.Vector3) {
    pos.copy(to);
    for (let r = 0; r < 30 && blocked(pos.x, pos.z); r++) pos.z += 1;
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
    baseCtx.fillStyle = '#12141a';
    baseCtx.fillRect(0, 0, 200, 200);
    layout.buildings.forEach((b) => {
      const [x, y] = toMap(b.x - b.w / 2, b.z - b.d / 2);
      baseCtx.fillStyle = palette[arch.nodes[b.i].role] ?? '#888';
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
    mapCtx.rotate(-heading);
    mapCtx.fillStyle = '#ffffff';
    mapCtx.beginPath();
    mapCtx.moveTo(0, -6); mapCtx.lineTo(4, 5); mapCtx.lineTo(-4, 5);
    mapCtx.fill();
    mapCtx.restore();
  }

  function size() {
    return { w: Math.max(1, root.clientWidth), h: Math.max(1, root.clientHeight) };
  }
  const resizeObserver = new ResizeObserver(() => {
    const { w, h } = size();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  resizeObserver.observe(root);
  { const { w, h } = size(); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); }

  let disposed = false;
  let last = performance.now();
  let signClock = 0;
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const input = (a: string[], b: string[]) => (a.some((k) => keys.has(k)) ? 1 : 0) - (b.some((k) => keys.has(k)) ? 1 : 0);
    const fz = input(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
    const fx = input(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(-forward.z, 0, forward.x);
    move.set(0, 0, 0).addScaledVector(forward, fz).addScaledVector(right, fx);
    const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN : WALK;
    if (move.lengthSq() > 0 && !detailOpen) {
      move.normalize().multiplyScalar(speed * dt);
      if (!blocked(pos.x + move.x, pos.z)) pos.x += move.x;
      if (!blocked(pos.x, pos.z + move.z)) pos.z += move.z;
      const target = Math.atan2(move.x, move.z);
      let delta = target - heading;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      heading += delta * Math.min(1, dt * 12);
      moving = Math.min(1, moving + dt * 6);
      phase += dt * speed * 1.9;
    } else {
      moving = Math.max(0, moving - dt * 6);
    }
    const swing = Math.sin(phase) * 0.7 * moving;
    legL.rotation.x = swing; legR.rotation.x = -swing;
    armL.rotation.x = -swing * 0.8; armR.rotation.x = swing * 0.8;
    hero.position.set(pos.x, Math.abs(Math.sin(phase)) * 0.06 * moving, pos.z);
    hero.rotation.y = heading;

    let reach = distance;
    do {
      camPos.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(reach).add(v.set(pos.x, 1.7, pos.z));
      reach -= 0.5;
    } while (reach > 1.5 && insideBuilding(camPos));
    camPos.y = Math.max(0.6, camPos.y);
    camera.position.lerp(camPos, Math.min(1, dt * 10));
    camera.lookAt(pos.x, 1.7, pos.z);

    signClock -= dt;
    if (signClock <= 0) {
      signClock = 0.25;
      updateSigns(pos.x, pos.z);
      let best: WalkBuilding | null = null;
      let bestGap = REACH;
      for (const b of nearby(pos.x, pos.z, REACH + 1)) {
        const g = gap(b, pos.x, pos.z);
        if (g < bestGap) { bestGap = g; best = b; }
      }
      if (best !== focus) setFocus(best);
      drawMap();
    }
    renderer.render(scene, camera);
  });

  return () => {
    disposed = true;
    renderer.setAnimationLoop(null);
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
    resizeObserver.disconnect();
    cleanups.forEach((fn) => fn());
    disposables.forEach((d) => d.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    root.innerHTML = '';
    root.classList.remove('wk-walk');
  };
};
