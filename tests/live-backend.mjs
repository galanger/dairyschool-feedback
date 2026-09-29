// End-to-end proof against the REAL backend on the deployed site, using the sample seminar that
// First setup opens (three invented names). Two phones answer, the guide page counts them, the
// staff page closes the survey and shows the results and the backup note.
// Usage: PASSCODE=<staff passcode> [BASE=…] [SEMINAR=sample] node tests/live-backend.mjs
import { chromium, webkit, devices } from 'playwright-core';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'https://galanger.github.io/dairyschool-feedback/';
const SEM = process.env.SEMINAR || 'sample';
const PASS = process.env.PASSCODE;
if (!PASS) { console.error('PASSCODE is required'); process.exit(2); }
const ENGINE = process.env.ENGINE || 'chrome';
const browser = ENGINE === 'webkit' ? await webkit.launch() : await chromium.launch({ channel: 'chrome' });
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n').slice(0, 3).join(' | ')]); }
}
async function phone() {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  return { ctx, page };
}
const settle = (p, ms = 400) => p.waitForTimeout(ms);
async function begin(page, who) {
  await page.goto(`${BASE}?s=${SEM}`); await page.waitForSelector('.hero h1', { timeout: 30000 });
  await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.names');
  await page.locator('.name-opt', { hasText: who }).click();
  await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item'); await settle(page);
}
async function rateAll(page, v, comment) {
  const cards = page.locator('.item');
  for (let i = 0; i < await cards.count(); i++) {
    const c = cards.nth(i);
    if (!(await c.evaluate((el) => el.classList.contains('answered')))) await c.locator(`.scale label:nth-child(${v})`).click();
    if (comment && !(await c.locator('textarea').inputValue())) await c.locator('textarea').fill(comment);
  }
}
// Pages until Send appears: rate everything, fill the closing questions, arm Send.
async function finish(page, v, comment) {
  for (let k = 0; k < 10; k++) {
    await rateAll(page, v, comment);
    if (await page.locator('.q-open').count()) break;
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item'); await settle(page, 250);
  }
  for (const ta of await page.locator('.q-open textarea').all()) if (!(await ta.inputValue())) await ta.fill('Дякуємо за семінар.');
  await page.locator('.summary').scrollIntoViewIfNeeded(); await page.waitForSelector('#send');
}

const A = await phone(), B = await phone(), G = await phone(), S = await phone();
await step('the survey loads from the real backend, in Ukrainian, with the sample names', async () => {
  await A.page.goto(`${BASE}?s=${SEM}`); await A.page.waitForSelector('.hero h1', { timeout: 30000 });
  assert.match(await A.page.textContent('.hero h1'), /Пробний семінар/);
  await A.page.click('.bar-inner .btn-primary'); await A.page.waitForSelector('.names');
  assert.equal(await A.page.locator('.name-opt').count(), 3);
});
await step('phone A answers as Мельник with a comment; the answer is stored and the thank-you screen shows the review ask', async () => {
  await begin(A.page, 'Мельник');
  await finish(A.page, 6, 'Дуже добре, дякуємо.');
  await A.page.click('#send'); await A.page.waitForSelector('.badge-ok', { timeout: 60000 });
  assert.equal(await A.page.locator('.review a').count(), 1);
  assert.deepEqual(A.page.errors, []);
});
await step('phone B cannot answer as Мельник again, but can as Гнатюк', async () => {
  await B.page.goto(`${BASE}?s=${SEM}`); await B.page.waitForSelector('.hero h1', { timeout: 30000 });
  await B.page.click('.bar-inner .btn-primary'); await B.page.waitForSelector('.names'); await settle(B.page, 800);
  assert.ok(await B.page.locator('.name-opt', { hasText: 'Мельник' }).evaluate((el) => el.classList.contains('is-done')), 'Мельник greyed out');
  await B.page.locator('.name-opt', { hasText: 'Гнатюк' }).click();
  await B.page.click('.bar-inner .btn-primary'); await B.page.waitForSelector('.item'); await settle(B.page);
  await finish(B.page, 4, '=1+1 замало часу');
  await B.page.click('#send'); await B.page.waitForSelector('.badge-ok', { timeout: 60000 });
});
await step('the same phone reopening the link sees "already answered"', async () => {
  await A.page.reload(); await A.page.waitForSelector('.badge-ok', { timeout: 30000 });
  assert.match(await A.page.textContent('main'), /Ви вже відповіли/);
});
await step('the guide page (staff passcode as key) counts 2 of 3 and names the missing person', async () => {
  await G.page.goto(`${BASE}guide.html?s=${SEM}#${PASS}`); await G.page.waitForSelector('.qr-box svg', { timeout: 30000 }); await settle(G.page, 800);
  assert.match(await G.page.textContent('.big-count'), /2\s*\/ 3/);
  assert.match(await G.page.textContent('.missing'), /Bondarenko/);
  assert.match(await G.page.locator('.link-text').first().textContent(), new RegExp(`${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?s=${SEM}`));
});
await step('staff page: wrong passcode refused; the right one shows progress while open', async () => {
  await S.page.goto(`${BASE}staff.html?s=${SEM}`); await S.page.waitForSelector('#pass', { timeout: 30000 });
  await S.page.fill('#pass', 'wrong-passcode-xx'); await S.page.click('button[type=submit]'); await S.page.waitForSelector('text=didn’t work', { timeout: 30000 });
  await S.page.fill('#pass', PASS); await S.page.click('button[type=submit]');
  await S.page.waitForSelector('text=The survey is still open', { timeout: 30000 });
  assert.match(await S.page.textContent('.big-count'), /2\s*\/ 3/);
});
await step('closing from the staff page keeps both answers, backs them up, unlocks the results', async () => {
  await S.page.click('button:has-text("Close survey…")'); await S.page.click('.btn-danger');
  await S.page.waitForSelector('.kpis', { timeout: 120000 }); await settle(S.page, 500);
  assert.match(await S.page.textContent('.rs-head'), /2 responses of 3 invited/);
  const note = await S.page.textContent('.closed-note');
  assert.match(note, /2 answers kept/); assert.match(note, /dated copy/); assert.match(note, /emailed to /);
  await S.page.click('.tabs button:has-text("Comments")'); await settle(S.page, 500);
  assert.match(await S.page.textContent('main'), /=1\+1 замало часу/, 'comment stored as typed');
  await S.page.click('.tabs button:has-text("Client sheet")'); await settle(S.page, 500);
  assert.equal(await S.page.locator('.sheet tbody tr').count(), 5);
  assert.deepEqual(S.page.errors, []);
});
await step('after closing, the survey link says the survey is closed', async () => {
  await B.page.goto(`${BASE}?s=${SEM}`); await B.page.waitForSelector('text=Опитування закрито', { timeout: 30000 });
});
await browser.close();
const w = Math.max(...results.map((r) => r[1].length));
for (const [st, n, m] of results) console.log(`${st === 'PASS' ? '✔' : '✘'} ${n.padEnd(w)} ${m || ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n[${ENGINE}] ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
