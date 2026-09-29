import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://localhost:4173/';
const OUT = resolve(ROOT, 'test-results/e2e');
const REACT = resolve(ROOT, 'tests/fixtures/react-mini');
const LARAVEL = resolve(ROOT, 'tests/fixtures/laravel-mini');

const results = [];
const external = [];
const consoleErrors = [];
const notes = [];

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

const shot = (page, name) => page.screenshot({ path: resolve(OUT, name) });

/** Records loading-screen sightings and CSP violations on window, for every document load. */
function initScript() {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__csp.push({ directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber });
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

async function cspViolations(page) {
  return page.evaluate(() => window.__csp);
}

async function openFolder(page, dir, loadingShot) {
  await page.evaluate(() => (window.__loading = { seen: false, reading: false }));
  const loading = loadingShot
    ? page.waitForSelector('.cc-load', { timeout: 30_000 }).then(() => shot(page, loadingShot)).then(() => true, () => false)
    : Promise.resolve(false);
  await page.setInputFiles('[data-testid=folder-input]', dir);
  await waitForCity(page);
  return { captured: await loading, ...(await page.evaluate(() => window.__loading)) };
}

let preview = null;
// hard upper bound so a hung browser or server can never stall the run
const watchdog = setTimeout(() => {
  console.error('e2e watchdog: exceeded 8 minutes, aborting');
  stopPreview(preview);
  process.exit(2);
}, 8 * 60_000);
watchdog.unref();

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log('build');
  await run('npm', ['run', 'build']);
  preview = await startPreview();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(initScript);
    const page = await context.newPage();
    page.on('request', (r) => {
      if (!r.url().startsWith(BASE)) external.push(r.url());
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
      const brand = await page.locator('.ca-shell-brand strong').textContent();
      assert(brand === 'react-mini', `unexpected repo name "${brand}"`);
      await shot(page, 'city.png');
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

    await step('graph tab renders', async () => {
      await page.click('.ca-shell [role=tab]:has-text("그래프")');
      await page.waitForSelector('.ca-shell-mount .cg-canvas canvas', { timeout: 30_000 });
      await page.waitForTimeout(3000);
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

    await step('no external requests', async () => {
      assert(external.length === 0, `requests outside ${BASE}:\n${external.join('\n')}`);
    });
    await step('no console errors', async () => {
      assert(consoleErrors.length === 0, consoleErrors.join('\n'));
    });
    await step('no CSP violations', async () => {
      const v = await cspViolations(page);
      assert(v.length === 0, JSON.stringify(v, null, 2));
    });
  } finally {
    await browser.close();
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
