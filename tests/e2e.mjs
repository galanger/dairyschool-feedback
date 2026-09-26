// End-to-end checks of the prototype in real Chrome with phone emulation.
// Run: node tests/e2e.mjs   (needs the local server: npm run serve)
import { devices } from 'playwright-core';
import { launch, adapt, ENGINE, isChromium, viewUrl } from './engine.mjs';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const OUT = 'tests/output';
const AXE = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const results = [];
const browser = await launch();

async function newPage(device, extra = {}) {
  // Tests inject axe-core inline, which the page's CSP (correctly) blocks, so bypass it here.
  const ctx = await browser.newContext(adapt({ ...device, ...extra, bypassCSP: true }));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  // Every screenshot is a checkpoint: no leaked "false"/"undefined"/"NaN" text and no script errors.
  const shoot = page.screenshot.bind(page);
  page.screenshot = async (opts) => {
    const junk = await page.evaluate(() => (document.body.innerText.match(/\b(false|undefined|null|NaN)\b|\[object Object\]/g) || []));
    assert.deepEqual(junk, [], `junk text on screen before ${opts?.path}`);
    assert.deepEqual(page.errors, [], `script errors before ${opts?.path}`);
    return shoot(opts);
  };
  return { ctx, page };
}
const settle = (page) => page.waitForTimeout(350);


class Skip extends Error {}
const LIVE = !!process.env.LIVE; // the public site has no private 2023 data
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) {
    if (e instanceof Skip) results.push(['SKIP', name, e.message]);
    else results.push(['FAIL', name, e.message.split('\n').slice(0, 3).join(' | ')]);
  }
}
async function axe(page, label) {
  await page.waitForTimeout(400); // let transitions finish so contrast is measured on final colours
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => {
    const res = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') }));
  });
  const serious = r.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  if (r.length) console.log(`  axe ${label}:`, JSON.stringify(r));
  assert.equal(serious.length, 0, `${label}: ${serious.map((v) => v.id).join(', ')}`);
}
async function noHorizontalScroll(page, label) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, `${label}: page scrolls sideways by ${over}px`);
}
async function rateAll(page, v = 6, comment = 'Добре, дякуємо.') {
  const cards = page.locator('.item');
  for (let i = 0; i < await cards.count(); i++) {
    const c = cards.nth(i);
    if (!(await c.evaluate((el) => el.classList.contains('answered')))) await c.locator(`.scale label:nth-child(${v})`).click();
    if (await c.evaluate((el) => el.classList.contains('is-na'))) continue;
    const ta = c.locator('textarea');
    if (!(await ta.inputValue())) await ta.fill(comment); // every rated item needs a comment
  }
}
// The two closing questions are required too.
async function fillOpen(page) {
  for (const id of ['#o-q1', '#o-q2']) { const ta = page.locator(id); if (await ta.count() && !(await ta.inputValue())) await ta.fill('Дякуємо за семінар.'); }
}
async function arm(page) { await fillOpen(page); await page.locator('.summary').scrollIntoViewIfNeeded(); await page.waitForSelector('#send'); }

// ---------- 1. full participant flow on a small Android ----------
const small = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: devices['Galaxy S9+'].userAgent };
{
  const { ctx, page } = await newPage(small);
  await step('welcome opens in Ukrainian by default', async () => {
    await page.goto(BASE);
    await page.waitForSelector('.hero h1'); await settle(page);
    assert.equal(await page.getAttribute('html', 'lang'), 'uk');
    if (!process.env.BUNDLE) {
      const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
      assert.match(csp, /script-src 'self'/);
    }
    assert.match(await page.textContent('.bar'), /Почати/);
    await page.screenshot({ path: `${OUT}/01-welcome-360.png` });
    await noHorizontalScroll(page, 'welcome');
    await axe(page, 'welcome');
  });
  await step('language switch changes everything and is remembered', async () => {
    await page.click('.lang button:has-text("EN")'); await settle(page);
    assert.match(await page.textContent('.bar'), /Start/);
    await page.reload(); await page.waitForSelector('.hero h1');
    assert.match(await page.textContent('.bar'), /Start/);
    await page.click('.lang button:has-text("УКР")'); await settle(page);
  });
  await step('name picker: sorted by surname, continue enabled after choosing', async () => {
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.names'); await settle(page);
    const first = await page.locator('.name-main').first().textContent();
    assert.match(first, /^Бондаренко/);
    assert.equal(await page.isDisabled('.bar-inner .btn-primary'), true);
    await page.screenshot({ path: `${OUT}/02-names-360.png` });
    await page.locator('.name-opt', { hasText: 'Мельник' }).click();
    assert.match(await page.textContent('.bar-inner .btn-primary'), /Продовжити як Олександр Мельник/);
    await axe(page, 'names');
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item'); await settle(page);
  });
  await step('section 1: rating, didn’t-take-part, comment; incomplete items block Next', async () => {
    await page.screenshot({ path: `${OUT}/03-section-360.png` });
    await noHorizontalScroll(page, 'section');
    const first = page.locator('.item').first();
    await first.locator('.scale label:nth-child(6)').click();
    assert.ok(await first.evaluate((el) => el.classList.contains('answered')));
    await first.locator('textarea').fill('=1+1 10/10 - дуже цікаво');
    // "for the ladies" item: didn't take part
    const ladies = page.locator('.item', { hasText: 'для дам' });
    await ladies.locator('button:has-text("Не брали участі")').click();
    assert.ok(await ladies.evaluate((el) => el.classList.contains('is-na')));
    // a rating without a comment
    await page.locator('.item').nth(1).locator('.scale label:nth-child(5)').click();
    await page.screenshot({ path: `${OUT}/04-section-answered-360.png`, fullPage: true });
    // items 3..5 blank: Next is refused with a clear note, no "continue anyway"; item 2 (rated, no comment) is fine
    await page.click('.bar-inner .btn-primary');
    await page.waitForSelector('.soft');
    assert.match(await page.textContent('.soft'), /^3 пункти без оцінки\. /);
    assert.ok(!/коментар/.test(await page.textContent('.soft')), 'comments on items are not required');
    assert.equal(await page.locator('.soft button').count(), 1, 'only "Show which"');
    await page.screenshot({ path: `${OUT}/05-soft-prompt-360.png` });
    await page.click('.soft button:has-text("Показати")');
    await settle(page);
    assert.equal(await page.locator('.item.flash').count(), 3);
    assert.match(await page.textContent('.progress-meta'), /Крок 1 з 5/, 'still on page 1');
    // rating a flagged item clears its flag
    await page.locator('.item').nth(2).locator('.scale label:nth-child(6)').click();
    assert.equal(await page.locator('.item.flash').count(), 2);
    await axe(page, 'section');
  });
  await step('answer the rest, reload mid-way resumes the draft', async () => {
    await rateAll(page, 5);
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.sec-head h1'); await settle(page);
    assert.match(await page.textContent('.progress-meta'), /Крок 2 з 5/);
    await page.reload(); await page.waitForSelector('.notice');
    assert.match(await page.textContent('.notice'), /Олександр Мельник/);
    await page.screenshot({ path: `${OUT}/06-resume-360.png` });
    await page.click('.notice .btn-primary'); await page.waitForSelector('.item');
    assert.match(await page.textContent('.progress-meta'), /Крок 2 з 5/);
    // the comment from section 1 survived
    await page.click('.bar-inner .btn-secondary'); await page.waitForSelector('.item');
    assert.equal(await page.locator('#c-i01').inputValue(), '=1+1 10/10 - дуже цікаво');
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item');
  });
  await step('sections 2–4 then the last page', async () => {
    for (let k = 0; k < 3; k++) {
      await rateAll(page, 7);
      await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item'); await settle(page);
    }
    assert.match(await page.textContent('.sec-head h1'), /Останні запитання/);
    assert.equal(await page.locator('.item .linkbtn.quiet').count(), 0, 'no "didn\'t take part" on overall questions');
    assert.match(await page.locator('.item').first().textContent(), /Дуже рекомендували\sб/);
    assert.equal(await page.locator('.scale-hint').count(), 0, 'no 1–7 hint above differently-labelled questions');
    assert.match(await page.textContent('.bar-inner .btn-primary'), /Далі/, 'before the open questions are seen, the button says Next');
    const before = await page.textContent('.summary .big');
    await page.locator('.item').first().locator('.scale label:nth-child(7)').click();
    await settle(page);
    assert.notEqual(await page.textContent('.summary .big'), before, 'summary updates live');
    await page.screenshot({ path: `${OUT}/07-last-360.png`, fullPage: true });
  });
  await step('network failure keeps answers and retry sends once', async () => {
    await rateAll(page, 6);
    await page.fill('#o-q1', 'Лекції та ферми');
    await page.evaluate(() => { window.__dsfMock.failNext = 1; });
    await arm(page); await page.click('#send');
    await page.waitForSelector('.alert-error');
    assert.match(await page.textContent('.alert-error'), /Не вдалося надіслати/);
    await page.screenshot({ path: `${OUT}/08-send-failed-360.png` });
    await page.click('.alert-error button');
    await page.waitForSelector('.badge-ok'); await settle(page);
    // the thank-you screen asks for a Google review: one tap, opens in a new tab, https only
    const review = page.locator('.review a');
    assert.equal(await review.count(), 1, 'Google review ask on the thank-you screen');
    assert.equal(await review.getAttribute('target'), '_blank');
    assert.match(await review.getAttribute('href'), /^https:\/\//);
    assert.equal(await page.locator('main a').count(), 1, 'the review link is the only link a participant ever sees');
    assert.match(await page.textContent('main h1'), /Дякуємо/);
    await page.screenshot({ path: `${OUT}/09-thanks-360.png` });
    await axe(page, 'thanks');
  });
  await step('reopening on the same phone shows "already answered"', async () => {
    await page.reload(); await page.waitForSelector('.badge-ok');
    assert.match(await page.textContent('main h1'), /Ви вже відповіли/);
  });
  await step('another person on the same phone cannot reuse a taken name', async () => {
    await page.click('main .btn-secondary'); await page.waitForSelector('.hero');
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.names'); await settle(page);
    const taken = page.locator('.name-opt', { hasText: 'Мельник' });
    assert.ok(await taken.evaluate((el) => el.classList.contains('is-done')));
    assert.equal(await taken.locator('input').isDisabled(), true);
    await page.screenshot({ path: `${OUT}/10-names-taken-360.png` });
  });
  await ctx.close();
}

// ---------- 2. race: two phones pick the same name ----------
{
  const a = await newPage(devices['iPhone 13']);
  const b = await newPage(devices['iPhone 13']);
  // share one mock backend by sharing storage state is not possible across contexts,
  // so simulate the race inside one context with two tabs.
  const page1 = a.page;
  const page2 = await a.ctx.newPage();
  page2.errors = []; page2.on('pageerror', (e) => page2.errors.push(String(e)));
  await step('two phones, same name: the second send is refused politely', async () => {
    for (const p of [page1, page2]) {
      // separate phones: each starts without the other's draft
      await p.goto(BASE); await p.evaluate(() => { localStorage.removeItem('dsf:demo:draft'); localStorage.removeItem('dsf:demo:done'); });
      await p.reload(); await p.waitForSelector('.hero');
      await p.click('.bar-inner .btn-primary'); await p.waitForSelector('.names');
      await p.locator('.name-opt', { hasText: 'Шевчук' }).click();
      await p.click('.bar-inner .btn-primary'); await p.waitForSelector('.item');
    }
    // both fill every page (everything is required) and reach the last page
    for (const p of [page1, page2]) {
      for (let k = 0; k < 4; k++) {
        await rateAll(p, 6);
        await p.click('.bar-inner .btn-primary'); await p.waitForSelector('.item'); await p.waitForTimeout(250);
      }
      await rateAll(p, 6);
    }
    await arm(page1); await page1.click('#send'); await page1.waitForSelector('.badge-ok');
    await arm(page2); await page2.click('#send'); await page2.waitForSelector('.alert-error');
    assert.match(await page2.textContent('.alert-error'), /вже надіслано/);
    await page2.screenshot({ path: `${OUT}/11-name-taken-iphone.png` });
    await page2.click('.alert-error button:has-text("Це не моє ім’я")'); await page2.waitForSelector('.names');
    await page2.waitForTimeout(600);
    assert.ok(await page2.locator('.name-opt', { hasText: 'Шевчук' }).evaluate((el) => el.classList.contains('is-done')));
  });
  await a.ctx.close(); await b.ctx.close();
}

// ---------- 3. guide view ----------
{
  const { ctx, page } = await newPage(devices['iPhone 13']);
  await step('guide view shows QR, progress and missing names (no scores)', async () => {
    await page.goto(viewUrl(BASE, 'guide', { key: 'demo' }));
    await page.waitForSelector('.qr-box svg'); await settle(page);
    assert.match(await page.textContent('.big-count'), /\/ 12/);
    const html = await page.content();
    assert.ok(!/Score|Оцінка|%/.test(await page.textContent('main')), 'guide must not show scores');
    await page.screenshot({ path: `${OUT}/12-guide-iphone.png`, fullPage: true });
    await page.click('button:has-text("Full-screen QR code")');
    await page.waitForSelector('.qr-full'); await settle(page);
    await page.screenshot({ path: `${OUT}/13-guide-bigqr.png` });
    await page.keyboard.press('Escape');
    await axe(page, 'guide');
  });
  await ctx.close();
}

// ---------- 4. results ----------
{
  const { ctx, page } = await newPage({ viewport: { width: 1280, height: 900 } });
  await step('results: passcode gate, locked while open, then close', async () => {
    await page.goto(viewUrl(BASE, 'staff'));
    await page.waitForSelector('#pass');
    await page.screenshot({ path: `${OUT}/14-results-gate.png` });
    await page.fill('#pass', 'demo'); await page.click('button[type=submit]');
    await page.waitForSelector('.rs-head h1'); await settle(page);
    assert.match(await page.textContent('main'), /still open/);
    await page.screenshot({ path: `${OUT}/15-results-open.png` });
    await page.click('button:has-text("Close survey…")');
    await page.click('.btn-danger');
    await page.waitForSelector('text=No answers were received');
  });
  await step('results: the 2023 paper forms reproduce the 2023 sheet in the dashboard', async () => {
    if (LIVE) throw new Skip('needs the private 2023 data');
    await page.selectOption('.rs-head select', 'bovicura-2023');
    await page.waitForSelector('.kpis'); await settle(page);
    const hero = await page.textContent('.kpi.hero');
    assert.match(hero, /6\.4/); assert.match(hero, /91%/);
    const row5 = page.locator('tr.row', { hasText: 'Family dairy farm in Golan Heights' });
    assert.match(await row5.textContent(), /4\.1.*59%/);
    assert.equal(await row5.locator('td.hl').count(), 2, 'row 5 highlighted like the paper sheet');
    const row21 = page.locator('tr.row', { hasText: 'Limousine' });
    assert.match(await row21.textContent(), /6\.95.*99%/);
    await page.screenshot({ path: `${OUT}/16-results-2023.png`, fullPage: true });
    await row5.locator('.rowbtn').click(); await settle(page);
    await page.screenshot({ path: `${OUT}/16b-results-row-open.png` });
    await axe(page, 'results');
  });
  await step('results: sheet, categories and comments tabs render', async () => {
    if (LIVE) throw new Skip('needs the private 2023 data');
    for (const tab of ['Areas', 'Comments', 'Client sheet', 'Data']) {
      await page.click(`.tabs button:has-text("${tab}")`); await settle(page);
      await page.screenshot({ path: `${OUT}/17-tab-${tab.split(' ')[0].toLowerCase()}.png`, fullPage: true });
    }
  });
  await ctx.close();
}

// ---------- 5. layout sweep: sizes, dark mode, large text ----------
for (const [label, opts] of [
  ['320', { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ['iphone-dark', { ...devices['iPhone 13'], colorScheme: 'dark' }],
  ['ipad', { ...devices['iPad Mini'] }],
]) {
  const { ctx, page } = await newPage(opts);
  await step(`layout ${label}: no sideways scroll, readable`, async () => {
    await page.goto(BASE); await page.waitForSelector('.hero h1'); await settle(page);
    await noHorizontalScroll(page, `${label} welcome`);
    await page.screenshot({ path: `${OUT}/20-${label}-welcome.png` });
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.names');
    await page.locator('.name-opt:not(.is-done)').first().click();
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item'); await settle(page);
    await page.locator('.item').first().locator('.scale label:nth-child(7)').click();
    await settle(page);
    await noHorizontalScroll(page, `${label} section`);
    await page.screenshot({ path: `${OUT}/21-${label}-section.png` });
    if (label === 'iphone-dark') await axe(page, 'dark section');
  });
  await ctx.close();
}
{
  const { ctx, page } = await newPage(small);
  await step('narrowest phone (280px, Galaxy Fold cover) keeps the rating row usable', async () => {
    await page.setViewportSize({ width: 280, height: 653 });
    await page.goto(BASE); await page.waitForSelector('.hero h1'); await settle(page);
    await noHorizontalScroll(page, '280 welcome');
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.names');
    await page.locator('.name-opt:not(.is-done)').first().click();
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item'); await settle(page);
    await noHorizontalScroll(page, '280 section');
    const w = await page.locator('.scale label').first().evaluate((el) => el.getBoundingClientRect().width);
    assert.ok(w >= 26, `rating buttons too narrow: ${w}px`);
    await page.screenshot({ path: `${OUT}/22-280px.png` });
  });
  await ctx.close();
}

await browser.close();
const width = Math.max(...results.map((r) => r[1].length));
for (const [s, n, m] of results) console.log(`${s === 'PASS' ? '✔' : s === 'SKIP' ? '–' : '✘'} ${n.padEnd(width)} ${m || ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
const skipped = results.filter((r) => r[0] === 'SKIP').length;
console.log(`\n[${ENGINE}] ${results.length - failed - skipped} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);
