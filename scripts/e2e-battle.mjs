import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://localhost:4173/';
const PAGE = `${BASE}battle.html`;
const OUT = resolve(ROOT, 'test-results/e2e');
const FIXTURE_A = resolve(ROOT, 'tests/fixtures/battle-ts');
const FIXTURE_B = resolve(ROOT, 'tests/fixtures/battle-php');
const CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'";

let preview = null;
const results = [];
const external = [];
const consoleErrors = [];
const cspEvents = [];
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
  preview = p;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (p.exitCode !== null) throw new Error(`vite preview exited early:\n${log}`);
    try {
      if ((await fetch(PAGE)).ok) return p;
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

function initScript() {
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__reportCsp?.({ directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber });
  });
}

// hard upper bound so a hung browser or server can never stall the run
const watchdog = setTimeout(() => {
  console.error('e2e watchdog: exceeded 4 minutes, aborting');
  stopPreview(preview);
  process.exit(2);
}, 4 * 60_000);
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

  await step('dist/battle.html carries the CSP meta', async () => {
    const html = await readFile(resolve(ROOT, 'dist/battle.html'), 'utf8');
    assert(html.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`), 'CSP meta missing from dist/battle.html');
    assert(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'dist/battle.html references an external URL');
  });

  await startPreview();
  let browser = null;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.exposeBinding('__reportCsp', (_source, v) => cspEvents.push(v));
    await context.addInitScript(initScript);
    const page = await context.newPage();
    page.on('request', (r) => {
      // blob: URLs of this origin are in-memory (the battle worker wrapper), not network requests
      if (!r.url().startsWith(BASE) && !r.url().startsWith(`blob:${new URL(BASE).origin}/`)) external.push(r.url());
    });
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`${m.text()} @ ${m.location().url}:${m.location().lineNumber}`);
    });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

    console.log('e2e');
    await step('select screen renders both empty cards', async () => {
      await page.goto(PAGE);
      await page.waitForSelector('text=코드 양이 아니라 품질로 싸워요');
      assert((await page.title()) === '레포 전쟁', `unexpected title "${await page.title()}"`);
      for (const side of ['a', 'b']) assert((await page.locator(`[data-testid=folder-input-${side}]`).count()) === 1, `folder input ${side} missing`);
      assert((await page.locator('.rb-card[data-state=empty]').count()) === 2, 'expected two empty cards');
      assert(await page.locator('button:has-text("작전 브리핑 보기")').isDisabled(), 'briefing button should start disabled');
    });

    await step('Pretendard is loaded and used', async () => {
      const r = await page.evaluate(async () => {
        await document.fonts.ready;
        const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Pretendard Variable');
        return {
          statuses: faces.map((f) => f.status),
          check: document.fonts.check('700 22px "Pretendard Variable"', '레포'),
          family: getComputedStyle(document.querySelector('.rb-select-lead')).fontFamily,
        };
      });
      assert(r.statuses.includes('loaded'), `Pretendard face not loaded: ${JSON.stringify(r)}`);
      assert(r.check, `document.fonts.check failed: ${JSON.stringify(r)}`);
      assert(r.family.startsWith('"Pretendard Variable"'), `lead text uses another font: ${r.family}`);
      notes.push(`font: ${r.family.split(',')[0]} (${r.statuses.join(', ')})`);
    });

    await step('screenshot the empty select screen', async () => {
      // let the 240ms enter animation finish before capturing
      await page.waitForTimeout(600);
      await page.screenshot({ path: resolve(OUT, 'battle-select.png') });
    });

    await step('narrow window keeps both cards without horizontal scroll', async () => {
      for (const width of [1280, 1024]) {
        await page.setViewportSize({ width, height: 800 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert(overflow <= 0, `horizontal overflow of ${overflow}px at ${width}px`);
      }
      await page.screenshot({ path: resolve(OUT, 'battle-select-1024.png') });
      await page.setViewportSize({ width: 1440, height: 900 });
    });

    await step('picking two real folders measures both in the worker', async () => {
      await page.setInputFiles('[data-testid=folder-input-a]', FIXTURE_A);
      await page.setInputFiles('[data-testid=folder-input-b]', FIXTURE_B);
      await page.waitForSelector('.rb-card-a[data-state=ready]', { timeout: 60_000 });
      await page.waitForSelector('.rb-card-b[data-state=ready]', { timeout: 60_000 });
      const a = await page.locator('.rb-card-a .rb-card-sub').first().textContent();
      const b = await page.locator('.rb-card-b .rb-card-sub').first().textContent();
      assert(a.startsWith('TypeScript · 코드'), `unexpected A summary "${a}"`);
      assert(b.startsWith('PHP · 코드'), `unexpected B summary "${b}"`);
      assert(!(await page.locator('button:has-text("작전 브리핑 보기")').isDisabled()), 'briefing button should be enabled');
      await page.waitForTimeout(300);
      await page.screenshot({ path: resolve(OUT, 'battle-select-ready.png') });
    });

    await step('the briefing runs the prediction in the worker and shows the counts', async () => {
      const t = Date.now();
      await page.click('button:has-text("작전 브리핑 보기")');
      await page.waitForSelector('.rb-brief-counts[data-state=done]', { timeout: 60_000 });
      const ms = Date.now() - t;
      notes.push(`prediction (100 runs, battle-ts vs battle-php): ${ms} ms from click to counts`);
      const nums = await page.locator('.rb-brief-num').allTextContents();
      assert(nums.length === 2 && nums.every((n) => /^\d+번$/.test(n)), `unexpected counts ${JSON.stringify(nums)}`);
      const sum = nums.map((n) => parseInt(n, 10)).reduce((x, y) => x + y, 0);
      assert(sum <= 100, `wins add up to ${sum}`);
      assert((await page.locator('.rb-brief-row').count()) === 10, 'expected 5 metric rows per side');
      assert((await page.locator('text=언어 차이 오차 가능').count()) === 2, 'language caveat missing');
      assert((await page.locator('.rb-brief-vanguard li').count()) === 3, 'expected 3 vanguard pairs');
      assert(!(await page.locator('button:has-text("전투 시작하기")').isDisabled()), 'start should be enabled');
      await page.waitForTimeout(600);
      await page.screenshot({ path: resolve(OUT, 'battle-briefing.png') });
      const overflow = await page.evaluate(() => [document.documentElement.scrollWidth - document.documentElement.clientWidth, document.documentElement.scrollHeight - document.documentElement.clientHeight]);
      notes.push(`briefing overflow at 1440×900: x ${overflow[0]}px, y ${overflow[1]}px`);
      assert(overflow[0] <= 0, `horizontal overflow of ${overflow[0]}px`);
    });

    await step('measurement settings open, other outcome bumps the match, start reaches the battle', async () => {
      await page.click('.rb-brief-side-a .rb-brief-config-toggle');
      await page.waitForSelector('.rb-brief-side-a .rb-brief-config');
      await page.waitForTimeout(400);
      await page.screenshot({ path: resolve(OUT, 'battle-briefing-config.png') });
      await page.click('.rb-brief-side-a .rb-brief-config button:has-text("닫기")');
      await page.click('button:has-text("다른 전개 보기")');
      await page.waitForSelector('text=대결 #2');
      await page.click('button:has-text("전투 시작하기")');
      await page.waitForSelector('h1:has-text("전투")');
      assert((await page.locator('text=대결 #2').count()) === 1, 'battle placeholder should show match 2');
      await page.click('button:has-text("브리핑으로")');
      await page.waitForSelector('.rb-brief-counts[data-state=done]', { timeout: 2_000 });
    });

    await step('narrow window keeps the briefing without horizontal scroll', async () => {
      for (const width of [1280, 1024]) {
        await page.setViewportSize({ width, height: 800 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert(overflow <= 0, `horizontal overflow of ${overflow}px at ${width}px`);
      }
      await page.screenshot({ path: resolve(OUT, 'battle-briefing-1024.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
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
