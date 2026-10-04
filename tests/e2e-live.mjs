// The production code path: the site's remote API (fetch, text/plain POST, 302 redirects, JSON)
// against backend/Code.gs served like Google serves it. Two phones = two separate browser contexts.
import { devices } from 'playwright-core';
import { launch, adapt, ENGINE, isChromium, viewUrl } from './engine.mjs';
import assert from 'node:assert/strict';
import { startServer, SEM, ADMIN, GUIDE } from './fake-gas-server.mjs';
import { DEMO_SEMINAR } from '../site/assets/js/demo-data.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const GAS = 'http://127.0.0.1:8790';
const server = await startServer(8790);
const browser = await launch();
const results = [];
const CONFIG = `window.DSF_CONFIG = { backendUrl: '${GAS}/exec', publicUrl: 'https://feedback.example/', defaultSeminar: null, reviewUrl: 'https://g.page/r/example/review' };`;

async function phone() {
  // The page's real Content-Security-Policy stays ON (every engine enforces it). The only change:
  // the local stand-in for Google is added to connect-src, next to script.google.com / googleusercontent.com.
  const ctx = await browser.newContext(adapt({ ...devices['Pixel 7'] }));
  await ctx.route('**/config.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: CONFIG }));
  await ctx.route((url) => url.origin === new URL(BASE).origin && (url.pathname === '/' || url.pathname.endsWith('.html')), async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace('https://script.googleusercontent.com;', `https://script.googleusercontent.com ${GAS};`);
    if (!body.includes(GAS)) throw new Error('CSP connect-src not found in index.html');
    await route.fulfill({ response: res, body });
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  return { ctx, page };
}
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n').slice(0, 4).join(' | ')]); }
}
const settle = (p, ms = 300) => p.waitForTimeout(ms);


const state = async (id = SEM) => (await fetch(`${GAS}/__state?s=${id}`)).json();
// What tools/save-draft.mjs sends: a new draft with a few of the demo questions and two invented names.
async function saveDraft(base) {
  const sec = Object.fromEntries(DEMO_SEMINAR.sections.map((x) => [x.id, x.title]));
  const items = DEMO_SEMINAR.items.filter((it) => ['i01', 'i02', 'i24', 'i25'].includes(it.id)).map((it) => ({
    section_en: sec[it.section].en, section_uk: sec[it.section].uk, category: it.category, label_en: it.label.en, label_uk: it.label.uk, key: it.key }));
  const body = { action: 'saveDraft', key: ADMIN, base, items,
    seminar: { title_en: 'Draft test', title_uk: 'Тестова чернетка', start: '2026-10-04', end: '2026-10-11', languages: 'uk,en', default_lang: 'uk', report_name: 'a test group' },
    names: [{ surname: 'Kravets', given: 'Ivan', surname_cyr: 'Кравець', given_cyr: 'Іван' }, { surname: 'Savchuk', given: 'Olha', surname_cyr: 'Савчук', given_cyr: 'Ольга' }] };
  const r = await (await fetch(`${GAS}/exec`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' })).json();
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
// Rates every page up to the last one (whatever the number of pages).
async function complete(page, v = 6) {
  for (let k = 0; k < 12; k++) {
    await rateAll(page, v);
    if (await page.locator('.q-open').count()) break;
    await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item'); await settle(page, 200);
  }
}
async function begin(page, who) {
  await page.goto(`${BASE}?s=${SEM}`); await page.waitForSelector('.hero h1');
  await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.names');
  await page.locator('.name-opt', { hasText: who }).click();
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
async function finish(page, v) {
  for (let k = 0; k < 4; k++) { await rateAll(page, v); await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.item'); await settle(page, 200); }
  await rateAll(page, v);
}

await fetch(`${GAS}/__reset`);
const A = await phone(), B = await phone(), C = await phone();

await step('live: config loads through the redirect, seminar title and dates in Ukrainian', async () => {
  await A.page.goto(`${BASE}?s=${SEM}`); await A.page.waitForSelector('.hero h1');
  assert.match(await A.page.textContent('.hero h1'), /UVT Україна/);
  assert.match(await A.page.textContent('.dates'), /4–11 жовтня 2026/);
});
await step('live: full answer with a Ukrainian comment reaches the Sheet, without the name', async () => {
  await begin(A.page, 'Мельник');
  const first = A.page.locator('.item').first();
  await first.locator('.scale label:nth-child(3)').click();
  await first.locator('textarea').fill('=1+1 замало практики');
  await finish(A.page, 6);
  await arm(A.page); await A.page.click('#send'); await A.page.waitForSelector('.badge-ok');
  assert.equal(await A.page.locator('.review a').getAttribute('href'), 'https://g.page/r/example/review', 'review link from the site config');
  const st = await state();
  assert.equal(st.rows.length, 1);
  assert.equal(st.used.length, 1);
  assert.ok(!JSON.stringify(st.rows).includes('Мельник') && !JSON.stringify(st.rows).includes('Melnyk'));
  assert.ok(JSON.stringify(st.rows).includes('=1+1 замало практики'), 'comment stored as typed');
  assert.deepEqual(A.page.errors, []);
});
await step('live: two separate phones pick the same name; the second is told politely', async () => {
  await begin(B.page, 'Шевчук');
  await begin(C.page, 'Шевчук');
  await finish(B.page, 5); await finish(C.page, 7);
  await arm(B.page); await B.page.click('#send'); await B.page.waitForSelector('.badge-ok');
  await arm(C.page); await C.page.click('#send'); await C.page.waitForSelector('.alert-error');
  assert.match(await C.page.textContent('.alert-error'), /вже надіслано/);
  await C.page.click('.alert-error button:has-text("Це не моє ім’я")'); await C.page.waitForSelector('.names'); await settle(C.page, 800);
  assert.ok(await C.page.locator('.name-opt', { hasText: 'Шевчук' }).evaluate((el) => el.classList.contains('is-done')));
  await C.page.locator('.name-opt', { hasText: 'Мороз' }).click();
  await C.page.click('.bar-inner .btn-primary'); await C.page.waitForSelector('#send');
  await arm(C.page); await C.page.click('#send'); await C.page.waitForSelector('.badge-ok');
  assert.equal((await state()).rows.length, 3);
});
await step('live: the answer arrives but every reply is lost; the phone tries 3 times, then Try again; counted once', async () => {
  const D = await phone();
  await begin(D.page, 'Ткачук'); await finish(D.page, 4);
  let posts = 0;
  await D.page.route(`${GAS}/exec`, async (route) => {
    if (route.request().method() === 'POST' && posts < 3) {
      if (posts++ === 0) await route.fetch({ maxRedirects: 0 }); // the server stores the answer…
      return route.abort('connectionreset');                     // …but the phone never hears back
    }
    return route.continue();
  });
  await arm(D.page); await D.page.click('#send'); await D.page.waitForSelector('.alert-error', { timeout: 20000 });
  assert.equal(posts, 3, 'sent 3 times quietly before showing the error');
  assert.equal((await state()).rows.length, 4, 'stored once already');
  await D.page.click('.alert-error button'); await D.page.waitForSelector('.badge-ok');
  assert.equal((await state()).rows.length, 4, 'retry did not add a second row');
  await D.ctx.close();
});
await step('live: guide link shows 4 of 12 and the missing names; a wrong key is refused', async () => {
  const G = await phone();
  await G.page.goto(viewUrl(BASE, 'guide', { s: SEM, key: GUIDE })); await G.page.waitForSelector('.qr-box svg'); await settle(G.page, 600);
  assert.match(await G.page.textContent('.big-count'), /4\s*\/ 12/);
  assert.match(await G.page.textContent('main'), /Still to answer · 8/);
  assert.match(await G.page.locator('.link-text').first().textContent(), /https:\/\/feedback\.example\/\?s=uvt-demo-ab12/);
  const W = await phone();
  await W.page.goto(viewUrl(BASE, 'guide', { s: SEM, key: 'wrong' })); await W.page.waitForSelector('text=isn’t valid');
  await G.ctx.close(); await W.ctx.close();
});
await step('live: on the day, the guide adds a person, removes a no-show and fixes a wrong tap, all over HTTP', async () => {
  const G = await phone();
  await G.page.goto(viewUrl(BASE, 'guide', { s: SEM, key: GUIDE })); await G.page.waitForSelector('.onday-panel'); await settle(G.page, 400);
  // an extra person joins
  await G.page.click('details.onday summary:has-text("Add a name")');
  const inputs = G.page.locator('.onday-form input');
  await inputs.nth(0).fill('Dubrovenko'); await inputs.nth(1).fill('Olha'); await inputs.nth(2).fill('Дубровенко'); await inputs.nth(3).fill('Ольга');
  await G.page.click('.onday-form button[type=submit]'); await G.page.waitForSelector('text=Added: Dubrovenko Olha');
  await G.page.waitForSelector('.big-count:has-text("/ 13")');
  assert.equal((await state()).names.length, 13, 'a row was appended to the Names tab');
  // she answers on her own phone
  const E = await phone();
  await begin(E.page, 'Дубровенко'); await finish(E.page, 6);
  await arm(E.page); await E.page.click('#send'); await E.page.waitForSelector('.badge-ok');
  assert.equal((await state()).rows.length, 5);
  // a no-show is removed; people who answered are not offered for removal
  await G.page.click('details.onday summary:has-text("not attending")');
  await settle(G.page, 300);
  assert.equal(await G.page.locator('#nm-remove option', { hasText: 'Melnyk' }).count(), 0);
  await G.page.selectOption('#nm-remove', { label: 'Lysenko Iryna' });
  await G.page.locator('.onday button:has-text("Remove")').first().click();
  await G.page.waitForSelector('text=Remove Lysenko Iryna from the list?');
  await G.page.click('.confirm:visible .btn-danger'); await G.page.waitForSelector('text=Removed: Lysenko Iryna');
  await G.page.waitForSelector('.big-count:has-text("/ 12")');
  assert.equal((await state()).names.length, 12, 'the row is gone from the Names tab');
  // a wrong tap: Bondarenko had answered under Moroz's name
  await G.page.click('details.onday summary:has-text("wrong name")');
  await G.page.selectOption('#nm-wrong', { label: 'Moroz Taras' });
  await G.page.selectOption('#nm-real', { label: 'Bondarenko Andrii' });
  await G.page.click('.onday button:has-text("Fix")'); await G.page.waitForSelector('text=let Moroz Taras answer again?');
  await G.page.click('.confirm:visible .btn-danger'); await G.page.waitForSelector('text=Done:');
  await G.page.waitForSelector('.missing li:has-text("Moroz")');
  const st = await state();
  assert.ok(st.used.includes(`used:${SEM}:n01`) && !st.used.includes(`used:${SEM}:n06`), 'once-only flags swapped');
  assert.equal(st.rows.length, 5, 'no answer row was touched');
  assert.equal(await G.page.locator('.missing li', { hasText: 'Moroz' }).count(), 1, 'Moroz can answer now');
  const F = await phone();
  await begin(F.page, 'Мороз'); await finish(F.page, 7);
  await arm(F.page); await F.page.click('#send'); await F.page.waitForSelector('.badge-ok');
  assert.equal((await state()).rows.length, 6);
  assert.deepEqual(G.page.errors, []);
  await G.ctx.close(); await E.ctx.close(); await F.ctx.close();
});
await step('live: results stay locked while open; wrong passcode refused; close unlocks, keeps every answer and backs them up', async () => {
  const R = await phone();
  await R.page.goto(viewUrl(BASE, 'staff', { s: SEM })); await R.page.waitForSelector('#pass');
  await R.page.fill('#pass', 'wrong-passcode'); await R.page.click('button[type=submit]');
  await R.page.waitForSelector('text=didn’t work');
  await R.page.fill('#pass', ADMIN); await R.page.click('button[type=submit]');
  await R.page.waitForSelector('text=still open');
  await R.page.click('button:has-text("Close survey…")'); await R.page.click('.btn-danger');
  await R.page.waitForSelector('.kpis');
  assert.match(await R.page.textContent('.rs-head'), /6 responses of 12 invited/);
  assert.match(await R.page.textContent('.closed-note'), /6 answers kept.*dated copy.*emailed to school@example\.com/s);
  await R.page.click('.tabs button:has-text("Comments")'); await settle(R.page);
  assert.match(await R.page.textContent('main'), /Translation: EN\(=1\+1 замало практики\)/);
  const st = await state();
  assert.equal(st.used.length, 0, 'once-only flags deleted at close');
  assert.equal(st.rows.length, 6, 'answers untouched by closing');
  assert.equal(st.mail, 1, 'one CSV backup email at close');
  assert.ok(st.tabs.some((n) => n.startsWith(`${SEM} · Answers · `)), 'dated copy of the answers tab');
  assert.equal(st.names.length, 0, 'names deleted at close');
  await R.ctx.close();
});
await step('live: after closing, the survey link shows "closed" and sends nothing', async () => {
  const Z = await phone();
  await Z.page.goto(`${BASE}?s=${SEM}`); await Z.page.waitForSelector('text=Опитування закрито');
  await Z.ctx.close();
});
await step('live: a draft from the staff tool: the preview sends nothing, the guide opens it, the waiting phone then sends', async () => {
  const d = await saveDraft('draft-test');
  const P = await phone();
  await P.page.goto(`${BASE}?s=${d.id}`); await P.page.waitForSelector('.hero h1');
  assert.match(await P.page.textContent('.preview-flag'), /Попередній перегляд: опитування ще не відкрите/);
  await P.page.click('.bar-inner .btn-primary'); await P.page.waitForSelector('.names');
  await P.page.locator('.name-opt', { hasText: 'Кравець' }).click();
  await P.page.click('.bar-inner .btn-primary'); await P.page.waitForSelector('.item'); await settle(P.page);
  await complete(P.page); await arm(P.page);
  await P.page.click('#send'); await P.page.waitForSelector('text=Ще не надіслано.');
  assert.ok(!(await state(d.id)).tabs.includes(`${d.id} · Answers`), 'a preview sends nothing and leaves no tab');
  const G = await phone();
  await G.page.goto(viewUrl(BASE, 'guide', { s: d.id, key: d.guideKey })); await G.page.waitForSelector('.draft-panel');
  assert.match(await G.page.textContent('.draft-panel'), /The survey is not open yet/);
  assert.equal(await G.page.locator('.qr-box').count(), 0, 'no QR code while it is a draft');
  assert.match(await G.page.textContent('main'), /Still to answer · 2/);
  await G.page.click('.draft-panel button:has-text("Open the survey now")');
  await G.page.waitForSelector('text=Open it now?');
  await G.page.click('.draft-panel .confirm .btn-primary');
  await G.page.waitForSelector('.qr-box svg', { timeout: 15000 });
  assert.match(await G.page.locator('.link-text').first().textContent(), new RegExp(`\\?s=${d.id}$`));
  // the phone that waited sends on its next tap, without reloading
  await P.page.click('#send'); await P.page.waitForSelector('.badge-ok', { timeout: 15000 });
  assert.equal((await state(d.id)).rows.length, 1);
  await G.page.click('.refresh-row button'); await G.page.waitForFunction(() => document.querySelector('.big-count .num')?.textContent === '1', null, { timeout: 15000 });
  assert.deepEqual(P.page.errors, []); assert.deepEqual(G.page.errors, []);
  await P.ctx.close(); await G.ctx.close();
});
await step('live: the staff page shows a draft as "not open yet" and opens it', async () => {
  const d = await saveDraft('draft-staff');
  const R = await phone();
  await R.page.goto(viewUrl(BASE, 'staff', { s: d.id })); await R.page.waitForSelector('#pass');
  await R.page.fill('#pass', ADMIN); await R.page.click('button[type=submit]');
  await R.page.waitForSelector('h2:has-text("Not open yet")');
  assert.match(await R.page.textContent('.rs-head .chip'), /Not open yet/);
  assert.match(await R.page.textContent('.rs-head'), /2 names on the list/);
  assert.equal(await R.page.locator('button:has-text("Close survey")').count(), 0, 'nothing to close yet');
  assert.match(await R.page.locator('.rs-head select option', { hasText: 'Draft test' }).first().textContent(), /not open yet/);
  await R.page.click('button:has-text("Open survey…")'); await R.page.click('.closing .btn-primary');
  await R.page.waitForSelector('text=The survey is still open', { timeout: 15000 });
  assert.match(await R.page.textContent('.rs-head .chip'), /^Open$/);
  assert.deepEqual(R.page.errors, []);
  await R.ctx.close();
});
await step('live: Google loses replies (bounced back empty, or a 404): guide, phone and staff page carry on by themselves', async () => {
  const glitch = (n, mode = 'lost') => fetch(`${GAS}/__glitch?n=${n}&mode=${mode}`);
  const d = await saveDraft('glitch-test');
  const G = await phone();
  await G.page.goto(viewUrl(BASE, 'guide', { s: d.id, key: d.guideKey })); await G.page.waitForSelector('.draft-panel');
  await G.page.click('.draft-panel button:has-text("Open the survey now")'); await G.page.waitForSelector('text=Open it now?');
  await glitch(1); // the open runs, its reply is lost
  await G.page.click('.draft-panel .confirm .btn-primary'); await G.page.waitForSelector('.qr-box svg', { timeout: 20000 });
  assert.equal(await G.page.locator('.onday-msg.err').count(), 0, 'no error shown');
  const P = await phone();
  await glitch(1); // the survey page's first request loses its reply
  await P.page.goto(`${BASE}?s=${d.id}`); await P.page.waitForSelector('.hero h1', { timeout: 20000 });
  await P.page.click('.bar-inner .btn-primary'); await P.page.waitForSelector('.names');
  await P.page.locator('.name-opt', { hasText: 'Савчук' }).click();
  await P.page.click('.bar-inner .btn-primary'); await P.page.waitForSelector('.item'); await settle(P.page);
  await complete(P.page); await arm(P.page);
  await glitch(1); // the answer is stored, its reply is lost
  await P.page.click('#send'); await P.page.waitForSelector('.badge-ok', { timeout: 20000 });
  assert.equal(await P.page.locator('.alert-error').count(), 0);
  assert.equal((await state(d.id)).rows.length, 1, 'stored once');
  await G.page.click('details.onday summary:has-text("Add a name")');
  const inputs = G.page.locator('.onday-form input');
  await inputs.nth(0).fill('Hlushko'); await inputs.nth(1).fill('Petro');
  await glitch(1, '404'); // the name is added, its reply is a 404
  await G.page.click('.onday-form button[type=submit]'); await G.page.waitForSelector('text=Added: Hlushko Petro', { timeout: 20000 });
  assert.equal((await state(d.id)).names.filter((r) => r[1] === 'Hlushko').length, 1, 'added once');
  const R = await phone();
  await R.page.goto(viewUrl(BASE, 'staff', { s: d.id })); await R.page.waitForSelector('#pass');
  await R.page.fill('#pass', ADMIN); await R.page.click('button[type=submit]'); await R.page.waitForSelector('text=still open');
  await R.page.click('button:has-text("Close survey…")');
  const mailBefore = (await state(d.id)).mail;
  await glitch(1); // the close runs (backup made), its reply is lost
  await R.page.click('.btn-danger'); await R.page.waitForSelector('.kpis', { timeout: 30000 });
  assert.match(await R.page.textContent('.rs-head'), /1 response of 3 invited/);
  assert.equal((await state(d.id)).mail, mailBefore + 1, 'one backup email');
  // The simulated 404 has no CORS header (as a real lost reply may not): the browser logs that, the site retries.
  const real = (x) => x.page.errors.filter((m) => !/echo\?t=gone|Access-Control-Allow-Origin\. Status code: 404/.test(m));
  for (const [n, x] of [['guide', G], ['phone', P], ['staff', R]]) assert.deepEqual(real(x), [], `${n}: ${JSON.stringify(real(x))}`);
  await G.ctx.close(); await P.ctx.close(); await R.ctx.close();
});
await step('live: no browser errors on any phone (CORS, JSON, scripts)', async () => {
  for (const p of [A, B, C]) assert.deepEqual(p.page.errors, []);
});

await browser.close(); server.close();
const w = Math.max(...results.map((r) => r[1].length));
for (const [st, n, m] of results) console.log(`${st === 'PASS' ? '✔' : '✘'} ${n.padEnd(w)} ${m || ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n[${ENGINE}] ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
