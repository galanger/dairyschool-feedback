// Real iPhone screenshots: iOS Simulator + Mobile Safari, driven through tests/sim/server.mjs.
// Usage: node tests/sim/run.mjs [device name]   → tests/sim/shots/*.png
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { startSimServer } from './server.mjs';

const DEVICE = process.argv[2] || 'iPhone 17e';
const OUT = new URL('./shots/', import.meta.url).pathname;
const PORT = 8770;
const BASE = `http://127.0.0.1:${PORT}/`;
const sim = (...a) => execFileSync('xcrun', ['simctl', ...a], { encoding: 'utf8' });
const udid = JSON.parse(sim('list', 'devices', 'available', '-j')).devices;
const dev = Object.values(udid).flat().find((d) => d.name === DEVICE);
if (!dev) throw new Error(`no simulator named ${DEVICE}`);

rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
console.log(`device: ${DEVICE} (${dev.udid})`);
try { sim('shutdown', 'all'); } catch { /* none running */ }
// ERASE=1 starts from a factory-fresh phone (iOS then shows first-run tips over Safari);
// by default the phone is reused so screenshots show only the page.
if (process.env.ERASE) sim('erase', dev.udid);
sim('boot', dev.udid);
sim('bootstatus', dev.udid, '-b');
sim('ui', dev.udid, 'appearance', 'light');
const { server, run, expectNewPage } = await startSimServer(PORT);
const log = [];
let n = 0;
function shot(name, what) {
  const file = `${String(++n).padStart(2, '0')}-${name}.png`;
  sim('io', dev.udid, 'screenshot', '--type=png', OUT + file);
  log.push({ file, what });
  console.log(`  📸 ${file}  ${what}`);
}
async function step(op, args = {}, name, what, timeout) {
  const res = await run({ op, ...args }, timeout);
  if (!res.ok) { console.log(`  ✘ ${op} ${JSON.stringify(args)} → ${res.info}`); shot(`FAIL-${op}`, String(res.info)); throw new Error(res.info); }
  if (name) shot(name, what || name);
  return res;
}
async function open(url) {
  // A freshly erased phone keeps setting itself up after "booted": retry until Safari opens.
  for (let i = 1; ; i++) {
    // A unique marker forces Safari to really navigate even if it already shows this address.
    const fresh = url.replace('?', `?nav=${Date.now()}&`);
    try { expectNewPage(); sim('openurl', dev.udid, fresh); break; } catch (e) {
      if (i >= 8) throw e;
      console.log(`  … Safari not ready yet (try ${i}), waiting`);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
  await step('wait', { ms: 800 }, null, null, 90000);
}

try {
  // ---------- participant, Ukrainian ----------
  await open(`${BASE}?s=demo`);
  await step('clear'); await step('reload'); await step('wait', { ms: 900 });
  shot('welcome', 'Welcome (Ukrainian by default)');
  await step('tap', { sel: 'details.privacy summary' });
  await step('show', { sel: 'details.privacy', block: 'center' }, 'privacy', 'Privacy note opened');
  await step('top');
  await step('tap', { sel: '.bar-inner .btn-primary' }, 'names', 'Find your name');
  await step('tap', { sel: '.name-opt', text: 'Мельник' }, 'name-chosen', 'Name chosen: the button says who');
  await step('tap', { sel: '.bar-inner .btn-primary' }, 'section-1', 'Section 1, nothing answered');
  await step('rate', { card: 0, value: 6 });
  await step('fill', { sel: '#c-i01', value: 'Дуже цікаво, але замало часу на фермі.' });
  await step('show', { sel: '#card-i01', block: 'start' }, 'rated-with-comment', 'First item rated 6, comment typed');
  await step('tap', { sel: '#card-i06 .linkbtn.quiet' });
  await step('show', { sel: '#card-i06', block: 'center' }, 'didnt-take-part', '“For the ladies” item: didn’t take part');
  await step('rate', { card: 1, value: 5 });
  await step('tap', { sel: '.bar-inner .btn-primary' }, 'prompt', 'Next with unrated items and a missing comment: refused with a note');
  await step('tap', { sel: '.soft .btn-primary' }, 'show-which', 'Show which: incomplete items flagged');
  await step('rateAll', { value: 5 });
  await step('tap', { sel: '.bar-inner .btn-primary' }, 'section-2', 'Section 2');
  await step('rateAll', { value: 7 });
  await step('tap', { sel: '.bar-inner .btn-primary' });
  await step('rateAll', { value: 6 });
  await step('tap', { sel: '.bar-inner .btn-primary' }, 'section-4', 'Section 4: guides, hotels, food');
  await step('rateAll', { value: 5 });
  await step('tap', { sel: '.bar-inner .btn-primary' }, 'last-top', 'Last page: overall questions, button says Next');
  await step('tap', { sel: '.bar-inner .btn-primary' }, 'open-questions', 'Next scrolls to the open questions');
  await step('fill', { sel: '#o-q1', value: 'Лекції та візити на ферми.' });
  await step('fill', { sel: '#o-q2', value: 'Більше часу на фермах.' });
  await step('rateAll', { value: 7 });
  await step('show', { sel: '.summary', block: 'center' }, 'summary-send', 'Summary seen: Send is ready');
  await step('tap', { sel: '#send' }, 'thanks', 'Sent: thank-you screen');
  await step('reload'); await step('wait', { ms: 800 }, 'already', 'Same phone reopens the link');
  await step('tap', { sel: 'main .btn-secondary' });
  await step('tap', { sel: '.bar-inner .btn-primary' });
  await step('show', { sel: '.name-opt.is-done', block: 'center' }, 'names-answered', 'The person who answered is greyed out');
  // ---------- English + errors ----------
  await step('tap', { sel: '.lang button', text: 'EN' });
  await step('tap', { sel: '.name-opt:not(.is-done)' });
  await step('tap', { sel: '.bar-inner .btn-primary' }, 'section-1-en', 'Section 1 in English');
  await step('goto', { url: `${BASE}?s=nope-nope` }); await step('wait', { ms: 800 }, 'invalid-link', 'Invalid link, both languages');
  // ---------- guide ----------
  await step('goto', { url: `${BASE}?s=demo#guide-demo` }); await step('wait', { ms: 1200 }, 'guide', 'Guide view (English)');
  await step('tap', { sel: 'button', text: 'Full-screen QR code' }, 'guide-qr', 'Full-screen QR for the group');
  await step('tap', { sel: '.qr-full .btn' });
  // ---------- staff results on a phone ----------
  await step('hash', { value: 'results' }); await step('wait', { ms: 800 }, 'results-gate', 'Staff passcode');
  await step('fill', { sel: '#pass', value: 'demo' });
  await step('tap', { sel: '.gate button[type=submit]' });
  await step('show', { sel: '.big-count', block: 'center' }, 'results-open', 'Survey still open: results locked');
  await step('select', { sel: '.rs-head select', value: 'bovicura-2023' }); await step('wait', { ms: 900 }, 'results-dashboard', 'Dashboard, 2023 forms');
  await step('show', { sel: '.sum-grid', block: 'start' }, 'results-summary', 'Needs attention / went well');
  await step('tap', { sel: '.tabs button', text: 'Items' }); await step('show', { sel: '.table-wrap', block: 'start' }, 'results-items', 'Items table on a phone');
  await step('tap', { sel: '.tabs button', text: 'Areas' }); await step('show', { sel: '.dotplot', block: 'center' }, 'results-areas', 'Areas chart on a phone');
  await step('tap', { sel: '.tabs button', text: 'Client sheet' }); await step('show', { sel: '.sheet-stage', block: 'start' }, 'results-sheet', 'Client sheet scaled to the phone');
  // ---------- dark mode ----------
  sim('ui', dev.udid, 'appearance', 'dark');
  await step('clear');
  await step('goto', { url: `${BASE}?s=demo` }); await step('wait', { ms: 900 }, 'dark-welcome', 'Welcome, dark mode');
  await step('tap', { sel: '.bar-inner .btn-primary' });
  await step('tap', { sel: '.name-opt', text: 'Ткачук' });
  await step('tap', { sel: '.bar-inner .btn-primary' });
  await step('rate', { card: 0, value: 6 }, 'dark-section', 'Section 1, dark mode, one rated');
  console.log('done');
} catch (e) {
  console.log('stopped:', e.message);
  try { shot('LAST-STATE', `state when stopped: ${e.message}`); } catch { /* ignore */ }
  process.exitCode = 1;
} finally {
  writeFileSync(OUT + 'index.json', JSON.stringify(log, null, 1));
  server.close();
  sim('ui', dev.udid, 'appearance', 'light');
  try { sim('shutdown', dev.udid); } catch { /* ignore */ }
}
