import type { ArchNode, Architecture } from '../../engine/architecture';
import { baseRoleName } from '../../engine/merge';
import { esc } from '../escape';
import type { MountViewer, ViewerEnv } from '../viewer-env';
import './explorer.css';

const KIND_LABEL: Record<string, string> = {
  inject: '생성자 주입', type: '타입 힌트', 'static-call': '정적 호출', new: 'new 생성',
  const: '상수·enum', 'class-ref': '::class 참조', trait: '트레이트', catch: '예외 catch',
  instanceof: 'instanceof', extends: '상속', implements: '인터페이스 구현', attribute: '어트리뷰트',
  triggers: '이벤트 → 리스너', binds: '컨테이너 바인딩', other: '기타',
  import: 'import', 'type-import': '타입 import', 'dynamic-import': '동적 import (지연 로딩)', 're-export': '재export', require: 'require',
};
const LAYER_VARS = ['--l0', '--l1', '--l2', '--l3'];
const TABS = [
  { key: 'fanIn', label: '범용 기반', head: 'fan-in', lead: '가장 많은 파일이 기대는 코드. 레포의 "공용어"라서 먼저 익혀두면 나머지 코드가 쉽게 읽혀요.' },
  { key: 'fanOut', label: '조율자', head: 'fan-out', lead: '가장 많은 파일을 엮는 코드. 기능 흐름을 따라갈 때 출발점으로 좋고, 동시에 복잡도가 몰리는 곳이에요.' },
  { key: 'centrality', label: '중심도', head: '중심도', lead: '간접 영향까지 반영한 핵심 파일 (PageRank). "중요한 파일이 쓰는 파일"일수록 높아요.' },
  { key: 'routeRefs', label: '진입점', head: '라우트 참조', lead: '라우트 파일에서 직접 연결된 코드. 요청·화면 진입이 실제로 들어오는 문이에요.' },
  { key: 'upward', label: '역방향 의존', head: '역방향 참조', lead: '가정한 계층(진입점 → 애플리케이션 → 도메인·인프라 → 기반)을 거슬러 위 계층을 참조하는 파일. 강한 역방향을 먼저 정렬했어요.' },
  { key: 'orphan', label: '참조 없음', head: '코드 줄', lead: '코드에서 직접 참조하는 곳이 없는 파일 (진입점 역할 제외). 컨테이너·설정·문자열로만 연결됐거나 안 쓰이는 코드일 수 있어요.' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

type Kinds = Record<string, number>;
interface XNode extends ArchNode {
  i: number;
  layer: number;
  in: XEdge[];
  out: XEdge[];
  upStrong: number;
  upWeak: number;
}
interface XEdge { f: number; t: number; w: number; kinds: Kinds; up: boolean; strong: boolean }
interface RoleEdge { rf: number; rt: number; pairs: number; refs: number; strong: number; weak: number; conceptual: number; list: XEdge[] }
type View = { type: 'file'; i: number } | { type: 'role'; role: number } | { type: 'edge'; key: string };

const fmt = (n: number) => Number(n).toLocaleString('ko-KR');
const layerColor = (layer: number) => `var(${LAYER_VARS[layer]})`;
const percentile = (arr: number[], v: number) => {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
  return arr.length ? lo / arr.length : 0;
};
const kindsText = (kinds: Kinds) =>
  Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${KIND_LABEL[k] ?? k}${n > 1 ? ' ×' + n : ''}`).join(' · ');
const openAttr = (view: View) => `data-open="${esc(JSON.stringify(view))}"`;

function wrapText(text: string, x: number, y: number, size: number, cls: string) {
  const lines = [''];
  text.split(' ').forEach((w) => {
    const next = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + w : w;
    if (next.length > 12 && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = next;
  });
  return lines.map((l, k) => `<text class="${cls}" x="${x}" y="${y + k * (size + 4)}">${esc(l)}</text>`).join('');
}

const SHELL = `
<header class="top">
    <div class="brand"><strong data-r="title"></strong><span data-r="meta"></span></div>
    <nav>
        <button data-go="layers">계층 지도</button>
        <button data-go="matrix">역할 행렬</button>
        <button data-go="ranking">파일 순위</button>
        <button data-r="city-link">코드 시티 ↗</button>
    </nav>
    <div class="search">
        <input data-r="q" type="search" placeholder="파일·클래스 검색  ( / )" autocomplete="off">
        <div class="results" data-r="results" role="listbox"></div>
    </div>
</header>
<main>
    <section data-s="intro">
        <div class="cards" data-r="cards"></div>
        <div class="howto">
            <div><b>fan-in — 얼마나 범용적인가</b>이 파일을 참조하는 파일 수. 높을수록 많은 곳이 기대는 기반이라 바꾸면 파급이 커요.</div>
            <div><b>fan-out — 얼마나 많이 기대나</b>이 파일이 참조하는 파일 수. 높을수록 여러 곳을 엮는 조율자예요.</div>
            <div><b>불안정도</b>fan-out ÷ (fan-in + fan-out). 0 에 가까우면 흔들리지 않는 기반, 1 에 가까우면 바꾸기 쉬운 말단.</div>
            <div><b>중심도</b>PageRank. 중요한 파일이 참조하는 파일일수록 올라가요. 1.0 = 평균 파일.</div>
        </div>
    </section>
    <section data-s="layers">
        <h2>계층 지도</h2>
        <p class="lead">폴더를 역할로 묶고, 역할을 네 계층에 배치했어요. 선은 역할 사이의 코드 참조이고 굵을수록 파일 쌍이 많아요. 정상 흐름은 위 → 아래이며, 빨간 점선은 아래 계층이 위 계층을 참조하는 역방향이에요. 역할에 마우스를 올리면 연결만 강조되고, 클릭하면 자세히 볼 수 있어요.</p>
        <div class="panel">
            <div class="controls">
                <label>최소 파일 쌍
                    <select data-r="threshold">
                        <option value="1">1</option>
                        <option value="5">5</option>
                        <option value="15" selected>15</option>
                        <option value="40">40</option>
                        <option value="100">100</option>
                    </select>
                </label>
                <label><input type="checkbox" data-r="only-up"> 역방향만</label>
                <label data-r="conceptual-option"><input type="checkbox" data-r="show-conceptual" checked> 바인딩·이벤트 연결 포함</label>
            </div>
            <div class="scroll-x"><svg class="layer-svg" data-r="layer-svg" role="img" aria-label="역할별 계층 의존 지도"></svg></div>
            <div class="legend">
                <span><i></i>정상 방향 (위 → 아래, 같은 계층)</span>
                <span><i class="up"></i>강한 역방향 — 도메인·기반이 애플리케이션·진입점을 참조</span>
                <span><i class="weak"></i>약한 역방향 — 기반이 도메인을 참조 (예: DTO 가 Model 을 앎)</span>
            </div>
        </div>
    </section>
    <section data-s="matrix">
        <h2>역할 간 의존 행렬</h2>
        <p class="lead">행이 참조하는 쪽, 열이 참조당하는 쪽이에요. 숫자는 파일 쌍 수이고 진할수록 많아요. 빨간 테두리는 강한 역방향, 주황 테두리는 약한 역방향. 칸을 클릭하면 실제 파일 쌍이 나와요.</p>
        <div class="panel scroll-x"><table class="matrix" data-r="matrix-table"></table></div>
    </section>
    <section data-s="ranking">
        <h2>파일 순위</h2>
        <p class="lead">질문별로 파일을 줄 세웠어요. 행을 클릭하면 그 파일을 쓰는 곳과 그 파일이 쓰는 것을 양쪽으로 볼 수 있어요.</p>
        <div class="tabs" data-r="tabs"></div>
        <div class="controls">
            <label>역할 <select data-r="role-filter"></select></label>
            <label><input type="checkbox" data-r="hide-data"> Data(DTO) 제외</label>
        </div>
        <p class="tab-lead" data-r="tab-lead"></p>
        <div class="panel scroll-x">
            <table class="rank">
                <thead><tr><th>#</th><th>파일</th><th>역할</th><th data-r="value-head">값</th><th class="hide-sm">fan-in · fan-out · 중심도</th></tr></thead>
                <tbody data-r="rank-body"></tbody>
            </table>
            <button class="more" data-r="more">더 보기</button>
        </div>
    </section>
</main>
<aside class="drawer" data-r="drawer" aria-hidden="true">
    <div class="drawer-head">
        <button data-r="back" title="이전">← 이전</button>
        <button data-r="close" title="닫기 (Esc)">닫기</button>
    </div>
    <div class="drawer-body" data-r="drawer-body"></div>
</aside>
<div class="tip" data-r="tip"></div>`;

export const mountExplorer: MountViewer = (root, arch, env) => {
  const cleanups: (() => void)[] = [];
  const listen = <T extends EventTarget>(target: T, type: string, fn: (e: any) => void) => {
    target.addEventListener(type, fn);
    cleanups.push(() => target.removeEventListener(type, fn));
  };

  root.classList.add('cc-explorer');
  root.innerHTML = SHELL;
  const $ = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-r="${name}"]`)!;
  const all = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));

  // Derived data lives in local copies so other viewers sharing `arch` are never mutated.
  const nodes: XNode[] = arch.nodes.map((n, i) => ({
    ...n, i, layer: arch.roles[n.role]?.layer ?? 3, in: [], out: [], upStrong: 0, upWeak: 0,
  }));
  const edges: XEdge[] = arch.edges.map(([f, t, w, kinds, up]) => {
    const e: XEdge = { f, t, w, kinds: kinds as Kinds, up: !!up, strong: false };
    if (e.up) {
      const lf = nodes[f].layer, lt = nodes[t].layer;
      e.strong = (lf >= 2 && lt <= 1) || lt === 0;
      if (e.strong) nodes[f].upStrong++; else nodes[f].upWeak++;
    }
    nodes[f].out.push(e);
    nodes[t].in.push(e);
    return e;
  });
  const roleEdges = new Map<string, RoleEdge>();
  edges.forEach((e) => {
    const rf = nodes[e.f].role, rt = nodes[e.t].role;
    const key = `${rf}>${rt}`;
    if (!roleEdges.has(key)) roleEdges.set(key, { rf, rt, pairs: 0, refs: 0, strong: 0, weak: 0, conceptual: 0, list: [] });
    const g = roleEdges.get(key)!;
    g.pairs++; g.refs += e.w; g.list.push(e);
    if (e.strong) g.strong++; else if (e.up) g.weak++;
    if (Object.keys(e.kinds).every((k) => k === 'binds' || k === 'triggers')) g.conceptual++;
  });
  const roleStats = arch.roles.map(() => ({ files: 0, lines: 0 }));
  nodes.forEach((n) => { roleStats[n.role].files++; roleStats[n.role].lines += n.lines; });
  const sortedFanIn = nodes.map((n) => n.fanIn).sort((a, b) => a - b);
  const sortedFanOut = nodes.map((n) => n.fanOut).sort((a, b) => a - b);
  const roleOrder = arch.roles.map((_, i) => i).sort((a, b) => arch.roles[a].layer - arch.roles[b].layer || a - b);
  const dir = arch.sourceDir ? `${arch.sourceDir}/` : '';

  const roleChip = (ri: number) =>
    `<span class="chip" style="--c:${layerColor(arch.roles[ri].layer)}">${esc(arch.roles[ri].name)}</span>`;

  const state = { tab: 'fanIn' as TabKey, role: '', hideData: false, limit: 25, history: [] as View[] };

  // ---------- tooltip ----------
  const tip = $('tip');
  const showTip = (ev: MouseEvent, html: string) => {
    tip.innerHTML = html;
    tip.style.display = 'block';
    const x = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8);
    const y = ev.clientY + 16 + tip.offsetHeight > innerHeight ? ev.clientY - tip.offsetHeight - 10 : ev.clientY + 16;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  };
  const hideTip = () => { tip.style.display = 'none'; };
  const edgeTip = (g: RoleEdge) => {
    const up = g.strong ? ` · <b>강한 역방향 ${fmt(g.strong)}</b>` : g.weak ? ` · 약한 역방향 ${fmt(g.weak)}` : '';
    return `<b>${esc(arch.roles[g.rf].name)} → ${esc(arch.roles[g.rt].name)}</b><br>파일 쌍 ${fmt(g.pairs)}개 · 참조 ${fmt(g.refs)}회${up}`;
  };

  // ---------- header / cards ----------
  const when = new Date(arch.generatedAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  $('title').textContent = `${arch.name} 아키텍처 탐색기`;
  $('meta').textContent = `${dir} · ${fmt(nodes.length)}개 파일 · 생성 ${when}`;
  $('conceptual-option').hidden = !arch.edges.some((e) => 'binds' in e[3] || 'triggers' in e[3]);
  listen($('city-link'), 'click', () => env.goto('city', env.selection));
  all('[data-go]').forEach((b) => listen(b, 'click', () => root.querySelector(`[data-s="${b.dataset.go}"]`)?.scrollIntoView?.()));

  const renderCards = () => {
    const upStrong = edges.filter((e) => e.strong).length;
    const upWeak = edges.filter((e) => e.up && !e.strong).length;
    const routed = nodes.filter((n) => n.routeRefs > 0).length;
    const refs = edges.reduce((s, e) => s + e.w, 0);
    const cards: [string, string][] = [
      [fmt(nodes.length), `파일 (${dir})`],
      [fmt(edges.length), `의존하는 파일 쌍 · 참조 ${fmt(refs)}회`],
      [String(arch.roles.length), '역할 · 4개 계층'],
      [fmt(routed), '라우트에 직접 연결된 파일'],
      [`${fmt(upStrong)} / ${fmt(upWeak)}`, '역방향 의존 (강한 / 약한)'],
    ];
    $('cards').innerHTML = cards.map(([b, s]) => `<div class="card"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('');
  };

  // ---------- layer map ----------
  const renderLayers = () => {
    const svg = root.querySelector<SVGSVGElement>('[data-r="layer-svg"]')!;
    const threshold = +$<HTMLSelectElement>('threshold').value;
    const onlyUp = $<HTMLInputElement>('only-up').checked;
    const showConceptual = $<HTMLInputElement>('show-conceptual').checked;
    const W = 1200, labelW = 150, bandH = 150, top = 26, boxH = 56, gap = 14;
    const H = top + bandH * 4 + 10;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const pos: { x: number; y: number; w: number; h: number; cx: number }[] = [];
    arch.layers.forEach((_, li) => {
      const roles = arch.roles.map((r, i) => ({ r, i })).filter(({ r }) => r.layer === li);
      const raw = roles.map(({ i }) => Math.max(1, Math.sqrt(roleStats[i].files)));
      const avail = W - labelW - 20 - gap * (roles.length - 1);
      const scale = Math.min(avail / (raw.reduce((a, b) => a + b, 0) || 1), 9);
      let widths = raw.map((v) => Math.max(76, v * scale));
      const overflow = widths.reduce((a, b) => a + b, 0) - avail;
      if (overflow > 0) {
        const big = widths.map((w) => w - 76);
        const bigSum = big.reduce((a, b) => a + b, 0) || 1;
        widths = widths.map((w, k) => w - overflow * big[k] / bigSum);
      }
      const total = widths.reduce((a, b) => a + b, 0) + gap * (roles.length - 1);
      let x = labelW + (W - labelW - 20 - total) / 2;
      const y = top + li * bandH + (bandH - boxH) / 2;
      roles.forEach(({ i }, k) => {
        pos[i] = { x, y, w: widths[k], h: boxH, cx: x + widths[k] / 2 };
        x += widths[k] + gap;
      });
    });

    let html = '<defs>';
    [['n', 'var(--edge)'], ['up', 'var(--danger)'], ['weak', 'var(--warn)']].forEach(([id, color]) => {
      html += `<marker id="cc-ex-arrow-${id}" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill:${color}"/></marker>`;
    });
    html += '</defs>';

    arch.layers.forEach((layer, li) => {
      const y = top + li * bandH;
      html += `<rect x="0" y="${y + 4}" width="${W}" height="${bandH - 8}" rx="14" style="fill:color-mix(in srgb, ${layerColor(li)} 6%, transparent)"/>`;
      html += `<text class="band-label" x="16" y="${y + bandH / 2 - 4}" style="fill:${layerColor(li)}">${esc(layer.label)}</text>`;
      html += wrapText(layer.hint, 16, y + bandH / 2 + 14, 11, 'band-hint');
    });

    const groups = [...roleEdges.values()].filter((g) => {
      if (g.rf === g.rt) return false;
      if (!showConceptual && g.conceptual === g.pairs) return false;
      if (onlyUp) return g.strong + g.weak > 0;
      return g.pairs >= threshold;
    }).sort((a, b) => a.pairs - b.pairs);

    let edgesHtml = '';
    groups.forEach((g) => {
      const s = pos[g.rf], t = pos[g.rt];
      const lf = arch.roles[g.rf].layer, lt = arch.roles[g.rt].layer;
      const cls = g.strong ? 'up' : g.weak ? 'weak' : 'n';
      const color = cls === 'up' ? 'var(--danger)' : cls === 'weak' ? 'var(--warn)' : 'var(--edge)';
      const width = Math.min(14, 1.2 + Math.sqrt(g.pairs) / 2.2);
      const spread = (a: typeof s, b: typeof s) => Math.max(-a.w / 2 + 10, Math.min(a.w / 2 - 10, (b.cx - a.cx) * 0.12));
      let d: string, lx: number, ly: number;
      if (lf === lt) {
        const sx = s.cx + spread(s, t), tx = t.cx + spread(t, s);
        const lift = 34 + Math.abs(tx - sx) * 0.08;
        d = `M${sx},${s.y} C${sx},${s.y - lift} ${tx},${t.y - lift} ${tx},${t.y}`;
        lx = (sx + tx) / 2; ly = s.y - lift * 0.75;
      } else if (lf < lt) {
        const sx = s.cx + spread(s, t), tx = t.cx + spread(t, s);
        const sy = s.y + s.h, ty = t.y, my = (sy + ty) / 2;
        d = `M${sx},${sy} C${sx},${my} ${tx},${my} ${tx},${ty}`;
        lx = (sx + tx) / 2; ly = my;
      } else {
        const sx = s.cx + spread(s, t) + 6, tx = t.cx + spread(t, s) + 6;
        const sy = s.y, ty = t.y + t.h, my = (sy + ty) / 2;
        d = `M${sx},${sy} C${sx + 30},${my} ${tx + 30},${my} ${tx},${ty}`;
        lx = (sx + tx) / 2 + 22; ly = my;
      }
      const dash = cls === 'n' ? '' : 'stroke-dasharray="6 5"';
      edgesHtml += `<path class="redge" data-key="${g.rf}>${g.rt}" data-rf="${g.rf}" data-rt="${g.rt}" d="${d}" style="stroke:${color}" stroke-width="${width}" stroke-opacity="${cls === 'n' ? .28 : .7}" ${dash} marker-end="url(#cc-ex-arrow-${cls})"/>`;
      edgesHtml += `<text class="redge-label" data-rf="${g.rf}" data-rt="${g.rt}" x="${lx}" y="${ly}" text-anchor="middle" style="display:none">${fmt(g.pairs)}</text>`;
    });
    html += `<g>${edgesHtml}</g>`;

    arch.roles.forEach((r, i) => {
      const p = pos[i];
      const self = roleEdges.get(`${i}>${i}`)?.pairs ?? 0;
      const narrow = p.w < 96;
      html += `<g class="role-box" data-role="${i}">
            <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="12" stroke-width="1.5" style="fill:color-mix(in srgb, ${layerColor(r.layer)} 16%, var(--surface));stroke:${layerColor(r.layer)}"/>
            <text class="role-name" x="${p.cx}" y="${p.y + 23}" text-anchor="middle">${esc(r.name)}</text>
            <text class="role-count" x="${p.cx}" y="${p.y + 41}" text-anchor="middle">${fmt(roleStats[i].files)}개${self && !narrow ? ` · 내부 ${fmt(self)}` : ''}</text>
        </g>`;
    });
    svg.innerHTML = html;

    const matches = (el: Element, rf: number, rt?: number) => {
      const a = +(el as SVGElement).dataset.rf!, b = +(el as SVGElement).dataset.rt!;
      return rt === undefined ? a === rf || b === rf : a === rf && b === rt;
    };
    const focus = (rf: number, rt?: number) => {
      svg.classList.add('focus');
      svg.querySelectorAll('.redge').forEach((el) => el.classList.toggle('on', matches(el, rf, rt)));
      svg.querySelectorAll<SVGElement>('.redge-label').forEach((el) => { el.style.display = matches(el, rf, rt) ? '' : 'none'; });
      const linked = new Set([rf]);
      if (rt === undefined) {
        groups.forEach((g) => { if (g.rf === rf) linked.add(g.rt); if (g.rt === rf) linked.add(g.rf); });
      } else linked.add(rt);
      svg.querySelectorAll<SVGElement>('.role-box').forEach((el) => el.classList.toggle('dim', !linked.has(+el.dataset.role!)));
    };
    const blur = () => {
      svg.classList.remove('focus');
      svg.querySelectorAll<SVGElement>('.redge-label').forEach((el) => { el.style.display = 'none'; });
      svg.querySelectorAll('.role-box').forEach((el) => el.classList.remove('dim'));
      hideTip();
    };
    svg.querySelectorAll<SVGElement>('.role-box').forEach((el) => {
      const i = +el.dataset.role!;
      el.addEventListener('mouseenter', () => focus(i));
      el.addEventListener('mousemove', (ev) => showTip(ev as MouseEvent, `<b>${esc(arch.roles[i].name)}</b> · ${esc(arch.roles[i].description)}`));
      el.addEventListener('mouseleave', blur);
      el.addEventListener('click', () => open({ type: 'role', role: i }));
    });
    svg.querySelectorAll<SVGElement>('.redge').forEach((el) => {
      const g = roleEdges.get(el.dataset.key!)!;
      el.addEventListener('mouseenter', () => focus(g.rf, g.rt));
      el.addEventListener('mousemove', (ev) => showTip(ev as MouseEvent, edgeTip(g)));
      el.addEventListener('mouseleave', blur);
      el.addEventListener('click', () => open({ type: 'edge', key: el.dataset.key! }));
    });
  };

  // ---------- matrix ----------
  const renderMatrix = () => {
    const order = roleOrder;
    const max = Math.max(1, ...[...roleEdges.values()].filter((g) => g.rf !== g.rt).map((g) => g.pairs));
    const gapAfter = (k: number) => k < order.length - 1 && arch.roles[order[k]].layer !== arch.roles[order[k + 1]].layer;
    const dot = (i: number) => `<span class="dot" style="background:${layerColor(arch.roles[i].layer)}"></span>`;
    let html = '<thead><tr><th></th>';
    order.forEach((i, k) => {
      html += `<th>${dot(i)}${esc(arch.roles[i].name)}</th>`;
      if (gapAfter(k)) html += '<th class="layer-gap"></th>';
    });
    html += '</tr></thead><tbody>';
    order.forEach((rf, rk) => {
      html += `<tr><th>${esc(arch.roles[rf].name)}${dot(rf)}</th>`;
      order.forEach((rt, k) => {
        const g = roleEdges.get(`${rf}>${rt}`);
        const n = g?.pairs ?? 0;
        const cls = [n ? '' : 'zero', rf === rt ? 'self' : '', g?.strong ? 'up' : g?.weak ? 'weak' : ''].filter(Boolean).join(' ');
        const alpha = n ? Math.round(12 + 70 * Math.log(n + 1) / Math.log(max + 1)) : 0;
        const bg = n && rf !== rt ? `style="background:color-mix(in srgb, var(--accent) ${alpha}%, var(--surface-2))${alpha > 55 ? ';color:#fff' : ''}"` : '';
        html += `<td class="${cls}" ${bg} data-key="${rf}>${rt}">${n || ''}</td>`;
        if (gapAfter(k)) html += '<td class="layer-gap"></td>';
      });
      html += '</tr>';
      if (gapAfter(rk)) html += `<tr><td colspan="${order.length + 5}" style="height:6px;background:none;cursor:default"></td></tr>`;
    });
    html += '</tbody>';
    const table = $('matrix-table');
    table.innerHTML = html;
    table.querySelectorAll<HTMLElement>('td[data-key]:not(.zero)').forEach((td) => {
      const g = roleEdges.get(td.dataset.key!)!;
      td.addEventListener('mousemove', (ev) => showTip(ev, edgeTip(g)));
      td.addEventListener('mouseleave', hideTip);
      td.addEventListener('click', () => open({ type: 'edge', key: td.dataset.key! }));
    });
  };

  // ---------- ranking ----------
  const eventRole = arch.roles.findIndex((r) => baseRoleName(r.name) === 'Event');
  const dataRole = arch.roles.findIndex((r) => baseRoleName(r.name) === 'Data');
  const rankValue = (n: XNode, tab: TabKey): number => {
    switch (tab) {
      case 'upward': return n.upStrong * 1000 + n.upWeak;
      case 'orphan': return n.fanIn === 0 && n.routeRefs === 0 && n.layer !== 0 && n.role !== eventRole ? n.lines : 0;
      default: return n[tab];
    }
  };
  const renderRanking = () => {
    const tab = TABS.find((t) => t.key === state.tab)!;
    all('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
    $('tab-lead').textContent = tab.lead;
    $('value-head').textContent = tab.head;
    const rows = nodes
      .filter((n) => state.role === '' || n.role === +state.role)
      .filter((n) => !state.hideData || n.role !== dataRole)
      .map((n) => ({ n, v: rankValue(n, state.tab) }))
      .filter((r) => r.v > 0)
      .sort((a, b) => b.v - a.v || b.n.fanIn - a.n.fanIn);
    const max = rows[0]?.v ?? 1;
    const display = (r: { n: XNode; v: number }) => state.tab === 'upward'
      ? `${r.n.upStrong ? `<span class="badge up">강 ${r.n.upStrong}</span>` : ''}${r.n.upWeak ? `<span class="badge weak">약 ${r.n.upWeak}</span>` : ''}`
      : `<i style="width:${Math.max(3, 120 * r.v / max)}px"></i><b>${state.tab === 'centrality' ? r.v.toFixed(1) : fmt(r.v)}</b>`;
    $('rank-body').innerHTML = rows.slice(0, state.limit).map((r, k) => `
        <tr data-i="${r.n.i}">
            <td class="sub">${k + 1}</td>
            <td><span class="fname">${esc(r.n.name)}</span><span class="fpath">${esc(r.n.path)}</span></td>
            <td>${roleChip(r.n.role)}</td>
            <td><div class="bar">${display(r)}</div></td>
            <td class="sub hide-sm">${fmt(r.n.fanIn)} · ${fmt(r.n.fanOut)} · ${r.n.centrality.toFixed(1)}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="sub">해당하는 파일이 없어요.</td></tr>';
    $('more').style.display = rows.length > state.limit ? '' : 'none';
    $('more').textContent = `더 보기 (${fmt(rows.length - state.limit)}개 남음)`;
  };
  const setupRanking = () => {
    $('tabs').innerHTML = TABS.map((t) => `<button data-tab="${t.key}">${t.label}</button>`).join('');
    listen($('tabs'), 'click', (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      state.tab = b.dataset.tab as TabKey; state.limit = 25; renderRanking();
    });
    $('role-filter').innerHTML = '<option value="">전체</option>'
      + roleOrder.map((i) => `<option value="${i}">${esc(arch.roles[i].name)} (${roleStats[i].files})</option>`).join('');
    listen($('role-filter'), 'change', (e) => { state.role = e.target.value; state.limit = 25; renderRanking(); });
    listen($('hide-data'), 'change', (e) => { state.hideData = e.target.checked; state.limit = 25; renderRanking(); });
    listen($('more'), 'click', () => { state.limit += 25; renderRanking(); });
    listen($('rank-body'), 'click', (e: MouseEvent) => {
      const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-i]');
      if (tr) open({ type: 'file', i: +tr.dataset.i! });
    });
    ['threshold', 'only-up', 'show-conceptual'].forEach((name) => listen($(name), 'change', renderLayers));
    renderRanking();
  };

  // ---------- search ----------
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  cleanups.push(() => clearTimeout(blurTimer));
  const setupSearch = () => {
    const input = $<HTMLInputElement>('q'), box = $('results');
    let items: XNode[] = [], active = 0;
    const draw = () => {
      box.innerHTML = items.map((n, k) => `<button class="${k === active ? 'active' : ''}" data-i="${n.i}">${roleChip(n.role)}<span><b>${esc(n.name)}</b><span class="r-path">${esc(n.path)}</span></span></button>`).join('');
      box.classList.toggle('open', items.length > 0);
    };
    listen(input, 'input', () => {
      const q = input.value.trim().toLowerCase();
      active = 0;
      items = q ? nodes.filter((n) => n.path.toLowerCase().includes(q))
        .sort((a, b) => (+b.name.toLowerCase().startsWith(q) - +a.name.toLowerCase().startsWith(q)) || b.fanIn - a.fanIn)
        .slice(0, 12) : [];
      draw();
    });
    listen(input, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
      if (e.key === 'Enter' && items[active]) { open({ type: 'file', i: items[active].i }); items = []; draw(); input.blur(); }
      if (e.key === 'Escape') { items = []; draw(); input.blur(); }
    });
    listen(box, 'mousedown', (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (b) { e.preventDefault(); open({ type: 'file', i: +b.dataset.i! }); items = []; draw(); input.blur(); }
    });
    listen(input, 'blur', () => { blurTimer = setTimeout(() => box.classList.remove('open'), 100); });
    listen(document, 'keydown', (e: KeyboardEvent) => {
      if (!root.isConnected || e.key !== '/') return;
      const a = document.activeElement;
      if (a instanceof HTMLElement && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return;
      e.preventDefault();
      input.focus();
    });
  };

  // ---------- drawer ----------
  const drawer = $('drawer');
  const closeDrawer = () => {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    state.history = [];
  };
  const setupDrawer = () => {
    listen($('close'), 'click', () => { closeDrawer(); env.onSelect({}); });
    listen($('back'), 'click', () => {
      state.history.pop();
      const prev = state.history.pop();
      if (prev) open(prev); else closeDrawer();
    });
    listen(document, 'keydown', (e: KeyboardEvent) => {
      if (root.isConnected && e.key === 'Escape' && document.activeElement !== $('q')) closeDrawer();
    });
    listen($('drawer-body'), 'click', (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-open]');
      if (el) open(JSON.parse(el.dataset.open!) as View);
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (act) runAction(act);
    });
  };
  const runAction = (el: HTMLElement) => {
    const path = el.dataset.path!;
    if (el.dataset.act === 'vscode-setup') env.requestVscodeSetup();
    else if (el.dataset.act === 'goto-city') env.goto('city', { file: path });
    else if (el.dataset.act === 'goto-graph') env.goto('graph', { file: path });
  };

  function open(view: View) {
    state.history.push(view);
    $<HTMLButtonElement>('back').disabled = state.history.length < 2;
    const body = $('drawer-body');
    if (view.type === 'file') {
      body.innerHTML = fileView(nodes[view.i]);
      env.onSelect({ file: nodes[view.i].path });
    } else body.innerHTML = view.type === 'role' ? roleView(view.role) : edgeView(roleEdges.get(view.key)!);
    body.scrollTop = 0;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    hideTip();
  }

  function fileView(n: XNode) {
    const pIn = percentile(sortedFanIn, n.fanIn), pOut = percentile(sortedFanOut, n.fanOut);
    const role = arch.roles[n.role];
    const insights: [string, string][] = [];
    if (n.routeRefs > 0) insights.push(['', `라우트(${n.routeFiles.map(esc).join(', ')})에서 직접 연결돼요 — 요청·화면 진입이 여기로 들어와요.`]);
    if (n.fanIn >= 5 && pIn >= 0.97) insights.push(['', `fan-in 상위 ${Math.max(1, Math.round((1 - pIn) * 100))}% — 레포 전체가 기대는 기반 코드예요. 바꾸면 파급 범위가 넓어요.`]);
    if (n.fanOut >= 5 && pOut >= 0.97) insights.push(['', `fan-out 상위 ${Math.max(1, Math.round((1 - pOut) * 100))}% — 많은 파일을 엮는 조율자예요. 흐름을 이해할 때 출발점으로 좋아요.`]);
    if (n.fanIn >= 10 && n.instability <= 0.2) insights.push(['', '안정된 기반이에요 (불안정도 낮음). 다른 코드가 이걸 따라가고, 이건 남을 거의 따라가지 않아요.']);
    if (n.fanOut >= 5 && n.instability >= 0.8) insights.push(['', '말단 코드예요 (불안정도 높음). 바꿔도 영향받는 곳이 적어요.']);
    if (role.warning) insights.push(['warn', esc(role.warning)]);
    if (n.upStrong) insights.push(['warn', `위 계층을 참조하는 강한 역방향 의존이 ${n.upStrong}개 있어요. 아래 "내가 쓰는 것"에서 빨간 표시를 확인하세요.`]);
    if (n.fanIn === 0 && n.routeRefs === 0 && n.layer !== 0) insights.push(['', '코드에서 직접 참조하는 곳이 없어요. 컨테이너·이벤트·설정·문자열로만 연결됐거나 쓰이지 않는 코드일 수 있어요.']);
    const metrics: [string, string, string][] = [
      [fmt(n.fanIn), 'fan-in', '나를 쓰는 파일'],
      [fmt(n.fanOut), 'fan-out', '내가 쓰는 파일'],
      [n.instability.toFixed(2), '불안정도', '0 기반 ↔ 1 말단'],
      [n.centrality.toFixed(1) + '×', '중심도', '평균 파일 대비'],
      [fmt(n.routeRefs), '라우트 참조', n.routeFiles.length ? esc(n.routeFiles.join(', ')) : '라우트 파일 없음'],
      [fmt(n.functions), '함수 수', esc(n.kind)],
      [fmt(n.maxComplexity), '함수 최대 복잡도', '가장 꼬인 함수'],
      [fmt(n.lines), '줄 수', `함수 ${fmt(n.functions)}개`],
    ];
    const href = env.vscodeHref(n.path);
    const vscode = href
      ? `<a href="${esc(href)}">VS Code 에서 열기</a>`
      : `<button data-act="vscode-setup" data-path="${esc(n.path)}">VS Code 에서 열기</button>`;
    return `
        <div class="kicker">${roleChip(n.role)}<span>${esc(arch.layers[n.layer].label)} 계층</span><span>·</span><span>${esc(n.kind)}</span></div>
        <h3>${esc(n.name)}</h3>
        <div class="dpath mono">${esc(n.path)}</div>
        <div class="actions">
            ${vscode}
            <button ${openAttr({ type: 'role', role: n.role })}>${esc(role.name)} 역할 보기</button>
            <button data-act="goto-city" data-path="${esc(n.path)}">코드 시티에서 보기</button>
            <button data-act="goto-graph" data-path="${esc(n.path)}">그래프에서 보기</button>
        </div>
        <p class="note">${esc(role.description)}</p>
        ${insights.length ? `<ul class="insights">${insights.map(([c, t]) => `<li class="${c}">${t}</li>`).join('')}</ul>` : ''}
        <div class="metrics">${metrics.map(([b, l, s]) => `<div class="metric"><b>${b}</b><span>${l}</span><span>${s}</span></div>`).join('')}</div>
        <div class="ego">
            <div class="dsec" style="margin:0"><h4>← 나를 쓰는 곳 <small>${fmt(n.in.length)}</small></h4>${groupList(n.in, 'f')}</div>
            <div class="dsec" style="margin:0"><h4>내가 쓰는 것 → <small>${fmt(n.out.length)}</small></h4>${groupList(n.out, 't')}</div>
        </div>`;
  }

  function groupList(list0: XEdge[], side: 'f' | 't') {
    if (!list0.length) return '<p class="note">없음</p>';
    const groups = new Map<number, XEdge[]>();
    list0.forEach((e) => {
      const other = nodes[e[side]];
      if (!groups.has(other.role)) groups.set(other.role, []);
      groups.get(other.role)!.push(e);
    });
    const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    return sorted.map(([role, list], k) => {
      list.sort((a, b) => b.w - a.w);
      const hasUp = list.some((e) => e.strong) ? '<span class="badge up">역방향</span>' : list.some((e) => e.up) ? '<span class="badge weak">역방향</span>' : '';
      return `<details class="group" ${sorted.length <= 3 || k === 0 ? 'open' : ''}>
            <summary><span>${roleChip(role)}${hasUp}</span><span class="sub">${list.length}</span></summary>
            ${list.slice(0, 60).map((e) => {
              const o = nodes[e[side]];
              const badge = e.strong ? '<span class="badge up">역방향</span>' : e.up ? '<span class="badge weak">역방향</span>' : '';
              return `<button class="link-item" ${openAttr({ type: 'file', i: o.i })}><b>${esc(o.name)}</b>${badge}<span class="k">${esc(kindsText(e.kinds))}</span></button>`;
            }).join('')}
            ${list.length > 60 ? `<p class="note" style="padding:0 10px">외 ${list.length - 60}개</p>` : ''}
        </details>`;
    }).join('');
  }

  function roleView(ri: number) {
    const r = arch.roles[ri];
    const out = [...roleEdges.values()].filter((g) => g.rf === ri && g.rt !== ri).sort((a, b) => b.pairs - a.pairs);
    const inc = [...roleEdges.values()].filter((g) => g.rt === ri && g.rf !== ri).sort((a, b) => b.pairs - a.pairs);
    const self = roleEdges.get(`${ri}>${ri}`);
    const files = nodes.filter((n) => n.role === ri);
    const top = (key: 'fanIn' | 'fanOut', count: number) => [...files].sort((a, b) => b[key] - a[key]).slice(0, count).filter((n) => n[key] > 0);
    const bars = (list: RoleEdge[], pick: (g: RoleEdge) => number) => {
      const max = list[0]?.pairs ?? 1;
      return list.length ? `<div class="bars">${list.map((g) => {
        const other = pick(g);
        const color = g.strong ? 'var(--danger)' : g.weak ? 'var(--warn)' : layerColor(arch.roles[other].layer);
        return `<button ${openAttr({ type: 'edge', key: `${g.rf}>${g.rt}` })}><span>${esc(arch.roles[other].name)}</span><i style="width:${Math.max(4, 100 * g.pairs / max)}%;background:${color}"></i><b>${fmt(g.pairs)}</b></button>`;
      }).join('')}</div>` : '<p class="note">없음</p>';
    };
    const fileList = (list: XNode[], key: 'fanIn' | 'fanOut', label: string) => list.length
      ? list.map((n) => `<button class="link-item" ${openAttr({ type: 'file', i: n.i })}><b>${esc(n.name)}</b><span class="k">${label} ${fmt(n[key])} · ${esc(n.path)}</span></button>`).join('')
      : '<p class="note">없음</p>';
    return `
        <div class="kicker"><span class="chip" style="--c:${layerColor(r.layer)}">${esc(arch.layers[r.layer].label)} 계층</span></div>
        <h3>${esc(r.name)}</h3>
        <p class="note">${esc(r.description)}</p>
        <div class="metrics">
            <div class="metric"><b>${fmt(files.length)}</b><span>파일</span></div>
            <div class="metric"><b>${fmt(roleStats[ri].lines)}</b><span>총 줄 수</span></div>
            <div class="metric"><b>${fmt(self?.pairs ?? 0)}</b><span>역할 내부 참조</span></div>
            <div class="metric"><b>${fmt(files.filter((n) => n.routeRefs > 0).length)}</b><span>라우트 연결</span></div>
        </div>
        <div class="dsec"><h4>이 역할이 의존하는 역할 → <small>파일 쌍</small></h4>${bars(out, (g) => g.rt)}</div>
        <div class="dsec"><h4>← 이 역할에 의존하는 역할 <small>파일 쌍</small></h4>${bars(inc, (g) => g.rf)}</div>
        <div class="dsec"><h4>가장 많이 쓰이는 파일 <small>fan-in</small></h4><div class="group" style="border:1px solid var(--border);border-radius:10px;overflow:hidden">${fileList(top('fanIn', 10), 'fanIn', 'fan-in')}</div></div>
        <div class="dsec"><h4>가장 많이 엮는 파일 <small>fan-out</small></h4><div class="group" style="border:1px solid var(--border);border-radius:10px;overflow:hidden">${fileList(top('fanOut', 6), 'fanOut', 'fan-out')}</div></div>`;
  }

  function edgeView(g: RoleEdge) {
    const rf = arch.roles[g.rf], rt = arch.roles[g.rt];
    const kinds: Kinds = {};
    g.list.forEach((e) => Object.entries(e.kinds).forEach(([k, n]) => { kinds[k] = (kinds[k] ?? 0) + n; }));
    const list = [...g.list].sort((a, b) => (+b.strong - +a.strong) || (b.w - a.w));
    const note = g.strong
      ? `<ul class="insights"><li class="warn">${esc(arch.layers[rf.layer].label)} 계층이 위쪽 ${esc(arch.layers[rt.layer].label)} 계층을 참조하는 강한 역방향이 ${fmt(g.strong)}쌍 있어요. 의존 방향을 뒤집거나(인터페이스·이벤트) 호출 위치를 위로 올릴 후보예요.</li></ul>`
      : g.weak
        ? `<ul class="insights"><li>기반 계층이 도메인 계층을 아는 약한 역방향 ${fmt(g.weak)}쌍이에요. DTO 가 Model 에서 값을 꺼내는 것처럼 흔한 패턴이라 대부분은 문제가 아니에요.</li></ul>`
        : '';
    return `
        <div class="kicker">${roleChip(g.rf)}<span>→</span>${roleChip(g.rt)}</div>
        <h3>${esc(rf.name)} → ${esc(rt.name)}</h3>
        <p class="note">파일 쌍 ${fmt(g.pairs)}개 · 참조 ${fmt(g.refs)}회</p>
        ${note}
        <div class="kinds">${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span>${esc(KIND_LABEL[k] ?? k)} ${fmt(n)}</span>`).join('')}</div>
        ${list.slice(0, 300).map((e) => {
          const f = nodes[e.f], t = nodes[e.t];
          const badge = e.strong ? '<span class="badge up">역방향</span>' : e.up ? '<span class="badge weak">역방향</span>' : '';
          return `<div class="pair">
                <button ${openAttr({ type: 'file', i: f.i })}><b>${esc(f.name)}</b></button><span class="sub">→</span>
                <button ${openAttr({ type: 'file', i: t.i })}><b>${esc(t.name)}</b>${badge}<span class="fpath">${esc(kindsText(e.kinds))}</span></button>
                <span class="w">×${e.w}</span>
            </div>`;
        }).join('')}
        ${list.length > 300 ? `<p class="note">외 ${fmt(list.length - 300)}쌍</p>` : ''}`;
  }

  renderCards();
  renderLayers();
  renderMatrix();
  setupRanking();
  setupSearch();
  setupDrawer();
  const initial = env.selection.file === undefined ? -1 : nodes.findIndex((n) => n.path === env.selection.file);
  if (initial >= 0) open({ type: 'file', i: initial });

  return () => {
    cleanups.forEach((fn) => fn());
    root.innerHTML = '';
    root.classList.remove('cc-explorer');
  };
};
