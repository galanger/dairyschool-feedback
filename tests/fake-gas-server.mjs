// Serves backend/Code.gs over HTTP the way Google does: /exec answers with a 302 to a one-time
// URL that returns the JSON, both with Access-Control-Allow-Origin: *; preflight (OPTIONS) gets
// no CORS headers, so any client request that needs a preflight fails, as on Google.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { FakeSheet, makeEnv } from './gas-fakes.mjs';
import { DEMO_SEMINAR } from '../site/assets/js/demo-data.js';

export const SEM = 'uvt-demo-ab12';
export const ADMIN = 'staff-passcode-123';
export const GUIDE = 'guide-key-1';

export function seedEnv() {
  const env = makeEnv();
  const cols = ['id', 'title_en', 'title_uk', 'subtitle_en', 'subtitle_uk', 'start', 'end', 'languages', 'default_lang', 'status', 'guide_key', 'report_name', 'invited'];
  env.book.sheets.push(new FakeSheet('Seminars', [cols,
    [SEM, 'UVT Ukraine · Israel 2026', 'UVT Україна · Ізраїль 2026', 'Dairy farming in Israel', 'Молочне скотарство в Ізраїлі',
      new Date('2026-10-03T21:00:00Z'), new Date('2026-10-10T21:00:00Z'), 'uk,en', 'uk', 'open', GUIDE, 'UVT Ukraine', '']]));
  const secTitle = Object.fromEntries(DEMO_SEMINAR.sections.map((x) => [x.id, x.title]));
  env.book.sheets.push(new FakeSheet(`${SEM} · Items`, [
    ['no', 'id', 'section_en', 'section_uk', 'category', 'label_en', 'label_uk', 'detail_en', 'detail_uk', 'optional', 'key'],
    ...DEMO_SEMINAR.items.map((it) => [it.no, it.id, secTitle[it.section].en, secTitle[it.section].uk, it.category,
      it.label.en, it.label.uk, '', '', !!it.optional, it.key || ''])]));
  env.book.sheets.push(new FakeSheet(`${SEM} · Names`, [['id', 'surname', 'given', 'surname_cyr', 'given_cyr'],
    ...DEMO_SEMINAR.names.map((n) => [n.id, n.surname, n.given, n.surnameCyr, n.givenCyr])]));
  env.props.set('ADMIN_KEY', ADMIN);
  return env;
}

export function startServer(port = 8790) {
  let env = seedEnv();
  const pending = new Map();
  const cors = { 'Access-Control-Allow-Origin': '*' };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    await new Promise((r) => setTimeout(r, 120)); // Apps Script is never instant
    if (req.method === 'OPTIONS') { res.writeHead(200, { Allow: 'HEAD, GET, POST' }); return res.end(); }
    if (url.pathname === '/exec') {
      let out;
      if (req.method === 'GET') out = env.doGet({ parameter: Object.fromEntries(url.searchParams) }).getContent();
      else {
        const body = await new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });
        out = env.doPost({ postData: { contents: body, type: req.headers['content-type'] } }).getContent();
      }
      const token = randomUUID();
      pending.set(token, out);
      res.writeHead(302, { ...cors, Location: `http://127.0.0.1:${port}/echo?t=${token}` });
      return res.end();
    }
    if (url.pathname === '/echo') {
      const out = pending.get(url.searchParams.get('t'));
      pending.delete(url.searchParams.get('t'));
      if (!out) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      return res.end(out);
    }
    // test helpers
    if (url.pathname === '/__reset') { env = seedEnv(); res.writeHead(200, cors); return res.end('ok'); }
    if (url.pathname === '/__state') {
      const answers = env.book.getSheetByName(`${SEM} · Answers`);
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ rows: answers ? answers.data.slice(1) : [], used: [...env.props.keys()].filter((k) => k.startsWith('used:')) }));
    }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startServer();
  console.log('fake Apps Script on http://127.0.0.1:8790/exec');
}
