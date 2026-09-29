// Turns deps.json into role/layer-aware architecture data: the explorer's architecture.json and a
// CodeCharta map (architecture.cc.json) whose buildings carry dependency metrics and code edges.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [name, configPath, repo, work, serve] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const src = config.sourceDir;
const LAYERS = config.layers;
// [name, layer index, path prefixes under sourceDir, description] — first matching prefix wins
const ROLES = config.roles;

const CONCEPTUAL_KINDS = new Set(['binds', 'triggers']);

const roleOf = (path) => {
    const inner = path.slice(src.length + 1);
    return ROLES.findIndex(([, , prefixes]) => prefixes.some((prefix) => inner.startsWith(prefix)));
};

function indexCodeCharta(map) {
    const byPath = new Map();
    const walk = (node, path) => {
        const current = path === null ? '' : path ? `${path}/${node.name}` : node.name;
        if (node.type === 'File') {
            byPath.set(`${src}/${current}`, node.id);
        }
        (node.children ?? []).forEach((child) => walk(child, current));
    };
    walk(map.files[0], null);
    return byPath;
}

function pageRank(count, edges, damping = 0.85, iterations = 80) {
    const outDegree = new Array(count).fill(0);
    edges.forEach(([from]) => outDegree[from]++);
    let rank = new Array(count).fill(1 / count);
    for (let i = 0; i < iterations; i++) {
        const next = new Array(count).fill(0);
        let dangling = 0;
        rank.forEach((value, node) => {
            if (outDegree[node] === 0) {
                dangling += value;
            }
        });
        edges.forEach(([from, to]) => {
            next[to] += (damping * rank[from]) / outDegree[from];
        });
        const base = (1 - damping + damping * dangling) / count;
        rank = next.map((value) => value + base);
    }
    return rank.map((value) => value * count);
}

const deps = JSON.parse(readFileSync(join(work, 'deps.json'), 'utf8'));
const current = JSON.parse(readFileSync(join(serve, 'current.cc.json'), 'utf8'));
const ccIds = indexCodeCharta(current);
const ccAttributes = current.lenses.metrics.attributes;

const index = new Map(deps.nodes.map((node, i) => [node.id, i]));
const edges = deps.edges.map((edge) => {
    const kinds = Object.keys(edge.kinds);
    return {
        from: index.get(edge.from),
        to: index.get(edge.to),
        weight: edge.weight,
        kinds: edge.kinds,
        conceptual: kinds.every((kind) => CONCEPTUAL_KINDS.has(kind)),
    };
});

const fanIn = new Array(deps.nodes.length).fill(0);
const fanOut = new Array(deps.nodes.length).fill(0);
edges.forEach(({ from, to }) => {
    fanOut[from]++;
    fanIn[to]++;
});
const rank = pageRank(deps.nodes.length, edges.map(({ from, to }) => [from, to]));

const nodes = deps.nodes.map((node, i) => {
    const git = ccAttributes[ccIds.get(node.id)] ?? {};
    const routeRefs = Object.values(deps.routeRefs[node.id] ?? {}).reduce((sum, n) => sum + n, 0);
    return {
        path: node.id,
        fqcn: node.fqcn,
        kind: node.kind,
        role: roleOf(node.id),
        lines: node.lines,
        methods: node.methods,
        fanIn: fanIn[i],
        fanOut: fanOut[i],
        instability: fanIn[i] + fanOut[i] ? Math.round((fanOut[i] / (fanIn[i] + fanOut[i])) * 100) / 100 : 0,
        centrality: Math.round(rank[i] * 100) / 100,
        routeRefs,
        routeFiles: Object.keys(deps.routeRefs[node.id] ?? {}),
        commits: git.number_of_commits ?? 0,
        maxComplexity: git.max_complexity_per_function ?? 0,
    };
});

const isUpward = (edge) => !edge.conceptual && ROLES[nodes[edge.from].role][1] > ROLES[nodes[edge.to].role][1];

writeFileSync(
    join(serve, 'architecture.json'),
    JSON.stringify({
        generatedAt: new Date().toISOString(),
        name,
        title: config.title ?? name,
        repo,
        sourceDir: src,
        routesDir: config.routesDir,
        language: config.language,
        layers: LAYERS,
        roles: ROLES.map(([name, layer, , description]) => ({ name, layer, description, warning: config.roleWarnings?.[name] })),
        nodes,
        edges: edges.map((edge) => [edge.from, edge.to, edge.weight, edge.kinds, isUpward(edge) ? 1 : 0]),
    }),
);
['explorer.html', 'graph.html', 'city.html'].forEach((page) => copyFileSync(join(here, 'pages', page), join(serve, page)));

const metrics = current.lenses.metrics;
nodes.forEach((node) => {
    const id = ccIds.get(node.path);
    if (!id) {
        return;
    }
    Object.assign((metrics.attributes[id] ??= {}), {
        fan_in: node.fanIn,
        fan_out: node.fanOut,
        instability: Math.round(node.instability * 100),
        centrality: Math.round(node.centrality * 100),
        route_refs: node.routeRefs,
    });
});
const descriptors = {
    fan_in: ['Fan-in', 'Number of files that reference this file'],
    fan_out: ['Fan-out', 'Number of files this file references'],
    instability: ['Instability (%)', 'fan-out / (fan-in + fan-out) x 100 — 0 = stable foundation, 100 = leaf'],
    centrality: ['Centrality (x100)', 'PageRank over code references, 100 = average file'],
    route_refs: ['Route References', 'Times referenced from routes/*.php'],
};
for (const [key, [title, description]] of Object.entries(descriptors)) {
    metrics.attributeTypes[key] = key === 'instability' ? 'relative' : 'absolute';
    metrics.attributeDescriptors[key] = { title, description, hintLowValue: '', hintHighValue: '', link: '', direction: -1, analyzers: ['codecity/architecture.mjs'] };
}

const dependency = current.lenses.dependency;
edges.forEach((edge) => {
    const fromId = ccIds.get(nodes[edge.from].path);
    const toId = ccIds.get(nodes[edge.to].path);
    if (fromId && toId) {
        dependency.edges.push({ fromId, toId, attributes: { code_dependency: edge.weight } });
    }
});
dependency.attributeTypes.code_dependency = 'absolute';
dependency.attributeDescriptors.code_dependency = { title: 'Code Dependency', description: 'Number of class references from one file to another', hintLowValue: '', hintHighValue: '', link: '', direction: -1, analyzers: ['codecity/architecture.mjs'] };
writeFileSync(join(serve, 'architecture.cc.json'), JSON.stringify(current));

const link = (params) => '/codecharta/?' + new URLSearchParams([['file', `../${name}/architecture.cc.json`], ...Object.entries(params)]);
const presets = [
    ...JSON.parse(readFileSync(join(work, 'presets.json'), 'utf8')),
    { title: '의존성 도시 (높이 fan-in, 색 불안정도)', url: link({ area: 'rloc', height: 'fan_in', color: 'instability', edge: 'code_dependency' }) },
    { title: '중심 파일 (높이 중심도, 색 fan-out)', url: link({ area: 'rloc', height: 'centrality', color: 'fan_out', edge: 'code_dependency' }) },
];
writeFileSync(
    join(serve, 'meta.json'),
    JSON.stringify({
        name,
        title: config.title ?? name,
        language: config.language,
        sourceDir: src,
        generatedAt: new Date().toISOString(),
        files: nodes.length,
        edges: edges.length,
        upward: edges.filter(isUpward).length,
        presets,
    }),
);

const base = `http://127.0.0.1:${process.env.CODE_ATLAS_PORT ?? 9400}`;
writeFileSync(
    join(work, 'links.md'),
    [
        '',
        `# ${name}`,
        '',
        `- 의존성 3D 도시: ${base}/${name}/city.html`,
        `- 의존성 3D 그래프: ${base}/${name}/graph.html`,
        `- 아키텍처 탐색기: ${base}/${name}/explorer.html`,
        ...presets.map(({ title, url }) => `- ${title}: ${base}${url}`),
        `- 리포트: ${join(serve, 'hotspots.md')}`,
        '',
    ].join('\n'),
);

console.log(`architecture: ${nodes.length} files, ${edges.length} edges, ${edges.filter(isUpward).length} upward`);
