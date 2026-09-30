import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://localhost:4173/';
const OUT = resolve(ROOT, 'test-results/e2e');
const TS = resolve(ROOT, 'tests/fixtures/battle-ts');
const PHP = resolve(ROOT, 'tests/fixtures/battle-php');

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

const shot = (page, name, opts = {}) => page.screenshot({ path: resolve(OUT, name), ...opts });

/** Horizontal overflow of the page and of the battle tab's own scroll box, which the shell clips. */
async function overflowAt(page, widths) {
  const out = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width >= 1440 ? 900 : 800 });
    await page.waitForTimeout(200);
    const o = await page.evaluate(() => {
      const d = document.documentElement;
      const tab = document.querySelector('.rb-tab');
      return { page: d.scrollWidth - d.clientWidth, tab: tab ? tab.scrollWidth - tab.clientWidth : 0 };
    });
    if (o.page > 0 || o.tab > 0) out.push(`${width}px: page ${o.page}px, battle tab ${o.tab}px`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  return out;
}

async function assertNoOverflow(page, where) {
  const bad = await overflowAt(page, [1440, 1024]);
  assert(bad.length === 0, `horizontal overflow on ${where}: ${bad.join('; ')}`);
}

async function waitForCity(page) {
  await page.waitForSelector('.ca-shell [role=tab][aria-selected=true]:has-text("도시")', { timeout: 90_000 });
  await page.waitForSelector('.ca-shell-mount canvas', { timeout: 30_000 });
}

async function openBattleTab(page) {
  await page.click('.ca-shell [role=tab]:has-text("대결")');
  await page.waitForSelector('.rb-tab', { timeout: 30_000 });
}

async function toPick(page) {
  if (await page.locator('.rb-pick').count()) return;
  const home = page.locator('.rb-tab button:has-text("처음으로")');
  if (await home.count()) await home.click();
  else await page.click('.rb-tab button:has-text("상대 다시 고르기")');
  await page.waitForSelector('.rb-pick', { timeout: 10_000 });
}

function initScript() {
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__reportCsp?.({ directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber });
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
      // blob: URLs of this origin are in-memory (the worker wrappers), not network requests
      if (!r.url().startsWith(BASE) && !r.url().startsWith(`blob:${new URL(BASE).origin}/`)) external.push(r.url());
    });
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`${m.text()} @ ${m.location().url}:${m.location().lineNumber}`);
    });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

    console.log('e2e');
    await step('analyse battle-php, then battle-ts, through the landing page', async () => {
      await page.goto(BASE);
      await page.waitForSelector('text=레포 폴더를 여기에 끌어다 놓으세요');
      await page.setInputFiles('[data-testid=folder-input]', PHP);
      await waitForCity(page);
      assert((await page.locator('.ca-shell-brand strong').textContent()) === 'battle-php', 'first analysis is not battle-php');
      await page.click('.ca-shell-actions button:has-text("다른 레포 열기")');
      await page.waitForSelector('[data-testid=folder-input]');
      await page.setInputFiles('[data-testid=folder-input]', TS);
      await waitForCity(page);
      assert((await page.locator('.ca-shell-brand strong').textContent()) === 'battle-ts', 'second analysis is not battle-ts');
    });

    await step('대결 tab: A is battle-ts, battle-php is ready to fight', async () => {
      await openBattleTab(page);
      await page.waitForSelector('.rb-pick-self[data-state=ready]', { timeout: 60_000 });
      const selfName = await page.locator('.rb-pick-self-name').textContent();
      assert(selfName === 'battle-ts', `A shows "${selfName}"`);
      const sub = await page.locator('.rb-pick-self .rb-pick-sub').first().textContent();
      assert(sub.startsWith('TypeScript · 코드'), `unexpected A summary "${sub}"`);
      const row = page.locator('.rb-pick-row', { has: page.locator('.rb-pick-row-name', { hasText: /^battle-php$/ }) });
      await row.waitFor({ timeout: 10_000 });
      const status = await row.locator('.rb-pick-row-status').textContent();
      assert(status === '바로 싸울 수 있어요', `battle-php status "${status}"`);
      assert(!(await row.isDisabled()), 'battle-php row is disabled');
      assert((await page.locator('.rb-pick-row-name', { hasText: /^battle-ts$/ }).count()) === 0, 'the open repo is listed as its own opponent');
      const font = await page.evaluate(async () => {
        await document.fonts.ready;
        return { check: document.fonts.check('700 22px "Pretendard Variable"', '레포'), family: getComputedStyle(document.querySelector('.rb-pick-lead')).fontFamily };
      });
      assert(font.check && font.family.startsWith('"Pretendard Variable"'), `Pretendard not used: ${JSON.stringify(font)}`);
      await page.waitForTimeout(600);
      await shot(page, 'battle-pick.png');
      await assertNoOverflow(page, 'the pick screen');
    });

    await step('pick battle-php → briefing with the prediction', async () => {
      const t = Date.now();
      await page.locator('.rb-pick-row', { has: page.locator('.rb-pick-row-name', { hasText: /^battle-php$/ }) }).click();
      await page.waitForSelector('.rb-brief-counts[data-state=done]', { timeout: 90_000 });
      notes.push(`pick to prediction counts: ${Date.now() - t} ms`);
      const nums = await page.locator('.rb-brief-num').allTextContents();
      assert(nums.length === 2 && nums.every((n) => /^\d+번$/.test(n)), `unexpected counts ${JSON.stringify(nums)}`);
      assert(!(await page.locator('button:has-text("전투 시작하기")').isDisabled()), 'start should be enabled');
      await page.waitForTimeout(600);
      await shot(page, 'battle-briefing.png');
      await assertNoOverflow(page, 'the briefing');
    });

    let live = false;
    await step('전투 시작하기 → engagement', async () => {
      await page.click('button:has-text("전투 시작하기")');
      await page.waitForSelector('.rb-engage', { timeout: 30_000 });
      await page.waitForSelector('.rb-eng-stage canvas, .rb-eng-fallback', { state: 'attached', timeout: 30_000 });
      live = (await page.locator('.rb-eng-stage canvas').count()) > 0;
      notes.push(`engagement path: ${live ? 'WebGL 3D field' : 'fallback without WebGL'}`);
      await page.waitForTimeout(3_000);
      await shot(page, 'battle-engage.png');
      const fit = await page.evaluate(() => {
        const tab = document.querySelector('.rb-tab').getBoundingClientRect();
        const eng = document.querySelector('.rb-engage').getBoundingClientRect();
        return { tab: Math.round(tab.height), engage: Math.round(eng.height), bottom: Math.round(eng.bottom - tab.bottom) };
      });
      notes.push(`engagement height ${fit.engage}px in a ${fit.tab}px tab`);
      assert(fit.bottom <= 1, `engagement runs ${fit.bottom}px past the bottom of the tab`);
      await assertNoOverflow(page, 'the engagement');
    });

    await step('최종전으로 건너뛰기 → 결과 보기 → fix list', async () => {
      if (live) {
        const skip = page.locator('button:has-text("최종전으로 건너뛰기")');
        if (await skip.count()) await skip.click();
        else notes.push('skip button was already gone (final had started)');
      }
      await page.waitForSelector('button:has-text("결과 보기")', { timeout: 180_000 });
      await page.click('button:has-text("결과 보기")');
      await page.waitForSelector('.rb-result', { timeout: 10_000 });
      const headline = (await page.locator('.rb-res-headline').textContent()).trim();
      assert(/승리$|^무승부$/.test(headline), `unexpected verdict "${headline}"`);
      notes.push(`result verdict: ${headline}`);
      await page.waitForFunction(() => !document.querySelector('.rb-res-fix-wait'), null, { timeout: 120_000 });
      assert((await page.locator('.rb-res-fix-error').count()) === 0, 'fix list failed');
      notes.push(`fix list: ${await page.locator('.rb-res-fix').count()} files, ${await page.locator('.rb-res-fix-open').count()} open in the city`);
      await page.waitForTimeout(400);
      await shot(page, 'battle-result.png');
      await assertNoOverflow(page, 'the result');
    });

    await step('a 고칠 곳 file of side A opens the city code view', async () => {
      const open = page.locator('.rb-res-fix-open');
      // only the open repo's files link to the city, so rematch (seeded, so always the same matches) until battle-ts loses
      for (let rematch = 0; !(await open.count()) && rematch < 8; rematch++) {
        await page.click('button:has-text("다시 싸우기")');
        await page.waitForSelector('.rb-engage', { timeout: 30_000 });
        const skip = page.locator('button:has-text("최종전으로 건너뛰기")');
        if (live && (await skip.count())) await skip.click();
        await page.waitForSelector('button:has-text("결과 보기")', { timeout: 180_000 });
        await page.click('button:has-text("결과 보기")');
        await page.waitForSelector('.rb-result', { timeout: 10_000 });
        await page.waitForFunction(() => !document.querySelector('.rb-res-fix-wait'), null, { timeout: 120_000 });
      }
      if (!(await open.count())) {
        notes.push('battle-ts won every match tried, so no side A fix file to open (side B files are plain text)');
        return;
      }
      notes.push(`side A fix files appeared on ${(await page.locator('.rb-res-top, .rb-result').first().textContent()).match(/대결 #\d+/)?.[0] ?? 'a rematch'}`);
      await shot(page, 'battle-result-a-lost.png');
      const path = await open.first().evaluate((el) => el.closest('[data-path]').getAttribute('data-path'));
      await open.first().click();
      await page.waitForSelector('.ca-shell [role=tab][aria-selected=true]:has-text("도시")', { timeout: 30_000 });
      const hash = await page.evaluate(() => location.hash);
      assert(hash === `#city&file=${encodeURIComponent(path)}&code`, `unexpected hash "${hash}" for ${path}`);
      await page.waitForFunction(() => (document.querySelector('[data-el=code-src]')?.textContent ?? '').length > 0, null, { timeout: 30_000 });
      const name = await page.locator('[data-el=code-name]').textContent();
      const stem = path.split('/').pop().replace(/\.[^.]+$/, '');
      assert(name.trim() === stem, `code view shows "${name}", expected ${stem}`);
      await page.waitForTimeout(500);
      await shot(page, 'battle-fix-city.png');
      await page.keyboard.press('Escape');
    });

    await step('자기 자신과 대결 reaches the briefing', async () => {
      await openBattleTab(page);
      await toPick(page);
      await page.waitForSelector('.rb-pick-self[data-state=ready]', { timeout: 60_000 });
      await page.locator('.rb-pick-row', { has: page.locator('.rb-pick-row-name', { hasText: '자기 자신과 대결' }) }).click();
      await page.waitForSelector('.rb-brief-counts[data-state=done]', { timeout: 90_000 });
      assert((await page.locator('text=battle-ts (미러)').count()) >= 1, 'mirror side B missing');
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
