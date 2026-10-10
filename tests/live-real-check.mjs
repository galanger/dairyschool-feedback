// Read-only check of a REAL seminar on the live site and the real backend: nothing is opened, sent or
// changed. Walks the participant preview page by page against the seminar's spec file, the guide
// page (draft state) and the staff page.
// Usage: SEMINAR=<id> GUIDEKEY=<guide key> PASSCODE=<staff passcode> SPEC=private/<spec>.json NAMES=private/<names>.csv OUT=<dir> node tests/live-real-check.mjs
import { chromium, webkit, devices } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'https://galanger.github.io/dairyschool-feedback/';
const ID = process.env.SEMINAR, KEY = process.env.GUIDEKEY, PASS = process.env.PASSCODE, OUT = process.env.OUT || 'tests/output/live-real';
mkdirSync(OUT, { recursive: true });
const spec = JSON.parse(readFileSync(process.env.SPEC, 'utf8'));
const csv = readFileSync(process.env.NAMES, 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
const T = 120000;
const rows = []; const check = (ok, label) => rows.push([!!ok, label]);
const pages = []; spec.items.forEach((it, i) => { let p = pages.find((x) => x.en === it.section_en); if (!p) { p = { en: it.section_en, uk: it.section_uk, items: [] }; pages.push(p); } p.items.push({ n: i + 1, ...it }); });
const backend = readFileSync('site/config.js', 'utf8').match(/backendUrl:\s*'([^']+)'/)[1];
const config = async () => { for (let i = 0; i < 5; i++) { const r = await fetch(`${backend}?action=config&s=${ID}`, { redirect: 'follow', signal: AbortSignal.timeout(T) }).then((x) => x.json()).catch(() => null); if (r?.ok) return r.seminar; await new Promise((r2) => setTimeout(r2, 3000)); } return null; };
const settle = (p, ms = 500) => p.waitForTimeout(ms);
const text = (p, sel = 'main') => p.locator(sel).first().textContent({ timeout: T }).catch(() => '');
for (const [name, launch, ctxOpts] of [['chrome', () => chromium.launch({ channel: 'chrome' }), { ...devices['Pixel 7'] }], ['webkit', () => webkit.launch(), { ...devices['iPhone 13'] }]]) {
  const browser = await launch();
  const mk = async () => { const ctx = await browser.newContext(ctxOpts); const page = await ctx.newPage(); page.errors = []; page.on('pageerror', (e) => page.errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); }); return page; };
  try {
    const P = await mk();
    await P.goto(BASE); await P.waitForSelector('main h1', { timeout: T }).catch(() => {});
    const bare = await text(P); check(/Link not valid/.test(bare) && /Посилання недійсне/.test(bare), `${name}: bare address → bilingual "link not valid"`);
    let t0 = Date.now(); await P.goto(`${BASE}?s=${ID}`); await P.waitForSelector('.hero h1', { timeout: T });
    check(true, `${name}: participant page loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    check(/Попередній перегляд: опитування ще не відкрите/.test(await text(P, '.preview-flag')), `${name}: preview notice in Ukrainian`);
    check((await text(P, '.hero h1')).trim() === spec.seminar.title_uk, `${name}: title as in the program`);
    check(/4–11 жовтня 2026/.test(await text(P)), `${name}: dates in Ukrainian`);
    check((await P.locator('meta[http-equiv="Content-Security-Policy"]').count()) === 1 && (await P.locator('meta[name="robots"][content*="noindex"]').count()) === 1, `${name}: security policy and noindex present`);
    check((await P.locator('main a').count()) === 0 && (await P.locator('.demo-bar').count()) === 0, `${name}: no links and no prototype bar for participants`);
    await P.click('.bar-inner .btn-primary'); await P.waitForSelector('.names', { timeout: T }); await settle(P, 800);
    const opts = await P.locator('.name-opt').allTextContents();
    check(opts.length === csv.length, `${name}: ${csv.length} names offered (${opts.length})`);
    check(csv.every((r) => opts.some((o) => o.includes(r[3]))), `${name}: every surname from the list is there, in Cyrillic`);
    check((await P.locator('.name-opt.is-done').count()) === 0, `${name}: nobody greyed out (nobody has answered)`);
    await P.locator('.name-opt').first().click(); await P.click('.bar-inner .btn-primary'); await P.waitForSelector('.item', { timeout: T }); await settle(P);
    let allOk = true; const seen = [];
    for (let k = 0; k < pages.length; k++) {
      const p = pages[k]; seen.push((await text(P, 'main h1')).trim());
      const cards = P.locator('.item'); const n = await cards.count();
      if (n !== p.items.length) { allOk = false; check(false, `${name}: page ${k + 1} has ${n} questions, expected ${p.items.length}`); }
      for (let i = 0; i < Math.min(n, p.items.length); i++) {
        const it = p.items[i], c = cards.nth(i);
        const lbl = (await c.locator('legend .t').textContent()).trim(); if (lbl !== it.label_uk) { allOk = false; check(false, `${name}: page ${k + 1} q${i + 1} label "${lbl}"`); }
        if (it.detail_uk) { const d = (await c.locator('.detail').textContent().catch(() => '')).trim(); if (d !== it.detail_uk) { allOk = false; check(false, `${name}: page ${k + 1} q${i + 1} detail`); } }
        await c.locator('.scale label:nth-child(6)').click();
      }
      await P.screenshot({ path: `${OUT}/${name}-page-${k + 1}.png`, fullPage: true });
      if (k < pages.length - 1) { await P.click('.bar-inner .btn-primary'); await P.waitForSelector('.item', { timeout: T }); await settle(P, 300); }
    }
    check(allOk, `${name}: all ${pages.length} pages: ${spec.items.length} questions, details and order exactly as in the file`);
    check(seen.slice(0, -1).every((h, i) => h === pages[i].uk) && seen.at(-1) === 'Останні запитання', `${name}: page titles in Ukrainian, last page "Останні запитання"`);
    check((await P.locator('.q-open textarea').count()) === 2, `${name}: the two closing questions are there`);
    await P.fill('#o-q1', 'Перевірка.'); await P.fill('#o-q2', 'Перевірка.'); await P.locator('.summary').scrollIntoViewIfNeeded(); await P.waitForSelector('#send');
    await P.click('#send'); const refused = await P.waitForSelector('text=Ще не надіслано.', { timeout: T }).then(() => true).catch(() => false);
    check(refused, `${name}: Send on the preview is refused politely; nothing is sent`);
    const c2 = await config(); check(c2 && c2.status === 'draft' && c2.names.every((n) => !n.answered), `${name}: afterwards still a draft, nobody marked as answered`);
    check(P.errors.length === 0, `${name}: no script errors on the participant page${P.errors.length ? ` (${P.errors.join(' | ')})` : ''}`);
    await P.context().close();
    const G = await mk();
    await G.goto(`${BASE}guide.html?s=${ID}#not-the-key`); await G.waitForSelector('text=isn’t valid', { timeout: T }).catch(() => {});
    check(/isn’t valid/.test(await text(G)), `${name}: guide page refuses a wrong key`);
    await G.goto('about:blank'); // a change of the part after # alone would not reload the page
    t0 = Date.now(); await G.goto(`${BASE}guide.html?s=${ID}#${KEY}`); await G.waitForSelector('.draft-panel', { timeout: T }); await settle(G, 800);
    check(true, `${name}: guide page loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    check(/The survey is not open yet/.test(await text(G, '.draft-panel')) && (await G.locator('.draft-panel button:has-text("Open the survey now")').count()) === 1, `${name}: guide sees "not open yet" with the Open button (not tapped)`);
    check((await G.locator('.qr-box').count()) === 0, `${name}: no QR code before opening`);
    check(new RegExp(`0\\s*/ ${csv.length} answered`).test(await text(G, '.big-count')), `${name}: 0 / ${csv.length} answered`);
    const missing = await G.locator('.missing li .name-main').allTextContents();
    check(missing.length === csv.length && csv.every((r) => missing.some((m) => m.includes(r[1]))), `${name}: all ${csv.length} names still to answer, Latin as in the passports`);
    check((await G.locator('.onday-panel').count()) === 1, `${name}: on-the-day panel present`);
    await G.screenshot({ path: `${OUT}/${name}-guide.png`, fullPage: true });
    check(G.errors.length === 0, `${name}: no script errors on the guide page`);
    await G.context().close();
    const S = await mk();
    await S.goto(`${BASE}staff.html?s=${ID}`); await S.waitForSelector('#pass', { timeout: T });
    await S.fill('#pass', 'not-the-passcode-1'); await S.click('button[type=submit]'); await S.waitForSelector('text=didn’t work', { timeout: T }).catch(() => {});
    check(/didn’t work/.test(await text(S)), `${name}: staff page refuses a wrong passcode`);
    t0 = Date.now(); await S.fill('#pass', PASS); await S.click('button[type=submit]'); await S.waitForSelector('h2:has-text("Not open yet")', { timeout: T }); await settle(S, 500);
    check(true, `${name}: staff page opened in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    check(/Not open yet/.test(await text(S, '.rs-head .chip')) && new RegExp(`${csv.length} names on the list`).test(await text(S, '.rs-head')), `${name}: "Not open yet", ${csv.length} names on the list`);
    check((await S.locator('button:has-text("Open survey…")').count()) === 1 && (await S.locator('button:has-text("Close survey")').count()) === 0, `${name}: Open available (not tapped), nothing to close`);
    check((await S.locator('.rs-head select option').count()) <= 1, `${name}: the seminar list holds only this survey`);
    await S.screenshot({ path: `${OUT}/${name}-staff.png`, fullPage: true });
    check(S.errors.length === 0, `${name}: no script errors on the staff page`);
    await S.context().close();
  } catch (e) { check(false, `${name}: stopped early: ${String(e.message || e).split('\n')[0]}`); }
  await browser.close();
}
for (const [ok, l] of rows) console.log(`${ok ? '✔' : '✘'} ${l}`);
console.log(`\n${rows.filter((r) => r[0]).length} passed, ${rows.filter((r) => !r[0]).length} failed`);
process.exit(rows.some((r) => !r[0]) ? 1 : 0);
