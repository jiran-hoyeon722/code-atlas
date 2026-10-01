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
import { BEAM_FRAG, BEAM_VERT, BUILDING_FRAG, BUILDING_VERT, SKY_FRAG, SKY_VERT } from './walkShaders';
import { createModelHero, type Emote } from './walkHero';
import { createTraffic, routeBetween } from './walkTraffic';
import { createRain } from './walkRain';
import { RIVALS, createBattle } from './walkBattle';
import { createHeli } from './walkHeli';
import { createHeliArms, shakeAt } from './walkHeliArms';
import { createVehicles, type Vehicle } from './walkVehicles';
import { THEMES, type Theme } from './walkThemes';
import { createBeacon, createGuide, createMarkers, createMotes, createSparks, type PathPoint } from './walkFx';
import { WEAPONS, createTracers, createWeaponKit, weaponById, type Weapon, type WeaponId } from './walkWeapons';
import { DIFFICULTIES, DIFFICULTY, FORM_TIME, createSiege, createVirus, isDifficulty, isInfected, pickOrigin, pickSpawnSite, type Difficulty } from './walkVirus';
import { HELI_BOSS_BONUS, createHorde } from './walkHorde';
import { turnToward } from './walkMotion';
import type { RideCar } from './walkTraffic';
import { GUIDE, GUIDE_KEY } from './walkGuide';
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
const VIRUS_SPREAD = DIFFICULTY.normal.spread;
const DESCEND = ['KeyC', 'KeyX', 'ControlLeft', 'ControlRight'];
const CURE_TIME = 2.5;
const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const icon = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const WEATHER_ICONS: Record<string, string> = {
  night: icon('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor"/>'),
  rain: icon('<path d="M7 14a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.3 1.6A3.3 3.3 0 0 1 17.5 14z" fill="currentColor"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  day: icon('<circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  sunset: icon('<path d="M6 16a6 6 0 0 1 12 0z" fill="currentColor"/><path d="M2 19h20M12 4v3M4.5 8.5l2 2M19.5 8.5l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  fog: icon('<path d="M3 8h13M6 12h15M3 16h12M8 20h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
};
const GUN_ICON = icon('<path d="M2 10h14l2-2h3v3h-2l-1 1H9l-1 4H5l1-4H2z" fill="currentColor"/><path d="M18 13h4M18 15.5h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>');
const BOMB_ICON = icon('<circle cx="10.5" cy="14" r="6.5" fill="currentColor"/><path d="M15 9.5l2.5-2.5M18 4.5v2M20.5 7h-2M19.8 4.2l-1.4 1.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>');
const VIRUS_ICON = icon('<circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.8 2.8M16.2 16.2L19 19M5 19l2.8-2.8M16.2 7.8L19 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>');
const HELP = [
  ['이동', [['W A S D', '걷기'], ['Shift', '달리기'], ['Space', '점프'], ['클릭', '마우스로 시점 돌리기 (Esc 로 풀기)'], ['휠', '카메라 거리']]],
  ['전투', [['1 ~ 6', '무기 고르기'], ['F · 클릭', '공격 (기관단총은 누르고 있기)'], ['G', '감정 표현']]],
  ['행동', [['E', '건물 들어가기 · 차 타기 · 바이러스 치료'], ['H', '헬기 타기 (라이벌 4명을 다 잡으면)']]],
  ['바이러스', [['V', '바이러스 모드 시작 · 그만두기 (괴물이 나타나면 못 그만둬요)'], ['하 · 중 · 상', '난이도 — 하는 바닥 화살표 안내, 상은 빠른 확산과 좀비 떼'], ['E (근원지 앞)', '백신 주입 — 도시가 다 감염되기 전에'], ['괴물', '다 감염되면 나타나요. 시간 안에 못 잡으면 레포가 무너지고 분석 기록이 지워져요']]],
  ['헬기', [['W S', '앞으로 · 뒤로'], ['A D · 마우스', '방향 돌리기'], ['Q E', '옆으로 이동'], ['Space · C (Ctrl · X)', '올라가기 · 내려가기'], ['Shift', '가속'], ['F · 클릭', '기관총 (누르고 있기)'], ['G · 우클릭', '폭탄 떨어뜨리기'], ['마우스 위아래', '조준점 가깝게 · 멀리'], ['H', '천천히 내려가 착륙 (Space 로 취소)']]],
  ['화면', [['/', '파일 이름으로 순간 이동'], ['T', '날씨 바꾸기'], ['V', '바이러스 모드'], ['?', '이 도움말 · 게임 가이드']]],
] as const;

const DIFF_HINT: Record<Difficulty, string> = {
  easy: '하 — 바닥에 근원지로 가는 형광 화살표가 보여요',
  normal: '중 — 보통 속도, 화살표 없음',
  hard: '상 — 빨리 번지고 좀비가 빨리 생겨요, 화살표 없음',
};
const VIRUS_NOTE = '하늘로 솟은 초록 빛기둥이 근원지예요. 건물 앞에서 <b>E</b> 로 백신을 넣으세요. 감염된 건물은 코드를 볼 수 없고 차도 끊겨요.';
const GUIDE_NOTE = ' 바닥의 형광 화살표를 따라가세요.';

const MARKUP = `
<div class="wk-hud glass">
    <div class="hud-head"><div><h1>코드시티GTA</h1><div class="repo" data-el="repo"></div></div><button class="help-btn" data-el="help-btn" aria-label="조작법 보기" title="조작법 (?)">?</button></div>
    <input data-el="q" type="search" placeholder="파일 이름으로 순간 이동 ( / )" autocomplete="off">
    <div class="field"><span class="lbl">날씨</span><div class="weather" data-el="themes" role="radiogroup" aria-label="날씨"></div></div>
    <button class="virus-btn" data-el="virus-btn">${VIRUS_ICON}<span data-el="virus-label">바이러스 모드 시작</span><kbd>V</kbd></button>
    <div class="field"><span class="lbl">바이러스 난이도</span><div class="v-diff" data-el="v-diff" role="radiogroup" aria-label="바이러스 난이도">${DIFFICULTIES.map((d) => `<button role="radio" aria-checked="false" data-diff="${d}" title="${DIFF_HINT[d]}">${DIFFICULTY[d].label}</button>`).join('')}</div></div>
    <div class="tips"><b>WASD</b> 이동 · <b>클릭</b> 시점 · <b>F</b> 공격 · <b>E</b> 행동 · <b>1~6</b> 무기 · <b>?</b> 전체 조작법</div>
</div>
<div class="wk-virus glass" data-el="virus" hidden>
    <div class="v-head">${VIRUS_ICON}<b data-el="v-title">바이러스 확산 중</b><span data-el="v-time">00:00</span></div>
    <div class="v-bar"><i data-el="v-bar"></i></div>
    <div class="v-row"><span>감염된 건물</span><b data-el="v-count"></b></div>
    <div class="v-row"><span>근원지 신호</span><span class="signal" data-el="v-signal"><i></i><i></i><i></i><i></i><i></i></span></div>
    <div class="v-row"><span>난이도</span><b data-el="v-diff-label"></b></div>
    <div class="v-row"><span>처치한 바이러스</span><b data-el="v-kills">0</b></div>
    <p data-el="v-note"></p>
</div>
<div class="wk-boss glass" data-el="boss" hidden>
    <div class="b-head"><b data-el="b-title">초대형 바이러스</b><span data-el="b-time"></span></div>
    <div class="b-bar"><i data-el="b-bar"></i></div>
    <p data-el="b-note">처치하지 않으면 레포가 붕괴돼요 — 분석 기록이 지워져요</p>
</div>
<div class="wk-weapons glass" data-el="weapons" role="toolbar" aria-label="무기"></div>
<div class="wk-heli glass" data-el="heli-hud" aria-label="헬기">
    <div class="hh-slot" data-el="hh-gun">${GUN_ICON}<span>기관총</span><kbd>F</kbd></div>
    <div class="hh-slot" data-el="hh-bomb">${BOMB_ICON}<span>폭탄</span><kbd>G</kbd><i><b data-el="hh-bomb-bar"></b></i></div>
    <div class="hh-lift"><span data-el="hh-up"><kbd>Space</kbd>▲ 상승</span><span data-el="hh-down"><kbd>C</kbd>▼ 하강</span></div>
    <div class="hh-meter"><span>고도</span><b data-el="hh-alt">0</b><small>m</small></div>
    <div class="hh-meter"><span>속도</span><b data-el="hh-speed">0</b><small>km/h</small></div>
    <div class="hh-hint" data-el="hh-hint"></div>
</div>
<div class="wk-help glass" data-el="help" hidden role="dialog" aria-label="조작법">
    <div class="h-head"><b>조작법</b><span><button data-el="guide-open">게임 가이드</button><button data-el="help-close">닫기 (Esc)</button></span></div>
    <div class="h-body" data-el="help-body"></div>
</div>
<div class="wk-guide" data-el="guide" hidden>
    <section class="g-card glass" role="dialog" aria-modal="true" aria-labelledby="wk-guide-title">
        <div class="g-step" data-el="g-step"></div>
        <h2 id="wk-guide-title" data-el="g-title"></h2>
        <div class="g-repo" data-el="g-repo"></div>
        <p data-el="g-body"></p>
        <div class="g-keys" data-el="g-keys"></div>
        <div class="g-foot"><div class="g-dots" data-el="g-dots"></div><button data-el="g-skip">건너뛰기</button><button data-el="g-prev">이전</button><button class="primary" data-el="g-next">다음</button></div>
    </section>
</div>
<canvas class="wk-map glass" data-el="map" width="200" height="200" title="클릭하면 그 위치로 이동"></canvas>
<div class="wk-prompt glass" data-el="prompt"></div>
<div class="wk-fade" data-el="fade"></div>
<div class="wk-hurt" data-el="hurt"></div>
<div class="wk-battle glass"><div class="hp"><i data-el="hp"></i></div><div class="rivals" data-el="rivals"></div></div>
<div class="wk-toast" data-el="toast"></div>
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
  try {
    return mount(root, arch, env);
  } catch (err) {
    root.classList.remove('wk-walk', 'entering');
    throw err;
  }
};

const mount: MountViewer = (root, arch, env) => {
  root.classList.add('wk-walk');
  root.innerHTML = MARKUP;
  const $ = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-el="${name}"]`)!;
  const cleanups: (() => void)[] = [];
  const listen = <K extends keyof HTMLElementEventMap>(target: HTMLElement | Window | Document, type: K, fn: (ev: HTMLElementEventMap[K]) => void) => {
    target.addEventListener(type, fn as EventListener);
    cleanups.push(() => target.removeEventListener(type, fn as EventListener));
  };
  $('repo').textContent = arch.name;
  $('help-body').innerHTML = HELP.map(([group, rows]) => `<section><h2>${esc(group)}</h2>${rows.map(([k, what]) => `<div><kbd>${esc(k)}</kbd><span>${esc(what)}</span></div>`).join('')}</section>`).join('');
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
  const hemi = new THREE.HemisphereLight('#7f93d8', '#1c1d26', 0.75);
  scene.add(hemi);
  const fogColor = (scene.fog as THREE.Fog).color;
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

  const moonDir = new THREE.Vector3(0.45, 0.55, -0.7).normalize();
  // ---- sky ----
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(1500, 32, 16)), keep(new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uHorizon: { value: HORIZON.clone() }, uZenith: { value: ZENITH.clone() }, uGlow: { value: new THREE.Color('#3b2f5c') }, uSunDir: { value: moonDir }, uSunColor: { value: new THREE.Color(0, 0, 0) } },
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
  moonDisc.position.copy(moonDir).multiplyScalar(1200);
  scene.add(moonDisc);

  // ---- ground, lots, lanes ----
  const groundMat = std('#1a1c24', { roughness: 0.42, metalness: 0.15 });
  const lotMat = std('#ffffff', { roughness: 0.8 });
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(bounds.maxX - bounds.minX + 400, bounds.maxZ - bounds.minZ + 400)), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  const lots = instanced(new THREE.BoxGeometry(1, 1, 1), lotMat, layout.strips.map((st) => ({ x: st.x, y: 0.08, z: st.z, sx: st.w, sy: 0.16, sz: st.d })), { receive: true });
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
  const lampHead = glow('#ffd29a', 2.2);
  instanced(new THREE.BoxGeometry(0.34, 0.12, 0.5), lampHead, lampSpots.map((p) => ({ ...p, y: 5.05, z: p.z - p.side * 0.95 })));
  const pool = keep(new THREE.MeshBasicMaterial({ color: '#ffb866', transparent: true, opacity: 0.035, depthWrite: false, blending: THREE.AdditiveBlending }));
  instanced(new THREE.CircleGeometry(4.5, 28).rotateX(-Math.PI / 2), pool, lampSpots.map((p) => ({ ...p, y: 0.2, z: p.z - p.side * 0.95 })));
  const lampLights = Array.from({ length: LAMP_LIGHTS }, () => {
    const l = new THREE.PointLight('#ffc27a', 0, 14, 1.8);
    scene.add(l);
    return l;
  });

  const props: { x: number; z: number; r: number }[] = lampSpots.map((p) => ({ x: p.x, z: p.z, r: 0.22 }));
  const benchSpots = lampSpots.filter(() => random() < 0.45).map((p) => ({ x: p.x + 2.2, z: p.z + p.side * 0.6, side: p.side }));
  instanced(new THREE.BoxGeometry(1.8, 0.08, 0.5), std('#6b4a32'), benchSpots.map((p) => ({ ...p, y: 0.62 })), { cast: true });
  instanced(new THREE.BoxGeometry(1.8, 0.4, 0.06), std('#6b4a32'), benchSpots.map((p) => ({ ...p, y: 0.85, z: p.z + p.side * 0.22 })), { cast: true });
  instanced(new THREE.BoxGeometry(0.08, 0.6, 0.45), std('#2d3139'), benchSpots.flatMap((p) => [-0.8, 0.8].map((dx) => ({ x: p.x + dx, y: 0.46, z: p.z }))));

  const treeSpots = layout.districts.flatMap((d) => {
    const out: { x: number; z: number; k: number }[] = [];
    for (let x = d.x - d.w / 2 + 4; x <= d.x + d.w / 2 - 4; x += 9) out.push({ x, z: d.z - d.d / 2 - 3.5, k: random() }, { x, z: d.z + d.d / 2 + 3.5, k: random() });
    return out;
  });
  benchSpots.forEach((p) => props.push({ x: p.x - 0.5, z: p.z, r: 0.42 }, { x: p.x + 0.5, z: p.z, r: 0.42 }));
  treeSpots.forEach((p) => props.push({ x: p.x, z: p.z, r: 0.3 }));
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

  // ---- buildings: houses get a gable roof, apartments balconies, towers a set-back upper tier ----
  type Part = { k: number; b: WalkBuilding; x: number; z: number; w: number; d: number; h: number; base: number };
  const parts: Part[] = [];
  const roofs: (Item & { k: number })[] = [];
  const gables: (Item & { k: number })[] = [];
  const balconies: (Item & { k: number })[] = [];
  const ridge = (b: WalkBuilding) => (b.kind === 'house' ? Math.min(3, b.d * 0.3) : 0);
  const tallest = [...layout.buildings].sort((a, c) => c.h - a.h).slice(0, Math.max(1, Math.ceil(layout.buildings.length * 0.04)));
  layout.buildings.forEach((b, k) => {
    const floors = Math.round(b.h / FLOOR);
    const tiered = b.kind === 'tower';
    const lower = tiered ? Math.round(floors * 0.62) * FLOOR : b.h;
    parts.push({ k, b, x: b.x, z: b.z, w: b.w, d: b.d, h: lower, base: 0 });
    let top = { w: b.w, d: b.d, h: lower };
    if (tiered) {
      const shrink = 0.62 + random() * 0.15;
      top = { w: b.w * shrink, d: b.d * shrink, h: b.h };
      parts.push({ k, b, x: b.x, z: b.z - b.face * b.d * 0.08, w: top.w, d: top.d, h: b.h - lower, base: lower });
    }
    if (b.kind === 'house') {
      gables.push({ k, x: b.x, y: b.h + 0.16, z: b.z, sx: b.w + 0.8, sy: ridge(b), sz: b.d + 0.8 });
      roofs.push({ k, x: b.x + b.w * 0.25, y: b.h + 0.16 + ridge(b) * 0.7, z: b.z - b.face * b.d * 0.15, sx: 0.6, sy: 1.6, sz: 0.6 });
      return;
    }
    if (b.kind === 'apartment') {
      for (let f = 1; f < floors; f++) balconies.push({ k, x: b.x, y: 0.16 + f * FLOOR, z: b.z + b.face * (b.d / 2 + 0.5), sx: b.w - 1.4, ry: b.face > 0 ? 0 : Math.PI });
    }
    const units = 1 + Math.floor(random() * 3);
    for (let u = 0; u < units; u++) {
      const sx = 0.8 + random() * 1.6;
      roofs.push({ k, x: b.x + (random() - 0.5) * top.w * 0.55, y: top.h + 0.16 + sx * 0.3, z: b.z + (random() - 0.5) * top.d * 0.55, sx, sy: sx * 0.6, sz: 0.8 + random() * 1.2, ry: random() < 0.5 ? 0 : Math.PI / 2 });
    }
  });
  const bgeo = keep(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const pc = parts.length;
  const attr = (size: number) => new Float32Array(Math.max(1, pc) * size);
  const aSize = attr(3), aColor = attr(3), aSeed = attr(1), aFace = attr(1), aBase = attr(1), aInfect = attr(1), aCap = attr(1), aKind = attr(1), aSink = attr(1);
  const KIND = { house: 0, apartment: 1, tower: 2 } as const;
  const tmpColor = new THREE.Color();
  parts.forEach((p, j) => {
    aSize.set([p.w, p.h, p.d], j * 3);
    tmpColor.set(roleColor(arch.nodes[p.b.i].role));
    aColor.set([tmpColor.r, tmpColor.g, tmpColor.b], j * 3);
    aSeed[j] = p.k;
    aFace[j] = p.b.face;
    aBase[j] = p.base;
    aCap[j] = parts[j + 1]?.k === p.k ? 0 : 1;
    aKind[j] = KIND[p.b.kind];
  });
  bgeo.setAttribute('aSize', new THREE.InstancedBufferAttribute(aSize, 3));
  bgeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3));
  bgeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
  bgeo.setAttribute('aFace', new THREE.InstancedBufferAttribute(aFace, 1));
  bgeo.setAttribute('aBase', new THREE.InstancedBufferAttribute(aBase, 1));
  bgeo.setAttribute('aCap', new THREE.InstancedBufferAttribute(aCap, 1));
  bgeo.setAttribute('aKind', new THREE.InstancedBufferAttribute(aKind, 1));
  const infectAttr = new THREE.InstancedBufferAttribute(aInfect, 1);
  infectAttr.setUsage(THREE.DynamicDrawUsage);
  bgeo.setAttribute('aInfect', infectAttr);
  const sinkAttr = new THREE.InstancedBufferAttribute(aSink, 1);
  sinkAttr.setUsage(THREE.DynamicDrawUsage);
  bgeo.setAttribute('aSink', sinkAttr);
  const uniforms = { uFog: { value: fogColor }, uFocus: { value: -1 }, uTime: { value: 0 }, uDay: { value: 0 }, uLit: { value: 0.5 }, uSunDir: { value: moonDir }, uSky: { value: new THREE.Color() }, uOrigin: { value: -1 } };
  const bmat = keep(new THREE.ShaderMaterial({ vertexShader: BUILDING_VERT, fragmentShader: BUILDING_FRAG, uniforms }));
  const buildings = new THREE.InstancedMesh(bgeo, bmat, Math.max(1, pc));
  buildings.count = pc;
  parts.forEach((p, j) => buildings.setMatrixAt(j, matrix.compose(v.set(p.x, 0.16 + p.base, p.z), q.identity(), s.set(p.w, p.h, p.d))));
  buildings.computeBoundingSphere();
  buildings.castShadow = true;
  scene.add(buildings);
  disposables.push(buildings);
  const roofMesh = instanced(new THREE.BoxGeometry(1, 1, 1), std('#3a3e48', { metalness: 0.3, roughness: 0.6 }), roofs, { cast: true });
  const gableGeo = new THREE.BufferGeometry();
  gableGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0, -0.5, 0, -0.5, 0.5, 1, 0, 0.5, 0, -0.5,
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
    0.5, 0, -0.5, 0.5, 1, 0, 0.5, 0, 0.5, -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0,
  ], 3));
  gableGeo.computeVertexNormals();
  const gableMesh = instanced(gableGeo, std('#ffffff', { roughness: 0.7 }), gables, { cast: true, receive: true });
  const slabMesh = instanced(new THREE.BoxGeometry(1, 0.16, 1).translate(0, 0.08, 0), std('#ffffff', { roughness: 0.8 }), balconies, { cast: true });
  const railMesh = instanced(new THREE.BoxGeometry(1, 1, 0.06).translate(0, 0.66, 0.47), std('#ffffff', { roughness: 0.35, metalness: 0.3 }), balconies);
  const soot = new THREE.Color('#1b1e19');
  const tintSets = [
    { mesh: gableMesh, ks: gables.map((g) => g.k), base: gables.map((g) => tmpColor.set(roleColor(arch.nodes[layout.buildings[g.k].i].role)).lerp(new THREE.Color('#4a2e24'), 0.3).multiplyScalar(0.8).clone()) },
    { mesh: slabMesh, ks: balconies.map((it) => it.k), base: balconies.map(() => new THREE.Color('#b4b7bd')) },
    { mesh: railMesh, ks: balconies.map((it) => it.k), base: balconies.map((it) => tmpColor.set(roleColor(arch.nodes[layout.buildings[it.k].i].role)).lerp(new THREE.Color('#2a3140'), 0.45).clone()) },
  ];
  const tintInfected = (levels: ArrayLike<number>) => {
    tintSets.forEach(({ mesh, ks, base }) => {
      ks.forEach((k, j) => mesh.setColorAt(j, tmpColor.copy(base[j]).lerp(soot, (levels[k] ?? 0) * 0.7)));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    // Infected house walls sag at least 6% of their height, so the roof sinks with them instead of floating.
    gables.forEach((g, j) => place(gableMesh, { ...g, y: g.y - (levels[g.k] ?? 0) * 0.06 * layout.buildings[g.k].h }, j, true));
    gableMesh.instanceMatrix.needsUpdate = true;
  };
  tintInfected([]);
  const beacons = instanced(new THREE.SphereGeometry(0.35, 10, 8), glow('#ff3b3b', 3), tallest.map((b) => ({ x: b.x, y: b.h + 4.6, z: b.z })));
  const beaconPoles = instanced(new THREE.CylinderGeometry(0.05, 0.08, 4.4, 6), std('#6b7080', { metalness: 0.7 }), tallest.map((b) => ({ x: b.x, y: b.h + 2.4, z: b.z })));

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
    const posts = [1, -1].flatMap((side) => [-4.3, 4.3].map((dx) => ({ x: d.x + dx, y: 2.5, z: d.z + side * (d.d / 2 + 5.5) })));
    posts.forEach((p) => props.push({ x: p.x, z: p.z, r: 0.18 }));
    instanced(new THREE.BoxGeometry(0.16, 5, 0.16), std('#2d3139', { metalness: 0.6 }), posts, { cast: true });
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
  const propGrid = new Map<string, typeof props>();
  props.forEach((p) => {
    const k = key(Math.floor(p.x / GRID), Math.floor(p.z / GRID));
    const list = propGrid.get(k) ?? [];
    list.push(p);
    propGrid.set(k, list);
  });
  const propHit = (x: number, z: number, r: number) => {
    for (let gx = Math.floor((x - r - 1) / GRID); gx <= Math.floor((x + r + 1) / GRID); gx++)
      for (let gz = Math.floor((z - r - 1) / GRID); gz <= Math.floor((z + r + 1) / GRID); gz++)
        if (propGrid.get(key(gx, gz))?.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r)) return true;
    return false;
  };
  const clearLine = (ax: number, az: number, bx: number, bz: number) => {
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.8);
    for (let k = 1; k < steps; k++) {
      const x = ax + ((bx - ax) * k) / steps, z = az + ((bz - az) * k) / steps;
      for (const b of nearby(x, z, 0.5)) if (gap(b, x, z) < 0.05) return false;
    }
    return true;
  };
  const blocked = (x: number, z: number, r = RADIUS) => {
    if (propHit(x, z, r)) return true;
    for (const b of nearby(x, z, r + 1)) if (gap(b, x, z) < r) return true;
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
      .forEach(({ p }, k) => { lampLights[k].position.set(p.x, 4.8, p.z - p.side * 0.95); lampLights[k].intensity = lampsOn ? 6 : 0; });
  }

  // ---- character ----
  const hero = createModelHero(robotUrl, () => {});
  scene.add(hero.root);
  const traffic = createTraffic(scene, layout, arch, roleColor, random);
  const rain = createRain(scene, ground, fogColor, random);
  let theme: Theme = THEMES[0];
  let lampsOn = true;
  const refreshSky = () => {
    stars.visible = theme.stars && !rain.enabled;
    moonDisc.visible = !!theme.disc && !rain.enabled;
  };
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
  // Hits shove the player through their own decaying impulse, so steering and facing never fight the knockback.
  const knock = new THREE.Vector3();
  let vy = 0;
  let footY = 0;
  let heading = start ? (start.face > 0 ? Math.PI : 0) : Math.PI;
  let turnRate = 0;
  let yaw = heading + Math.PI;
  let pitch = 0.3;
  let distance = 7.5;
  let camReach = distance;
  let bob = 0;
  let fov = 58;
  const camPos = new THREE.Vector3();
  const lookAt = new THREE.Vector3(pos.x, 1.6, pos.z);
  camera.position.set(pos.x - Math.sin(heading) * 8, 4, pos.z - Math.cos(heading) * 8);
  const keys = new Set<string>();

  // ---- easter egg: four roaming rivals, a respawning player, and a helicopter for catching all of them ----
  const spawnPoint = pos.clone();
  const spawnHeading = heading;
  let hp = 100;
  let alive = true;
  let respawnAt = 0;
  let punchAt = 0;
  let punchCooldown = 0;
  let hurt = 0;
  let mode: 'walk' | 'fly' | 'drive' | 'ride' = 'walk';
  let nearVehicle: Vehicle | null = null;
  let nearCar: RideCar | null = null;
  let toastTimer = 0;
  const caughtNames = new Set<string>();
  const toast = (text: string, ms = 2600) => {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('open');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove('open'), ms);
  };
  const renderBattle = () => {
    $('hp').style.width = `${Math.max(0, hp)}%`;
      const armed = new Map(battle.roster().map((r) => [r.name, r.weapon.name]));
    $('rivals').innerHTML = RIVALS.map((r) => `<span class="${caughtNames.has(r.name) ? 'got' : ''}" style="--c:${esc(r.tint)}">${esc(r.name)}${armed.has(r.name) ? ` <small>${esc(armed.get(r.name)!)}</small>` : ''}</span>`).join('') + `<b>${caughtNames.size}/${RIVALS.length}</b>`;
  };
  function freeSpotNear(x: number, z: number, min: number, max: number) {
    for (let r = min; r <= max; r += 1.5)
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (![[0, 0], [3.5, 0], [-3.5, 0], [0, 3.5], [0, -3.5]].some(([dx, dz]) => blockedWalker(px + dx, pz + dz))) return new THREE.Vector3(px, 0, pz);
      }
    return new THREE.Vector3(x, 0, z);
  }
  const heli = createHeli(scene, bounds);
  const vehicles = createVehicles(scene, layout, blocked, random);
  const sparks = createSparks(scene);
  const markers = createMarkers(scene);
  const blockedWalker = (x: number, z: number, r = RADIUS) => blocked(x, z, r) || vehicles.occupied(x, z, r);
  let shake = 0;
  function hurtPlayer(damage: number, fx: number, fz: number, push = 7) {
    if (!alive) return;
    hp -= damage;
    hurt = 1;
    shake = Math.max(shake, Math.min(1, damage / 30));
    const dx = pos.x - fx, dz = pos.z - fz;
    const d = Math.hypot(dx, dz) || 1;
    knock.x += (dx / d) * push;
    knock.z += (dz / d) * push;
    if (hp <= 0) {
      if (mode === 'drive') leaveVehicle();
      alive = false;
      hero.die();
      respawnAt = performance.now() + 2600;
      toast('쓰러졌어요 — 잠시 후 처음 자리에서 다시 시작해요', 2400);
    }
    renderBattle();
  }
  const kit = createWeaponKit();
  const tracers = createTracers(scene);
  const battle = createBattle(scene, robotUrl, pos, kit, {
    blocked: blockedWalker,
    clear: clearLine,
    random,
    shot: (from, to, color) => tracers.fire(from, to, color),
    onPlayerHit(damage, fx, fz) {
      hurtPlayer(damage, fx, fz);
    },
    onCaught(name, n, total) {
      caughtNames.add(name);
      renderBattle();
      if (n < total || heli.state !== 'hidden') { toast(`${name} 잡았다! (${n}/${total})`); return; }
      toast('모두 잡았어요! 헬기가 내려옵니다 — 가까이 가서 H', 5000);
      const spot = freeSpotNear(pos.x, pos.z, 9, 30);
      heli.arrive(spot.x, spot.z, Math.atan2((bounds.minX + bounds.maxX) / 2 - spot.x, (bounds.minZ + bounds.maxZ) / 2 - spot.z));
    },
  });
  renderBattle();

  // ---- weapons: the hero may pick any of them, rivals were dealt one each ----
  const heroHeld = kit.hold(scene, 'fist');
  let weapon: Weapon = weaponById('fist');
  let triggerHeld = false;
  let aimHold = 0;
  let pendingShot = false;
  const rivalAt = (k: number) => (k >= 0 ? battle.positions().find((r) => r.name === RIVALS[k].name) : undefined);
  const shotEnd = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const aimVec = new THREE.Vector3();
  const reticle = new THREE.Mesh(keep(new THREE.RingGeometry(0.75, 0.95, 32).rotateX(-Math.PI / 2)), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff4d4d').multiplyScalar(2), transparent: true, opacity: 0.85, depthWrite: false })));
  reticle.visible = false;
  scene.add(reticle);
  const weaponsBar = $('weapons');
  weaponsBar.innerHTML = WEAPONS.map((w, k) => `<button data-weapon="${esc(w.id)}" title="${esc(w.name)} (${k + 1})" aria-pressed="false">${w.icon}<span>${esc(w.name)}</span><kbd>${k + 1}</kbd></button>`).join('');
  function selectWeapon(w: Weapon) {
    weapon = w;
    heroHeld.set(w.id);
    weaponsBar.querySelectorAll<HTMLElement>('[data-weapon]').forEach((b) => {
      const on = b.dataset.weapon === w.id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  selectWeapon(weapon);
  listen(weaponsBar, 'click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-weapon]')?.dataset.weapon as WeaponId | undefined;
    if (id) selectWeapon(weaponById(id));
    (e.target as HTMLElement).closest('button')?.blur();
  });
  const attack = () => {
    if (punchCooldown > 0 || !alive || mode !== 'walk' || detailOpen || entering) return;
    punchCooldown = weapon.cooldown;
    heroHeld.kick();
    if (weapon.kind === 'melee') {
      hero.emote('Punch');
      punchAt = 0.22;
      return;
    }
    aimHold = 0.7;
    pendingShot = true;
  };

  // ---- virus mode: spreads out from a random building until the player cures it at the source ----
  const sites = layout.buildings.map((b) => ({ x: b.x, z: b.z }));
  const virus = createVirus(sites, VIRUS_SPREAD, Math.random);
  const siege = createSiege();
  const diffKey = 'code-atlas.walk.virus-difficulty';
  let difficulty: Difficulty = 'normal';
  try {
    const stored = localStorage.getItem(diffKey);
    if (isDifficulty(stored)) difficulty = stored;
  } catch { /* storage may be blocked */ }
  let curing = 0;
  let nearOrigin = false;
  let kills = 0;
  let bossDown = false;
  let bossFormed = false;
  let collapsed = false;
  let closedCount = 0;
  // On 상 the minimap only rings the neighbourhood, not the building itself.
  const mapHint = { x: 0, z: 0, fuzz: 0 };
  const core = new THREE.Group();
  const coreMat = glow('#39ff7a', 2.6);
  const coreShell = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(0.75, 1)), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color('#39ff7a').multiplyScalar(1.6), wireframe: true })));
  core.add(new THREE.Mesh(keep(new THREE.IcosahedronGeometry(0.38, 0)), coreMat), coreShell);
  const coreLight = new THREE.PointLight('#39ff7a', 0, 18, 1.6);
  core.add(coreLight);
  core.visible = false;
  scene.add(core);
  const beacon = createBeacon(scene, BEAM_VERT, BEAM_FRAG);
  const guide = createGuide(scene);
  const energy = createMotes(scene, 900, new THREE.Color('#5dff8f').multiplyScalar(2.2), 0.35, true);
  const dust = createMotes(scene, 700, new THREE.Color('#8a8778'), 1.6, false);
  const openSpot = (x: number, z: number, min: number, max: number, r: number) => {
    const turn0 = Math.random() * Math.PI * 2;
    for (let d = min; d <= max; d += 1.5)
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const px = x + Math.cos(turn0 + a) * d, pz = z + Math.sin(turn0 + a) * d;
        if (!blockedWalker(px, pz, r)) return { x: px, z: pz };
      }
    return null;
  };
  const horde = createHorde(scene, robotUrl, energy, {
    blocked: blockedWalker,
    clear: clearLine,
    spot: (x, z, min, max) => openSpot(x, z, min, max, 0.6),
    onPlayerHit: (damage, fx, fz, push) => hurtPlayer(damage, fx, fz, push),
    onKill: () => { kills++; },
    onBossDown: () => { bossDown = true; },
    onQuake: (x, z) => { shake = Math.max(shake, Math.max(0.25, 1 - Math.hypot(x - pos.x, z - pos.z) / 60)); },
  });
  const originBuilding = () => (virus.origin >= 0 ? layout.buildings[virus.origin] : null);
  const buildingInfected = (b: WalkBuilding | null) => !!b && virus.state !== 'off' && isInfected(virus.levels[indexOf.get(b) ?? -1] ?? 0);
  const nodeInfected = (node: number) => buildingInfected(byNode.get(node) ?? null);
  const rule = () => siege.rule;
  function startVirus() {
    const o = pickOrigin(sites, { x: pos.x, z: pos.z }, Math.random);
    if (o < 0) return;
    const r = DIFFICULTY[difficulty];
    virus.start(o, r.spread);
    siege.start(r);
    kills = 0;
    bossDown = false;
    bossFormed = false;
    horde.warm(r.zombieCap + r.eliteCap + 1);
    const b = layout.buildings[o];
    core.position.set(b.x, 1.6, b.z + b.face * (b.d / 2 + 1.4));
    core.visible = true;
    coreLight.intensity = 10;
    beacon.show(b.x, b.z, b.h + ridge(b) + 0.16);
    uniforms.uOrigin.value = o;
    const a = Math.random() * Math.PI * 2;
    const off = difficulty === 'hard' ? 14 + Math.random() * 14 : 0;
    Object.assign(mapHint, { x: b.x + Math.cos(a) * off, z: b.z + Math.sin(a) * off, fuzz: off });
    toast(r.guide ? '바이러스가 퍼지기 시작했어요! 바닥의 형광 화살표를 따라 근원지로 가서 E 로 치료하세요' : '바이러스가 퍼지기 시작했어요! 초록 빛기둥이 솟은 근원지 건물 앞에서 E 로 치료하세요', 5000);
    renderVirus();
  }
  function endVirus(cured: boolean, byBoss = false) {
    const seconds = virus.elapsed;
    const saved = virus.infected;
    virus.cure();
    siege.stop();
    horde.clear('die');
    curing = 0;
    core.visible = false;
    coreLight.intensity = 0;
    beacon.hide();
    guide.setPath(null);
    uniforms.uOrigin.value = -1;
    if (byBoss) {
      const b = horde.boss;
      if (b) { energy.burst(b.x, 8, b.z, 200, 22, 6, 1.8); sparks.burst(b.x, 4, b.z, 120); }
      shake = Math.max(shake, 1);
      toast(`초대형 바이러스 처치! 레포를 지켜냈어요 — 도시가 되살아나요 (${clock(seconds)})`, 6000);
    } else if (cured) {
      sparks.burst(core.position.x, 1.6, core.position.z, 60);
      energy.burst(core.position.x, 1.6, core.position.z, 80, 8, 4, 1.4);
      toast(`바이러스 퇴치! ${clock(seconds)} 만에 건물 ${fmt(saved)}개를 되살렸어요`, 5000);
    }
    renderVirus();
  }
  const toggleVirus = () => {
    if (virus.state === 'spreading' && !siege.cancellable) { toast('괴물을 처치해야 끝나요'); return; }
    if (virus.state === 'spreading') endVirus(false);
    else if (virus.state === 'off') startVirus();
  };
  const bossHud = { boss: '', bar: -1, time: '' };
  function renderBossHud() {
    const phase = siege.phase;
    const show = phase === 'forming' || phase === 'boss' || phase === 'collapsing' || phase === 'over';
    const el = $('boss');
    if (el.hidden === show) el.hidden = !show;
    if (!show) return;
    const b = horde.boss;
    const title = phase === 'forming' ? '초대형 바이러스가 모이는 중…' : phase === 'boss' ? '초대형 바이러스' : '레포가 무너지고 있어요…';
    if (bossHud.boss !== title) { bossHud.boss = title; $('b-title').textContent = title; }
    const bar = Math.round(phase === 'forming' ? siege.progress * 100 : phase === 'boss' && b ? (b.hp / b.max) * 100 : 0);
    if (bar !== bossHud.bar) { bossHud.bar = bar; $('b-bar').style.width = `${bar}%`; }
    const time = phase === 'boss' ? clock(Math.ceil(siege.timeLeft)) : '';
    if (time !== bossHud.time) { bossHud.time = time; $('b-time').textContent = time; }
    el.classList.toggle('urgent', phase === 'boss' && siege.timeLeft < 20);
  }
  function renderDifficulty() {
    const locked = virus.state !== 'off';
    $('v-diff').querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((b) => {
      const on = b.dataset.diff === difficulty;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.disabled = locked;
    });
  }
  function renderVirus() {
    const on = virus.state === 'spreading';
    $('virus').hidden = !on;
    $('virus-btn').classList.toggle('on', on);
    $('virus-label').textContent = on ? (siege.cancellable ? '바이러스 모드 그만두기' : '괴물을 처치해야 끝나요') : '바이러스 모드 시작';
    renderDifficulty();
    if (!on) return;
    const total = layout.buildings.length;
    $('v-title').textContent = siege.phase === 'outbreak' ? '바이러스 확산 중' : '도시 전체 감염';
    $('v-time').textContent = clock(virus.elapsed);
    $('v-count').textContent = `${fmt(virus.infected)} / ${fmt(total)}`;
    $('v-bar').style.width = `${(virus.infected / Math.max(1, total)) * 100}%`;
    $('v-diff-label').textContent = rule().label;
    $('v-kills').textContent = fmt(kills);
    const note = VIRUS_NOTE + (rule().guide ? GUIDE_NOTE : '');
    if ($('v-note').dataset.note !== note) { $('v-note').dataset.note = note; $('v-note').innerHTML = note; }
    const b = originBuilding();
    const strength = b ? Math.max(0, 1 - Math.hypot(b.x - pos.x, b.z - pos.z) / Math.max(40, span * 0.8)) : 0;
    const bars = Math.max(1, Math.ceil(strength * 5));
    $('v-signal').querySelectorAll('i').forEach((el, k) => el.classList.toggle('on', k < bars));
  }
  listen($('virus-btn'), 'click', (e) => { toggleVirus(); (e.currentTarget as HTMLElement).blur(); });
  listen($('v-diff'), 'click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-diff]')?.dataset.diff;
    (e.target as HTMLElement).closest('button')?.blur();
    if (!isDifficulty(id) || virus.state !== 'off') return;
    difficulty = id;
    try { localStorage.setItem(diffKey, id); } catch { /* storage may be blocked */ }
    renderDifficulty();
  });
  renderDifficulty();
  function spawnFoes(events: string[]) {
    events.forEach((ev) => {
      if (ev === 'zombie') {
        let k = pickSpawnSite(sites, virus.levels, pos, Math.random);
        if (k < 0) k = pickSpawnSite(sites, virus.levels, pos, Math.random, 14, 100);
        if (k < 0) return;
        const door = frontOf(layout.buildings[k]);
        const at = openSpot(door.x, door.z, 0, 8, 0.6);
        if (at) horde.spawn('zombie', at.x, at.z);
      } else if (ev === 'elite') {
        const b = originBuilding();
        if (!b) return;
        const door = frontOf(b);
        const at = openSpot(door.x, door.z, 2, 14, 1.2);
        if (at) horde.spawn('elite', at.x, at.z);
      }
    });
  }
  function formBoss() {
    const b = originBuilding();
    if (!b) return;
    const door = frontOf(b);
    const at = openSpot(door.x, door.z, 0, 40, 3.2) ?? door;
    bossFormed = horde.formBoss(at.x, at.z, FORM_TIME * 0.85);
  }
  // Collapse: each building sinks in turn from the origin outwards, dragging its roof parts with it.
  const sinkOf = new Float32Array(layout.buildings.length);
  const dusted = new Uint8Array(layout.buildings.length);
  function sinkCity(progress: number) {
    const o = originBuilding() ?? layout.buildings[0];
    const far = Math.max(1, ...sites.map((b) => Math.hypot(b.x - o.x, b.z - o.z)));
    layout.buildings.forEach((b, k) => {
      const t = Math.min(1, Math.max(0, (progress - (Math.hypot(b.x - o.x, b.z - o.z) / far) * 0.45) / 0.5));
      sinkOf[k] = t * t * (b.h + ridge(b) + 4);
      if (t > 0 && !dusted[k]) {
        dusted[k] = 1;
        if (Math.hypot(b.x - camera.position.x, b.z - camera.position.z) < 160) dust.burst(b.x, 0.6, b.z, 10, Math.max(b.w, b.d) * 0.5, 1.5, 2.4);
      }
    });
    parts.forEach((p, j) => { aSink[j] = sinkOf[p.k]; });
    sinkAttr.needsUpdate = true;
    const drop = (mesh: THREE.InstancedMesh, items: (Item & { k: number })[], sag = 0) => {
      items.forEach((it, j) => place(mesh, { ...it, y: it.y - sinkOf[it.k] - sag * layout.buildings[it.k].h }, j, true));
      mesh.instanceMatrix.needsUpdate = true;
    };
    drop(roofMesh, roofs);
    drop(gableMesh, gables, 0.06);
    drop(slabMesh, balconies);
    drop(railMesh, balconies);
  }
  const floorAt = (x: number, z: number) => {
    let floor = 0;
    for (const b of nearby(x, z, 4)) if (gap(b, x, z) < 3) floor = Math.max(floor, b.h + ridge(b) + 0.16 + 1.2);
    return floor;
  };
  const partsOf = new Map<WalkBuilding, Part[]>();
  parts.forEach((p) => partsOf.set(p.b, [...(partsOf.get(p.b) ?? []), p]));
  const surfaceAt = (x: number, z: number) => {
    let top = 0;
    grid.get(key(Math.floor(x / GRID), Math.floor(z / GRID)))?.forEach((b) => partsOf.get(b)?.forEach((p) => {
      if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) top = Math.max(top, 0.16 + p.base + p.h);
    }));
    return top;
  };
  // Every heli bullet and bomb lands here, so new kinds of targets only need to be added once.
  function heliHit(x: number, y: number, z: number, radius: number, damage: number, fromX: number, fromZ: number) {
    const foes = horde.damageArea(x, y, z, radius, damage, fromX, fromZ, HELI_BOSS_BONUS);
    if (y > radius + 1.5) return foes;
    return foes + battle.damageArea(x, z, radius, damage, fromX, fromZ);
  }
  const heliArms = createHeliArms(scene, heli, {
    surfaceAt,
    hit: heliHit,
    blast: (x, y, z) => { shake = Math.max(shake, shakeAt(camera.position.distanceTo(v.set(x, y, z)))); },
    sparks,
    tracers,
  });
  let aimPitch = 0.55;
  let flyYaw = 0;
  const hud = { alt: '', speed: '', hint: '', bomb: -1, gun: false, lift: 0 };
  function renderHeliHud() {
    const set = (el: string, key: 'alt' | 'speed' | 'hint', text: string, html = false) => {
      if (hud[key] === text) return;
      hud[key] = text;
      if (html) $(el).innerHTML = text; else $(el).textContent = text;
    };
    set('hh-alt', 'alt', String(Math.round(heli.altitude)));
    set('hh-speed', 'speed', String(Math.round(heli.speed * 3.6)));
    const hp0 = heli.root.position;
    const outside = hp0.x < bounds.minX || hp0.x > bounds.maxX || hp0.z < bounds.minZ || hp0.z > bounds.maxZ;
    set('hh-hint', 'hint', heli.rpm < 0.8 ? '로터 도는 중…'
      : heli.autoLanding ? '착륙하는 중… <kbd>Space</kbd> 취소'
      : outside ? '도시 밖 — 돌아와야 착륙할 수 있어요'
      : '<kbd>H</kbd> 착륙', true);
    const charge = Math.round(heliArms.bombCharge * 100);
    if (charge !== hud.bomb) {
      hud.bomb = charge;
      $('hh-bomb-bar').style.width = `${charge}%`;
      $('hh-bomb').classList.toggle('ready', charge === 100);
    }
    const lift = (DESCEND.some((k) => keys.has(k)) ? -1 : 0) + (keys.has('Space') ? 1 : 0);
    if (lift !== hud.lift) {
      hud.lift = lift;
      $('hh-up').classList.toggle('on', lift > 0);
      $('hh-down').classList.toggle('on', lift < 0);
    }
    if (heliArms.firing !== hud.gun) {
      hud.gun = heliArms.firing;
      $('hh-gun').classList.toggle('on', hud.gun);
    }
  }
  function toggleHeli() {
    if (mode === 'walk') {
      const hpos = heli.root.position;
      if (heli.state === 'parked' && Math.hypot(hpos.x - pos.x, hpos.z - pos.z) < 7) {
        heli.board();
        mode = 'fly';
        keys.clear();
        triggerHeld = false;
        hero.root.visible = false;
        blob.visible = false;
        setFocus(null);
        root.classList.add('flying');
        toast('비행 시작 — WASD 이동 · Q/E 옆으로 · Space 상승 · C 하강 · F 기관총 · G 폭탄 · H 착륙', 5000);
      } else if (heli.state === 'hidden') {
        toast(`헬기는 ${RIVALS.length}명을 모두 잡으면 나타나요 (${battle.caught}/${RIVALS.length})`);
      } else if (heli.state === 'parked') {
        toast('헬기에 더 가까이 가야 탈 수 있어요');
      }
      return;
    }
    const hp0 = heli.root.position;
    if (hp0.x < bounds.minX || hp0.x > bounds.maxX || hp0.z < bounds.minZ || hp0.z > bounds.maxZ) { toast('도시 안으로 돌아와야 착륙할 수 있어요'); return; }
    heli.land();
  }
  function disembark() {
    mode = 'walk';
    keys.clear();
    triggerHeld = false;
    root.classList.remove('flying');
    const hpos = heli.root.position;
    pos.copy(freeSpotNear(hpos.x, hpos.z, 4, 20));
    vel.set(0, 0, 0);
    heading = heli.heading;
    yaw = heading + Math.PI;
    hero.root.visible = true;
    blob.visible = true;
  }

  // ---- entering a building ----
  let focus: WalkBuilding | null = null;
  let detailOpen = false;
  let entering: { t0: number; dur: number; b: WalkBuilding; from: THREE.Vector3; fromLook: THREE.Vector3 } | null = null;
  let codeRequest = 0;
  function setFocus(b: WalkBuilding | null) {
    focus = b;
    uniforms.uFocus.value = b ? indexOf.get(b) ?? -1 : -1;
    updatePrompt();
  }
  function updatePrompt() {
    const prompt = $('prompt');
    let html = '';
    const name = (i: number) => esc(arch.nodes[i].name);
    if (mode === 'drive') html = '<b>E</b> 내리기';
    else if (mode === 'ride' && traffic.riding) html = `<b>E</b> 먼저 내리기 — ${name(traffic.riding.t)}(으)로 가는 중`;
    else if (mode === 'walk' && alive && !detailOpen && !entering) {
      const hpos = heli.root.position;
      if (curing > 0) html = `백신 주입 중… ${Math.round((curing / CURE_TIME) * 100)}% — 자리를 지키세요`;
      else if (nearOrigin) html = '<b>E</b> 백신 주입 — 바이러스 근원지를 찾았어요!';
      else if (heli.state === 'parked' && Math.hypot(hpos.x - pos.x, hpos.z - pos.z) < 7) html = '<b>H</b> 헬기 타기';
      else if (nearVehicle) html = `<b>E</b> 운전 — ${nearVehicle.kind === 'car' ? '자동차' : '오토바이'}`;
      else if (nearCar) html = `<b>E</b> 탑승 — ${name(nearCar.f)} → ${name(nearCar.t)}`;
      else if (focus && buildingInfected(focus)) html = `바이러스에 잠식된 건물이에요 — ${name(focus.i)} 코드를 볼 수 없어요`;
      else if (focus) html = `<b>E</b> 들어가기 — ${name(focus.i)}`;
    }
    if (html) prompt.innerHTML = html;
    prompt.classList.toggle('open', !!html);
  }
  const showHero = (on: boolean) => { hero.root.visible = on; blob.visible = on; };
  function driveVehicle(v: Vehicle) {
    vehicles.enter(v);
    mode = 'drive';
    keys.clear();
    setFocus(null);
    if (v.kind === 'car') showHero(false); else hero.sit(true);
    toast('운전 — W/S 가속·브레이크 · A/D 핸들 · Shift 부스트 · Space 급제동 · E 내리기', 4500);
    updatePrompt();
  }
  function leaveVehicle() {
    const u = vehicles.exit();
    mode = 'walk';
    hero.sit(false);
    showHero(true);
    hero.root.rotation.z = 0;
    if (u) {
      pos.copy(freeSpotNear(u.x + Math.cos(u.heading) * 2.4, u.z - Math.sin(u.heading) * 2.4, 0, 10));
      heading = u.heading;
      yaw = heading + Math.PI;
    }
    vel.set(0, 0, 0);
    updatePrompt();
  }
  function hitch(car: RideCar) {
    traffic.board(car, (c) => {
      mode = 'walk';
      showHero(true);
      const b = byNode.get(c.t);
      if (b) {
        pos.copy(freeSpotNear(b.x, b.z + b.face * (b.d / 2 + 2.6), 0, 8));
        heading = b.face > 0 ? Math.PI : 0;
        yaw = heading + Math.PI;
      }
      vel.set(0, 0, 0);
      toast(`${arch.nodes[c.t].name} 도착! — ${arch.nodes[c.f].name} 이(가) 쓰는 파일이에요`, 3500);
      updatePrompt();
    });
    mode = 'ride';
    keys.clear();
    setFocus(null);
    showHero(false);
    toast(`${arch.nodes[car.f].name} → ${arch.nodes[car.t].name} 차에 탔어요 — 도착하면 내려 줘요`, 3500);
    updatePrompt();
  }
  function hopOff() {
    const car = traffic.riding;
    traffic.leave();
    mode = 'walk';
    showHero(true);
    if (car) pos.copy(freeSpotNear(car.x, car.z, 3, 12));
    vel.set(0, 0, 0);
    updatePrompt();
  }
  function interact() {
    if (nearOrigin) { if (curing <= 0) curing = 0.001; updatePrompt(); }
    else if (nearVehicle) driveVehicle(nearVehicle);
    else if (nearCar) hitch(nearCar);
    else if (focus && buildingInfected(focus)) toast('바이러스에 잠식된 건물은 코드를 볼 수 없어요 — 근원지를 치료하면 다시 열려요');
    else if (focus) enter(focus);
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
    root.classList.add('inside');
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
    root.classList.remove('entering', 'inside');
    $('detail').classList.remove('open');
    setFocus(focus);
  }
  listen($('d-close'), 'click', leave);
  const helpOpen = () => !$('help').hidden;
  const setHelp = (on: boolean) => { $('help').hidden = !on; if (on) keys.clear(); };
  listen($('help-btn'), 'click', (e) => { setHelp(!helpOpen()); (e.currentTarget as HTMLElement).blur(); });
  listen($('help-close'), 'click', () => setHelp(false));
  let guideStep = -1;
  const guideOpen = () => guideStep >= 0;
  function showGuide(step: number) {
    guideStep = step;
    $('guide').hidden = step < 0;
    if (step < 0) {
      try { localStorage.setItem(GUIDE_KEY, '1'); } catch { /* storage may be blocked */ }
      return;
    }
    keys.clear();
    triggerHeld = false;
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
    const g = GUIDE[step];
    const last = step === GUIDE.length - 1;
    $('g-step').textContent = `${step + 1} / ${GUIDE.length}`;
    $('g-title').textContent = g.title;
    $('g-repo').textContent = step === 0 ? arch.name : '';
    $('g-body').textContent = g.body;
    $('g-keys').innerHTML = g.keys.map(([k, what]) => `<span><kbd>${esc(k)}</kbd>${esc(what)}</span>`).join('');
    $('g-dots').innerHTML = GUIDE.map((_, k) => `<i class="${k === step ? 'on' : ''}"></i>`).join('');
    $<HTMLButtonElement>('g-prev').disabled = step === 0;
    $('g-next').textContent = last ? '시작하기' : '다음';
    $('g-next').focus();
  }
  const guideNext = () => showGuide(guideStep < GUIDE.length - 1 ? guideStep + 1 : -1);
  listen($('g-next'), 'click', guideNext);
  listen($('g-prev'), 'click', () => showGuide(Math.max(0, guideStep - 1)));
  listen($('g-skip'), 'click', () => showGuide(-1));
  listen($('guide-open'), 'click', () => { setHelp(false); showGuide(0); });
  let guideSeen = false;
  try { guideSeen = !!localStorage.getItem(GUIDE_KEY); } catch { guideSeen = false; }
  if (!guideSeen) showGuide(0);

  // ---- input ----
  const typing = () => document.activeElement instanceof HTMLInputElement;
  const EMOTES: Emote[] = ['Wave', 'ThumbsUp', 'Dance'];
  let emoteIndex = 0;
  listen(window, 'keydown', (e) => {
    if (e.metaKey || e.altKey || (e.ctrlKey && e.key !== 'Control')) return;
    if (guideOpen()) {
      if (e.key === 'Escape') showGuide(-1);
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); guideNext(); }
      else if (e.key === 'ArrowLeft') showGuide(Math.max(0, guideStep - 1));
      return;
    }
    if (typing()) { if (e.key === 'Escape') (document.activeElement as HTMLElement).blur(); return; }
    if (helpOpen()) { if (e.key === 'Escape' || e.key === '?') setHelp(false); return; }
    if (e.key === 'Escape' && (detailOpen || entering)) { leave(); return; }
    if (detailOpen || entering) return;
    if (e.key === '?') { setHelp(true); return; }
    const isE = e.key === 'e' || e.key === 'E' || e.key === 'ㄷ';
    if (e.code === 'KeyT') { applyTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]); return; }
    if (e.code === 'KeyV') { toggleVirus(); return; }
    if (e.code === 'KeyH' && alive && (mode === 'walk' || mode === 'fly')) { toggleHeli(); return; }
    if (mode === 'drive' || mode === 'ride') {
      if (isE) { if (mode === 'drive') leaveVehicle(); else hopOff(); return; }
      if (mode === 'drive') {
        keys.add(e.code);
        if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      }
      return;
    }
    if (mode === 'fly') {
      if (e.code === 'KeyF') { triggerHeld = true; return; }
      if (e.code === 'KeyG') { if (!e.repeat) heliArms.bomb(); return; }
      keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
      return;
    }
    const slot = /^Digit([1-9])$/.exec(e.code);
    if (slot && WEAPONS[Number(slot[1]) - 1]) { selectWeapon(WEAPONS[Number(slot[1]) - 1]); return; }
    if (!alive) return;
    if (e.code === 'KeyF') { if (!e.repeat) { triggerHeld = true; attack(); } return; }
    if (e.key === '/') { e.preventDefault(); $('q').focus(); return; }
    if (isE) { interact(); return; }
    if (e.code === 'KeyG') { hero.emote(EMOTES[emoteIndex++ % EMOTES.length]); return; }
    if (e.code === 'Space') {
      e.preventDefault();
      if (footY <= 0.001) vy = JUMP;
      return;
    }
    keys.add(e.code);
    if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  listen(window, 'keyup', (e) => { keys.delete(e.code); if (e.code === 'KeyF') triggerHeld = false; });
  listen(window, 'blur', () => { keys.clear(); triggerHeld = false; });
  listen(renderer.domElement, 'click', () => {
    if (document.pointerLockElement === renderer.domElement) return;
    if (!detailOpen && !entering) Promise.resolve(renderer.domElement.requestPointerLock?.()).catch(() => {});
  });
  listen(renderer.domElement, 'pointerdown', (e) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    if (mode === 'fly' && e.button === 2) { heliArms.bomb(); return; }
    if (e.button !== 0) return;
    triggerHeld = true;
    attack();
  });
  listen(renderer.domElement, 'contextmenu', (e) => { if (mode === 'fly') e.preventDefault(); });
  listen(window, 'pointerup', () => { if (document.pointerLockElement === renderer.domElement) triggerHeld = false; });
  let dragging = false;
  listen(renderer.domElement, 'pointerdown', () => (dragging = true));
  listen(window, 'pointerup', () => (dragging = false));
  listen(document, 'mousemove', (e) => {
    if (detailOpen || entering) return;
    if (document.pointerLockElement !== renderer.domElement && !dragging) return;
    if (mode === 'fly') {
      flyYaw -= e.movementX * 0.0026;
      aimPitch = Math.min(1.35, Math.max(0.15, aimPitch + e.movementY * 0.002));
      return;
    }
    yaw -= e.movementX * 0.0032;
    pitch = Math.min(1.15, Math.max(-0.05, pitch + e.movementY * 0.0026));
  });
  listen(renderer.domElement, 'wheel', (e) => {
    e.preventDefault();
    distance = Math.min(22, Math.max(2.5, distance + e.deltaY * 0.01));
  });

  const clampToCity = (p: THREE.Vector3) => p.set(Math.min(bounds.maxX - 2, Math.max(bounds.minX + 2, p.x)), 0, Math.min(bounds.maxZ - 2, Math.max(bounds.minZ + 2, p.z)));
  function teleport(to: THREE.Vector3) {
    pos.copy(clampToCity(to.clone()));
    vel.set(0, 0, 0);
    const want = pos.clone();
    // Nearest free point in widening rings, so a door-front target stays at the door even if something parks there.
    search: for (let r = 0; r <= 12 && blockedWalker(pos.x, pos.z); r += 0.75)
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        clampToCity(pos.set(want.x + Math.cos(a) * r, 0, want.z + Math.sin(a) * r));
        if (!blockedWalker(pos.x, pos.z)) break search;
      }
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
    // During an outbreak the role colours fade back so the infected area reads at a glance.
    mapCtx.globalAlpha = virus.state === 'off' ? 1 : 0.3;
    mapCtx.drawImage(base, 0, 0);
    mapCtx.globalAlpha = 1;
    if (virus.state !== 'off') layout.buildings.forEach((b, k) => {
      const level = virus.levels[k];
      if (level < 0.02) return;
      const [x, y] = toMap(b.x - b.w / 2, b.z - b.d / 2);
      mapCtx.fillStyle = `rgba(90, 255, 140, ${0.3 + level * 0.7})`;
      mapCtx.fillRect(x, y, Math.max(1.5, (b.w / span) * 200), Math.max(1.5, (b.d / span) * 200));
    });
    if (virus.state === 'spreading' && siege.phase === 'outbreak') {
      const [hx, hy] = toMap(mapHint.x, mapHint.z);
      const t = (performance.now() / 1000 * 0.9) % 1;
      const r0 = 4 + (mapHint.fuzz / span) * 200;
      mapCtx.lineWidth = 2;
      mapCtx.strokeStyle = 'rgba(57, 255, 122, .9)';
      mapCtx.beginPath();
      mapCtx.arc(hx, hy, r0, 0, Math.PI * 2);
      mapCtx.stroke();
      mapCtx.strokeStyle = `rgba(57, 255, 122, ${1 - t})`;
      mapCtx.beginPath();
      mapCtx.arc(hx, hy, r0 + 3 + t * 18, 0, Math.PI * 2);
      mapCtx.stroke();
    }
    horde.positions().forEach((f) => {
      const [x, y] = toMap(f.x, f.z);
      mapCtx.fillStyle = f.kind === 'zombie' ? '#b6ff4a' : '#39ff7a';
      mapCtx.beginPath();
      mapCtx.arc(x, y, f.kind === 'boss' ? 7 : f.kind === 'elite' ? 3.6 : 1.8, 0, Math.PI * 2);
      mapCtx.fill();
      if (f.kind === 'zombie') return;
      mapCtx.strokeStyle = '#0b0d12';
      mapCtx.lineWidth = 1.2;
      mapCtx.stroke();
    });
    battle.positions().forEach((r) => {
      const [x, y] = toMap(r.x, r.z);
      mapCtx.fillStyle = r.down ? '#5c6270' : r.tint;
      mapCtx.beginPath();
      mapCtx.arc(x, y, 3.4, 0, Math.PI * 2);
      mapCtx.fill();
    });
    if (heli.state !== 'hidden' && mode === 'walk') {
      const [x, y] = toMap(heli.root.position.x, heli.root.position.z);
      mapCtx.fillStyle = '#ffd43b';
      mapCtx.fillRect(x - 4, y - 4, 8, 8);
    }
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

  const themeKey = 'code-atlas.walk.theme';
  function applyTheme(t: Theme) {
    theme = t;
    const skyU = (sky.material as THREE.ShaderMaterial).uniforms;
    skyU.uHorizon.value.set(t.horizon);
    skyU.uZenith.value.set(t.zenith);
    skyU.uGlow.value.set(t.glow);
    skyU.uSunColor.value.set(t.disc ? t.disc.color : '#000000').multiplyScalar(t.disc ? 1 : 0);
    fogColor.set(t.horizon);
    (scene.fog as THREE.Fog).near = t.fog[0];
    (scene.fog as THREE.Fog).far = t.fog[1];
    moonDir.set(...t.sun.dir).normalize();
    moon.color.set(t.sun.color);
    moon.intensity = t.sun.intensity;
    if (t.disc) {
      (moonDisc.material as THREE.MeshBasicMaterial).color.set(t.disc.color).multiplyScalar(t.disc.boost);
      moonDisc.scale.setScalar(t.disc.size / 28);
    }
    hemi.color.set(t.hemi.sky);
    hemi.groundColor.set(t.hemi.ground);
    hemi.intensity = t.hemi.intensity;
    renderer.toneMappingExposure = t.exposure;
    bloom.strength = t.bloom;
    uniforms.uDay.value = t.day;
    beacon.tone(t.day);
    uniforms.uLit.value = t.lit;
    uniforms.uSky.value.set(t.horizon);
    lampsOn = t.lamps;
    lampHead.color.set('#ffd29a').multiplyScalar(t.lamps ? 2.2 : 0.3);
    pool.opacity = t.lamps ? 0.035 : 0;
    groundMat.color.set(t.ground);
    lotMat.color.setScalar(t.lot);
    rain.tone(groundMat.color);
    rain.set(t.rain);
    refreshSky();
    updateLampLights(pos.x, pos.z);
    $('themes').querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.theme === t.id);
      b.setAttribute('aria-checked', String(b.dataset.theme === t.id));
    });
    try { localStorage.setItem(themeKey, t.id); } catch { /* storage may be blocked */ }
  }
  $('themes').innerHTML = THEMES.map((t) => `<button role="radio" aria-checked="false" data-theme="${esc(t.id)}" title="${esc(t.label)} (T)">${WEATHER_ICONS[t.id] ?? ''}<span>${esc(t.short)}</span></button>`).join('');
  listen($('themes'), 'click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-theme]')?.dataset.theme;
    const t = THEMES.find((x) => x.id === id);
    if (t) applyTheme(t);
    (e.target as HTMLElement).closest('button')?.blur();
  });
  let saved: string | null = null;
  try { saved = localStorage.getItem(themeKey); } catch { saved = null; }
  applyTheme(THEMES.find((t) => t.id === saved) ?? THEMES[0]);

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

  let disposed = false;
  let last = performance.now();
  let slowClock = 0;
  let guideClock = 0;
  let trafficClock = 0;
  const guidePath = (): PathPoint[] | null => {
    const o = originBuilding();
    if (!o) return null;
    const near = layout.buildings.reduce((best, b) => (gap(b, pos.x, pos.z) < gap(best, pos.x, pos.z) ? b : best), o);
    const door = frontOf(o);
    return [[pos.x, pos.z], ...(near === o ? [] : routeBetween(layout, near, o)), [door.x, door.z]];
  };
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
    const flying = mode === 'fly';
    const onFoot = mode === 'walk';
    wish.set(0, 0, 0);
    if (alive && onFoot) wish.addScaledVector(forward, fz).addScaledVector(right, fx);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(running ? RUN : WALK);
    const airborne = footY > 0.001 || vy > 0;
    vel.lerp(wish, Math.min(1, dt * (airborne ? ACCEL * 0.15 : ACCEL) / Math.max(1, vel.distanceTo(wish))));
    if (vel.lengthSq() < 0.0004 && wish.lengthSq() === 0) vel.set(0, 0, 0);
    if (onFoot) knock.multiplyScalar(Math.exp(-dt * (airborne ? 1.5 : 7))); else knock.set(0, 0, 0);
    const stepX = (vel.x + knock.x) * dt, stepZ = (vel.z + knock.z) * dt;
    if (!blockedWalker(pos.x + stepX, pos.z)) pos.x += stepX; else { vel.x = 0; knock.x = 0; }
    if (!blockedWalker(pos.x, pos.z + stepZ)) pos.z += stepZ; else { vel.z = 0; knock.z = 0; }
    vy -= GRAVITY * dt;
    footY = Math.max(0, footY + vy * dt);
    if (footY === 0 && vy < 0) vy = 0;
    const speed = Math.hypot(vel.x, vel.z);
    const prev = heading;
    aimHold = Math.max(0, aimHold - dt);
    if (triggerHeld && weapon.auto) attack();
    const aimHeading = yaw + Math.PI;
    if (aimHold > 0 && onFoot) heading = turnToward(heading, aimHeading, dt, 22, 26);
    else if (speed > 0.3) heading = turnToward(heading, Math.atan2(vel.x, vel.z), dt, 10, 12);
    turnRate += ((Math.atan2(Math.sin(heading - prev), Math.cos(heading - prev)) / Math.max(dt, 1e-3)) - turnRate) * Math.min(1, dt * 8);
    const run = Math.max(0, Math.min(1, (speed - WALK) / (RUN - WALK)));
    hero.animate({ speed, run, airborne: footY > 0.05, turn: turnRate, dt, time });
    hero.root.position.set(pos.x, footY + 0.16, pos.z);
    hero.root.rotation.y = heading;
    const gun = weapon.kind === 'gun';
    heroHeld.follow(hero.rig, gun && (aimHold > 0 || triggerHeld) ? aimVec.set(Math.sin(aimHold > 0 ? aimHeading : heading), 0, Math.cos(aimHold > 0 ? aimHeading : heading)) : null, hero.root.visible && onFoot && alive);
    if (pendingShot) {
      pendingShot = false;
      heroHeld.tip(muzzle);
      const foe = horde.aimTarget(pos, aimHeading, weapon);
      const rival = rivalAt(battle.aimTarget(pos, aimHeading, weapon));
      if (foe && (!rival || foe.d < Math.hypot(rival.x - pos.x, rival.z - pos.z))) horde.shoot(pos, aimHeading, weapon, shotEnd);
      else battle.shoot(pos, aimHeading, weapon, shotEnd);
      const pellets = weapon.id === 'shotgun' ? 6 : 1;
      for (let k = 0; k < pellets; k++) {
        const end = pellets > 1 ? v.copy(shotEnd).add(s.set((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.6)) : shotEnd;
        tracers.fire(muzzle, end);
      }
      sparks.burst(shotEnd.x, shotEnd.y, shotEnd.z, 6);
      shake = Math.max(shake, weapon.id === 'shotgun' ? 0.35 : 0.08);
    }
    const aiming = gun && onFoot && alive;
    const rivalAim = aiming ? rivalAt(battle.aimTarget(pos, yaw + Math.PI, weapon)) : undefined;
    const foeAim = aiming ? horde.aimTarget(pos, yaw + Math.PI, weapon) : null;
    const target = foeAim && (!rivalAim || foeAim.d < Math.hypot(rivalAim.x - pos.x, rivalAim.z - pos.z)) ? foeAim : rivalAim;
    reticle.visible = !!target;
    if (target) {
      reticle.position.set(target.x, 0.22, target.z);
      reticle.rotation.y = time * 2;
      reticle.scale.setScalar(target === foeAim ? Math.max(1, foeAim.r * 1.4) : 1);
    }
    blob.position.set(pos.x, 0.18, pos.z);
    blob.scale.setScalar(1 / (1 + footY * 0.6));
    heli.update(dt, time, flying
      ? { forward: fz, strafe: input(['KeyE'], ['KeyQ']), turn: -fx, lift: input(['Space'], DESCEND), boost: running, yaw: flyYaw }
      : { forward: 0, strafe: 0, turn: 0, lift: 0, boost: false, yaw: 0 }, floorAt);
    flyYaw = 0;
    heliArms.update(dt, time, { active: flying, firing: triggerHeld, pitch: aimPitch });
    if (flying) {
      pos.set(heli.root.position.x, 0, heli.root.position.z);
      if (heli.state === 'parked') disembark(); else renderHeliHud();
    }
    const impact = vehicles.update(dt, mode === 'drive' ? { throttle: fz, steer: -fx, boost: running, handbrake: keys.has('Space') } : { throttle: 0, steer: 0, boost: false, handbrake: false }, pos);
    const drivenNow = vehicles.driving;
    if (mode === 'drive' && drivenNow) {
      const spd = Math.abs(drivenNow.speed);
      const dirx = Math.sin(drivenNow.heading) * Math.sign(drivenNow.speed || 1), dirz = Math.cos(drivenNow.heading) * Math.sign(drivenNow.speed || 1);
      const reachAhead = drivenNow.kind === 'car' ? 1.8 : 0.9;
      const nose = { x: drivenNow.x + dirx * reachAhead, z: drivenNow.z + dirz * reachAhead };
      let crash = impact ? impact.speed : 0;
      const body = drivenNow.kind === 'car' ? 1.3 : 0.7;
      if (battle.ram(nose.x, nose.z, body, dirx, dirz, spd) + horde.ram(nose.x, nose.z, body, dirx, dirz, spd)) { vehicles.bounce(0.55); crash = Math.max(crash, spd * 0.5); }
      if (spd > 1.5) {
        const other = traffic.bump(nose.x, nose.z, drivenNow.kind === 'car' ? 1.0 : 0.5);
        if (other >= 0) { vehicles.bounce(-0.3); crash = Math.max(crash, spd + other * 0.5); }
      }
      if (crash > 2.5) {
        shake = Math.max(shake, Math.min(1, crash / 22));
        sparks.burst(nose.x, 0.8, nose.z, Math.min(40, 8 + crash * 1.5));
        if (crash > 12) hurtPlayer(Math.round((crash - 12) * 1.5), nose.x, nose.z, 0);
      }
    }
    if (mode === 'drive' && drivenNow) {
      pos.set(drivenNow.x, 0, drivenNow.z);
      heading = drivenNow.heading;
      if (drivenNow.kind === 'bike') {
        hero.root.position.set(drivenNow.x, 0.3, drivenNow.z);
        hero.root.rotation.set(0, drivenNow.heading, drivenNow.lean);
      }
    }
    const ridden = traffic.riding;
    if (mode === 'ride' && ridden) pos.set(ridden.x, 0, ridden.z);
    if (!alive && now >= respawnAt) {
      alive = true;
      hp = 100;
      hero.revive();
      teleport(spawnPoint);
      heading = spawnHeading;
      yaw = heading + Math.PI;
      renderBattle();
    }
    punchCooldown -= dt;
    if (punchAt > 0) {
      punchAt -= dt;
      if (punchAt <= 0) { battle.strike(pos, heading, weapon); horde.strike(pos, heading, weapon); }
    }
    battle.update(dt, pos, alive && onFoot && !detailOpen && !entering);
    if (virus.update(dt)) {
      parts.forEach((p, j) => { aInfect[j] = virus.levels[p.k]; });
      infectAttr.needsUpdate = true;
      tintInfected(virus.levels);
    }
    horde.update(dt, time, { x: pos.x, z: pos.z, y: flying ? heli.root.position.y : footY }, alive && onFoot && !detailOpen && !entering);
    const allInfected = virus.infected === layout.buildings.length && virus.levels.every((l) => l >= 1);
    const events = virus.state === 'spreading' ? siege.update(dt, { allInfected, bossDown, zombies: horde.zombies, elites: horde.elites }) : [];
    spawnFoes(events);
    if (events.includes('form')) {
      horde.clear('poof');
      guide.setPath(null);
      curing = 0;
      toast('도시가 모두 감염됐어요! 근원지에서 초대형 바이러스가 깨어나요', 5000);
      formBoss();
    } else if (siege.phase === 'forming' && !bossFormed) formBoss();
    if (events.includes('boss')) toast(`초대형 바이러스 등장! ${clock(rule().bossTime)} 안에 처치하지 않으면 레포가 붕괴돼요`, 5000);
    if (events.includes('won')) endVirus(true, true);
    if (events.includes('collapse')) {
      horde.clear('poof');
      beacons.visible = beaconPoles.visible = false;
      signs.forEach((sg) => { sg.mesh.visible = false; sg.owner = -1; });
      if (detailOpen || entering) leave();
      toast('시간 초과 — 바이러스가 레포를 무너뜨리고 있어요!', 7000);
    }
    const sinking = siege.phase === 'collapsing' || siege.phase === 'over';
    if (sinking) {
      sinkCity(siege.progress);
      shake = Math.max(shake, 0.3 + siege.progress * 0.4);
    }
    if (events.includes('collapsed') && !collapsed) {
      collapsed = true;
      env.collapse();
    }
    renderBossHud();
    beacon.update(time, dt);
    energy.update(dt);
    dust.update(dt);
    guideClock -= dt;
    if (guideClock <= 0) {
      guideClock = 0.5;
      guide.setPath(rule().guide && siege.phase === 'outbreak' ? guidePath() : null);
    }
    guide.update(time);
    if (core.visible) {
      core.rotation.y = time * 1.4;
      coreShell.rotation.x = time * 0.9;
      core.position.y = 1.6 + Math.sin(time * 2.2) * 0.2;
    }
    if (curing > 0) {
      if (!nearOrigin || !alive || mode !== 'walk') { curing = 0; toast('치료가 끊겼어요 — 근원지 앞에 머물러야 해요'); }
      else {
        curing += dt;
        if (curing >= CURE_TIME) endVirus(true);
      }
      updatePrompt();
    }
    hurt = Math.max(0, hurt - dt * 1.6);
    $('hurt').style.opacity = String(hurt * 0.85);

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
    } else if ((mode === 'drive' && drivenNow) || (mode === 'ride' && ridden)) {
      $('fade').style.opacity = '0';
      const h = drivenNow && mode === 'drive' ? drivenNow.heading : Math.atan2(ridden!.dx, ridden!.dz);
      const spd = drivenNow && mode === 'drive' ? Math.abs(drivenNow.speed) : ridden!.speed;
      const want = h + Math.PI;
      yaw += Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw)) * Math.min(1, dt * 3);
      const back = (drivenNow?.kind === 'bike' && mode === 'drive' ? 6 : 9) + spd * 0.08;
      let reach = back;
      do {
        camPos.set(Math.sin(yaw) * Math.cos(0.24), Math.sin(0.24), Math.cos(yaw) * Math.cos(0.24)).multiplyScalar(reach).add(v.set(pos.x, 1.7, pos.z));
        reach -= 0.5;
      } while (reach > 2 && insideBuilding(camPos));
      camera.position.lerp(camPos, Math.min(1, dt * 6));
      lookAt.lerp(v.set(pos.x, 1.3, pos.z), Math.min(1, dt * 12));
      camera.lookAt(lookAt);
    } else if (flying) {
      $('fade').style.opacity = '0';
      const hpos = heli.root.position;
      const want = heli.heading + Math.PI;
      yaw += Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw)) * Math.min(1, dt * 3);
      // Rising with the aim and looking down with altitude keeps the heli, its aim point and the bomb drop point in one frame.
      const elev = 0.3 + aimPitch * 0.35;
      let reach = 17 + heli.speed * 0.15;
      do {
        camPos.set(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev)).multiplyScalar(reach).add(v.set(hpos.x, hpos.y + 2.5, hpos.z));
        reach -= 1;
      } while (reach > 6 && insideBuilding(camPos));
      camera.position.lerp(camPos, Math.min(1, dt * 5));
      const ahead = Math.min(0.25, 15 / Math.max(1, heliArms.aim.distanceTo(hpos)));
      lookAt.lerp(v.set(hpos.x, hpos.y + 2 - heli.altitude * 0.45, hpos.z).lerp(heliArms.aim, ahead), Math.min(1, dt * 8));
      camera.lookAt(lookAt);
    } else {
      $('fade').style.opacity = '0';
      const orbit = (r: number) => camPos.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(r).add(v.set(pos.x, 1.7 + footY * 0.5, pos.z));
      let reach = distance;
      while (reach > 1.5 && insideBuilding(orbit(reach))) reach -= 0.5;
      // Pull in at once so walls never cut the view, but ease back out so the camera does not pump along a wall.
      camReach = reach < camReach ? reach : camReach + (reach - camReach) * Math.min(1, dt * 3);
      orbit(camReach);
      bob += dt * speed * 2.6;
      camPos.y = Math.max(0.6, camPos.y) + (reduceMotion ? 0 : Math.sin(bob) * 0.035 * run);
      camera.position.lerp(camPos, Math.min(1, dt * 9));
      lookAt.lerp(v.set(pos.x, 1.6 + footY * 0.4, pos.z), Math.min(1, dt * 14));
      camera.lookAt(lookAt);
    }
    if (shake > 0.001 && !reduceMotion) {
      camera.position.x += (Math.random() - 0.5) * shake * 0.6;
      camera.position.y += (Math.random() - 0.5) * shake * 0.4;
      shake = Math.max(0, shake - dt * 2.5);
    }
    const targetFov = flying ? 62 + (heli.speed / 52) * 14 : mode === 'drive' && drivenNow ? 60 + (Math.abs(drivenNow.speed) / 40) * 14 : 58 + run * 10;
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
      if (!sinking) updateSigns(pos.x, pos.z);
      updateLampLights(pos.x, pos.z);
      let near: WalkBuilding | null = null;
      let nearGap = 20;
      if (onFoot) for (const b of nearby(pos.x, pos.z, 21)) { const g = gap(b, pos.x, pos.z); if (g < nearGap) { nearGap = g; near = b; } }
      if (mode !== 'ride') traffic.setFocus(near ? near.i : null, pos);
      nearVehicle = onFoot && alive ? vehicles.nearest(pos.x, pos.z) : null;
      nearCar = onFoot && alive && !nearVehicle ? traffic.nearest(pos.x, pos.z, 6.5) : null;
      const ob = virus.state === 'spreading' && siege.phase === 'outbreak' ? originBuilding() : null;
      nearOrigin = !!ob && onFoot && alive && gap(ob, pos.x, pos.z) < REACH + 0.5;
      if ((detailOpen || entering) && buildingInfected(entering?.b ?? focus)) {
        leave();
        toast('이 건물이 바이러스에 잠식됐어요 — 밖으로 나왔어요');
      }
      trafficClock -= 0.2;
      if (trafficClock <= 0) {
        trafficClock = 1;
        const closedNow = virus.state === 'off' ? 0 : virus.levels.reduce((n, l) => n + (isInfected(l) ? 1 : 0), 0);
        if (closedNow !== closedCount) {
          closedCount = closedNow;
          const car = traffic.riding;
          if (mode === 'ride' && car && (nodeInfected(car.f) || nodeInfected(car.t))) {
            hopOff();
            toast('차가 바이러스 구역에 막혀서 내렸어요', 2400);
          }
          traffic.setClosed(closedNow ? nodeInfected : null);
        }
      }
      renderVirus();
      if (!entering && !detailOpen && onFoot) {
        let best: WalkBuilding | null = null;
        let bestGap = REACH;
        for (const b of nearby(pos.x, pos.z, REACH + 1)) {
          const g = gap(b, pos.x, pos.z);
          if (g < bestGap) { bestGap = g; best = b; }
        }
        if (best !== focus) setFocus(best);
      }
      updatePrompt();
      drawMap();
    }
    const struck = traffic.update(dt, flying ? heli.root.position : pos, onFoot && alive ? pos : null);
    if (struck > 0) {
      hurtPlayer(Math.round(struck * 2 + 4), pos.x - Math.sin(heading), pos.z - Math.cos(heading), 9);
      vy = 4.5;
      toast('차에 치였어요!', 1600);
    }
    markers.update(time, onFoot && alive ? (nearVehicle ?? nearCar) : null, nearVehicle ? '운전' : '탑승');
    sparks.update(dt);
    tracers.update(dt);
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
    battle.dispose();
    horde.dispose();
    beacon.dispose();
    guide.dispose();
    energy.dispose();
    dust.dispose();
    heroHeld.dispose();
    kit.dispose();
    tracers.dispose();
    coreLight.dispose();
    vehicles.dispose();
    sparks.dispose();
    markers.dispose();
    heliArms.dispose();
    heli.dispose();
    window.clearTimeout(toastTimer);
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
    root.classList.remove('wk-walk', 'entering', 'flying');
  };
};
