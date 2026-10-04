// Writes a seminar into the school's Google Sheet as a draft: titles, dates, questions and names.
// A new draft gets a hard-to-guess id and its own guide key. With --id, an existing draft is
// rewritten in place (same links), which the backend allows only while it is a draft without
// answers; open and closed seminars, and answers, are never touched.
//
// Usage:
//   PASSCODE=<staff passcode> node tools/save-draft.mjs <seminar.json> [names.csv] [--id <seminar id>] [--dry]
//
// seminar.json  { "base": "uvt-2026",
//                 "seminar": { "title_en", "title_uk", "subtitle_en", "subtitle_uk", "start": "2026-10-04",
//                              "end": "2026-10-11", "languages": "uk,en", "default_lang": "uk", "report_name" },
//                 "items": [ { "section_en", "section_uk", "category", "label_en", "label_uk",
//                              "detail_en"?, "detail_uk"?, "optional"?, "key"? ("overall" | "recommend") } ] }
// names.csv     id,surname,given,surname_cyr,given_cyr   (names only, never passport numbers)
//
// The backend and public site addresses come from site/config.js (override with BACKEND / SITE).
// Keep real seminar files and names in private/ (not published).
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const take = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const dry = args.includes('--dry'); if (dry) args.splice(args.indexOf('--dry'), 1);
const id = take('--id');
const [jsonPath, csvPath] = args;
if (!jsonPath) {
  console.error('Usage: PASSCODE=… node tools/save-draft.mjs <seminar.json> [names.csv] [--id <seminar id>] [--dry]');
  process.exit(2);
}

const cfgText = readFileSync(new URL('../site/config.js', import.meta.url), 'utf8');
const fromCfg = (k) => (cfgText.match(new RegExp(`${k}:\\s*'([^']*)'`)) || [])[1] || null;
const BACKEND = process.env.BACKEND || fromCfg('backendUrl');
const SITE = (process.env.SITE || fromCfg('publicUrl') || '').replace(/\/?$/, '/');
const KEY = process.env.PASSCODE;

function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...data] = rows.filter((r) => r.some((x) => x.trim()));
  return data.map((r) => Object.fromEntries(head.map((h, i) => [h.trim().replace(/^﻿/, ''), (r[i] || '').trim()])));
}

const spec = JSON.parse(readFileSync(jsonPath, 'utf8'));
const body = { action: 'saveDraft', key: KEY, base: spec.base, seminar: spec.seminar, items: spec.items };
if (id) body.s = id;
if (csvPath) {
  body.names = parseCsv(readFileSync(csvPath, 'utf8'))
    .map((r) => ({ surname: r.surname, given: r.given, surname_cyr: r.surname_cyr, given_cyr: r.given_cyr }));
}

// What will be written, so it can be checked before (and in the log after) sending.
const sections = [];
spec.items.forEach((it) => { if (!sections.includes(it.section_en)) sections.push(it.section_en); });
console.log(`${id ? `Rewrite draft ${id}` : `New draft "${spec.base}-…"`}: ${spec.seminar.title_en} · ${spec.seminar.start} to ${spec.seminar.end}`);
sections.forEach((s, i) => {
  console.log(`  page ${i + 1}. ${s}`);
  spec.items.forEach((it, n) => { if (it.section_en === s) console.log(`     ${String(n + 1).padStart(2)}. [${it.category}${it.key ? ` · ${it.key}` : ''}] ${it.label_en}`); });
});
console.log(`  names: ${body.names ? body.names.length : 'unchanged'}`);
if (dry) process.exit(0);
if (!KEY || !BACKEND) { console.error('PASSCODE and a backend address (site/config.js or BACKEND) are needed.'); process.exit(2); }

// Google answers with a redirect to the reply; fetch follows it as a GET, like a browser.
// Google sometimes loses that reply after the request has run: a rewrite (--id) is then simply
// sent again, but a new draft is not, so it is never created twice.
let out;
for (let attempt = 1; attempt <= (id ? 3 : 1); attempt++) {
  out = await fetch(BACKEND, {
    method: 'POST', body: JSON.stringify(body), redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: AbortSignal.timeout(120000),
  }).then((r) => r.json().catch(() => ({ ok: false, code: `HTTP ${r.status}` })), (e) => ({ ok: false, code: `NETWORK (${e.name})` }));
  if (out.ok || !/^(LOST|HTTP|NETWORK)/.test(out.code)) break;
}
if (!out.ok && /^(LOST|HTTP|NETWORK)/.test(out.code)) {
  console.error(id
    ? `No reply from Google (${out.code}) after 3 tries. Running the same command again is safe.`
    : `No reply from Google (${out.code}). The draft may have been created anyway: look at the seminar list on the staff page (or the Seminars tab) before running this again, and use --id to change it.`);
  process.exit(1);
}
if (!out.ok) {
  console.error(`Refused: ${out.code}${out.problem ? ` (${out.problem})` : ''}`);
  process.exit(1);
}
console.log(`\nSaved as a draft: ${out.id} · ${out.items} questions · ${out.names} names`);
console.log(`Participants (QR):  ${SITE}?s=${out.id}`);
console.log(`Guide:              ${SITE}guide.html?s=${out.id}#${out.guideKey}`);
console.log(`Staff:              ${SITE}staff.html?s=${out.id}`);
