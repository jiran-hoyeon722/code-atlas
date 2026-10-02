import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://localhost:4173/';
const OUT = resolve(ROOT, 'test-results/e2e');
const REACT = resolve(ROOT, 'tests/fixtures/react-mini');
const LARAVEL = resolve(ROOT, 'tests/fixtures/laravel-mini');
const PY = resolve(ROOT, 'tests/fixtures/py-mini');
const GO = resolve(ROOT, 'tests/fixtures/go-mini');
const MIXED = resolve(ROOT, 'tests/fixtures/mixed-mini');

let preview = null;
const results = [];
const external = [];
const githubRequests = [];
const GITHUB_HOSTS = ['https://api.github.com/', 'https://raw.githubusercontent.com/'];
const GH_SHA = 'e2e0'.repeat(10);
const consoleErrors = [];
const cspEvents = [];
const notes = [];
const workerScripts = [];

function run(cmd, args) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}

async function startPreview() {
  const p = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  p.stdout.on('data', (d) => (log += d));
  p.stderr.on('data', (d) => (log += d));
  preview = p;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (p.exitCode !== null) throw new Error(`vite preview exited early:\n${log}`);
    try {
      if ((await fetch(BASE)).ok) return p;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  stopPreview(p);
  throw new Error(`vite preview did not start:\n${log}`);
}

function stopPreview(p) {
  if (!p || p.exitCode !== null) return;
  try {
    process.kill(-p.pid, 'SIGTERM');
  } catch {
    p.kill('SIGTERM');
  }
}

async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`  PASS ${name}`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t, error: e.message });
    console.log(`  FAIL ${name}\n       ${e.message.split('\n').join('\n       ')}`);
    throw e;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const shot = async (page, name) => {
  // A city rises for about a second and a half after it mounts; shoot it built.
  await page.waitForFunction(() => { const c = document.querySelector('.cc-city'); return !c || c.dataset.revealDone === '1'; }, null, { timeout: 10_000 }).catch(() => {});
  return page.screenshot({ path: resolve(OUT, name) });
};

/** Records loading-screen sightings and CSP violations on window, for every document load. */
function initScript() {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    const v = { directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber };
    window.__csp.push(v);
    window.__reportCsp?.(v);
  });
  window.__loading = { seen: false, reading: false };
  const check = () => {
    const el = document.querySelector('.cc-load');
    if (!el) return;
    window.__loading.seen = true;
    if ((el.textContent || '').includes('코드 읽기')) window.__loading.reading = true;
  };
  new MutationObserver(check).observe(document, { childList: true, subtree: true, characterData: true });
}

async function waitForCity(page) {
  await page.waitForSelector('.ca-shell [role=tab][aria-selected=true]:has-text("도시")', { timeout: 60_000 });
  await page.waitForSelector('.ca-shell-mount canvas', { timeout: 30_000 });
  await page.waitForTimeout(3000);
}

async function openFolder(page, dir, loadingShot) {
  await page.evaluate(() => (window.__loading = { seen: false, reading: false }));
  const miniCitySize = () => {
    const c = document.querySelector('.cc-load-city canvas');
    return c ? { w: c.clientWidth, h: c.clientHeight } : null;
  };
  const loading = loadingShot
    ? page.waitForSelector('.cc-load-city canvas', { timeout: 30_000 })
      .then(async () => {
        const size = await page.evaluate(miniCitySize);
        await shot(page, loadingShot);
        const still = await page.evaluate(() => !!document.querySelector('.cc-load'));
        return { ...size, still };
      })
      .catch(() => null)
    : Promise.resolve(null);
  await page.setInputFiles('[data-testid=folder-input]', dir);
  await waitForCity(page);
  const miniCity = await loading;
  return { captured: !!miniCity, miniCity, ...(await page.evaluate(() => window.__loading)) };
}

async function readTree(root) {
  const out = {};
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else out[relative(root, p).split('\\').join('/')] = await readFile(p, 'utf8');
    }
  };
  await walk(root);
  return out;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': '*' };

/** Stands in for GitHub: `acme/react-mini` serves the react-mini fixture; `rateLimit` makes the API refuse. */
async function mockGithub(page, mode = 'ok') {
  const files = await readTree(REACT);
  await page.unrouteAll({ behavior: 'wait' });
  await page.route((url) => GITHUB_HOSTS.some((h) => url.href.startsWith(h)), (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const json = (body, status = 200, headers = {}) => route.fulfill({ status, headers: { ...CORS, ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (url.startsWith('https://api.github.com/') && mode === 'rateLimit') {
      return json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1800) });
    }
    if (url === 'https://api.github.com/repos/acme/react-mini') return json({ name: 'react-mini', owner: { login: 'acme' }, default_branch: 'main' });
    if (url === 'https://api.github.com/repos/acme/react-mini/commits/main') return route.fulfill({ status: 200, headers: CORS, body: GH_SHA });
    if (url.startsWith(`https://api.github.com/repos/acme/react-mini/git/trees/${GH_SHA}`)) {
      return json({ truncated: false, tree: Object.entries(files).map(([path, t]) => ({ path, type: 'blob', size: Buffer.byteLength(t) })) });
    }
    const raw = `https://raw.githubusercontent.com/acme/react-mini/${GH_SHA}/`;
    const path = url.startsWith(raw) ? decodeURIComponent(url.slice(raw.length)) : null;
    if (path !== null && path in files) return route.fulfill({ status: 200, headers: CORS, body: files[path] });
    return json({ message: 'Not Found' }, 404);
  });
}

// hard upper bound so a hung browser or server can never stall the run
const watchdog = setTimeout(() => {
  console.error('e2e watchdog: exceeded 8 minutes, aborting');
  stopPreview(preview);
  process.exit(2);
}, 8 * 60_000);
watchdog.unref();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopPreview(preview);
    process.exit(130);
  });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log('build');
  await run('npm', ['run', 'build']);
  await startPreview();
  let browser = null;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.exposeBinding('__reportCsp', (_source, v) => cspEvents.push(v));
    await context.addInitScript(initScript);
    const page = await context.newPage();
    page.on('request', (r) => {
      // blob: URLs of this origin are in-memory (the analysis worker wrapper), not network requests
      // GitHub is only ever reached through mockGithub's routes, which answer before anything leaves the machine
      if (GITHUB_HOSTS.some((h) => r.url().startsWith(h))) githubRequests.push(r.url());
      else if (!r.url().startsWith(BASE) && !r.url().startsWith(`blob:${new URL(BASE).origin}/`)) external.push(r.url());
      else if (/\/assets\/worker-[^/]*\.js$/.test(r.url())) workerScripts.push(r.url());
    });
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`${m.text()} @ ${m.location().url}:${m.location().lineNumber}`);
    });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

    console.log('e2e');
    await step('landing screen renders', async () => {
      await page.goto(BASE);
      await page.waitForSelector('text=레포 폴더를 여기에 끌어다 놓으세요');
      assert((await page.locator('[data-testid=folder-input]').count()) === 1, 'folder input missing');
      await shot(page, 'landing.png');
    });

    await step('react-mini: loading screen then city', async () => {
      const r = await openFolder(page, REACT, 'loading.png');
      assert(r.seen, 'loading screen never appeared');
      assert(r.reading, 'loading screen never showed "코드 읽기"');
      if (!r.captured) notes.push('loading.png: loading screen finished before the screenshot could be taken');
      else assert(r.miniCity.w > 0 && r.miniCity.h > 0, `mini-city canvas has no size: ${JSON.stringify(r.miniCity)}`);
      if (r.captured && !r.miniCity.still) notes.push('loading.png: analysis finished while the screenshot was being taken, so it may show the city instead');
      notes.push(`mini-city canvas while loading: ${r.miniCity ? `${r.miniCity.w}×${r.miniCity.h}` : 'not captured'} (react-mini parses in well under a second, so buildings may not be visible yet)`);
      const brand = await page.locator('.ca-shell-brand strong').textContent();
      assert(brand === 'react-mini', `unexpected repo name "${brand}"`);
      await shot(page, 'city.png');
    });

    await step('city: first-visit tour flies through the city, then stays closed', async () => {
      await page.waitForSelector('[data-el=tour]:not([hidden])', { timeout: 10_000 });
      await shot(page, 'city-tour-1.png');
      await page.click('[data-el=t-next]');
      await page.waitForSelector('[data-el=panel].open');
      await page.waitForTimeout(1100);
      await shot(page, 'city-tour-2.png');
      const steps = Number((await page.locator('[data-el=t-step]').textContent()).split('/')[1]);
      for (let k = 2; k < steps; k++) await page.click('[data-el=t-next]');
      await page.waitForTimeout(1100);
      await shot(page, 'city-tour-last.png');
      assert((await page.locator('[data-el=t-next]').textContent()) === '시작하기', 'last tour step should offer 시작하기');
      await page.click('[data-el=t-next]');
      assert(await page.locator('[data-el=tour]').isHidden(), 'tour did not close');
      assert(await page.evaluate(() => localStorage.getItem('code-atlas.city.tour-seen') === '1'), 'tour was not remembered');
    });

    await step('city: search (/) → code view shows fixture source', async () => {
      await page.locator('.ca-shell-mount canvas').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
      await page.keyboard.press('/');
      const q = page.locator('[data-el=q]');
      assert(await q.evaluate((el) => el === document.activeElement), '"/" did not focus the search input');
      await page.keyboard.type('userService');
      await page.waitForSelector('[data-el=results].open button');
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-el=panel-body] [data-open-code]');
      await page.click('[data-el=panel-body] [data-open-code]');
      await page.waitForFunction(() => document.querySelector('[data-el=code-src]')?.textContent?.includes('export const fetchUsers'), null, { timeout: 10_000 });
      const codeName = await page.locator('[data-el=code-name]').textContent();
      assert(codeName.startsWith('userService'), `code view shows another file: "${codeName}"`);
      await page.waitForTimeout(500);
      await shot(page, 'city-code.png');
    });

    await step('city: blast radius', async () => {
      await page.keyboard.press('Escape');
      await page.click('[data-el=panel-body] [data-blast]');
      await page.waitForSelector('.cc-city[data-blast-done]', { state: 'attached', timeout: 10_000 });
      const summary = await page.locator('.blast-summary').textContent();
      assert(summary.startsWith('직접'), `unexpected blast summary: "${summary}"`);
      await shot(page, 'city-blast.png');
    });

    await step('codecity GTA tab: search, walk up to a door, E opens the code', async () => {
      await page.click('.ca-shell [role=tab]:has-text("코드시티GTA")');
      await page.waitForSelector('.wk-walk canvas', { timeout: 30_000 });
      await page.waitForSelector('.wk-pick [data-id=astro]', { timeout: 10_000 });
      await page.waitForTimeout(2500);
      await page.keyboard.press('3');
      await page.waitForSelector('.wk-pick [data-id=astro].on', { timeout: 5_000 });
      await shot(page, 'walk-pick.png');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.wk-pick', { state: 'detached', timeout: 5_000 });
      await page.waitForSelector('.wk-guide:not([hidden])', { timeout: 10_000 });
      await page.waitForTimeout(1500);
      await shot(page, 'walk-guide.png');
      for (let k = 0; k < 5; k++) {
        assert(await page.locator('.wk-walk .g-spot').count() > 0, `guide step ${k + 1} lights up nothing`);
        if (k > 0) await shot(page, `walk-guide-${k + 1}.png`);
        if (k < 4) await page.click('[data-el=g-next]');
      }
      assert((await page.locator('[data-el=g-next]').textContent()) === '시작하기', 'guide does not end on its fifth step');
      await page.click('[data-el=g-next]');
      await page.waitForSelector('.wk-guide[hidden]', { state: 'attached', timeout: 5_000 });
      await page.waitForSelector('[data-el=quest]:not([hidden])', { timeout: 5_000 });
      // Back away from the door the walk starts at, so the run is not cut short by the wall.
      await page.keyboard.down('Shift');
      await page.keyboard.down('KeyS');
      // Software-rendered frames are slow and each one advances at most 0.05 s of game time, so give the run a while.
      await page.waitForFunction(() => document.querySelectorAll('[data-el=quest-list] li.done').length >= 2, null, { timeout: 15_000 }).catch(() => {});
      await page.keyboard.press('Space');
      await page.waitForTimeout(700);
      await page.keyboard.up('KeyS');
      await page.keyboard.up('Shift');
      const ticked = await page.locator('[data-el=quest-list] li').evaluateAll((els) => els.map((el) => `${el.className === 'done' ? '✓' : '✗'} ${el.textContent}`));
      assert(ticked.filter((t) => t.startsWith('✓')).length === 3, `walking, running and jumping should tick 3 first-steps tasks: ${ticked.join(' | ')}`);
      await shot(page, 'walk-quest.png');
      await page.waitForTimeout(500);
      await page.keyboard.press('/');
      await page.keyboard.type('userService');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.wk-prompt.open')?.textContent?.includes('들어가기'), null, { timeout: 20_000 });
      await shot(page, 'walk.png');
      await page.keyboard.press('e');
      await page.waitForFunction(() => document.querySelector('[data-el=d-src]')?.textContent?.includes('export const fetchUsers'), null, { timeout: 20_000 });
      const name = await page.locator('[data-el=d-name]').textContent();
      assert(name.startsWith('userService'), `walk detail shows another file: "${name}"`);
      await page.waitForSelector('[data-el=quest]', { state: 'hidden', timeout: 5_000 });
      await page.waitForTimeout(600);
      await shot(page, 'walk-code.png');
      await page.keyboard.press('Escape');
    });

    await step('codecity GTA: R climbs onto the roof and back down', async () => {
      await page.waitForTimeout(800);
      await page.keyboard.press('r');
      await page.waitForFunction(() => document.querySelector('.wk-prompt.open')?.textContent?.includes('내려가기'), null, { timeout: 15_000 });
      await page.waitForTimeout(1200);
      await shot(page, 'walk-roof.png');
      await page.keyboard.press('r');
      await page.waitForFunction(() => document.querySelector('.wk-prompt.open')?.textContent?.includes('옥상으로'), null, { timeout: 15_000 });
    });

    await step('codecity GTA: weapons, virus outbreak, help', async () => {
      await page.waitForTimeout(800);
      const held = await page.locator('.wk-weapons button.on').getAttribute('data-weapon');
      const lockedKey = await page.locator('.wk-weapons button.locked kbd').first().textContent();
      await page.keyboard.press(lockedKey);
      await page.waitForTimeout(200);
      assert(await page.locator('.wk-weapons button.on').getAttribute('data-weapon') === held, `${lockedKey} picked a weapon the player has not looted yet`);
      await page.keyboard.press('f');
      await page.keyboard.press('v');
      await page.waitForSelector('.wk-virus:not([hidden])', { timeout: 5_000 });
      await page.waitForFunction(() => !/^0 \//.test(document.querySelector('[data-el=v-count]')?.textContent ?? '0 /'), null, { timeout: 15_000 });
      await page.waitForTimeout(8000);
      await shot(page, 'walk-virus.png');
      await page.keyboard.press('m');
      assert(await page.locator('[data-el=sound-btn]').getAttribute('aria-pressed') === 'false', 'M did not mute the sound');
      await page.keyboard.press('m');
      assert(await page.locator('[data-el=sound-btn]').getAttribute('aria-pressed') === 'true', 'M did not turn the sound back on');
      await page.keyboard.press('?');
      await page.waitForSelector('.wk-help:not([hidden])', { timeout: 5_000 });
      await shot(page, 'walk-help.png');
      await page.keyboard.press('Escape');
      await page.keyboard.press('v');
      await page.waitForSelector('.wk-virus[hidden]', { state: 'attached', timeout: 5_000 });
    });

    await step('codecity GTA: auto hunt walks an expedition and keeps virus mode off', async () => {
      await page.keyboard.press('o');
      await page.waitForSelector('.wk-auto:not([hidden])', { timeout: 5_000 });
      await page.waitForSelector('.wk-auto-card:not([hidden])', { timeout: 5_000 });
      assert(/원정/.test(await page.locator('[data-el=c-title]').textContent()), 'no expedition brief card');
      await shot(page, 'walk-auto-brief.png');
      await page.waitForSelector('.wk-auto-card[hidden]', { state: 'attached', timeout: 20_000 });
      assert(await page.locator('[data-el=a-route] li').count() > 0, 'expedition route is empty');
      await page.waitForFunction(() => document.querySelector('.wk-walk')?.classList.contains('inside'), null, { timeout: 60_000 });
      await page.waitForTimeout(800);
      assert(await page.locator('[data-el=d-why]:not([hidden])').count() === 1, 'code view does not explain why the file was visited');
      await shot(page, 'walk-auto-read.png');
      await page.keyboard.press('v');
      assert(await page.locator('.wk-virus:not([hidden])').count() === 0, 'virus mode started during auto hunt');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.wk-auto[hidden]', { state: 'attached', timeout: 5_000 });
      await page.waitForFunction(() => !document.querySelector('.wk-walk')?.classList.contains('inside'), null, { timeout: 5_000 });
    });

    await step('graph tab renders', async () => {
      await page.click('.ca-shell [role=tab]:has-text("그래프")');
      await page.waitForSelector('.ca-shell-mount .cg-canvas canvas', { timeout: 30_000 });
      // the layout settles (up to 15 s on a slow software renderer), then zooms to fit over 600 ms
      await page.waitForSelector('.cc-graph[data-settled]', { state: 'attached', timeout: 45_000 });
      await page.waitForTimeout(1500);
      await shot(page, 'graph.png');
    });

    await step('explorer tab renders', async () => {
      await page.click('.ca-shell [role=tab]:has-text("탐색기")');
      await page.waitForSelector('.ca-shell-mount svg', { timeout: 30_000 });
      await page.waitForTimeout(500);
      await shot(page, 'explorer.png');
    });

    await step('reload → one recent card → city without analysis', async () => {
      await page.goto(BASE);
      await page.waitForSelector('.ca-land-card', { timeout: 10_000 });
      const cards = await page.locator('.ca-land-card').count();
      assert(cards === 1, `expected 1 recent card, got ${cards}`);
      assert((await page.locator('.ca-land-card strong').textContent()) === 'react-mini', 'recent card is not react-mini');
      await shot(page, 'landing-recent.png');
      await page.click('.ca-land-open');
      await waitForCity(page);
      const l = await page.evaluate(() => window.__loading);
      assert(!l.seen, 'opening a recent analysis showed the loading screen (re-analysed)');
    });

    await step('laravel-mini: city', async () => {
      await page.click('.ca-shell-actions button:has-text("다른 레포 열기")');
      await page.waitForSelector('[data-testid=folder-input]');
      const r = await openFolder(page, LARAVEL, null);
      assert(r.seen, 'loading screen never appeared for laravel-mini');
      const brand = await page.locator('.ca-shell-brand strong').textContent();
      assert(brand === 'laravel-mini', `unexpected repo name "${brand}"`);
      const meta = await page.locator('.ca-shell-brand span').textContent();
      assert(meta.startsWith('Laravel'), `expected Laravel detection, got "${meta}"`);
      await shot(page, 'laravel-city.png');
    });

    const newLangCity = async (dir, name, label, query, codeText, hljs, shotPrefix) => {
      await page.click('.ca-shell-actions button:has-text("다른 레포 열기")');
      await page.waitForSelector('[data-testid=folder-input]');
      const r = await openFolder(page, dir, null);
      assert(r.seen, `loading screen never appeared for ${name}`);
      const brand = await page.locator('.ca-shell-brand strong').textContent();
      assert(brand === name, `unexpected repo name "${brand}"`);
      const meta = await page.locator('.ca-shell-brand span').textContent();
      assert(meta.startsWith(`${label} · `), `expected ${label} detection, got "${meta}"`);
      await page.locator('.ca-shell-mount canvas').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
      await page.keyboard.press('/');
      await page.keyboard.type(query);
      await page.waitForSelector('[data-el=results].open button');
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-el=panel-body] [data-open-code]');
      await page.waitForTimeout(1500);
      await shot(page, `${shotPrefix}-city.png`);
      await page.click('[data-el=panel-body] [data-open-code]');
      await page.waitForFunction((t) => document.querySelector('[data-el=code-src]')?.textContent?.includes(t), codeText, { timeout: 10_000 });
      const cls = await page.locator('[data-el=code-src]').getAttribute('class');
      assert(cls.includes(`language-${hljs}`), `code view class "${cls}" lacks language-${hljs}`);
      assert(await page.locator('[data-el=code-src] .hljs-keyword').count() > 0, `${label} code is not highlighted`);
      await page.waitForTimeout(500);
      await shot(page, `${shotPrefix}-code.png`);
      await page.keyboard.press('Escape');
    };

    await step('py-mini: city', () => newLangCity(PY, 'py-mini', 'Python', 'order', 'class Order', 'python', 'py'));

    await step('go-mini: city', () => newLangCity(GO, 'go-mini', 'Go', 'item', 'func (i Item) Label', 'go', 'go'));

    const openCodeFor = async (query, codeText, hljs) => {
      await page.locator('.ca-shell-mount canvas').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
      await page.keyboard.press('/');
      await page.fill('[data-el=q]', query);
      await page.waitForSelector('[data-el=results].open button');
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-el=panel-body] [data-open-code]');
      await page.click('[data-el=panel-body] [data-open-code]');
      await page.waitForFunction((t) => document.querySelector('[data-el=code-src]')?.textContent?.includes(t), codeText, { timeout: 10_000 });
      const cls = await page.locator('[data-el=code-src]').getAttribute('class');
      assert(cls.includes(`language-${hljs}`), `code view class "${cls}" lacks language-${hljs}`);
      assert(await page.locator('[data-el=code-src] .hljs-keyword').count() > 0, `${hljs} code is not highlighted`);
      await page.waitForTimeout(500);
      await shot(page, `mixed-code-${hljs}.png`);
      await page.keyboard.press('Escape');
    };

    await step('mixed-mini: one city with both languages', async () => {
      await page.click('.ca-shell-actions button:has-text("다른 레포 열기")');
      await page.waitForSelector('[data-testid=folder-input]');
      const r = await openFolder(page, MIXED, null);
      assert(r.seen, 'loading screen never appeared for mixed-mini');
      assert(await page.locator('[role=dialog]:visible').count() === 0, 'a dialog is open over the mixed city');
      const meta = await page.locator('.ca-shell-brand span').textContent();
      assert(meta.startsWith('Python + Go · '), `expected "Python + Go" in the top bar, got "${meta}"`);
      await page.waitForTimeout(1500);
      await shot(page, 'mixed-city.png');
      await openCodeFor('menu', 'class Menu', 'python');
      await openCodeFor('tray', 'func (t Tray) Fits', 'go');
    });

    await step('landing: GitHub form and sample gallery', async () => {
      await page.click('.ca-shell-actions button:has-text("다른 레포 열기")');
      await page.waitForSelector('.ca-land-sample', { timeout: 10_000 });
      const cards = await page.locator('.ca-land-sample').count();
      assert(cards >= 4, `expected sample cards, got ${cards}`);
      await page.fill('.ca-land-gh-form input', 'https://github.com/acme/react-mini/tree/main/src');
      const hint = await page.locator('.ca-land-gh-hint').textContent();
      assert(hint === '✓ acme/react-mini · main 브랜치 · src 폴더만', `unexpected parse hint "${hint}"`);
      await page.locator('.ca-land-sample').first().hover();
      await page.screenshot({ path: resolve(OUT, 'landing-github.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: resolve(OUT, 'landing-github-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.fill('.ca-land-gh-form input', '');
    });

    await step('sample card → city without analysis', async () => {
      await page.evaluate(() => (window.__loading = { seen: false, reading: false }));
      const name = (await page.locator('.ca-land-sample strong').first().textContent()).trim();
      await page.locator('.ca-land-sample').first().click();
      await waitForCity(page);
      const brand = await page.locator('.ca-shell-brand strong').textContent();
      assert(brand.endsWith(`/${name}`), `sample opened "${brand}", expected …/${name}`);
      assert(!(await page.evaluate(() => window.__loading.seen)), 'a sample should open without the loading screen');
      assert((await page.locator('.ca-shell-origin code').textContent()).length === 7, 'short commit sha missing from the header');
      await shot(page, 'sample-city.png');
    });

    await step('GitHub URL (mocked) → loading → city → code from raw', async () => {
      await mockGithub(page);
      await page.click('.ca-shell-actions button:has-text("다른 레포 열기")');
      await page.waitForSelector('.ca-land-gh-form input');
      await page.evaluate(() => (window.__loading = { seen: false, reading: false }));
      const loading = page.waitForSelector('.cc-load', { timeout: 30_000 }).then(() => shot(page, 'github-loading.png')).catch(() => null);
      await page.fill('.ca-land-gh-form input', 'acme/react-mini');
      await page.press('.ca-land-gh-form input', 'Enter');
      await waitForCity(page);
      await loading;
      assert(await page.evaluate(() => window.__loading.seen), 'loading screen never appeared for the GitHub repo');
      const brand = await page.locator('.ca-shell-brand strong').textContent();
      assert(brand === 'acme/react-mini', `unexpected repo name "${brand}"`);
      const reanalyze = await page.locator('.ca-shell-actions button', { hasText: '최신 커밋으로 다시 분석' }).count();
      assert(reanalyze === 1, 'GitHub analysis should offer "최신 커밋으로 다시 분석"');
      await page.locator('.ca-shell-mount canvas').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
      await page.keyboard.press('/');
      await page.keyboard.type('userService');
      await page.waitForSelector('[data-el=results].open button');
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-el=panel-body] [data-open-code]');
      await page.click('[data-el=panel-body] [data-open-code]');
      await page.waitForFunction(() => document.querySelector('[data-el=code-src]')?.textContent?.includes('export const fetchUsers'), null, { timeout: 10_000 });
      assert(githubRequests.some((u) => u.startsWith(`https://raw.githubusercontent.com/acme/react-mini/${GH_SHA}/`)), 'code was not fetched from the pinned commit');
      await page.waitForTimeout(500);
      await shot(page, 'github-city-code.png');
      await page.keyboard.press('Escape');
    });

    await step('GitHub rate limit (mocked) → notice with ZIP fallback', async () => {
      await mockGithub(page, 'rateLimit');
      const before = consoleErrors.length;
      await page.click('.ca-shell-actions button:has-text("다른 레포 열기")');
      await page.fill('.ca-land-gh-form input', 'acme/other');
      await page.press('.ca-land-gh-form input', 'Enter');
      await page.waitForSelector('.ca-land-notice-link', { timeout: 10_000 });
      const text = await page.locator('.ca-land-notice').textContent();
      assert(text.includes('GitHub 요청 한도'), `unexpected notice "${text}"`);
      const href = await page.locator('.ca-land-notice-link').getAttribute('href');
      assert(href === 'https://github.com/acme/other/archive/HEAD.zip', `unexpected ZIP link ${href}`);
      await shot(page, 'github-rate-limit.png');
      await page.unrouteAll({ behavior: 'wait' });
      // the browser logs the refused request itself; that 403 is the point of this step
      const stepConsole = consoleErrors.splice(before);
      assert(stepConsole.every((m) => m.includes('403') && m.includes('api.github.com')), `unexpected console errors: ${stepConsole.join('\n')}`);
    });

    await step('analysis worker script is loaded (via the blob: wrapper)', async () => {
      assert(workerScripts.length > 0, 'no assets/worker-*.js request seen — the analysis worker never loaded');
    });

    await step('blob: module worker inherits the CSP (fetch to another origin is blocked)', async () => {
      // this step triggers exactly one violation on purpose, so its events are kept apart from the app's
      const before = { csp: cspEvents.length, console: consoleErrors.length, external: external.length };
      const r = await page.evaluate(async () => {
        const src = `
          const violations = [];
          self.addEventListener('securitypolicyviolation', (e) => violations.push({ directive: e.violatedDirective, blocked: e.blockedURI }));
          let fetched = null;
          try { await fetch('https://example.invalid/'); fetched = 'ok'; } catch (e) { fetched = String(e); }
          await new Promise((r) => setTimeout(r, 200));
          postMessage({ fetched, violations });
        `;
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const w = new Worker(url, { type: 'module' });
        try {
          return await new Promise((ok, fail) => {
            w.onmessage = (e) => ok(e.data);
            w.onerror = (e) => fail(new Error(e.message || 'blob worker failed'));
            setTimeout(() => fail(new Error('blob worker timed out')), 10_000);
          });
        } finally {
          w.terminate();
          URL.revokeObjectURL(url);
        }
      });
      await page.waitForTimeout(300);
      const stepCsp = cspEvents.splice(before.csp);
      const stepConsole = consoleErrors.splice(before.console);
      const stepExternal = external.splice(before.external);
      assert(r.fetched !== 'ok', `blob worker fetched another origin: ${JSON.stringify(r)}`);
      assert(r.violations.length === 1 && r.violations[0].directive === 'connect-src' && r.violations[0].blocked.startsWith('https://example.invalid'),
        `expected exactly one connect-src violation for example.invalid inside the worker, got ${JSON.stringify(r.violations)}`);
      assert(stepCsp.every((v) => v.blocked.startsWith('https://example.invalid')), `unexpected document CSP events: ${JSON.stringify(stepCsp)}`);
      assert(stepConsole.every((m) => /example\.invalid/.test(m)), `unexpected console errors: ${stepConsole.join('\n')}`);
      assert(stepExternal.every((u) => u.startsWith('https://example.invalid')), `unexpected external requests: ${stepExternal.join('\n')}`);
      notes.push(`blob-worker CSP probe: fetch → ${r.fetched}; worker violation ${JSON.stringify(r.violations[0])}`);
    });

    await step('no external requests', async () => {
      assert(external.length === 0, `requests outside ${BASE}:\n${external.join('\n')}`);
    });
    await step('no console errors', async () => {
      assert(consoleErrors.length === 0, consoleErrors.join('\n'));
    });
    await step('no CSP violations', async () => {
      assert(cspEvents.length === 0, JSON.stringify(cspEvents, null, 2));
    });
  } finally {
    await browser?.close().catch(() => {});
    stopPreview(preview);
  }
}

main().then(
  () => {
    for (const n of notes) console.log(`  note: ${n}`);
    console.log(`\n${results.length} passed · screenshots in ${OUT}`);
  },
  (e) => {
    for (const n of notes) console.log(`  note: ${n}`);
    if (!results.some((r) => !r.ok)) console.error(e);
    if (external.length) console.log(`external requests:\n  ${external.join('\n  ')}`);
    if (consoleErrors.length) console.log(`console errors:\n  ${consoleErrors.join('\n  ')}`);
    console.log(`\nFAILED (${results.filter((r) => r.ok).length}/${results.length} steps passed)`);
    process.exit(1);
  },
);
