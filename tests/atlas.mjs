// Screenshots of every screen and state, for design review. Output: tests/atlas/*.png + index.json
import { chromium, devices } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const OUT = 'tests/atlas';
const index = [];
const browser = await chromium.launch({ channel: 'chrome' });
const iphone = { ...devices['iPhone 13'], deviceScaleFactor: 2 };
const settle = (p, ms = 450) => p.waitForTimeout(ms);
async function ctxPage(opts = iphone, init) {
  const ctx = await browser.newContext({ ...opts, bypassCSP: true });
  if (init) await ctx.addInitScript(init);
  return { ctx, page: await ctx.newPage() };
}
async function shot(page, name, what, full = false) {
  await settle(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  index.push({ file: `${name}.png`, what });
}
async function patch(page, fn) {
  await page.evaluate((src) => {
    const st = JSON.parse(localStorage.getItem('dsf-demo-v1'));
    new Function('st', src)(st);
    localStorage.setItem('dsf-demo-v1', JSON.stringify(st));
  }, `(${fn})(st)`);
  await page.reload(); await settle(page);
}
async function toNames(page) { await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.names'); await settle(page); }
async function pick(page, who) { await page.locator('.name-opt', { hasText: who }).click(); await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item'); await settle(page); }
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
async function next(page) { await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item'); await settle(page, 250); }

// ---------- participant ----------
{
  const { ctx, page } = await ctxPage();
  await page.goto(BASE); await page.waitForSelector('.hero h1');
  await shot(page, 'p01-welcome-uk', 'Welcome, Ukrainian (default)');
  await page.click('details.privacy summary'); await page.locator('details.privacy').scrollIntoViewIfNeeded();
  await shot(page, 'p02-welcome-privacy', 'Welcome, privacy note opened');
  await page.click('.lang button:has-text("EN")');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'p03-welcome-en', 'Welcome, English');
  await page.click('.lang button:has-text("УКР")');
  await toNames(page);
  await shot(page, 'p06-names', 'Name picker');
  await page.locator('.name-opt', { hasText: 'Мельник' }).click();
  await shot(page, 'p07-names-selected', 'Name picker, a name selected (button says who)');
  await page.click('text=Мого імені немає у списку'); await page.locator('#name-help').scrollIntoViewIfNeeded();
  await shot(page, 'p08-names-missing-help', 'Name picker, "my name isn’t on the list" help');
  await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item');
  await shot(page, 'p11-section1-top', 'Section 1, nothing answered yet');
  const first = page.locator('.item').first();
  await first.locator('.scale label:nth-child(6)').click();
  await first.locator('textarea').fill('Дуже цікава екскурсія, але замало часу на фермі.');
  await page.locator('.item', { hasText: 'для дам' }).locator('button:has-text("Не брали участі")').click();
  await page.locator('.item').first().scrollIntoViewIfNeeded();
  await shot(page, 'p12-section1-answered', 'Section 1: first item rated 6 with a comment');
  await page.locator('.item', { hasText: 'для дам' }).scrollIntoViewIfNeeded();
  await shot(page, 'p12b-section1-na', 'Section 1: a "for the ladies" item marked "didn’t take part"');
  await page.locator('.item').nth(1).locator('.scale label:nth-child(5)').click();
  await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.soft');
  await shot(page, 'p13-soft-prompt', 'Next with 3 unrated items and 1 missing comment: refused with a note (everything is required)');
  await page.click('.soft button:has-text("Показати")');
  await shot(page, 'p14-show-me', 'After "Show which": the incomplete items are flagged (no rating / needs a comment)');
  await page.click('.lang button:has-text("EN")'); await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'p15-section1-en', 'Section 1 in English');
  await page.click('.lang button:has-text("УКР")');
  await rateAll(page, 5); await next(page);
  await rateAll(page, 7); await next(page);
  await rateAll(page, 6); await next(page);
  await shot(page, 'p18-section4', 'Section 4: guides, hotels and food');
  await rateAll(page, 5); await next(page);
  await shot(page, 'p19-last-top', 'Last page: recommend + overall (own end labels); bar says "Next" until the end is seen');
  await page.locator('.q-open').first().scrollIntoViewIfNeeded();
  await shot(page, 'p19b-last-open', 'Last page: the two closing questions (required)');
  await page.locator('.summary').scrollIntoViewIfNeeded();
  await shot(page, 'p20-last-bottom', 'Last page bottom: answered count, "name on the list … not saved with answers", Send now armed');
  await rateAll(page, 7);
  await page.fill('#o-q1', 'Лекції та візити на ферми.');
  await page.fill('#o-q2', 'Більше часу на фермах.');
  await page.evaluate(() => { window.__dsfMock.failNext = 1; });
  await arm(page); await page.click('#send'); await page.waitForSelector('.alert-error');
  await shot(page, 'p22-send-failed', 'Send failed (no signal): answers kept, Try again');
  await page.click('.alert-error button'); await page.waitForSelector('.badge-ok');
  await shot(page, 'p24-thanks', 'Thanks screen (no results shown)');
  await page.reload(); await page.waitForSelector('.badge-ok');
  await shot(page, 'p25-already', 'Same phone opens the link again: already answered');
  await page.click('main .btn-secondary'); await page.waitForSelector('.hero');
  await toNames(page);
  await page.locator('.name-opt.is-done').first().scrollIntoViewIfNeeded();
  await shot(page, 'p09-names-answered', 'Name picker: someone who answered is greyed out ("answer sent")');
  await ctx.close();
}
{
  // resume, taken name, slow send, dark, small, errors
  const { ctx, page } = await ctxPage();
  await page.goto(BASE); await page.waitForSelector('.hero'); await toNames(page); await pick(page, 'Шевчук');
  await page.locator('.item').first().locator('.scale label:nth-child(4)').click();
  await page.reload(); await page.waitForSelector('.notice');
  await shot(page, 'p05-resume', 'Reopened mid-survey: continue where you left off');
  await page.click('.notice button:has-text("Почати заново")'); await page.waitForSelector('text=Видалити ваші відповіді');
  await shot(page, 'p05b-restart-confirm', 'Start over asks before deleting saved answers');
  await page.click('.notice button:has-text("Скасувати")'); await page.waitForSelector('text=Продовжити з місця');
  await page.click('.notice .btn-primary'); await page.waitForSelector('.item');
  for (let k = 0; k < 4; k++) { await rateAll(page, 6); await next(page); }
  await rateAll(page, 6);
  // someone else takes "Шевчук" first
  await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('dsf-demo-v1')); st.seminars.demo.used.n09 = true; localStorage.setItem('dsf-demo-v1', JSON.stringify(st)); });
  await arm(page); await page.click('#send'); await page.waitForSelector('.alert-error');
  await page.locator('.alert-error').scrollIntoViewIfNeeded();
  await shot(page, 'p23-name-taken', 'Send refused: this name has already answered');
  await page.click('.alert-error button:has-text("Це не моє ім’я")'); await page.waitForSelector('.names');
  await page.locator('.name-opt', { hasText: 'Мороз' }).click(); await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.summary');
  await page.evaluate(() => { window.__dsfMock.slowNext = 1; });
  await arm(page); await page.click('#send'); await page.waitForSelector('text=Ще надсилаємо', { timeout: 9000 });
  await shot(page, 'p21-sending-slow', 'Slow network: "still sending, keep this page open"');
  await page.waitForSelector('.badge-ok', { timeout: 15000 });
  await ctx.close();
}
for (const [name, opts, what] of [
  ['p04-welcome-dark', { ...iphone, colorScheme: 'dark' }, 'Welcome, dark mode'],
  ['p16-section-dark', { ...iphone, colorScheme: 'dark' }, 'Section 1, dark mode, one rated'],
  ['p17-section-320', { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 'Section 1 on a small 320px phone'],
]) {
  const { ctx, page } = await ctxPage(opts);
  await page.goto(BASE); await page.waitForSelector('.hero h1');
  if (name.startsWith('p04')) await shot(page, name, what);
  else {
    await toNames(page); await pick(page, 'Лисенко');
    await page.locator('.item').first().locator('.scale label:nth-child(6)').click();
    await shot(page, name, what);
  }
  await ctx.close();
}
{
  const { ctx, page } = await ctxPage();
  await page.goto(BASE); await page.waitForSelector('.hero');
  await patch(page, (st) => { const b = st.seminars.demo.names; for (let i = 0; i < 48; i++) b.push({ id: `x${i}`, surname: `Testenko${i}`, given: 'Ivan', surnameCyr: `Тестенко${i}`, givenCyr: 'Іван' }); });
  await toNames(page); await page.fill('#name-search', 'мор');
  await shot(page, 'p10-names-search', 'Long list (60 names): search box, typed "мор"');
  await patch(page, (st) => { st.seminars.demo.names = st.seminars.demo.names.slice(0, 12); st.seminars.demo.status = 'draft'; });
  await shot(page, 'p29-draft-preview', 'Staff preview of a draft survey (nothing is sent)');
  await patch(page, (st) => { st.seminars.demo.status = 'closed'; });
  await shot(page, 'p26-closed', 'Survey closed');
  await page.goto(`${BASE}?s=nope-nope`); await page.waitForSelector('.second-lang');
  await shot(page, 'p27-invalid-link', 'Invalid link (shown in both languages)');
  await ctx.close();
  const off = await ctxPage(iphone, () => { window.__dsfMock = { failNext: 1, slowNext: 0, busyNext: 0 }; });
  await off.page.goto(BASE); await off.page.waitForSelector('.second-lang');
  await shot(off.page, 'p28-offline', 'No connection when opening the link (both languages)');
  await off.ctx.close();
}

// ---------- guide ----------
{
  const { ctx, page } = await ctxPage();
  await page.goto(`${BASE}#guide-demo`); await page.waitForSelector('.qr-box svg');
  await shot(page, 'g01-guide-en', 'Guide view (English by default): QR, progress, who is missing');
  await page.click('details.onday summary:has-text("Add a name")'); await page.locator('.onday-panel').scrollIntoViewIfNeeded();
  await shot(page, 'g05-guide-on-day', 'Guide: fixes on the day (add a name, a no-show, a wrong tap)');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('.lang button:has-text("УКР")');
  await shot(page, 'g02-guide-uk', 'Guide view switched to Ukrainian');
  await page.click('.lang button:has-text("EN")');
  await page.click('button:has-text("Full-screen QR code")'); await page.waitForSelector('.qr-full');
  await shot(page, 'g03-guide-bigqr', 'Full-screen QR for the group: bilingual caption and live count');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('dsf-demo-v1')); st.seminars.demo.names.forEach((n) => { st.seminars.demo.used[n.id] = true; }); localStorage.setItem('dsf-demo-v1', JSON.stringify(st)); });
  await page.click('.refresh-row button');
  await page.locator('.all-done').scrollIntoViewIfNeeded();
  await shot(page, 'g04-guide-all-done', 'Everyone has answered (answers count comes from real submissions)');
  await ctx.close();
  const nk = await ctxPage();
  await nk.page.goto(`${BASE}#guide`); await nk.page.waitForSelector('main p');
  await shot(nk.page, 'g06-guide-no-key', 'Guide link without its key');
  await nk.ctx.close();
}

// ---------- results ----------
async function login(page) {
  await page.goto(`${BASE}#results`); await page.waitForSelector('#pass');
}
{
  const desk = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 };
  const { ctx, page } = await ctxPage(desk);
  await login(page);
  await shot(page, 'r01-gate', 'Staff passcode');
  await page.click('button[type=submit]');
  await shot(page, 'r02-gate-error', 'Passcode left empty');
  await page.fill('#pass', 'demo'); await page.click('button[type=submit]'); await page.waitForSelector('.rs-head');
  await shot(page, 'r03-open-locked', 'Survey still open: results locked, progress only');
  await page.click('button:has-text("Close survey…")');
  await shot(page, 'r04-close-confirm', 'Close confirmation');
  await page.click('.btn-danger'); await page.waitForSelector('text=No answers were received');
  await shot(page, 'r05-empty', 'Closed with no answers (demo)');
  await page.selectOption('.rs-head select', 'bovicura-2023'); await page.waitForSelector('.kpis');
  await shot(page, 'r06-dashboard-top', 'Dashboard (2023 paper forms): KPIs, how-to-read line, needs attention / went well');
  await page.locator('.sum-notes').scrollIntoViewIfNeeded();
  await shot(page, 'r06b-summary-notes', 'Summary notes: split opinions, areas with the driver, comments');
  await page.locator('.table-wrap').scrollIntoViewIfNeeded();
  await shot(page, 'r07-items-table', 'All items table with rating bars (share of answers, one scale)');
  await page.locator('tr.row', { hasText: 'Lectures by Eyal Frank' }).locator('.rowbtn').click();
  await page.locator('tr.row', { hasText: 'Lectures by Eyal Frank' }).scrollIntoViewIfNeeded();
  await shot(page, 'r08-row-expanded', 'An item opened: rating bars, counts, one-person effect, comments with ratings');
  await page.selectOption('.toolbar select', 'low'); await page.locator('.tabs').scrollIntoViewIfNeeded();
  await shot(page, 'r09-sorted-lowest', 'Sorted: lowest score first');
  for (const [tab, file, what] of [['Areas', 'r10-by-area', 'Areas: item dots + area average, scale from 4, 80% line'], ['Comments', 'r11-comments', 'All comments, open questions first'],
    ['Client sheet', 'r12-sheet', 'Client results sheet (classic layout, prints on one A4 page)'], ['Data', 'r13-data', 'Data quality, export, definitions']]) {
    await page.click(`.tabs button:has-text("${tab}")`); await page.locator('.tabs').scrollIntoViewIfNeeded();
    await shot(page, file, what);
  }
  await ctx.close();
  const ph = await ctxPage(iphone);
  await login(ph.page); await ph.page.fill('#pass', 'demo'); await ph.page.click('button[type=submit]');
  await ph.page.waitForSelector('.rs-head select'); await ph.page.selectOption('.rs-head select', 'bovicura-2023'); await ph.page.waitForSelector('.kpis');
  await shot(ph.page, 'r14-phone-dashboard', 'Results on a phone: top');
  await ph.page.locator('.tabs').scrollIntoViewIfNeeded();
  await shot(ph.page, 'r15-phone-items', 'Results on a phone: items table, extra columns folded into the item line');
  await ph.page.click('.tabs button:has-text("Client sheet")');
  await ph.page.locator('.sheet-stage').scrollIntoViewIfNeeded();
  await shot(ph.page, 'r17-phone-sheet', 'Results on a phone: whole client sheet scaled to fit');
  await ph.page.click('.tabs button:has-text("Areas")');
  await shot(ph.page, 'r16-phone-areas', 'Results on a phone: by area');
  await ph.ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 1));
console.log(`${index.length} screenshots in ${OUT}`);
