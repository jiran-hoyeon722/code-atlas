// Extracts module-level import references between JS/TS files in <source-dir>/ with dependency-cruiser
// from code-atlas's own node_modules/, in the same deps.json shape as deps.php.
// Usage: node deps-js.mjs <repo-root> <source-dir> <routes-dir> <extensions-csv> <exclude-regex> <tsconfig> <output.json>
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [root, sourceDir, routesDir, extensionsCsv, exclude, tsConfig, output] = process.argv.slice(2);
const cruiser = join(dirname(fileURLToPath(import.meta.url)), '../../node_modules/dependency-cruiser/bin/dependency-cruise.mjs');
const raw = join(dirname(output), 'depcruise.json');
const extensions = extensionsCsv.split(',').map((ext) => `.${ext}`);
const isSource = (path) => extensions.some((ext) => path.endsWith(ext));

execFileSync(process.execPath, [
    cruiser, sourceDir,
    '--no-config',
    '--ts-pre-compilation-deps',
    '--include-only', `^${sourceDir}/`,
    ...(exclude ? ['--exclude', exclude] : []),
    ...(tsConfig && existsSync(join(root, tsConfig)) ? ['--ts-config', tsConfig] : []),
    '--output-type', 'json',
    '--output-to', raw,
], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });

const modules = JSON.parse(readFileSync(raw, 'utf8')).modules.filter((module) => isSource(module.source));

// Most specific dependency type wins; aliased/local are resolution details, not reference kinds
function referenceKind(types) {
    if (types.includes('dynamic-import')) return 'dynamic-import';
    if (types.includes('type-only') || types.includes('type-import')) return 'type-import';
    if (types.includes('export')) return 're-export';
    if (types.includes('require')) return 'require';
    return 'import';
}

function moduleKind(path) {
    if (/\.d\.[cm]?ts$/.test(path)) return 'types';
    if (/\.(test|spec)\.[^.]+$/.test(path)) return 'test';
    return /\.[jt]sx$/.test(path) ? 'component' : 'module';
}

const nodes = modules
    .map((module) => ({
        id: module.source,
        fqcn: null,
        kind: moduleKind(module.source),
        methods: null,
        lines: readFileSync(join(root, module.source), 'utf8').split('\n').length,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
const known = new Set(nodes.map((node) => node.id));

const edges = new Map();
const routeRefs = {};
for (const module of modules) {
    for (const dependency of module.dependencies) {
        const to = dependency.resolved;
        if (!known.has(to) || to === module.source) {
            continue;
        }
        const kind = referenceKind(dependency.dependencyTypes);
        const key = `${module.source}\0${to}`;
        const edge = edges.get(key) ?? edges.set(key, { from: module.source, to, weight: 0, kinds: {} }).get(key);
        edge.weight++;
        edge.kinds[kind] = (edge.kinds[kind] ?? 0) + 1;
        if (routesDir && module.source.startsWith(`${routesDir}/`)) {
            (routeRefs[to] ??= {})[module.source] = (routeRefs[to]?.[module.source] ?? 0) + 1;
        }
    }
}

writeFileSync(output, JSON.stringify({ nodes, edges: [...edges.values()], routeRefs }));
console.error(`deps: ${nodes.length} files, ${edges.size} edges, ${Object.keys(routeRefs).length} route-referenced modules`);
