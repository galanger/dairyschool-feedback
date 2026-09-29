// Checks a deployed site: the three pages load without errors, carry no prototype bar and no
// links (participants see nothing but the questionnaire), and the staff page opens.
// Usage: BASE=… SEMINAR=sample PASSCODE=<staff passcode> node tests/live-check.mjs
// In prototype mode (no backend) the defaults work: SEMINAR=demo, results at demo-results, any passcode.
import { chromium, webkit, devices } from 'playwright-core';

const BASE = process.env.BASE || 'https://galanger.github.io/dairyschool-feedback/';
const SEM = process.env.SEMINAR || 'demo';
const RESULTS = process.env.RESULTS || (SEM === 'demo' ? 'demo-results' : SEM);
const PASS = process.env.PASSCODE || 'demo';
const KEY = process.env.GUIDEKEY || PASS; // the staff passcode opens the guide page too
const out = [];
let failed = 0;
const check = (ok, label) => { out.push(`${ok ? '✔' : '✘'} ${label}`); if (!ok) failed++; };

for (const [name, launch] of [['chrome', () => chromium.launch({ channel: 'chrome' })], ['webkit', () => webkit.launch()]]) {
  const browser = await launch();
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  page.on('requestfailed', (r) => errs.push('REQFAIL ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
  for (const [label, url, sel] of [['participant', `${BASE}?s=${SEM}`, 'main h1'], ['guide', `${BASE}guide.html?s=${SEM}#${KEY}`, '.big-count'], ['staff', `${BASE}staff.html?s=${RESULTS}`, '#pass']]) {
    await page.goto(url); await page.waitForSelector(sel, { timeout: 30000 }); await page.waitForTimeout(600);
    check(await page.locator('.demo-bar').count() === 0, `${name}: ${label} page has no prototype bar`);
    check(await page.locator('main a').count() === 0, `${name}: ${label} page has no links`);
  }
  await page.fill('#pass', PASS); await page.click('button[type=submit]');
  await page.waitForSelector('.kpis, .big-count', { timeout: 30000 }); // results, or progress while open await page.waitForTimeout(500);
  const closed = await page.locator('.kpis').count();
  check(true, `${name}: staff page opened (${closed ? 'results' : 'progress while open'})`);
  if (closed) {
    check(/responses of .* invited/.test(await page.textContent('.rs-head')), `${name}: results header`);
    await page.click('.tabs button:has-text("Client sheet")'); await page.waitForTimeout(500);
    check((await page.locator('.sheet tbody tr').count()) > 0, `${name}: client sheet rows`);
  }
  check(errs.length === 0, `${name}: no load errors${errs.length ? ` (${errs.join(' | ')})` : ''}`);
  await browser.close();
}
console.log(out.join('\n'));
console.log(`\n${out.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
