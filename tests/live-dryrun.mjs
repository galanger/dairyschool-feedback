// A whole seminar day on the LIVE site and the REAL backend, on a TEST draft written with
// tools/save-draft.mjs (invented names only): the preview sends nothing, the guide opens the
// survey, an iPhone answers in Ukrainian and a small Android phone in English, the guide sees
// them and fixes the list, the staff close it, and the results, client sheet (one A4 page),
// translations and backups are checked. Screenshots of every page go to OUT.
//
// Usage: SEMINAR=<test draft id> GUIDEKEY=<its guide key> PASSCODE=<staff passcode> OUT=<dir> node tests/live-dryrun.mjs
// The run CLOSES the seminar, so it refuses any id without "test" in it.
// Names expected on the draft: tests/dryrun-names.csv.
import { chromium, webkit, devices } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE || 'https://galanger.github.io/dairyschool-feedback/';
const SEM = process.env.SEMINAR, GKEY = process.env.GUIDEKEY, PASS = process.env.PASSCODE;
const OUT = process.env.OUT || 'tests/output/dryrun';
if (!SEM || !GKEY || !PASS) { console.error('SEMINAR, GUIDEKEY and PASSCODE are required'); process.exit(2); }
if (!/test/.test(SEM)) { console.error('Refusing: this run closes the seminar, so its id must contain "test".'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const T = 90000; // Google is sometimes slow; a person would wait or tap Try again
const cfgText = readFileSync(new URL('../site/config.js', import.meta.url), 'utf8');
const BACKEND = process.env.BACKEND || cfgText.match(/backendUrl:\s*'([^']+)'/)[1];

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push(['PASS', name, `${((Date.now() - t0) / 1000).toFixed(0)} s`]); }
  catch (e) { results.push(['FAIL', name, e.message.split('\n').slice(0, 3).join(' | ')]); }
}
const settle = (p, ms = 400) => p.waitForTimeout(ms);
const shot = (p, name, full = false) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });

const config = async () => (await (await fetch(`${BACKEND}?action=config&s=${SEM}`, { redirect: 'follow', signal: AbortSignal.timeout(T) })).json()).seminar;
const sem = await config();
assert.equal(sem.status, 'draft', 'start from a draft');
const pages = sem.sections.map((s) => ({ ...s, items: sem.items.filter((it) => it.section === s.id) }));
console.log(`${SEM}: ${sem.items.length} questions on ${pages.length} pages, ${sem.names.length} names`);

const wk = await webkit.launch();
const cr = await chromium.launch({ channel: 'chrome' });
async function open(browser, ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  return page;
}
const A = await open(wk, { ...devices['iPhone 13'] });          // Ukrainian, an iPhone
const B = await open(cr, { ...devices['Galaxy S9+'] });         // English, a small Samsung screen (320 px wide)
const G = await open(cr, { ...devices['Pixel 7'] });            // the guide
const S = await open(cr, { viewport: { width: 1280, height: 900 } }); // the school, on a computer

// Answers every page of the survey; returns the page titles seen.
async function answerAll(page, who, { lang, low = [], na = [], comments = {}, prefix }) {
  await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.names', { timeout: T });
  await page.locator('.name-opt', { hasText: who }).click();
  await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item', { timeout: T }); await settle(page);
  const titles = [];
  for (let k = 0; k < pages.length; k++) {
    const p = pages[k];
    const h1 = (await page.textContent('main h1')).trim();
    titles.push(h1);
    const cards = page.locator('.item');
    assert.equal(await cards.count(), p.items.length, `page ${k + 1}: ${p.items.length} questions`);
    for (let i = 0; i < p.items.length; i++) {
      const it = p.items[i], c = cards.nth(i);
      assert.equal((await c.locator('legend .t').textContent()).trim(), it.label[lang], `label of ${it.id}`);
      if (it.detail) assert.equal((await c.locator('.detail').textContent()).trim(), it.detail[lang]);
      if (na.includes(it.id)) await c.locator('.item-actions button').click();
      else await c.locator(`.scale label:nth-child(${low.includes(it.id) ? 3 : it.no % 3 === 0 ? 6 : 7})`).click();
      if (comments[it.id]) await c.locator('textarea').fill(comments[it.id]);
    }
    await shot(page, `${prefix}-page-${k + 1}`, true);
    if (k < pages.length - 1) { await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item'); await settle(page, 250); }
  }
  return titles;
}

await step('participant preview (iPhone, Ukrainian): every page and question as in the Sheet; sending is refused politely', async () => {
  await A.goto(`${BASE}?s=${SEM}`); await A.waitForSelector('.hero h1', { timeout: T }); await settle(A, 600);
  assert.match(await A.textContent('.preview-flag'), /Попередній перегляд/);
  assert.equal((await A.textContent('.hero h1')).trim(), sem.title.uk);
  await shot(A, 'a-01-welcome');
  const titles = await answerAll(A, 'Бондаренко', { lang: 'uk', na: ['i14'], comments: { i01: 'Дуже корисно, багато цифр.', i05: 'Цікаво, але замало часу на ферму.' }, prefix: 'a' });
  assert.deepEqual(titles.slice(0, -1), pages.slice(0, -1).map((p) => p.title.uk));
  assert.equal(titles.at(-1), 'Останні запитання');
  await A.fill('#o-q1', 'Візити на ферми та лекція про годівлю.'); await A.fill('#o-q2', 'Більше часу на фермах.');
  await A.locator('.summary').scrollIntoViewIfNeeded(); await A.click('#send');
  await A.waitForSelector('text=Ще не надіслано.', { timeout: T });
  await shot(A, 'a-09-preview-not-sent');
});

await step('guide page: "not open yet", no QR code; the guide opens the survey and the QR code appears', async () => {
  await G.goto(`${BASE}guide.html?s=${SEM}#${GKEY}`); await G.waitForSelector('.draft-panel', { timeout: T }); await settle(G, 600);
  assert.equal(await G.locator('.qr-box').count(), 0);
  assert.match(await G.textContent('main'), new RegExp(`Still to answer · ${sem.names.length}`));
  await shot(G, 'g-01-draft', true);
  await G.click('.draft-panel button:has-text("Open the survey now")'); await G.waitForSelector('text=Open it now?');
  await shot(G, 'g-02-confirm');
  await G.click('.draft-panel .confirm .btn-primary');
  await G.waitForSelector('.qr-box svg', { timeout: T });
  assert.equal((await config()).status, 'open');
  await shot(G, 'g-03-open', true);
});

await step('the iPhone that waited on the preview sends with its next tap; thank-you with the Google review ask', async () => {
  await A.click('#send'); await A.waitForSelector('.badge-ok', { timeout: T });
  assert.equal(await A.locator('.review a').count(), 1);
  assert.equal(await A.locator('.preview-flag').count(), 0);
  await shot(A, 'a-10-thanks');
});

await step('a small Android phone answers in English; Melnyk is offered, Bondarenko is taken', async () => {
  await B.goto(`${BASE}?s=${SEM}`); await B.waitForSelector('.hero h1', { timeout: T });
  await B.click('.lang button:has-text("EN")'); await settle(B);
  assert.equal((await B.textContent('.hero h1')).trim(), sem.title.en);
  await shot(B, 'b-01-welcome');
  await B.click('.bar-inner .btn-primary'); await B.waitForSelector('.names', { timeout: T }); await settle(B, 800);
  assert.ok(await B.locator('.name-opt', { hasText: 'Bondarenko' }).evaluate((el) => el.classList.contains('is-done')), 'Bondarenko greyed out');
  await shot(B, 'b-02-names');
  await B.click('.btn-back'); await B.waitForSelector('.hero h1');
  await answerAll(B, 'Melnyk', { lang: 'en', low: ['i05', 'i14', 'i21'], comments: { i05: 'Too short, we did not see the robot.', i21: 'Обіди були дуже пізно.' }, prefix: 'b' });
  await B.fill('#o-q1', 'The farm visits.'); await B.fill('#o-q2', 'More time for questions after the lectures.');
  await B.locator('.summary').scrollIntoViewIfNeeded(); await B.click('#send'); await B.waitForSelector('.badge-ok', { timeout: T });
  await shot(B, 'b-10-thanks');
});

await step('guide: 2 of 3 answered, Hnatiuk still to answer; adds and removes an extra person', async () => {
  await G.click('.refresh-row button');
  await G.waitForFunction(() => document.querySelector('.big-count .num')?.textContent === '2', null, { timeout: T });
  assert.match(await G.textContent('.missing'), /Hnatiuk/);
  await G.click('details.onday summary:has-text("Add a name")');
  const f = G.locator('.onday-form input');
  await f.nth(0).fill('Testenko'); await f.nth(1).fill('Ivan'); await f.nth(2).fill('Тестенко'); await f.nth(3).fill('Іван');
  await G.click('.onday-form button[type=submit]'); await G.waitForSelector('text=Added: Testenko Ivan', { timeout: T });
  await G.waitForSelector('.big-count:has-text("/ 4")', { timeout: T });
  await G.click('details.onday summary:has-text("not attending")'); await settle(G, 300);
  await G.selectOption('#nm-remove', { label: 'Testenko Ivan' });
  await G.locator('.onday button:has-text("Remove")').first().click(); await G.click('.confirm:visible .btn-danger');
  await G.waitForSelector('text=Removed: Testenko Ivan', { timeout: T });
  await G.waitForSelector('.big-count:has-text("/ 3")', { timeout: T });
  await shot(G, 'g-04-two-answered', true);
});

let closeNote = '';
await step('staff: progress while open, close (backup copy + email), results unlock', async () => {
  await S.goto(`${BASE}staff.html?s=${SEM}`); await S.waitForSelector('#pass', { timeout: T });
  await S.fill('#pass', PASS); await S.click('button[type=submit]');
  await S.waitForSelector('text=The survey is still open', { timeout: T });
  assert.match(await S.textContent('.big-count'), /2\s*\/ 3/);
  await shot(S, 's-01-open');
  await S.click('button:has-text("Close survey…")'); await S.click('.btn-danger');
  await S.waitForSelector('.kpis', { timeout: 180000 }); await settle(S, 800);
  closeNote = (await S.textContent('.closed-note')).replace(/\s+/g, ' ');
  assert.match(closeNote, /2 answers kept/); assert.match(closeNote, /dated copy/); assert.match(closeNote, /emailed to /);
  assert.match(await S.textContent('.rs-head'), /2 responses of 3 invited/);
  await shot(S, 's-02-results', true);
});

await step('results: every question listed, comments with English translations, areas', async () => {
  assert.equal(await S.locator('table tbody tr.row, table tbody tr:not(.detail)').count() >= sem.items.length, true);
  await S.click('.tabs button:has-text("Areas")'); await settle(S, 600); await shot(S, 's-03-areas', true);
  await S.click('.tabs button:has-text("Comments")'); await settle(S, 600);
  const c = await S.textContent('main');
  assert.match(c, /Дуже корисно, багато цифр\./);
  assert.match(c, /Translation: /, 'Google translated the Ukrainian comments');
  await shot(S, 's-04-comments', true);
  await S.click('.tabs button:has-text("Data")'); await settle(S, 500); await shot(S, 's-06-data', true);
});

await step('client sheet: all questions, prints on one A4 page', async () => {
  await S.click('.tabs button:has-text("Client sheet")'); await settle(S, 800);
  assert.equal(await S.locator('.sheet tbody tr').count(), sem.items.length);
  assert.match(await S.textContent('.sheet'), /UVT Ukraine/);
  await shot(S, 's-05-client-sheet', true);
  await S.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await S.pdf({ path: `${OUT}/client-sheet.pdf`, format: 'A4', printBackground: false, preferCSSPageSize: true });
  const info = execFileSync('pdfinfo', [`${OUT}/client-sheet.pdf`], { encoding: 'utf8' });
  assert.match(info, /Pages:\s+1\b/);
});

await step('after closing: the survey link says closed; the guide page says closed', async () => {
  await B.goto(`${BASE}?s=${SEM}`); await B.waitForSelector('text=closed', { timeout: T });
  await G.click('.refresh-row button'); await G.waitForSelector('text=The survey is closed.', { timeout: T });
});

await step('no script errors on any page', async () => {
  for (const [n, p] of [['iPhone', A], ['Android', B], ['guide', G], ['staff', S]]) assert.deepEqual(p.errors, [], n);
});

await wk.close(); await cr.close();
const w = Math.max(...results.map((r) => r[1].length));
for (const [st, n, m] of results) console.log(`${st === 'PASS' ? '✔' : '✘'} ${n.padEnd(w)} ${m || ''}`);
console.log(`\nclose note: ${closeNote}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
