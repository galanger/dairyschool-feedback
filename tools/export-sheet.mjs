// Read-only copy of the answers Sheet as JSON, for reports (usage: SHEET=<spreadsheet id> node tools/export-sheet.mjs <out.json>).
// Uses clasp's own sign-in (~/.clasprc.json) and the Drive export, so nothing in the Sheet changes and no new access is set up.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const sheetId = process.env.SHEET, out = process.argv[2];
if (!sheetId || !out) { console.error('usage: SHEET=<spreadsheet id> node tools/export-sheet.mjs <out.json>'); process.exit(2); }
const rc = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.clasprc.json'), 'utf8'));
const t = rc.tokens?.default || rc.token || rc;
const tok = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: t.client_id, client_secret: t.client_secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' }) })).json();
if (!tok.access_token) { console.error('could not refresh clasp token', tok); process.exit(1); }
const res = await fetch(`https://www.googleapis.com/drive/v3/files/${sheetId}/export?mimeType=${encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
if (!res.ok) { console.error('export failed', res.status, await res.text()); process.exit(1); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-')); const xlsx = path.join(dir, 'sheet.xlsx');
fs.writeFileSync(xlsx, Buffer.from(await res.arrayBuffer()));
execFileSync('unzip', ['-o', '-q', xlsx, '-d', path.join(dir, 'x')]);
const read = (p) => fs.readFileSync(path.join(dir, 'x', p), 'utf8');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const texts = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => unesc(m[1] || '')).join('');
const shared = fs.existsSync(path.join(dir, 'x/xl/sharedStrings.xml')) ? [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1])) : [];
const rels = Object.fromEntries([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])[1], /Target="([^"]+)"/.exec(m[0])[1]]));
const tabs = {};
for (const m of read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
  const name = unesc(/name="([^"]*)"/.exec(m[0])[1]), rid = /r:id="([^"]+)"/.exec(m[0])[1], target = rels[rid];
  const xml = read(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  const rows = [];
  for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {}; let width = 0;
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /r="([A-Z]+)\d+"/.exec(c[1])[1]; let n = 0; for (const ch of ref) n = n * 26 + ch.charCodeAt(0) - 64;
      const type = /\bt="([^"]+)"/.exec(c[1])?.[1]; const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] || '')?.[1] ?? '';
      cells[n] = type === 's' ? shared[+v] : type === 'inlineStr' ? texts(c[2] || '') : unesc(v); width = Math.max(width, n);
    }
    rows.push(Array.from({ length: width }, (_, i) => cells[i + 1] ?? ''));
  }
  tabs[name] = rows;
}
fs.rmSync(dir, { recursive: true, force: true });
const exportedAt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'medium' }).format(new Date()).replace(',', '');
fs.writeFileSync(out, JSON.stringify({ exportedAt, timeZone: 'Asia/Jerusalem', tabs }));
console.log('exported', Object.keys(tabs).map((k) => `${k} (${tabs[k].length} rows)`).join(', '), '· at', exportedAt, 'Israel time');
