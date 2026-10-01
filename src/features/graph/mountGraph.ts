import ForceGraph3D from '3d-force-graph';
import type { Architecture } from '../../engine/architecture';
import { esc } from '../escape';
import { roleChip } from '../lang-label';
import type { MountViewer } from '../viewer-env';
import { graphData, nodeRelSize, type GraphLink, type GraphNode } from './data';
import './graph.css';

const KIND_LABEL: Record<string, string> = {
  inject: '생성자 주입', type: '타입 힌트', 'static-call': '정적 호출', new: 'new 생성', const: '상수·enum',
  'class-ref': '::class', trait: '트레이트', catch: 'catch', instanceof: 'instanceof', extends: '상속',
  implements: '구현', attribute: '어트리뷰트', triggers: '이벤트→리스너', binds: '바인딩', other: '기타',
  import: 'import', 'type-import': '타입 import', 'dynamic-import': '동적 import', 're-export': '재export', require: 'require',
};
const LAYER_Y = [260, 90, -90, -260];
const fmt = (n: number) => Number(n).toLocaleString('ko-KR');

interface Anchor { x: number; y: number; z: number }
interface N extends GraphNode {
  fanIn: number;
  fanOut: number;
  centrality: number;
  instability: number;
  neighbors: Set<number>;
  links: L[];
  x: number;
  y: number;
  z: number;
}
interface L extends Omit<GraphLink, 'source' | 'target'> {
  source: number | N;
  target: number | N;
  strong: boolean;
}

// Each role gets an anchor: layers stack vertically, roles spread on a ring inside their layer.
function anchorPositions(arch: Architecture): Anchor[] {
  const anchors: Anchor[] = [];
  arch.layers.forEach((_layer, li) => {
    const roles = arch.roles.map((_r, i) => i).filter((i) => arch.roles[i].layer === li);
    const radius = 110 + roles.length * 30;
    roles.forEach((ri, k) => {
      const angle = (k / roles.length) * Math.PI * 2 + li * 0.6;
      anchors[ri] = { x: Math.cos(angle) * radius, y: LAYER_Y[li], z: Math.sin(angle) * radius };
    });
  });
  return anchors;
}

function structureForce(anchors: Anchor[], strength: number) {
  let nodes: (N & { vx: number; vy: number; vz: number })[] = [];
  const force = (alpha: number) => {
    for (const n of nodes) {
      const t = anchors[n.role];
      n.vx += (t.x - n.x) * strength * alpha;
      n.vy += (t.y - n.y) * strength * 2.5 * alpha;
      n.vz += (t.z - n.z) * strength * alpha;
    }
  };
  force.initialize = (ns: typeof nodes) => { nodes = ns; };
  return force;
}

const TEMPLATE = `
<div class="cg-canvas"></div>
<div class="cg-top glass">
    <h1 data-el="title"></h1>
    <div class="meta" data-el="meta"></div>
    <div class="search">
        <input data-el="q" type="search" placeholder="파일·클래스 검색  ( / )" autocomplete="off">
        <div class="cg-results" data-el="results"></div>
    </div>
    <div class="opts">
        <label><input type="checkbox" data-el="opt-structure" checked> 계층·역할별로 모으기</label>
        <label><input type="checkbox" data-el="opt-neighbors"> 선택한 파일의 이웃만 보기</label>
        <label><input type="checkbox" data-el="opt-up"> 역방향 의존만 빨갛게 강조</label>
    </div>
    <div class="links">
        <button type="button" data-el="go-explorer">아키텍처 탐색기 ↗</button>
        <button type="button" data-el="go-city">코드 시티 ↗</button>
    </div>
</div>
<div class="cg-legend glass">
    <h2>역할 (클릭해서 켜고 끄기) <button type="button" data-el="all">전체 켜기</button></h2>
    <div data-el="roles"></div>
    <div class="hint">점 크기 = fan-in(나를 쓰는 파일 수) · 위층일수록 진입점, 아래층일수록 기반 · 드래그 회전, 스크롤 확대</div>
</div>
<aside class="cg-panel glass"><button type="button" class="close" data-el="close">닫기</button><div data-el="panel-body"></div></aside>`;

export const mountGraph: MountViewer = (root, arch, env) => {
  const wrap = document.createElement('div');
  wrap.className = 'cc-graph';
  wrap.innerHTML = TEMPLATE;
  root.appendChild(wrap);
  const $ = <T extends HTMLElement = HTMLElement>(name: string) => wrap.querySelector<T>(`[data-el="${name}"]`)!;
  const canvas = wrap.querySelector<HTMLElement>('.cg-canvas')!;
  const panel = wrap.querySelector<HTMLElement>('.cg-panel')!;

  const hidden = new Set<number>();
  const state = { selected: null as N | null, neighborsOnly: false, upOnly: false };
  const highlightNodes = new Set<N>();
  const highlightLinks = new Set<L>();
  const timers: ReturnType<typeof setTimeout>[] = [];

  const anchors = anchorPositions(arch);
  const data = graphData(arch);
  const nodes: N[] = data.nodes.map((n, i) => ({
    ...n,
    fanIn: arch.nodes[i].fanIn,
    fanOut: arch.nodes[i].fanOut,
    centrality: arch.nodes[i].centrality,
    instability: arch.nodes[i].instability,
    neighbors: new Set<number>(),
    links: [],
    x: anchors[n.role].x + (Math.random() - 0.5) * 60,
    y: anchors[n.role].y + (Math.random() - 0.5) * 30,
    z: anchors[n.role].z + (Math.random() - 0.5) * 60,
  }));
  const links: L[] = data.links.map((l) => {
    const f = nodes[l.source], t = nodes[l.target];
    const strong = l.upward && ((f.layer >= 2 && t.layer <= 1) || t.layer === 0);
    const link: L = { ...l, strong };
    f.neighbors.add(l.target); t.neighbors.add(l.source);
    f.links.push(link); t.links.push(link);
    return link;
  });

  $('title').textContent = `${arch.name} 의존성 그래프`;
  $('meta').textContent = `파일 ${fmt(nodes.length)}개 · 참조 ${fmt(links.length)}쌍 · ${new Date(arch.generatedAt).toLocaleDateString('ko-KR')}`;

  const endId = (end: number | N) => (typeof end === 'object' ? end.id : end);
  const endNode = (end: number | N) => (typeof end === 'object' ? end : nodes[end]);
  const visibleNode = (n: N) => {
    if (hidden.has(n.role)) return false;
    if (state.neighborsOnly && state.selected) return n.id === state.selected.id || state.selected.neighbors.has(n.id);
    return true;
  };
  const linkColor = (l: L) => {
    if (highlightLinks.size) {
      if (!highlightLinks.has(l)) return 'rgba(255,255,255,0.03)';
      return l.upward ? (l.strong ? '#ff5c5c' : '#ffa94d') : 'rgba(255,255,255,0.75)';
    }
    if (state.upOnly) return l.strong ? '#ff5c5c' : l.upward ? 'rgba(255,169,77,0.55)' : 'rgba(255,255,255,0.03)';
    return l.strong ? 'rgba(255,92,92,0.8)' : 'rgba(170,180,200,0.12)';
  };

  const Graph = new ForceGraph3D(canvas, { controlType: 'orbit' })
    .width(canvas.clientWidth || wrap.clientWidth || 800)
    .height(canvas.clientHeight || wrap.clientHeight || 600)
    .backgroundColor(getComputedStyle(wrap).getPropertyValue('--bg').trim())
    .graphData({ nodes, links } as never)
    .nodeId('id')
    .nodeVal(((n: N) => n.val) as never)
    .nodeRelSize(nodeRelSize(nodes.length))
    .nodeResolution(10)
    .nodeOpacity(0.92)
    .nodeColor(((n: N) => {
      if (highlightNodes.size && !highlightNodes.has(n)) return 'rgba(120,125,140,0.18)';
      if (state.upOnly && !highlightNodes.size && !n.links.some((l) => l.upward)) return 'rgba(120,125,140,0.25)';
      return n.color;
    }) as never)
    .nodeLabel(((n: N) => `<b>${esc(n.name)}</b> <span style="color:${esc(n.color)}">${esc(arch.roles[n.role].name)}</span><br><span style="color:#9aa0ad">fan-in ${n.fanIn} · fan-out ${n.fanOut} · 중심도 ${n.centrality.toFixed(1)}</span>`) as never)
    .nodeVisibility(visibleNode as never)
    .linkVisibility(((l: L) => visibleNode(endNode(l.source)) && visibleNode(endNode(l.target)) && (!state.upOnly || l.upward || highlightLinks.has(l))) as never)
    .linkColor(linkColor as never)
    .linkWidth(((l: L) => (highlightLinks.has(l) ? 1.2 : l.strong ? 0.6 : 0)) as never)
    .linkDirectionalParticles(((l: L) => (highlightLinks.has(l) ? 2 : 0)) as never)
    .linkDirectionalParticleWidth(2)
    .linkDirectionalParticleSpeed(0.006)
    .linkDirectionalParticleColor(((l: L) => (l.upward ? '#ff5c5c' : '#ffffff')) as never)
    .onNodeHover(((n: N | null) => { canvas.style.cursor = n ? 'pointer' : ''; if (!state.selected) highlight(n); }) as never)
    .onNodeClick(((n: N) => select(n, true)) as never)
    .onBackgroundClick(() => select(null))
    .cooldownTicks(260)
    .warmupTicks(40);

  // d3Force typings are loose; the objects are d3 forces
  const g = Graph as unknown as {
    d3Force(name: string, force?: unknown): any;
    d3ReheatSimulation(): void;
  };
  g.d3Force('charge').strength(-18).distanceMax(220);
  g.d3Force('link').distance(34).strength((l: L) => ((l.source as N).role === (l.target as N).role ? 0.08 : 0.012));
  g.d3Force('structure', structureForce(anchors, 0.06));
  Graph.cameraPosition({ x: 0, y: 120, z: 1250 });

  const linked = env.selection.file ? nodes.find((n) => n.path === env.selection.file) : undefined;
  let settled = false;
  Graph.onEngineStop(() => {
    if (settled) return;
    settled = true;
    wrap.dataset.settled = '';
    if (linked && !state.selected) select(linked, true);
    else if (!state.selected) Graph.zoomToFit(600, 60);
  });

  // Big graphs cost >100ms per frame, which starves scrolling in the panels on top, so the render loop sleeps while the pointer is over them.
  let overUi = false;
  let awakeUntil = 0;
  const syncAnimation = () => {
    if (overUi && performance.now() >= awakeUntil) Graph.pauseAnimation();
    else Graph.resumeAnimation();
  };
  const wake = (ms: number) => {
    awakeUntil = Math.max(awakeUntil, performance.now() + ms);
    syncAnimation();
    timers.push(setTimeout(syncAnimation, ms + 20));
  };

  function refresh() {
    wake(150);
    Graph.nodeColor(Graph.nodeColor()).linkColor(Graph.linkColor()).linkWidth(Graph.linkWidth())
      .linkDirectionalParticles(Graph.linkDirectionalParticles()).nodeVisibility(Graph.nodeVisibility()).linkVisibility(Graph.linkVisibility());
  }
  function highlight(n: N | null) {
    highlightNodes.clear(); highlightLinks.clear();
    if (n) {
      highlightNodes.add(n);
      n.links.forEach((l) => { highlightLinks.add(l); highlightNodes.add(endNode(l.source)); highlightNodes.add(endNode(l.target)); });
    }
    refresh();
  }
  function select(n: N | null, fly = false) {
    const changed = (state.selected?.path ?? null) !== (n?.path ?? null);
    state.selected = n;
    highlight(n);
    if (changed) env.onSelect(n ? { file: n.path } : {});
    if (!n) { panel.classList.remove('open'); return; }
    renderPanel(n);
    if (fly) {
      const distance = 280;
      const ratio = 1 + distance / Math.max(1, Math.hypot(n.x, n.y, n.z));
      wake(1000);
      Graph.cameraPosition({ x: n.x * ratio, y: n.y * ratio, z: n.z * ratio }, n, 900);
    }
  }

  function renderPanel(n: N) {
    const role = arch.roles[n.role];
    const list = (items: L[], side: 'source' | 'target', label: string) => {
      const sorted = [...items].sort((a, b) => Number(b.strong) - Number(a.strong) || b.weight - a.weight);
      const rows = sorted.slice(0, 40).map((l) => {
        const o = endNode(l[side]);
        const k = Object.keys(l.kinds).map((x) => KIND_LABEL[x] ?? x).join(' · ');
        return `<button type="button" class="item" data-id="${o.id}"><i style="background:${esc(o.color)}"></i><span>${esc(o.name)}${l.strong ? '<b class="up">역방향</b>' : ''}</span><small>${esc(k)}</small></button>`;
      }).join('');
      return `<div class="sec"><h4><span>${label}</span><span>${sorted.length}</span></h4>${rows || '<div class="more">없음</div>'}${sorted.length > 40 ? `<div class="more">외 ${sorted.length - 40}개 — 탐색기에서 전체 보기</div>` : ''}</div>`;
    };
    const incoming = n.links.filter((l) => endId(l.target) === n.id);
    const outgoing = n.links.filter((l) => endId(l.source) === n.id);
    const href = env.vscodeHref(n.path);
    $('panel-body').innerHTML = `
      <span class="chip" style="--c:${esc(n.color)}">${esc(roleChip(role.name, arch.layers[n.layer].label))}</span>
      <h3>${esc(n.name)}</h3>
      <div class="path">${esc(n.path)}</div>
      <p class="desc">${esc(role.description)}</p>
      <div class="metrics">
        <div class="metric"><b>${fmt(n.fanIn)}</b><span>fan-in</span></div>
        <div class="metric"><b>${fmt(n.fanOut)}</b><span>fan-out</span></div>
        <div class="metric"><b>${n.centrality.toFixed(1)}×</b><span>중심도</span></div>
        <div class="metric"><b>${n.instability.toFixed(2)}</b><span>불안정도</span></div>
      </div>
      <div class="actions">
        ${href ? `<a href="${esc(href)}">VS Code 에서 열기</a>` : '<button type="button" data-act="vscode">VS Code 에서 열기</button>'}
        <button type="button" data-act="explorer">탐색기에서 보기 ↗</button>
      </div>
      ${list(incoming, 'source', '← 나를 쓰는 곳')}
      ${list(outgoing, 'target', '내가 쓰는 것 →')}`;
    panel.classList.add('open');
  }

  const listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];
  const on = (t: EventTarget, type: string, fn: (e: any) => void) => {
    t.addEventListener(type, fn);
    listeners.push([t, type, fn]);
  };

  on(panel, 'click', (e: MouseEvent) => {
    const el = e.target as HTMLElement;
    const item = el.closest<HTMLElement>('.item');
    if (item) { select(nodes[+item.dataset.id!], true); return; }
    const act = el.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'vscode') env.requestVscodeSetup();
    else if (act === 'explorer' && state.selected) env.goto('explorer', { file: state.selected.path });
  });
  on($('go-explorer'), 'click', () => env.goto('explorer', state.selected ? { file: state.selected.path } : undefined));
  on($('go-city'), 'click', () => env.goto('city', state.selected ? { file: state.selected.path } : undefined));
  on($('close'), 'click', () => select(null));
  wrap.querySelectorAll('.glass').forEach((el) => {
    on(el, 'pointerenter', () => { overUi = true; syncAnimation(); });
    on(el, 'pointerleave', () => { overUi = false; syncAnimation(); });
  });

  // legend
  const counts = arch.roles.map(() => 0);
  arch.nodes.forEach((n) => counts[n.role]++);
  const colorOf = (i: number) => nodes.find((n) => n.role === i)?.color;
  const legendColors = arch.roles.map((_r, i) => colorOf(i) ?? '#adb5bd');
  $('roles').innerHTML = arch.layers.map((layer, li) => `
    <div class="layer"><div class="layer-name">${esc(layer.label)} — ${esc(layer.hint)}</div><div class="roles">
    ${arch.roles.map((r, i) => ({ r, i })).filter(({ r }) => r.layer === li).map(({ r, i }) =>
      `<button type="button" class="role" data-role="${i}" title="${esc(r.description)}"><i style="background:${esc(legendColors[i])}"></i>${esc(r.name)} <small>${counts[i]}</small></button>`).join('')}
    </div></div>`).join('');
  const sync = () => wrap.querySelectorAll<HTMLElement>('.role').forEach((b) => b.classList.toggle('off', hidden.has(+b.dataset.role!)));
  on($('roles'), 'click', (e: MouseEvent) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.role');
    if (!b) return;
    const role = +b.dataset.role!;
    if (hidden.has(role)) hidden.delete(role); else hidden.add(role);
    sync(); refresh();
  });
  on($('all'), 'click', () => { hidden.clear(); sync(); refresh(); });

  // search
  const input = $<HTMLInputElement>('q'), box = $('results');
  let items: N[] = [], active = 0;
  const draw = () => {
    box.innerHTML = items.map((n, k) => `<button type="button" class="${k === active ? 'active' : ''}" data-id="${n.id}"><span style="color:${esc(n.color)}">●</span> ${esc(n.name)}<small>${esc(n.path)}</small></button>`).join('');
    box.classList.toggle('open', items.length > 0);
  };
  const pick = (n: N) => { select(n, true); items = []; draw(); input.blur(); };
  on(input, 'input', () => {
    const q = input.value.trim().toLowerCase();
    active = 0;
    items = q ? nodes.filter((n) => n.path.toLowerCase().includes(q))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)) || b.fanIn - a.fanIn).slice(0, 12) : [];
    draw();
  });
  on(input, 'keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter' && items[active]) pick(items[active]);
    if (e.key === 'Escape') { items = []; draw(); input.blur(); }
  });
  on(box, 'mousedown', (e: MouseEvent) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (b) { e.preventDefault(); pick(nodes[+b.dataset.id!]); }
  });
  on(input, 'blur', () => timers.push(setTimeout(() => box.classList.remove('open'), 100)));

  // options
  on($('opt-structure'), 'change', (e: Event) => {
    g.d3Force('structure', (e.target as HTMLInputElement).checked ? structureForce(anchors, 0.06) : null);
    g.d3ReheatSimulation();
  });
  on($('opt-neighbors'), 'change', (e: Event) => { state.neighborsOnly = (e.target as HTMLInputElement).checked; refresh(); });
  on($('opt-up'), 'change', (e: Event) => { state.upOnly = (e.target as HTMLInputElement).checked; refresh(); });
  on(window, 'keydown', (e: KeyboardEvent) => {
    if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); }
    if (e.key === 'Escape' && document.activeElement !== input) select(null);
  });

  const resize = () => Graph.width(canvas.clientWidth).height(canvas.clientHeight);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  observer?.observe(canvas);
  if (!observer) on(window, 'resize', resize);

  return () => {
    observer?.disconnect();
    timers.forEach(clearTimeout);
    listeners.forEach(([t, type, fn]) => t.removeEventListener(type, fn));
    // _destructor leaves the WebGL context alive; browsers cap live contexts, so tab switches would exhaust them
    Graph.renderer().forceContextLoss();
    Graph._destructor();
    wrap.remove();
  };
};
