// Lists the comment and closing-answer texts of a seminar that have no English entry yet in a translations map
// (usage: node tools/report-untranslated.mjs <export.json> <seminar id> <translations.json>).
// The map is { "original text": "English" }, keyed by the exact trimmed original, as tools/report-pdf.mjs reads it.
// Each missing text is printed with its response row, sent time, item and rating. Exit code 1 while anything is missing.
import fs from 'node:fs';
const [exportFile, id, trFile] = process.argv.slice(2);
if (!exportFile || !id || !trFile) { console.error('usage: node tools/report-untranslated.mjs <export.json> <seminar id> <translations.json>'); process.exit(2); }
const X = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
const T = fs.existsSync(trFile) ? JSON.parse(fs.readFileSync(trFile, 'utf8')) : {};
const tab = (n) => X.tabs[`${id} · ${n}`] || [];
const ih = tab('Items')[0] || [];
const items = tab('Items').slice(1).filter((r) => r[1]).map((r) => Object.fromEntries(ih.map((k, i) => [k, r[i] ?? ''])));
const [head, ...rows] = tab('Answers');
if (!head) { console.error(`no "${id} · Answers" tab in ${exportFile}`); process.exit(2); }
const K = items.length;
const sentCol = head.indexOf('Sent (Israel time)');
const openQ = head.slice(1 + 2 * K).filter((h) => h && h !== 'Sent (Israel time)');
let total = 0, missing = 0; const seen = new Set();
rows.filter((r) => r[0]).forEach((r, ri) => {
  const sent = sentCol >= 0 ? String(r[sentCol] || '') : '';
  const check = (text, where) => {
    const t = String(text || '').trim(); if (!t) return;
    total++; if (seen.has(t)) return; seen.add(t);
    if (T[t] && String(T[t]).trim()) return;
    missing++; console.log(`[row ${ri + 1}${sent ? ` · sent ${sent}` : ''}] ${where}\n   ${t}\n`);
  };
  items.forEach((it, k) => check(r[1 + K + k], `Q${it.no || k + 1} ${it.label_en} · rating ${r[1 + k] || '–'}`));
  openQ.forEach((q, qi) => check(r[1 + 2 * K + qi], `OPEN: ${q}`));
});
console.log(`texts ${total} · unique ${seen.size} · untranslated ${missing} · entries in the map ${Object.keys(T).length}`);
process.exit(missing ? 1 : 0);
