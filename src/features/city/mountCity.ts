import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import 'highlight.js/styles/github-dark.css';
import './city.css';
import type { ArchNode } from '../../engine/architecture';
import type { MountViewer } from '../viewer-env';
import { esc } from '../escape';
import { LAYER_TINT, roleColors } from '../palette';
import { renderCode } from '../code-viewer/highlight';
import { ROAD, layoutCity } from './layout';
import { createSelectionReporter } from './selection';
import { MAX_HEIGHT, SMALL_CITY, homeView } from './homeView';

const KIND_LABEL: Record<string, string> = {
  inject: '생성자 주입', type: '타입 힌트', 'static-call': '정적 호출', new: 'new 생성', const: '상수·enum',
  'class-ref': '::class', trait: '트레이트', catch: 'catch', instanceof: 'instanceof', extends: '상속',
  implements: '구현', attribute: '어트리뷰트', triggers: '이벤트→리스너', binds: '바인딩', other: '기타',
  import: 'import', 'type-import': '타입 import', 'dynamic-import': '동적 import', 're-export': '재export', require: 'require',
};
const fmt = (n: number) => Number(n).toLocaleString('ko-KR');

type HeightKey = 'fanIn' | 'fanOut' | 'centrality' | 'routeRefs' | 'functions' | 'maxComplexity' | 'lines';
type ColorKey = 'role' | 'instability' | 'upward' | 'maxComplexity';

interface CityEdge { f: number; t: number; w: number; kinds: Record<string, number>; up: boolean; strong: boolean }
interface CityNode extends ArchNode {
  i: number;
  layer: number;
  color: THREE.Color;
  css: string;
  incoming: CityEdge[];
  outgoing: CityEdge[];
  neighbors: Set<number>;
  upStrong: number;
  upWeak: number;
  cx: number;
  cz: number;
  fp: number;
  h: number;
}

const MARKUP = `
<div class="cc-top glass">
    <h1 data-el="title">의존성 도시</h1>
    <div class="meta" data-el="meta"></div>
    <div class="search">
        <input data-el="q" type="search" placeholder="파일·클래스 검색  ( / )" autocomplete="off">
        <div class="cc-results" data-el="results"></div>
    </div>
    <label class="row">높이
        <select data-el="height">
            <option value="fanIn">fan-in — 나를 쓰는 파일 수</option>
            <option value="fanOut">fan-out — 내가 쓰는 파일 수</option>
            <option value="centrality">중심도 (PageRank)</option>
            <option value="routeRefs">라우트 참조 수</option>
            <option value="functions">함수 수</option>
            <option value="maxComplexity">함수 최대 복잡도</option>
            <option value="lines">줄 수</option>
        </select>
    </label>
    <label class="row">색
        <select data-el="color">
            <option value="role">역할</option>
            <option value="instability">불안정도 (기반 ↔ 말단)</option>
            <option value="upward">역방향 의존 보유</option>
            <option value="maxComplexity">함수 최대 복잡도</option>
        </select>
    </label>
    <div class="cc-scale" data-el="scale"></div>
    <div class="links">
        <a data-goto="explorer">아키텍처 탐색기 ↗</a>
        <a data-goto="graph">3D 그래프 ↗</a>
    </div>
</div>

<div class="cc-legend glass">
    <h2>구역 = 역할 (클릭해서 켜고 끄기) <button data-el="all">전체 켜기</button></h2>
    <div data-el="roles"></div>
    <div class="hint">앞줄부터 <b>진입점 → 애플리케이션 → 도메인·인프라 → 기반</b> 순서로 도로가 나뉘어요. 건물을 클릭하면 참조선이 떠요 — <b style="color:var(--in)">파랑</b> 나를 쓰는 곳, <b style="color:var(--out)">주황</b> 내가 쓰는 것, <b style="color:var(--danger)">빨강</b> 역방향. 점선이 흐르는 방향이 참조 방향이에요.</div>
</div>

<section class="cc-code glass" data-el="code" aria-label="소스 코드">
    <div class="code-head">
        <div class="title"><b data-el="code-name"></b><div class="path" data-el="code-path"></div></div>
        <span data-el="code-vscode"></span>
        <button data-el="code-close">닫기</button>
    </div>
    <div class="code-note">밑줄 친 <span class="ref">클래스 이름</span>을 클릭하면 그 건물로 이동하고 코드도 따라 열려요.</div>
    <div class="code-body" data-el="code-body"><pre class="gutter" data-el="code-gutter"></pre><pre class="source"><code class="hljs" data-el="code-src"></code></pre></div>
</section>

<aside class="cc-panel glass" data-el="panel"><button class="close" data-el="close">닫기</button><div data-el="panel-body"></div></aside>
<div class="cc-tip" data-el="tip"></div>`;

export const mountCity: MountViewer = (root, arch, env) => {
  root.classList.add('cc-city');
  root.innerHTML = MARKUP;
  const $ = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-el="${name}"]`)!;
  const cleanups: (() => void)[] = [];
  const listen = <K extends keyof HTMLElementEventMap>(target: HTMLElement | Window, type: K, fn: (ev: HTMLElementEventMap[K]) => void) => {
    target.addEventListener(type, fn as EventListener);
    cleanups.push(() => target.removeEventListener(type, fn as EventListener));
  };
  let disposed = false;

  $('title').textContent = `${arch.name} 의존성 도시`;
  const palette = roleColors(arch);
  const layout = layoutCity(arch);
  const placed = new Map(layout.buildings.map((b) => [b.i, b]));

  const nodes: CityNode[] = arch.nodes.map((n, i) => {
    const css = palette[n.role] ?? '#b8bfc7';
    const b = placed.get(i)!;
    return {
      ...n, i,
      layer: arch.roles[n.role].layer,
      color: new THREE.Color(css),
      css,
      incoming: [], outgoing: [], neighbors: new Set<number>(), upStrong: 0, upWeak: 0,
      cx: b.x, cz: b.z, fp: b.w, h: 0,
    };
  });
  arch.edges.forEach(([f, t, w, kinds, up]) => {
    const strong = !!up && ((nodes[f].layer >= 2 && nodes[t].layer <= 1) || nodes[t].layer === 0);
    const e: CityEdge = { f, t, w, kinds: kinds as Record<string, number>, up: !!up, strong };
    nodes[f].outgoing.push(e); nodes[t].incoming.push(e);
    nodes[f].neighbors.add(t); nodes[t].neighbors.add(f);
    if (e.up) { if (strong) nodes[f].upStrong++; else nodes[f].upWeak++; }
  });
  $('meta').textContent = `건물 ${fmt(nodes.length)}채 · 참조 ${fmt(arch.edges.length)}쌍 · ${new Date(arch.generatedAt).toLocaleDateString('ko-KR')}`;

  const counts = arch.roles.map((_, i) => nodes.filter((n) => n.role === i).length);
  const rows = arch.layers.flatMap((_, li) => {
    const blocks = layout.blocks.filter((b) => arch.roles[b.role].layer === li);
    if (!blocks.length) return [];
    const front = blocks[0].z + blocks[0].d / 2;
    const depth = Math.max(...blocks.map((b) => b.d));
    const width = Math.max(...blocks.map((b) => b.x + b.w / 2)) - Math.min(...blocks.map((b) => b.x - b.w / 2));
    return [{ li, front, depth, width, cz: front - depth / 2 }];
  });
  const citySize = Math.max(layout.bounds.w, layout.bounds.d);
  // below this size today's fixed label sizes dwarf the districts, so labels are fitted to their block/row
  const small = citySize < SMALL_CITY;

  // ---- scene ----
  const size = () => ({ w: Math.max(1, root.clientWidth), h: Math.max(1, root.clientHeight) });
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(size().w, size().h);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  root.prepend(renderer.domElement);

  const bg = new THREE.Color('#0e1015');
  const scene = new THREE.Scene();
  scene.background = bg;

  const camera = new THREE.PerspectiveCamera(45, size().w / size().h, 1, citySize * 8);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47;

  scene.add(new THREE.HemisphereLight('#c9d4ff', '#1a1c22', 1.1));
  const sun = new THREE.DirectionalLight('#ffffff', 1.6);
  sun.position.set(-citySize * 0.4, citySize * 0.9, citySize * 0.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -citySize * 0.7, right: citySize * 0.7, top: citySize * 0.7, bottom: -citySize * 0.7, far: citySize * 3 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(citySize * 6, citySize * 6), new THREE.MeshStandardMaterial({ color: '#15171d', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  rows.forEach((r) => {
    const avenue = new THREE.Mesh(new THREE.PlaneGeometry(r.width + 40, r.depth + 10), new THREE.MeshStandardMaterial({ color: LAYER_TINT[r.li], transparent: true, opacity: 0.07, roughness: 1 }));
    avenue.rotation.x = -Math.PI / 2;
    avenue.position.set(0, 0.05, r.cz);
    scene.add(avenue);
  });
  layout.blocks.forEach((d) => {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(d.w + 1.5, 0.5, d.d + 1.5), new THREE.MeshStandardMaterial({ color: new THREE.Color(palette[d.role]).multiplyScalar(0.28), roughness: 0.9 }));
    plate.position.set(d.x, 0.25, d.z);
    plate.receiveShadow = true;
    scene.add(plate);
  });

  function label(text: string, sub: string, color: string, scale: number, maxWidth = Infinity) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const nameFont = '600 96px -apple-system, "Apple SD Gothic Neo", sans-serif';
    const subFont = '500 60px -apple-system, "Apple SD Gothic Neo", sans-serif';
    ctx.font = nameFont;
    const nameWidth = ctx.measureText(text).width;
    ctx.font = subFont;
    const subWidth = sub ? ctx.measureText(sub).width + 28 : 0;
    canvas.width = Math.ceil(90 + nameWidth + subWidth + 40);
    canvas.height = 150;
    ctx.fillStyle = 'rgba(14,16,21,0.82)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 40);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(62, 75, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.font = nameFont;
    ctx.fillStyle = '#f1f3f8';
    ctx.fillText(text, 100, 78);
    if (sub) {
      ctx.font = subFont;
      ctx.fillStyle = 'rgba(190,196,208,.85)';
      ctx.fillText(sub, 128 + nameWidth, 80);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    const height = Math.min(scale, (maxWidth * canvas.height) / canvas.width);
    sprite.scale.set((height * canvas.width) / canvas.height, height, 1);
    sprite.center.set(0, 0);
    sprite.renderOrder = 2;
    return sprite;
  }
  let labelRight = layout.bounds.w / 2;
  layout.blocks.forEach((d) => {
    const role = arch.roles[d.role];
    const s = label(role.name, `${counts[d.role]}개`, palette[d.role], Math.max(4, Math.min(7, d.w / 5)), small ? d.w + ROAD : Infinity);
    s.position.set(d.x - d.w / 2, 0.6, d.z + d.d / 2 + 3);
    scene.add(s);
  });
  rows.forEach((r) => {
    const s = label(arch.layers[r.li].label, arch.layers[r.li].hint, LAYER_TINT[r.li], small ? Math.max(3, citySize / 12) : 11, small ? Math.max(r.width, citySize * 0.6) : Infinity);
    s.position.set(r.width / 2 + 10, 0.6, r.front - r.depth / 2);
    labelRight = Math.max(labelRight, s.position.x + s.scale.x);
    scene.add(s);
  });

  const view = homeView(layout.bounds, labelRight, size().w / size().h);
  const homeDistance = view.distance;
  camera.position.copy(view.position);
  camera.far = view.far;
  camera.updateProjectionMatrix();
  controls.target.copy(view.target);
  scene.fog = new THREE.Fog(bg, view.fogNear, view.fogFar);

  // ---- buildings (one instanced mesh) ----
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  boxGeometry.translate(0, 0.5, 0);
  const buildings = new THREE.InstancedMesh(boxGeometry, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.08 }), Math.max(1, nodes.length));
  buildings.count = nodes.length;
  buildings.castShadow = true;
  buildings.receiveShadow = true;
  scene.add(buildings);

  const hoverBox = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeometry), new THREE.LineBasicMaterial({ color: '#ffffff' }));
  hoverBox.visible = false;
  scene.add(hoverBox);
  const selectBox = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeometry), new THREE.LineBasicMaterial({ color: '#ffffff' }));
  selectBox.visible = false;
  scene.add(selectBox);

  const state = { height: 'fanIn' as HeightKey, color: 'role' as ColorKey, selected: null as CityNode | null, hidden: new Set<number>() };
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const gray = new THREE.Color('#2a2d35');
  const tmp = new THREE.Color();

  function applyHeights() {
    const max = Math.max(1, ...nodes.map((n) => n[state.height]));
    nodes.forEach((n) => {
      const visible = !state.hidden.has(n.role);
      n.h = 0.8 + ((MAX_HEIGHT - 0.8) * Math.sqrt(Math.max(0, n[state.height]))) / Math.sqrt(max);
      const fp = visible ? n.fp : 0.0001;
      matrix.compose(new THREE.Vector3(n.cx, 0.5, n.cz), quaternion, new THREE.Vector3(fp, visible ? n.h : 0.0001, fp));
      buildings.setMatrixAt(n.i, matrix);
    });
    buildings.instanceMatrix.needsUpdate = true;
    buildings.computeBoundingSphere();
    if (state.selected) drawArcs(state.selected);
    placeBox(selectBox, state.selected);
  }

  const ramp = (t: number) => tmp.setHSL((1 - Math.max(0, Math.min(1, t))) * 0.62, 0.78, 0.55).clone();
  const SCALES: Partial<Record<ColorKey, [string, string]>> = {
    instability: ['0 기반(안정)', '1 말단'],
    maxComplexity: ['단순', '복잡 (60+)'],
  };
  function baseColor(n: CityNode) {
    switch (state.color) {
      case 'instability': return n.fanIn + n.fanOut ? ramp(n.instability) : gray.clone();
      case 'upward': return n.upStrong ? new THREE.Color('#ff5c5c') : n.upWeak ? new THREE.Color('#ffa94d') : new THREE.Color('#3a3f4a');
      case 'maxComplexity': return ramp(n.maxComplexity / 60);
      default: return n.color.clone();
    }
  }
  function applyColors() {
    const sel = state.selected;
    nodes.forEach((n) => {
      const c = baseColor(n);
      if (sel && n !== sel && !sel.neighbors.has(n.i)) c.lerp(gray, 0.88);
      buildings.setColorAt(n.i, c);
    });
    if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
    const scale = SCALES[state.color];
    $('scale').innerHTML = scale
      ? `<div class="ramp" style="background:linear-gradient(90deg,hsl(223 78% 55%),hsl(112 78% 55%),hsl(56 78% 55%),hsl(0 78% 55%))"></div><div class="ends"><span>${scale[0]}</span><span>${scale[1]}</span></div>`
      : state.color === 'upward' ? '<span style="color:#ff5c5c">■</span> 강한 역방향 보유 &nbsp; <span style="color:#ffa94d">■</span> 약한 역방향만 보유' : '';
  }

  function placeBox(box: THREE.LineSegments, n: CityNode | null) {
    box.visible = !!n && !state.hidden.has(n.role);
    if (!n || !box.visible) return;
    const fp = n.fp + 0.35;
    box.position.set(n.cx, 0.5, n.cz);
    box.scale.set(fp, n.h + 0.3, fp);
  }

  // ---- dependency arcs for the selected building ----
  const arcs = new THREE.Group();
  scene.add(arcs);
  const dashOffset = { value: 0 };
  // LineDashedMaterial has no dash offset; inject one so dashes flow from the referencing file to the referenced one
  function flowingDash(color: string, opacity: number) {
    const material = new THREE.LineDashedMaterial({ color, dashSize: 2.2, gapSize: 1.4, transparent: true, opacity });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.dashOffset = dashOffset;
      shader.fragmentShader = shader.fragmentShader
        .replace('uniform float dashSize;', 'uniform float dashSize;\nuniform float dashOffset;')
        .replace('mod( vLineDistance, totalSize )', 'mod( vLineDistance - dashOffset, totalSize )');
    };
    return material;
  }
  const arcMaterials = {
    in: flowingDash('#4dabf7', 0.9),
    out: flowingDash('#ffa94d', 0.9),
    up: flowingDash('#ff5c5c', 1),
  };
  function drawArcs(n: CityNode | null) {
    arcs.children.forEach((line) => (line as THREE.Line).geometry.dispose());
    arcs.clear();
    if (!n) return;
    const add = (from: CityNode, to: CityNode, material: THREE.Material) => {
      if (state.hidden.has(from.role) || state.hidden.has(to.role)) return;
      const a = new THREE.Vector3(from.cx, from.h + 0.6, from.cz);
      const b = new THREE.Vector3(to.cx, to.h + 0.6, to.cz);
      const lift = Math.max(a.y, b.y) + 12 + a.distanceTo(b) * 0.28;
      const mid = a.clone().lerp(b, 0.5).setY(lift);
      const geometry = new THREE.BufferGeometry().setFromPoints(new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(48));
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      arcs.add(line);
    };
    n.incoming.forEach((e) => add(nodes[e.f], n, e.strong ? arcMaterials.up : arcMaterials.in));
    n.outgoing.forEach((e) => add(n, nodes[e.t], e.strong ? arcMaterials.up : arcMaterials.out));
  }

  // ---- selection, camera flight, panel ----
  let flight: { start: number; duration: number; fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3 } | null = null;
  function flyTo(n: CityNode) {
    const target = new THREE.Vector3(n.cx, n.h / 2, n.cz);
    const direction = camera.position.clone().sub(controls.target).normalize();
    const distance = Math.min(homeDistance, Math.max(110, n.h * 2.4 + 60));
    flight = {
      start: performance.now(), duration: 900,
      fromPos: camera.position.clone(), toPos: target.clone().add(direction.multiplyScalar(distance)),
      fromTarget: controls.target.clone(), toTarget: target,
    };
  }

  const reporter = createSelectionReporter((sel) => env.onSelect(sel));
  let codePath: string | null = null;
  const codeOpen = () => $('code').classList.contains('open');
  function select(n: CityNode | null, fly = false) {
    state.selected = n;
    applyColors();
    drawArcs(n);
    placeBox(selectBox, n);
    reporter.report(n ? { file: n.path, ...(codeOpen() && codePath === n.path ? { code: true } : {}) } : {});
    if (!n) { $('panel').classList.remove('open'); return; }
    renderPanel(n);
    if (fly) flyTo(n);
  }

  const vscodeAction = (path: string) => {
    const href = env.vscodeHref(path);
    return href ? `<a href="${esc(href)}">VS Code 에서 열기</a>` : '<button data-vscode-setup>VS Code 에서 열기</button>';
  };

  function renderPanel(n: CityNode) {
    const role = arch.roles[n.role];
    const list = (edges: CityEdge[], side: 'f' | 't', title: string, color: string) => {
      const sorted = [...edges].sort((a, b) => (+b.strong - +a.strong) || (b.w - a.w));
      return `<div class="sec"><h4><span><span class="dot" style="background:${color}"></span>${title}</span><span>${sorted.length}</span></h4>${sorted.slice(0, 40).map((e) => {
        const o = nodes[e[side]];
        const kinds = Object.keys(e.kinds).map((k) => KIND_LABEL[k] ?? k).join(' · ');
        return `<button class="item" data-select="${o.i}"><i style="background:${esc(o.css)}"></i><span>${esc(o.name)}${e.strong ? '<b class="up">역방향</b>' : ''}</span><small>${esc(kinds)}</small></button>`;
      }).join('') || '<div class="more">없음</div>'}${sorted.length > 40 ? `<div class="more">외 ${sorted.length - 40}개 — 탐색기에서 전체 보기</div>` : ''}</div>`;
    };
    $('panel-body').innerHTML = `
        <span class="chip" style="--c:${esc(n.css)}">${esc(role.name)} · ${esc(arch.layers[n.layer].label)}</span>
        <h3>${esc(n.name)}</h3>
        <div class="path">${esc(n.path)}</div>
        <p class="desc">${esc(role.description)}</p>
        <div class="metrics">
            <div class="metric"><b>${fmt(n.fanIn)}</b><span>fan-in</span></div>
            <div class="metric"><b>${fmt(n.fanOut)}</b><span>fan-out</span></div>
            <div class="metric"><b>${n.centrality.toFixed(1)}×</b><span>중심도</span></div>
            <div class="metric"><b>${n.instability.toFixed(2)}</b><span>불안정도</span></div>
            <div class="metric"><b>${fmt(n.routeRefs)}</b><span>라우트 참조</span></div>
            <div class="metric"><b>${fmt(n.functions)}</b><span>함수 수</span></div>
            <div class="metric"><b>${fmt(n.maxComplexity)}</b><span>함수 최대 복잡도</span></div>
            <div class="metric"><b>${fmt(n.lines)}</b><span>줄 수</span></div>
        </div>
        <div class="actions">
            <button data-open-code="${n.i}">코드 보기</button>
            ${vscodeAction(n.path)}
            <a data-explorer="${n.i}">탐색기에서 보기 ↗</a>
        </div>
        ${list(n.incoming, 'f', '나를 쓰는 곳', 'var(--in)')}
        ${list(n.outgoing, 't', '내가 쓰는 것', 'var(--out)')}`;
    $('panel').classList.add('open');
  }
  listen($('panel-body'), 'click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-select],[data-open-code],[data-explorer],[data-vscode-setup]');
    if (!el) return;
    if (el.dataset.select) select(nodes[+el.dataset.select], true);
    else if (el.dataset.openCode) void openCode(+el.dataset.openCode);
    else if (el.dataset.explorer) env.goto('explorer', { file: nodes[+el.dataset.explorer].path });
    else env.requestVscodeSetup();
  });

  // ---- source viewer ----
  let codeRequest = 0;
  async function openCode(i: number) {
    const n = nodes[i];
    const request = ++codeRequest;
    $('code').classList.add('open');
    codePath = n.path;
    reporter.report({ file: n.path, code: true });
    $('code-name').textContent = n.name;
    $('code-path').textContent = `${n.path} · ${fmt(n.lines)}줄`;
    $('code-vscode').innerHTML = vscodeAction(n.path);
    const code = $('code-src');
    code.className = `hljs language-${arch.lang === 'ts' ? 'typescript' : 'php'}`;
    code.textContent = '불러오는 중…';
    $('code-gutter').textContent = '';
    let source: string | null;
    try {
      source = await env.readSource(n.path);
    } catch (e) {
      if (request === codeRequest && !disposed) code.textContent = `소스를 불러오지 못했어요 (${(e as Error).message}).`;
      return;
    }
    if (request !== codeRequest || disposed) return;
    if (source === null) {
      code.textContent = '폴더 접근 권한이 없어요. 상단의 "폴더 다시 연결"을 눌러 주세요.';
      return;
    }
    renderCode(code, source, arch.lang);
    $('code-gutter').textContent = source.split('\n').map((_, k) => k + 1).join('\n');
    linkReferences(code, n);
    $('code-body').scrollTop = 0;
  }
  function closeCode() {
    $('code').classList.remove('open');
    codePath = null;
    codeRequest++;
    reporter.report(state.selected ? { file: state.selected.path } : {});
  }

  // Wraps the short class names this file references so they jump to that building.
  function linkReferences(el: HTMLElement, n: CityNode) {
    const targets = new Map<string, CityNode>();
    n.outgoing.forEach((e) => {
      const target = nodes[e.t];
      if (!targets.has(target.name)) targets.set(target.name, target);
    });
    if (!targets.size) return;
    const pattern = new RegExp(`\\b(${[...targets.keys()].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
    textNodes.forEach((text) => {
      const value = text.nodeValue ?? '';
      pattern.lastIndex = 0;
      if (!pattern.test(value)) return;
      const fragment = document.createDocumentFragment();
      let last = 0;
      value.replace(pattern, (match: string, name: string, offset: number) => {
        fragment.append(value.slice(last, offset));
        const link = document.createElement('span');
        link.className = 'ref';
        link.dataset.i = String(targets.get(name)!.i);
        link.title = targets.get(name)!.path;
        link.textContent = match;
        fragment.append(link);
        last = offset + match.length;
        return match;
      });
      fragment.append(value.slice(last));
      text.replaceWith(fragment);
    });
  }
  listen($('code-src'), 'click', (ev) => {
    const link = (ev.target as HTMLElement).closest<HTMLElement>('.ref');
    if (!link) return;
    const i = +link.dataset.i!;
    reporter.batch(() => {
      select(nodes[i], true);
      void openCode(i);
    });
  });
  listen($('code-vscode'), 'click', (ev) => {
    if ((ev.target as HTMLElement).closest('[data-vscode-setup]')) env.requestVscodeSetup();
  });
  listen($('code-close'), 'click', closeCode);

  // ---- picking ----
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt: [number, number] | null = null;
  const canvas = renderer.domElement;
  function pick(ev: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(buildings)[0];
    return hit && hit.instanceId !== undefined ? nodes[hit.instanceId] : null;
  }
  const tip = $('tip');
  listen(canvas, 'pointermove', (ev) => {
    const n = pick(ev);
    placeBox(hoverBox, n);
    canvas.style.cursor = n ? 'pointer' : '';
    if (!n) { tip.style.display = 'none'; return; }
    tip.innerHTML = `<b>${esc(n.name)}</b> <span style="color:${esc(n.css)}">${esc(arch.roles[n.role].name)}</span><small>fan-in ${n.fanIn} · fan-out ${n.fanOut} · 중심도 ${n.centrality.toFixed(1)}</small><small>${esc(n.path)}</small>`;
    tip.style.display = 'block';
    const rect = root.getBoundingClientRect();
    tip.style.left = Math.min(ev.clientX - rect.left + 14, rect.width - tip.offsetWidth - 8) + 'px';
    tip.style.top = ev.clientY - rect.top + 16 + 'px';
  });
  listen(canvas, 'pointerleave', () => { tip.style.display = 'none'; hoverBox.visible = false; });
  listen(canvas, 'pointerdown', (ev) => { downAt = [ev.clientX, ev.clientY]; });
  listen(canvas, 'pointerup', (ev) => {
    if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 5) return;
    select(pick(ev), false);
  });
  listen(canvas, 'dblclick', (ev) => { const n = pick(ev); if (n) select(n, true); });

  // ---- ui ----
  listen($<HTMLSelectElement>('height'), 'change', (ev) => { state.height = (ev.target as HTMLSelectElement).value as HeightKey; applyHeights(); });
  listen($<HTMLSelectElement>('color'), 'change', (ev) => { state.color = (ev.target as HTMLSelectElement).value as ColorKey; applyColors(); });
  listen($('close'), 'click', () => select(null));
  listen(root.querySelector<HTMLElement>('.links')!, 'click', (ev) => {
    const a = (ev.target as HTMLElement).closest<HTMLElement>('[data-goto]');
    if (a) env.goto(a.dataset.goto as 'explorer' | 'graph');
  });

  $('roles').innerHTML = arch.layers.map((layer, li) => `
    <div class="layer-name">${esc(layer.label)}</div><div class="roles">
    ${arch.roles.map((r, i) => ({ r, i })).filter(({ r }) => r.layer === li).map(({ r, i }) =>
      `<button class="role" data-role="${i}" title="${esc(r.description)}"><i style="background:${esc(palette[i])}"></i>${esc(r.name)} <small>${counts[i]}</small></button>`).join('')}
    </div>`).join('');
  const syncRoles = () => root.querySelectorAll<HTMLElement>('.role').forEach((b) => b.classList.toggle('off', state.hidden.has(+b.dataset.role!)));
  listen($('roles'), 'click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('.role');
    if (!b) return;
    const role = +b.dataset.role!;
    if (state.hidden.has(role)) state.hidden.delete(role); else state.hidden.add(role);
    syncRoles(); applyHeights();
  });
  listen($('all'), 'click', () => { state.hidden.clear(); syncRoles(); applyHeights(); });

  const input = $<HTMLInputElement>('q');
  const box = $('results');
  let items: CityNode[] = [];
  let active = 0;
  const draw = () => {
    box.innerHTML = items.map((n, k) => `<button class="${k === active ? 'active' : ''}" data-i="${n.i}"><span style="color:${esc(n.css)}">■</span> ${esc(n.name)}<small>${esc(n.path)}</small></button>`).join('');
    box.classList.toggle('open', items.length > 0);
  };
  const choose = (n: CityNode) => { select(n, true); items = []; draw(); input.blur(); };
  listen(input, 'input', () => {
    const q = input.value.trim().toLowerCase();
    active = 0;
    items = q ? nodes.filter((n) => n.path.toLowerCase().includes(q))
      .sort((a, b) => (+b.name.toLowerCase().startsWith(q) - +a.name.toLowerCase().startsWith(q)) || b.fanIn - a.fanIn).slice(0, 12) : [];
    draw();
  });
  listen(input, 'keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter' && items[active]) choose(items[active]);
    if (e.key === 'Escape') { items = []; draw(); input.blur(); }
  });
  listen(box, 'mousedown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (b) { e.preventDefault(); choose(nodes[+b.dataset.i!]); }
  });
  let blurTimer = 0;
  listen(input, 'blur', () => { blurTimer = window.setTimeout(() => box.classList.remove('open'), 100); });
  const typingElsewhere = (el: Element | null) =>
    !!el && el !== input && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable);
  listen(window, 'keydown', (e) => {
    const focused = document.activeElement;
    if (typingElsewhere(focused)) return;
    if (e.key === '/' && focused !== input) { e.preventDefault(); input.focus(); }
    if (e.key === 'Escape' && focused !== input) {
      if (codeOpen()) closeCode(); else select(null);
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    const { w, h } = size();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  resizeObserver.observe(root);

  applyHeights();
  applyColors();
  const linked = nodes.find((n) => n.path === env.selection.file);
  if (linked) {
    reporter.restore(() => {
      select(linked, true);
      if (env.selection.code) void openCode(linked.i);
    });
  }

  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    dashOffset.value += dt * 7;
    if (flight) {
      const t = Math.min(1, (now - flight.start) / flight.duration);
      const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      camera.position.lerpVectors(flight.fromPos, flight.toPos, k);
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, k);
      if (t === 1) flight = null;
    }
    controls.update();
    renderer.render(scene, camera);
  });

  return () => {
    disposed = true;
    renderer.setAnimationLoop(null);
    window.clearTimeout(blurTimer);
    resizeObserver.disconnect();
    cleanups.forEach((fn) => fn());
    controls.dispose();
    drawArcs(null);
    Object.values(arcMaterials).forEach((m) => m.dispose());
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      materials.forEach((m) => {
        (m as THREE.SpriteMaterial).map?.dispose();
        m.dispose();
      });
    });
    buildings.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    root.innerHTML = '';
    root.classList.remove('cc-city');
  };
};
