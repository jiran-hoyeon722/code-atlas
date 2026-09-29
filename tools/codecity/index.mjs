// Collects site/<name>/meta.json of every built repository into site/repos.json for the landing page.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const site = join(process.argv[2], 'site');
const repos = readdirSync(site, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(site, entry.name, 'meta.json')))
    .map((entry) => JSON.parse(readFileSync(join(site, entry.name, 'meta.json'), 'utf8')))
    .sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(join(site, 'repos.json'), JSON.stringify(repos));
console.log(`index: ${repos.map((repo) => repo.name).join(', ') || '(none)'}`);
