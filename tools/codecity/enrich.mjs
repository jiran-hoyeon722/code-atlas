// Adds derived metrics to the merged cc.json maps, writes the hotspot report and the preset links.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const [configPath, repo, work, serve, since, baselineCommit] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const src = config.sourceDir;
const name = basename(serve);
const legacy = config.legacyImport;
const LEGACY_IMPORT = legacy ? new RegExp(legacy.pattern, 'gm') : null;
mkdirSync(serve, { recursive: true });

const DERIVED = {
    hotspot: {
        title: 'Hotspot',
        description: `Recent commits (${since}) x max complexity per function`,
    },
    fix_commit_ratio: {
        title: 'Fix Commit Ratio',
        description: 'fix + hotfix commits / all commits in the window',
    },
    ...(legacy && { legacy_imports: { title: legacy.title, description: legacy.description } }),
};

function indexFiles(tree) {
    const files = [];
    const walk = (node, path) => {
        const here = path === null ? '' : path ? `${path}/${node.name}` : node.name;
        if (node.type === 'File') {
            files.push({ id: node.id, path: here });
        }
        (node.children ?? []).forEach((child) => walk(child, here));
    };
    walk(tree, null);
    return files;
}

function enrich(mapName) {
    const map = JSON.parse(readFileSync(join(work, `${mapName}.cc.json`), 'utf8'));
    const metrics = map.lenses.metrics;
    const files = indexFiles(map.files[0]);

    for (const file of files) {
        const attributes = (metrics.attributes[file.id] ??= {});
        const commits = attributes.number_of_commits ?? 0;
        const fixes = (attributes.fix_commits ?? 0) + (attributes.hotfix_commits ?? 0);

        attributes.hotspot = commits * (attributes.max_complexity_per_function ?? 0);
        attributes.fix_commit_ratio = commits ? Math.round((fixes / commits) * 100) / 100 : 0;
        if (LEGACY_IMPORT) {
            const sourcePath = join(repo, src, file.path);
            const source = existsSync(sourcePath) ? readFileSync(sourcePath, 'utf8') : '';
            attributes.legacy_imports = source.match(LEGACY_IMPORT)?.length ?? 0;
        }
        file.attributes = attributes;
    }

    for (const [key, descriptor] of Object.entries(DERIVED)) {
        metrics.attributeTypes[key] = 'absolute';
        metrics.attributeDescriptors[key] = {
            ...descriptor,
            hintLowValue: '',
            hintHighValue: '',
            link: '',
            direction: -1,
            analyzers: ['codecity/enrich.mjs'],
        };
    }

    writeFileSync(join(serve, `${mapName}.cc.json`), JSON.stringify(map));
    return files;
}

const current = enrich('current');
enrich('history');
writeFileSync(join(serve, 'baseline.cc.json'), readFileSync(join(work, 'baseline.cc.json')));

const row = (f, i) => {
    const a = f.attributes;
    return `| ${i + 1} | \`${src}/${f.path}\` | ${a.hotspot} | ${a.number_of_commits ?? 0} | ${a.max_complexity_per_function ?? 0} | ${a.rloc ?? 0} | ${a.number_of_authors ?? 0} | ${a.fix_commit_ratio} |`;
};
const header = [
    '| # | 파일 | 핫스팟 점수 | 최근 커밋 | 함수 최대 복잡도 | 코드 줄 | 작성자 | fix 비율 |',
    '|---|---|---|---|---|---|---|---|',
];

const hotspots = current.filter((f) => f.attributes.hotspot > 0).sort((a, b) => b.attributes.hotspot - a.attributes.hotspot);
const legacyFiles = !legacy
    ? []
    : current
          .filter((f) => !(legacy.ownPrefix && f.path.startsWith(legacy.ownPrefix)) && f.attributes.legacy_imports > 0)
          .sort((a, b) => (b.attributes.number_of_commits ?? 0) - (a.attributes.number_of_commits ?? 0) || b.attributes.legacy_imports - a.attributes.legacy_imports);

const report = [
    `# ${config.title ?? name} 핫스팟 리포트`,
    '',
    `- 생성: ${new Date().toISOString()}`,
    `- 최근 지표 기간: ${since} / 비교 기준 커밋: \`${baselineCommit.slice(0, 9)}\``,
    `- 핫스팟 점수 = 최근 커밋 수 × 함수 최대 복잡도`,
    '',
    '## 핫스팟 Top 20',
    '',
    ...header,
    ...hotspots.slice(0, 20).map(row),
    '',
    ...(!legacy
        ? []
        : [
              `## ${legacy.report} Top 20 (전체 ${legacyFiles.length}개)`,
              '',
              '| # | 파일 | 레거시 import 수 | 최근 커밋 |',
              '|---|---|---|---|',
              ...legacyFiles.slice(0, 20).map((f, i) => `| ${i + 1} | \`${src}/${f.path}\` | ${f.attributes.legacy_imports} | ${f.attributes.number_of_commits ?? 0} |`),
              '',
          ]),
];
writeFileSync(join(serve, 'hotspots.md'), report.join('\n'));
writeFileSync(
    join(serve, 'hotspots.csv'),
    ['path,hotspot,recent_commits,max_complexity_per_function,rloc,authors,fix_commit_ratio' + (legacy ? ',legacy_imports' : '')]
        .concat(hotspots.map((f) => {
            const a = f.attributes;
            return [`${src}/${f.path}`, a.hotspot, a.number_of_commits ?? 0, a.max_complexity_per_function ?? 0, a.rloc ?? 0, a.number_of_authors ?? 0, a.fix_commit_ratio, ...(legacy ? [a.legacy_imports] : [])].join(',');
        }))
        .join('\n'),
);

// Paths are relative to the CodeCharta app mounted at /codecharta/
const link = (files, params) => '/codecharta/?' + new URLSearchParams([...files.map((f) => ['file', `../${name}/${f}.cc.json`]), ...Object.entries(params)]);
const presets = [
    ['리팩터 우선순위', link(['current'], { area: 'rloc', height: 'number_of_commits', color: 'max_complexity_per_function', edge: 'temporal_coupling' })],
    ['핫스팟 한눈에', link(['current'], { area: 'rloc', height: 'number_of_commits', color: 'hotspot' })],
    ['버그 잦은 곳', link(['current'], { area: 'rloc', height: 'number_of_commits', color: 'fix_commit_ratio' })],
    ['지식 쏠림 (전체 이력)', link(['history'], { area: 'rloc', height: 'number_of_commits', color: 'number_of_authors' })],
    ...(legacy ? [[legacy.preset, link(['current'], { area: 'rloc', height: 'number_of_commits', color: 'legacy_imports' })]] : []),
    [`변화 비교 (${baselineCommit.slice(0, 9)} → HEAD)`, link(['baseline', 'current'], { mode: 'Delta', area: 'rloc', height: 'complexity', color: 'max_complexity_per_function' })],
];
writeFileSync(join(work, 'presets.json'), JSON.stringify(presets.map(([title, url]) => ({ title, url }))));
