// Second e2e suite: phone Back button, keyboard-only use, blocked storage, slow/busy server,
// long name lists, draft preview, error screens, language switching, changing name at the end.
import { devices } from 'playwright-core';
import { launch, adapt, ENGINE, isChromium } from './engine.mjs';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const OUT = 'tests/output';
const results = [];
const browser = await launch();
const phone = devices['Pixel 7'];

async function newPage(extra = {}, init) {
  const ctx = await browser.newContext(adapt({ ...phone, ...extra, bypassCSP: true }));
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  return { ctx, page };
}
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); }
}
const settle = (p, ms = 350) => p.waitForTimeout(ms);


async function start(page, surname = 'Мельник') {
  await page.goto(BASE); await page.waitForSelector('.hero h1');
  await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.names');
  await page.locator('.name-opt', { hasText: surname }).click();
  await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item'); await settle(page);
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
async function toLast(page) {
  for (let k = 0; k < 4; k++) { await rateAll(page, 6); await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item'); await settle(page, 250); }
}
// Changes the in-browser demo backend's saved state, then reloads.
async function patchState(page, fn) {
  await page.evaluate((src) => {
    const st = JSON.parse(localStorage.getItem('dsf-demo-v1'));
    // eslint-disable-next-line no-new-func
    new Function('st', src)(st);
    localStorage.setItem('dsf-demo-v1', JSON.stringify(st));
  }, `(${fn})(st)`);
  await page.reload();
}

// 1. phone Back button
{
  const { ctx, page } = await newPage();
  await step('phone Back goes to the previous survey page, not out of the survey', async () => {
    await start(page);
    await rateAll(page, 5);
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item'); await settle(page);
    assert.match(await page.textContent('.progress-meta'), /Крок 2 з 5/);
    await page.goBack(); await settle(page);
    assert.match(await page.textContent('.progress-meta'), /Крок 1 з 5/, 'back → step 1');
    assert.ok(await page.locator('.item.answered').count() >= 5, 'answers kept');
    await page.goBack(); await settle(page);
    assert.ok(await page.locator('.names').count(), 'back → names');
    await page.goBack(); await settle(page);
    assert.ok(await page.locator('.hero').count(), 'back → welcome');
    assert.deepEqual(page.errors, []);
  });
  await ctx.close();
}

// 2. keyboard only
{
  const { ctx, page } = await newPage({ ...devices['Desktop Chrome'], viewport: { width: 1024, height: 800 } });
  await step('keyboard only: choose a name and rate with Tab, arrows and Space', async () => {
    await page.goto(BASE); await page.waitForSelector('.hero h1');
    await page.focus('.bar-inner .btn-primary'); await page.keyboard.press('Enter');
    await page.waitForSelector('.names'); await settle(page);
    await page.focus('.name-opt input'); await page.keyboard.press('ArrowDown'); // radio group: arrows move + select
    await settle(page, 200);
    const chosen = await page.locator('.name-opt.is-selected').count();
    assert.equal(chosen, 1, 'arrow key selects a name');
    await page.focus('.bar-inner .btn-primary'); await page.keyboard.press('Enter');
    await page.waitForSelector('.item'); await settle(page);
    const first = page.locator('.item').first();
    await first.locator('input[value="1"]').focus();
    for (let k = 0; k < 4; k++) await page.keyboard.press('ArrowRight');
    await settle(page, 200);
    assert.ok(await first.evaluate((el) => el.classList.contains('answered')), 'arrow keys rate the item');
    assert.equal(await first.locator('input:checked').getAttribute('value'), '5');
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement.nextElementSibling).outlineStyle);
    assert.notEqual(ring, 'none', 'focus ring visible on the rating');
    await page.screenshot({ path: `${OUT}/k-keyboard-focus.png` });
  });
  await ctx.close();
}

// 3. storage blocked (some in-app browsers)
{
  const block = () => {
    const deny = () => { throw new DOMException('blocked', 'SecurityError'); };
    Object.defineProperty(window, 'localStorage', { get: deny });
    Object.defineProperty(window, 'sessionStorage', { get: deny });
  };
  const { ctx, page } = await newPage({}, block);
  await step('storage blocked: the survey still works end to end', async () => {
    await start(page);
    assert.equal(await page.locator('.saved').count(), 0, 'no false "saved on this phone" claim');
    await toLast(page);
    await rateAll(page, 7);
    await arm(page); await page.click('#send'); await page.waitForSelector('.badge-ok');
    assert.match(await page.textContent('main h1'), /Дякуємо/);
    assert.deepEqual(page.errors, []);
  });
  await ctx.close();
}

// 4. slow and busy server
{
  const { ctx, page } = await newPage();
  await step('slow server: “still sending” appears, then thanks', async () => {
    await start(page, 'Бондаренко'); await toLast(page); await rateAll(page, 6);
    await page.evaluate(() => { window.__dsfMock.slowNext = 1; });
    await arm(page); await page.click('#send');
    await page.waitForSelector('text=Ще надсилаємо', { timeout: 9000 });
    await page.screenshot({ path: `${OUT}/k-slow.png` });
    await page.waitForSelector('.badge-ok', { timeout: 15000 });
  });
  await step('busy server: retried quietly with the same submission, counted once', async () => {
    await page.click('main .btn-secondary'); await page.waitForSelector('.hero');
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.names');
    await page.locator('.name-opt', { hasText: 'Гнатюк' }).click();
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item'); await settle(page);
    await toLast(page); await rateAll(page, 6);
    await page.evaluate(() => { window.__dsfMock.busyNext = 2; });
    await arm(page); await page.click('#send');
    await page.waitForSelector('.badge-ok', { timeout: 20000 });
    const n = await page.evaluate(() => JSON.parse(localStorage.getItem('dsf-demo-v1')).seminars.demo.responses.length);
    assert.equal(n, 2, 'two people, two responses');
  });
  await ctx.close();
}

// 5. long name list with search
{
  const { ctx, page } = await newPage();
  await step('60 names: search finds a person by Latin or Cyrillic letters', async () => {
    await page.goto(BASE); await page.waitForSelector('.hero');
    await patchState(page, (st) => {
      const base = st.seminars.demo.names;
      for (let i = 0; i < 48; i++) base.push({ id: `x${i}`, surname: `Testenko${i}`, given: 'Ivan', surnameCyr: `Тестенко${i}`, givenCyr: 'Іван' });
      base.push({ id: 'zv', surname: 'Viunenko', given: 'Oleksandr', surnameCyr: 'В’юненко', givenCyr: 'Олександр' });
    });
    await page.waitForSelector('.hero'); await page.click('.bar-inner .btn-primary'); await page.waitForSelector('#name-search');
    await page.fill('#name-search', 'вюненко');
    await settle(page, 150);
    assert.equal(await page.locator('.names li:not([hidden])').count(), 1, 'apostrophe-insensitive Cyrillic match');
    await page.fill('#name-search', 'VIUNE');
    assert.equal(await page.locator('.names li:not([hidden])').count(), 1, 'Latin match');
    await page.screenshot({ path: `${OUT}/k-search.png` });
    await page.fill('#name-search', 'qqqq');
    assert.ok(await page.isVisible('text=Нічого не знайдено'));
  });
  await ctx.close();
}

// 6. draft preview, closed survey, invalid link, offline load
{
  const { ctx, page } = await newPage();
  await step('draft preview: full survey, banner, nothing is sent', async () => {
    await page.goto(BASE); await page.waitForSelector('.hero');
    await patchState(page, (st) => { st.seminars.demo.status = 'draft'; });
    await page.waitForSelector('.preview-flag');
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.names');
    await page.locator('.name-opt', { hasText: 'Мороз' }).click();
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item');
    await toLast(page); await rateAll(page, 6);
    await arm(page); await page.click('#send'); await page.waitForSelector('text=nothing was sent');
    await page.screenshot({ path: `${OUT}/k-preview.png` });
    const n = await page.evaluate(() => JSON.parse(localStorage.getItem('dsf-demo-v1')).seminars.demo.responses.length);
    assert.equal(n, 0);
  });
  await step('closed survey shows a clear closed screen', async () => {
    await patchState(page, (st) => { st.seminars.demo.status = 'closed'; });
    await page.waitForSelector('text=Опитування закрито');
    await page.screenshot({ path: `${OUT}/k-closed.png` });
  });
  await step('invalid link explains what to do', async () => {
    await page.goto(`${BASE}?s=nope-nope`); await page.waitForSelector('text=Посилання недійсне');
    await page.screenshot({ path: `${OUT}/k-invalid.png` });
  });
  await ctx.close();
  const off = await newPage();
  await step('no connection on load: clear message and Try again works', async () => {
    await off.page.addInitScript(() => { window.__dsfMock = { failNext: 1, slowNext: 0, busyNext: 0 }; });
    await off.page.goto(BASE); await off.page.waitForSelector('text=Немає з’єднання');
    await off.page.screenshot({ path: `${OUT}/k-offline.png` });
    await off.page.click('main .btn-secondary'); await off.page.waitForSelector('.hero');
  });
  await off.ctx.close();
}

// 7. language switch mid-way, changing name at the end, comment length
{
  const { ctx, page } = await newPage();
  await step('switching language mid-section keeps answers and comments', async () => {
    await start(page, 'Ткачук');
    const first = page.locator('.item').first();
    await first.locator('.scale label:nth-child(4)').click();
    await first.locator('textarea').fill('Добре');
    await page.click('.lang button:has-text("EN")'); await settle(page);
    const f2 = page.locator('.item').first();
    assert.equal(await f2.locator('input:checked').getAttribute('value'), '4');
    assert.equal(await f2.locator('textarea').inputValue(), 'Добре');
    assert.match(await page.textContent('.progress-meta'), /Step 1 of 5/);
  });
  await step('comments are capped at 1,000 characters', async () => {
    const ta = page.locator('.item').first().locator('textarea');
    await ta.fill('x'.repeat(1200));
    assert.equal((await ta.inputValue()).length, 1000);
    await ta.fill('Good');
  });
  await step('changing the name on the last page keeps all answers', async () => {
    await toLast(page);
    await page.click('.as-line .linkbtn'); await page.waitForSelector('.names');
    await page.locator('.name-opt', { hasText: 'Savchenko' }).click();
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.summary');
    assert.match(await page.textContent('.as-line'), /Nataliia Savchenko/);
    assert.match(await page.textContent('.progress-meta'), /Step 5 of 5/);
    await rateAll(page, 6);
    await arm(page); await page.click('#send'); await page.waitForSelector('.badge-ok');
  });
  await ctx.close();
}

// 8. results on a phone: readable chart text
{
  const { ctx, page } = await newPage();
  await step('results on a phone: area chart labels stay readable (≥12px)', async () => {
    await page.goto(`${BASE}#results`); await page.waitForSelector('#pass');
    await page.fill('#pass', 'demo'); await page.click('button[type=submit]');
    await page.waitForSelector('.rs-head select');
    await page.selectOption('.rs-head select', 'bovicura-2023'); await page.waitForSelector('.kpis');
    await page.click('.tabs button:has-text("Areas")'); await settle(page);
    const h = await page.locator('.dotplot .name').first().evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(h >= 12, `label height ${h}px`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, `sideways scroll ${over}px`);
    await page.screenshot({ path: `${OUT}/k-results-phone-areas.png`, fullPage: true });
  });
  await ctx.close();
}

// 9. new behaviour from the UX review
{
  const { ctx, page } = await newPage();
  await step('start over asks before deleting saved answers', async () => {
    await start(page, 'Волошин');
    await page.locator('.item').first().locator('.scale label:nth-child(5)').click();
    await page.reload(); await page.waitForSelector('.notice');
    await page.click('.notice button:has-text("Почати заново")');
    await page.waitForSelector('text=Видалити ваші відповіді');
    await page.click('.notice button:has-text("Скасувати")');
    await page.waitForSelector('text=Продовжити з місця');
    await page.click('.notice .btn-primary'); await page.waitForSelector('.item'); await settle(page);
    assert.equal(await page.locator('.item').first().locator('input:checked').getAttribute('value'), '5', 'answer kept');
  });
  await step('undoing "didn’t take part" restores the earlier rating', async () => {
    const card = page.locator('.item').first();
    await card.locator('button:has-text("Не брали участі")').click();
    await card.locator('.na-state button').click();
    assert.equal(await card.locator('input:checked').getAttribute('value'), '5');
  });
  await step('last page: “Next” leads to the open questions, then turns into Send', async () => {
    await toLast(page);
    assert.equal(await page.locator('#send').count(), 0);
    await page.click('.bar-inner .btn-primary'); await settle(page, 700);
    await page.click('.bar-inner .btn-primary'); await settle(page, 700);
    await page.locator('.summary').scrollIntoViewIfNeeded(); await settle(page, 300);
    assert.match(await page.textContent('#send'), /Надіслати відповіді/);
  });
  await ctx.close();
}
{
  const { ctx, page } = await newPage();
  await step('offline after opening once: the saved survey reopens and can be sent later', async () => {
    await start(page, 'Зінченко');
    await page.locator('.item').first().locator('.scale label:nth-child(6)').click();
    await page.evaluate(() => { sessionStorage.setItem('failNextOnLoad', '1'); });
    await page.addInitScript(() => { if (sessionStorage.getItem('failNextOnLoad')) { sessionStorage.removeItem('failNextOnLoad'); window.__dsfMock = { failNext: 1, slowNext: 0, busyNext: 0 }; } });
    await page.reload(); await page.waitForSelector('.offline-note');
    await page.screenshot({ path: `${OUT}/k-offline-cached.png` });
    await page.click('.notice .btn-primary'); await page.waitForSelector('.item');
    await toLast(page); await rateAll(page, 6);
    await arm(page); await page.click('#send'); await page.waitForSelector('.badge-ok');
  });
  await ctx.close();
}
{
  const { ctx, page } = await newPage();
  await step('guide view opens in English; the full-screen QR speaks both languages', async () => {
    await page.goto(`${BASE}#guide-demo`); await page.waitForSelector('.qr-box svg');
    assert.equal(await page.getAttribute('html', 'lang'), 'en');
    await page.click('button:has-text("Full-screen QR code")'); await page.waitForSelector('.qr-full');
    const t = await page.textContent('.qr-full');
    assert.match(t, /Відскануйте/); assert.match(t, /Scan to answer/);
  });
  await ctx.close();
}
{
  const { ctx, page } = await newPage({ ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } });
  if (isChromium) await step('print: yellow highlights print even with “background graphics” off; other tabs print normally', async () => {
    await page.goto(`${BASE}#results`); await page.waitForSelector('#pass');
    await page.fill('#pass', 'demo'); await page.click('button[type=submit]'); await page.waitForSelector('.rs-head select');
    await page.selectOption('.rs-head select', 'bovicura-2023'); await page.waitForSelector('.kpis');
    await page.pdf({ path: `${OUT}/print-dashboard.pdf`, format: 'A4', printBackground: false });
    await page.click('.head-btn'); await settle(page, 500);
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await page.pdf({ path: `${OUT}/print-sheet-nobg.pdf`, format: 'A4', printBackground: false, preferCSSPageSize: true });
    const { execSync } = await import('node:child_process');
    const pages = (f) => Number(/Pages:\s+(\d+)/.exec(execSync(`pdfinfo ${f}`).toString())[1]);
    assert.equal(pages(`${OUT}/print-sheet-nobg.pdf`), 1, 'client sheet: one page');
    const dash = execSync(`pdftotext ${OUT}/print-dashboard.pdf -`).toString();
    assert.match(dash, /Needs attention/, 'Ctrl+P on the dashboard is not blank');
    execSync(`pdftoppm -r 40 -singlefile ${OUT}/print-sheet-nobg.pdf ${OUT}/print-sheet-nobg`);
    const { readFileSync } = await import('node:fs');
    const ppm = readFileSync(`${OUT}/print-sheet-nobg.ppm`);
    let i = 0, fields = 0; while (fields < 4) { if (ppm[i] === 0x0a) fields++; i++; } // skip P6 header lines
    let yellow = 0;
    for (; i + 2 < ppm.length; i += 3) if (ppm[i] > 230 && ppm[i + 1] > 210 && ppm[i + 2] < 90) yellow++;
    assert.ok(yellow > 200, `yellow highlight pixels in print: ${yellow}`);
  });
  await ctx.close();
}

// 10. regressions from the verification round
{
  const { ctx, page } = await newPage();
  await step('name list refresh never steals focus or search text', async () => {
    await page.goto(BASE); await page.waitForSelector('.hero');
    await patchState(page, (st) => { const b = st.seminars.demo.names; for (let i = 0; i < 20; i++) b.push({ id: `y${i}`, surname: `Probenko${i}`, given: 'Ivan', surnameCyr: `Пробенко${i}`, givenCyr: 'Іван' }); });
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('#name-search');
    await page.fill('#name-search', 'мор');
    // someone else answers meanwhile → the list must update, but typing continues undisturbed
    await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('dsf-demo-v1')); st.seminars.demo.used.n01 = true; localStorage.setItem('dsf-demo-v1', JSON.stringify(st)); });
    await page.waitForTimeout(16500);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'name-search', 'focus stays in the search box');
    assert.equal(await page.inputValue('#name-search'), 'мор');
    await page.fill('#name-search', '');
    assert.ok(await page.locator('.name-opt.is-done').count() >= 1, 'the new answer shows up');
  });
  await ctx.close();
}
{
  const { ctx, page } = await newPage();
  await step('answering an item closes the "no answer" prompt', async () => {
    await start(page, 'Лисенко');
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.bar.prompting');
    await page.locator('.item').nth(1).locator('.scale label:nth-child(4)').click({ force: true });
    await settle(page, 200);
    assert.equal(await page.locator('.bar.prompting').count(), 0);
    assert.ok(await page.isVisible('.bar-inner'));
  });
  await step('offline copy on the phone holds only this person’s name, and is removed after sending', async () => {
    const cached = await page.evaluate(() => JSON.parse(localStorage.getItem('dsf:demo:cfg')));
    assert.equal(cached.names.length, 1);
    await toLast(page); await rateAll(page, 6);
    await arm(page); await page.click('#send'); await page.waitForSelector('.badge-ok');
    assert.equal(await page.evaluate(() => localStorage.getItem('dsf:demo:cfg')), null);
  });
  await step('the next person on the same phone starts with Next, not Send, on the last page', async () => {
    await page.click('main .btn-secondary'); await page.waitForSelector('.hero');
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.names');
    await page.locator('.name-opt', { hasText: 'Павленко' }).click();
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item');
    await toLast(page);
    assert.equal(await page.locator('#send').count(), 0);
  });
  await ctx.close();
}
{
  const { ctx, page } = await newPage();
  await step('full-screen QR count updates while it is open', async () => {
    await page.goto(`${BASE}#guide-demo`); await page.waitForSelector('.qr-box svg');
    await page.click('button:has-text("Full-screen QR code")'); await page.waitForSelector('.qr-count');
    const before = await page.textContent('.qr-count');
    await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('dsf-demo-v1')); st.seminars.demo.used.n02 = true; st.seminars.demo.used.n03 = true; localStorage.setItem('dsf-demo-v1', JSON.stringify(st)); });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(1500);
    assert.notEqual(await page.textContent('.qr-count'), before);
    assert.match(await page.textContent('.qr-full'), /\?s=demo/, 'the link is shown as text too');
  });
  await ctx.close();
}

await browser.close();
const w = Math.max(...results.map((r) => r[1].length));
for (const [st, n, m] of results) console.log(`${st === 'PASS' ? '✔' : '✘'} ${n.padEnd(w)} ${m || ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n[${ENGINE}] ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
