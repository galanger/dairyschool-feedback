// Runs backend/Code.gs against an in-memory imitation of Google Sheets / Apps Script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { analyze } from '../site/assets/js/analytics.js';

import { FakeSheet, makeEnv } from './gas-fakes.mjs';

const S = 'uvt-2026-ab12';
function seed(env) {
  const { book, props } = env;
  const cols = ['id', 'title_en', 'title_uk', 'subtitle_en', 'subtitle_uk', 'start', 'end', 'languages', 'default_lang', 'status', 'guide_key', 'report_name', 'invited'];
  // Dates as Sheets stores them: local midnight in Israel (UTC+3 in October).
  book.sheets.push(new FakeSheet('Seminars', [cols,
    [S, 'UVT Ukraine', 'UVT Україна', '', '', new Date('2026-10-03T21:00:00Z'), new Date('2026-10-10T21:00:00Z'), 'uk,en', 'uk', 'open', 'guide-key-1', 'UVT Ukraine', '']]));
  book.sheets.push(new FakeSheet(`${S} · Items`, [
    ['no', 'id', 'section_en', 'section_uk', 'category', 'label_en', 'label_uk', 'detail_en', 'detail_uk', 'optional', 'key'],
    [1, 'i01', 'Day 1', 'День 1', 'lecture', 'Lecture: heat stress', 'Лекція', '', '', false, ''],
    [2, 'i02', 'Day 1', 'День 1', 'farm', 'Farm visit', 'Ферма', '', '', false, ''],
    [3, 'i03', 'Day 2', 'День 2', 'partners', 'Ladies tour', 'Для дам', '', '', true, ''],
    [4, 'i04', 'Overall', 'Загальна', 'overall', 'Recommend', 'Рекомендація', '', '', false, 'recommend'],
    [5, 'i05', 'Overall', 'Загальна', 'overall', 'Overall', 'Загалом', '', '', false, 'overall']]));
  book.sheets.push(new FakeSheet(`${S} · Names`, [['id', 'surname', 'given', 'surname_cyr', 'given_cyr'],
    ['n1', 'Bondarenko', 'Oleksandr', 'Бондаренко', 'Олександр'], ['n2', 'Melnyk', 'Oleksandr', 'Мельник', 'Олександр'], ['n3', 'Hnatiuk', 'Olena', 'Гнатюк', 'Олена']]));
  props.set('ADMIN_KEY', 'staff-passcode-123');
}
const get = (env, params) => JSON.parse(env.doGet({ parameter: params }).getContent());
const post = (env, body) => JSON.parse(env.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent());
const sub = (nameId, answers, extra = {}) => ({ action: 'submit', s: S, nameId, submissionId: randomUUID(), answers, ...extra });

// ---------- tests ----------
test('config: items, sections, names, and dates in Israel time', () => {
  const env = makeEnv(); seed(env);
  const r = get(env, { action: 'config', s: S });
  assert.equal(r.ok, true);
  assert.equal(r.seminar.items.length, 5);
  assert.deepEqual(r.seminar.sections.map((x) => x.title.en), ['Day 1', 'Day 2', 'Overall']);
  assert.equal(r.seminar.items[2].optional, true);
  assert.equal(r.seminar.items[3].key, 'recommend');
  assert.deepEqual(r.seminar.dates, { start: '2026-10-04', end: '2026-10-11' });
  assert.equal(r.seminar.names.length, 3);
  assert.equal(r.seminar.names[0].answered, false);
  assert.equal(get(env, { action: 'config', s: 'nope-nope' }).code, 'NOT_FOUND');
  assert.equal(get(env, { action: 'config', s: '../x' }).code, 'NOT_FOUND');
});

test('once per name; a repeated send counts once', () => {
  const env = makeEnv(); seed(env);
  const first = sub('n1', { i01: 6, i02: 5, i03: 'na', i04: 7, i05: 6 });
  assert.equal(post(env, first).ok, true);
  const again = post(env, first);
  assert.deepEqual(again, { ok: true, repeat: true });
  assert.equal(post(env, sub('n1', { i01: 1 })).code, 'NAME_TAKEN');
  assert.equal(post(env, sub('zz', { i01: 1 })).code, 'NAME_UNKNOWN');
  const answers = env.book.getSheetByName(`${S} · Answers`);
  assert.equal(answers.getLastRow(), 2, 'header + one response');
  assert.equal(get(env, { action: 'config', s: S }).seminar.names.find((n) => n.id === 'n1').answered, true);
});

test('stored answers carry no name and no language; the last column is the time sent, in Israel time', () => {
  const env = makeEnv(); seed(env);
  post(env, sub('n1', { i01: 6 }, { comments: { i01: 'Дуже добре' }, lang: 'uk', name: 'Bondarenko' }));
  const sheet = env.book.getSheetByName(`${S} · Answers`);
  const flat = JSON.stringify(sheet.data);
  assert.ok(!/Bondarenko|Бондаренко|n1|uk"/.test(flat), flat);
  assert.deepEqual(sheet.data[0].slice(0, 2), ['response', '1. Lecture: heat stress']);
  assert.equal(sheet.data[0].at(-1), 'Sent (Israel time)');
  assert.ok(!sheet.data[0].slice(0, -1).some((h) => /time|date|name|lang/i.test(h)));
  const sent = sheet.data[1].at(-1);
  assert.match(sent, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, sent);
  const israel = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).format(d).replace(', ', ' ');
  assert.ok([israel(new Date()), israel(new Date(Date.now() - 3600000))].includes(sent.slice(0, 13)), `${sent} is Israel time`);
  // the once-only flag lives apart from the answers and has no timestamp
  assert.deepEqual([...env.props.keys()].filter((k) => k.startsWith('used:')), [`used:${S}:n1`]);
  assert.equal(env.props.get(`used:${S}:n1`), '1');
  post(env, { action: 'status', s: S, key: 'staff-passcode-123', status: 'closed' });
  assert.equal(post(env, { action: 'results', s: S, key: 'staff-passcode-123' }).responses[0].sentAt, sent, 'results carry it');
  assert.match(env.mail[0].attachments[0].content.split('\r\n')[0], /Sent \(Israel time\)$/, 'the CSV backup has the column');
});

test('answers are inserted at random rows, not in arrival order', () => {
  const env = makeEnv({ random: () => 0 }); seed(env); // always insert at the top
  const a = sub('n1', { i01: 1 }), b = sub('n2', { i01: 2 }), c = sub('n3', { i01: 3 });
  [a, b, c].forEach((x) => post(env, x));
  const ids = env.book.getSheetByName(`${S} · Answers`).data.slice(1).map((r) => r[0]);
  assert.deepEqual(ids, [c.submissionId, b.submissionId, a.submissionId]);
});

test('text stays text: formulas, dates and dashes are neutralised', () => {
  const env = makeEnv(); seed(env);
  const tricky = ['=HYPERLINK("http://x")', '10/10', '- too long', '+972 54', '@me'];
  post(env, sub('n1', { i01: 5 }, { comments: { i01: tricky[0], i02: tricky[1], i03: tricky[2] }, open: { q1: tricky[3], q2: tricky[4] } }));
  const sheet = env.book.getSheetByName(`${S} · Answers`);
  assert.equal(sheet.formulas, 0, 'no live formula was written');
  env.book.getSheetByName('Seminars').data[1][9] = 'closed';
  const r = post(env, { action: 'results', s: S, key: 'staff-passcode-123' });
  assert.equal(r.responses[0].comments.i01, tricky[0]);
  assert.equal(r.responses[0].comments.i02, tricky[1]);
  assert.equal(r.responses[0].open.q2, tricky[4]);
});

test('bad input is refused with a clear code, never an HTML error', () => {
  const env = makeEnv(); seed(env);
  assert.equal(post(env, '{not json').code, 'INVALID');
  assert.equal(post(env, 'x'.repeat(70000)).code, 'INVALID');
  assert.equal(post(env, { action: 'submit', s: S, nameId: 'n1', submissionId: 'short', answers: {} }).code, 'INVALID');
  assert.equal(post(env, { action: 'nope' }).code, 'INVALID');
  // junk values are dropped, valid ones kept
  post(env, sub('n2', { i01: 9, i02: '7', i03: 3.5, i04: 'na', i05: 7, zz: 5 }));
  const row = env.book.getSheetByName(`${S} · Answers`).data[1];
  assert.deepEqual(row.slice(1, 6), ['', '', '', 'NA', 7]);
  // an internal failure still answers in JSON
  env.book.getSheetByName = () => { throw new Error('boom'); };
  assert.deepEqual(get(env, { action: 'config', s: S }), { ok: false, code: 'SERVER' });
});

test('busy server says BUSY instead of hanging', () => {
  const env = makeEnv(); seed(env);
  env.holdLock();
  assert.equal(post(env, sub('n1', { i01: 6 })).code, 'BUSY');
  env.freeLock();
  assert.equal(post(env, sub('n1', { i01: 6 })).ok, true);
});

test('guide sees progress only; staff results stay locked while open', () => {
  const env = makeEnv(); seed(env);
  post(env, sub('n1', { i01: 6 }));
  const g = post(env, { action: 'progress', s: S, key: 'guide-key-1' });
  assert.equal(g.answered, 1); assert.equal(g.total, 3);
  assert.deepEqual(g.missing.map((n) => n.id), ['n2', 'n3']);
  assert.ok(!('responses' in g));
  assert.equal(post(env, { action: 'progress', s: S, key: 'wrong' }).code, 'UNAUTHORIZED');
  const locked = post(env, { action: 'results', s: S, key: 'staff-passcode-123' });
  assert.equal(locked.code, 'LOCKED'); assert.ok(!('responses' in locked));
  assert.equal(post(env, { action: 'results', s: S, key: 'guide-key-1' }).code, 'UNAUTHORIZED', 'guide key cannot open results');
  assert.equal(post(env, { action: 'seminars', key: 'nope' }).code, 'UNAUTHORIZED');
});

test('closing deletes names and flags, translates comments, unlocks results', () => {
  const env = makeEnv(); seed(env);
  post(env, sub('n1', { i01: 6, i02: 2, i03: 'na', i04: 7, i05: 6 }, { comments: { i02: 'Мало практики' } }));
  post(env, sub('n2', { i01: 7, i02: 3, i03: 6, i04: 6, i05: 6 }, { open: { q2: 'More farms' } }));
  const closed = post(env, { action: 'status', s: S, key: 'staff-passcode-123', status: 'closed' });
  assert.equal(closed.ok, true); assert.equal(closed.status, 'closed');
  assert.equal(closed.backup.rows, 2, 'the close reply reports the backup');
  assert.equal(env.book.getSheetByName(`${S} · Names`).getLastRow(), 1, 'only the header is left');
  assert.equal([...env.props.keys()].filter((k) => k.startsWith('used:')).length, 0);
  const cfg = get(env, { action: 'config', s: S });
  assert.equal(cfg.seminar.status, 'closed'); assert.equal(cfg.seminar.names.length, 0);
  assert.equal(post(env, sub('n3', { i01: 5 })).code, 'CLOSED');
  const r = post(env, { action: 'results', s: S, key: 'staff-passcode-123' });
  assert.equal(r.ok, true); assert.equal(r.invited, 3); assert.equal(r.responses.length, 2);
  assert.equal(r.translations['Мало практики'], 'EN(Мало практики)');
  // the site's analysis runs on exactly what the backend returns
  const a = analyze({ ...r.seminar, items: r.seminar.items.map((it) => ({ ...it, label: it.label.en })), invited: r.invited }, r.responses);
  assert.equal(a.items.find((i) => i.id === 'i02').score, '2.5');
  assert.equal(a.items.find((i) => i.id === 'i03').na, 1);
  assert.equal(a.overall.score, '6.0');
  assert.equal(a.responseRate, 2 / 3);
  const list = post(env, { action: 'seminars', key: 'staff-passcode-123' });
  assert.equal(list.seminars[0].answered, 2); assert.equal(list.seminars[0].status, 'closed');
});

test('a draft can be previewed but not answered', () => {
  const env = makeEnv(); seed(env);
  env.book.getSheetByName('Seminars').data[1][9] = 'draft';
  const cfg = get(env, { action: 'config', s: S });
  assert.equal(cfg.seminar.status, 'draft'); assert.equal(cfg.seminar.names.length, 3);
  assert.equal(post(env, sub('n1', { i01: 5 })).code, 'CLOSED');
});

// ---------- the Sheet menu (staff actions) ----------
function withUi(env, answers) {
  const said = [];
  const queue = [...answers];
  env.SpreadsheetApp.getUi = () => ({
    ButtonSet: { OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' },
    Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO' },
    prompt: () => { const a = queue.shift(); return { getSelectedButton: () => (a === null ? 'CANCEL' : 'OK'), getResponseText: () => a ?? '' }; },
    alert: (title, msg, buttons) => { said.push(msg ? `${title} ${msg}` : title); return buttons === 'YES_NO' ? (queue.shift() ?? 'YES') : 'OK'; },
    createMenu() { return { addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }; },
  });
  return said;
}
const tabNames = (env) => env.book.sheets.map((s) => s.name);

test('menu: first setup creates the tabs and a strong staff passcode once', () => {
  const env = makeEnv();
  const said = withUi(env, []);
  env.menuSetup();
  assert.ok(tabNames(env).includes('Seminars') && tabNames(env).includes('template · Items'));
  const key = env.props.get('ADMIN_KEY');
  assert.match(key, /^[a-z2-9]{6}-[a-z2-9]{6}-[a-z2-9]{6}$/);
  assert.match(said[0], new RegExp(key));
  // a sample seminar is open right away, with invented names and a guide key
  assert.ok(tabNames(env).includes('sample · Items') && tabNames(env).includes('sample · Names'));
  const cfg = env.doGet({ parameter: { action: 'config', s: 'sample' } }).getContent();
  const sample = JSON.parse(cfg).seminar;
  assert.equal(sample.status, 'open'); assert.equal(sample.names.length, 3); assert.equal(sample.items.length, 5);
  assert.equal(sample.items[0].label.en, 'Lecture: dairy farming in Israel');
  assert.match(said[0], /sample/);
  assert.equal(env.triggers.filter((t) => t.getHandlerFunction() === 'hourlyBackup').length, 1, 'hourly safety copies armed');
  env.menuSetup(); // running again changes nothing
  assert.equal(env.props.get('ADMIN_KEY'), key);
  assert.equal(tabNames(env).filter((n) => n === 'Seminars').length, 1);
  assert.equal(tabNames(env).filter((n) => n === 'sample · Items').length, 1);
});

test('menu: new seminar copies the questions and starts as a draft with a guide key', () => {
  const env = makeEnv();
  withUi(env, []); env.menuSetup();
  const said = withUi(env, ['UVT 2026', '']);
  env.menuNewSeminar();
  const row = env.book.getSheetByName('Seminars').data.at(-1); // after the sample seminar that First setup adds
  assert.match(row[0], /^uvt-2026-[a-z2-9]{4}$/, 'readable id with a hard-to-guess suffix');
  assert.equal(row[9], 'draft'); assert.equal(row[7], 'uk,en'); assert.match(row[10], /^[a-z2-9]{10}$/);
  assert.ok(tabNames(env).includes(`${row[0]} · Items`) && tabNames(env).includes(`${row[0]} · Names`));
  assert.match(said.at(-1), /Created seminar/);
});

test('menu: opening refuses a names list that contains passport numbers', () => {
  const env = makeEnv(); seed(env);
  env.book.getSheetByName('Seminars').data[1][9] = 'draft';
  env.book.getSheetByName(`${S} · Names`).data[1] = ['n1', 'Bondarenko AA000000', 'Oleksandr', '', ''];
  let said = withUi(env, [S]);
  env.menuOpen();
  assert.match(said.at(-1), /digits/);
  assert.equal(env.book.getSheetByName('Seminars').data[1][9], 'draft');
  env.book.getSheetByName(`${S} · Names`).data[1] = ['n1', 'Bondarenko', 'Oleksandr', 'Бондаренко', 'Олександр'];
  said = withUi(env, [S]);
  env.menuOpen();
  assert.equal(env.book.getSheetByName('Seminars').data[1][9], 'open');
  assert.match(said.at(-1), /open for 3 people/);
});

test('menu: fixing a wrong name frees it and locks the real person, so nobody answers twice', () => {
  const env = makeEnv(); seed(env);
  post(env, sub('n1', { i01: 6 })); // Hnatiuk answered but tapped "Bondarenko" by mistake
  let said = withUi(env, [S, 'Bondarenko', 'Hnatiuk']);
  env.menuSwap();
  assert.equal(env.props.get(`used:${S}:n1`), undefined, 'Bondarenko can answer now');
  assert.equal(env.props.get(`used:${S}:n3`), '1', 'Hnatiuk is marked as answered');
  assert.equal(post(env, sub('n3', { i01: 2 })).code, 'NAME_TAKEN');
  assert.equal(post(env, sub('n1', { i01: 5 })).ok, true);
  said = withUi(env, [S, 'Oleksandr', 'Hnatiuk']); // two Oleksandrs: ambiguous
  env.menuSwap();
  assert.match(said.at(-1), /exactly one person/);
});

test('menu: close asks first; passcode and address are validated', () => {
  const env = makeEnv(); seed(env);
  post(env, sub('n2', { i01: 6 }));
  let said = withUi(env, [S, 'NO']);
  env.menuClose();
  assert.equal(env.book.getSheetByName('Seminars').data[1][9], 'open', 'answering No keeps it open');
  said = withUi(env, [S, 'YES']);
  env.menuClose();
  assert.equal(env.book.getSheetByName('Seminars').data[1][9], 'closed');
  assert.match(said.at(-1), /Closed/);
  said = withUi(env, ['short']); env.menuPasscode(); assert.match(said.at(-1), /12 characters/);
  said = withUi(env, ['http://x.com']); env.menuSiteUrl(); assert.match(said.at(-1), /https/);
  said = withUi(env, ['https://feedback.dairyschool.co.il/']); env.menuSiteUrl();
  said = withUi(env, [S]); env.menuLinks();
  assert.match(said.at(-1), /https:\/\/feedback\.dairyschool\.co\.il\/\?s=uvt-2026-ab12\n/, 'participant link');
  assert.match(said.at(-1), /https:\/\/feedback\.dairyschool\.co\.il\/guide\.html\?s=uvt-2026-ab12#guide-key-1/, 'guide link');
  assert.match(said.at(-1), /https:\/\/feedback\.dairyschool\.co\.il\/staff\.html\?s=uvt-2026-ab12/, 'staff link');
  assert.equal(env.siteBase_('https://x.github.io/repo/index.html'), 'https://x.github.io/repo/');
  assert.equal(env.siteBase_('https://feedback.example/?x=1'), 'https://feedback.example/');
});

// ---------- data safety: nothing is ever lost ----------
test('closing keeps every answer, adds a dated copy and emails a CSV backup', () => {
  const env = makeEnv(); seed(env);
  post(env, sub('n1', { i01: 6, i02: 5 }, { comments: { i01: 'Добре, дякуємо' } }));
  post(env, sub('n2', { i01: 7 }, { comments: { i01: '=1+1' } }));
  const before = JSON.stringify(env.book.getSheetByName(`${S} · Answers`).data);
  const r = post(env, { action: 'status', s: S, key: 'staff-passcode-123', status: 'closed' });
  assert.equal(r.ok, true);
  assert.equal(r.backup.rows, 2);
  assert.equal(r.backup.emailedTo, 'school@example.com');
  assert.match(r.backup.snapshot, new RegExp(`^${S} · Answers · \\d{4}-\\d{2}-\\d{2}`));
  const answers = env.book.getSheetByName(`${S} · Answers`);
  assert.equal(JSON.stringify(answers.data), before, 'the answers tab is untouched');
  const snap = env.book.getSheetByName(r.backup.snapshot);
  assert.deepEqual(snap.data, answers.data, 'the copy has the same rows');
  assert.equal(snap.warningOnly, true, 'the copy warns before manual edits');
  assert.equal(env.mail.length, 1);
  const csv = env.mail[0].attachments[0].content;
  assert.equal(csv.split('\r\n').length, 3, 'header + 2 rows in the CSV');
  assert.match(csv, /"'=1\+1"|'=1\+1/, 'formulas neutralised in the CSV too');
  assert.match(env.mail[0].subject, /2 answers/);
});

test('the answers tab is created protected against manual edits', () => {
  const env = makeEnv(); seed(env);
  post(env, sub('n1', { i01: 6 }));
  const sh = env.book.getSheetByName(`${S} · Answers`);
  assert.equal(sh.warningOnly, true);
  assert.match(sh.protection, /never edit/);
});

test('menu: "Back up answers now" emails a copy without closing; backup email can be set', () => {
  const env = makeEnv(); seed(env);
  post(env, sub('n1', { i01: 6 }));
  let said = withUi(env, ['office@dairyschool.example']); env.menuBackupEmail();
  assert.equal(env.props.get('BACKUP_EMAIL'), 'office@dairyschool.example');
  said = withUi(env, [S]); env.menuBackup();
  assert.equal(env.mail.length, 1);
  assert.equal(env.mail[0].to, 'office@dairyschool.example');
  assert.match(said[0], /1 answers kept/);
  assert.equal(get(env, { action: 'config', s: S }).seminar.status, 'open', 'still open');
  assert.equal(tabNames(env).filter((n) => n.startsWith(`${S} · Answers ·`)).length, 1);
});

// ---------- names on the day: extra person, no-show, wrong tap (guide key) ----------
test('guide can add a name while open; digits (a passport number) are refused; closed refuses', () => {
  const env = makeEnv(); seed(env);
  const r = post(env, { action: 'addName', s: S, key: 'guide-key-1', surname: 'Zinchenko', given: 'Mariia', surnameCyr: 'Зінченко', givenCyr: 'Марія' });
  assert.equal(r.ok, true); assert.match(r.name.id, /^a[0-9a-f]{8}$/); assert.equal(r.name.answered, false);
  const names = get(env, { action: 'config', s: S }).seminar.names;
  assert.equal(names.length, 4); assert.equal(names[3].surnameCyr, 'Зінченко');
  assert.equal(post(env, { action: 'addName', s: S, key: 'guide-key-1', surname: 'Zinchenko GL000000' }).code, 'INVALID');
  assert.equal(post(env, { action: 'addName', s: S, key: 'guide-key-1', surname: '' }).code, 'INVALID');
  assert.equal(post(env, { action: 'addName', s: S, key: 'nope', surname: 'Zinchenko' }).code, 'UNAUTHORIZED');
  post(env, { action: 'status', s: S, key: 'staff-passcode-123', status: 'closed' });
  assert.equal(post(env, { action: 'addName', s: S, key: 'guide-key-1', surname: 'Late' }).code, 'CLOSED');
});

test('guide can remove a no-show but not someone who answered; the new person can answer at once', () => {
  const env = makeEnv(); seed(env);
  post(env, sub('n1', { i01: 6 }));
  assert.equal(post(env, { action: 'removeName', s: S, key: 'guide-key-1', nameId: 'n1' }).code, 'NAME_TAKEN');
  assert.equal(post(env, { action: 'removeName', s: S, key: 'guide-key-1', nameId: 'n3' }).ok, true);
  assert.deepEqual(post(env, { action: 'removeName', s: S, key: 'guide-key-1', nameId: 'n3' }), { ok: true, gone: true }, 'a repeated removal is fine');
  const p = post(env, { action: 'progress', s: S, key: 'guide-key-1' });
  assert.equal(p.total, 2); assert.deepEqual(p.missing.map((n) => n.id), ['n2']); assert.deepEqual(p.done.map((n) => n.id), ['n1']);
  const added = post(env, { action: 'addName', s: S, key: 'guide-key-1', surname: 'Moroz', given: 'Taras' }).name;
  assert.equal(post(env, sub(added.id, { i01: 7 })).ok, true, 'the added person can answer');
  assert.equal(post(env, sub(added.id, { i01: 7 })).code, 'NAME_TAKEN', 'still only once');
});

test('guide can fix a wrong tap: the wrong name is freed, the real person is marked as answered', () => {
  const env = makeEnv(); seed(env);
  post(env, sub('n1', { i01: 6 })); // n3 answered but tapped n1
  assert.equal(post(env, { action: 'swapName', s: S, key: 'guide-key-1', wrongId: 'n2', realId: 'n3' }).code, 'INVALID', 'n2 has not answered');
  assert.equal(post(env, { action: 'swapName', s: S, key: 'guide-key-1', wrongId: 'n1', realId: 'n1' }).code, 'NAME_UNKNOWN');
  assert.equal(post(env, { action: 'swapName', s: S, key: 'guide-key-1', wrongId: 'n1', realId: 'n3' }).ok, true);
  assert.equal(env.props.get(`used:${S}:n1`), undefined); assert.equal(env.props.get(`used:${S}:n3`), '1');
  assert.deepEqual(post(env, { action: 'swapName', s: S, key: 'guide-key-1', wrongId: 'n1', realId: 'n3' }), { ok: true, repeat: true }, 'a repeated fix changes nothing');
  assert.equal(env.props.get(`used:${S}:n1`), undefined); assert.equal(env.props.get(`used:${S}:n3`), '1');
  assert.equal(post(env, sub('n1', { i01: 5 })).ok, true, 'the real n1 can now answer');
  assert.equal(env.book.getSheetByName(`${S} · Answers`).getLastRow(), 3, 'both answers kept');
});

// ---------- review findings: backups never collide, translations never block the close ----------
test('two backups in the same second get distinct tab names; nothing is overwritten', () => {
  const env = makeEnv(); seed(env);
  post(env, sub('n1', { i01: 6 }));
  const a = env.backup_(S, 'first'), b = env.backup_(S, 'second');
  assert.notEqual(a.snapshot, b.snapshot);
  assert.ok(env.book.getSheetByName(a.snapshot) && env.book.getSheetByName(b.snapshot));
  assert.equal(tabNames(env).filter((n) => n.startsWith('Copy of')).length, 0, 'no stray "Copy of" tab');
});

test('closing backs up first, translates within a budget, and the rest finishes by trigger', () => {
  const env = makeEnv(); seed(env);
  post(env, sub('n1', { i01: 6, i02: 5 }, { comments: { i01: 'Дуже добре', i02: 'Мало часу' }, open: { q1: 'Ферми' } }));
  post(env, sub('n2', { i01: 7 }, { comments: { i01: 'Чудово' } }));
  // no time at all for translating inside the close: everything must still be safe
  const left = env.translateBatch_(S, 0);
  assert.equal(left, 4, 'four unique texts still to translate');
  env.scheduleTranslate_(S);
  assert.equal(env.triggers.length, 1); assert.equal(env.triggers[0].getHandlerFunction(), 'translatePending');
  env.scheduleTranslate_(S);
  assert.equal(env.triggers.length, 1, 'one trigger, not one per call');
  const r = post(env, { action: 'results', s: S, key: 'staff-passcode-123' });
  assert.equal(r.code, 'LOCKED');
  env.translatePending();
  assert.equal(env.triggers.length, 0, 'trigger removed itself');
  assert.equal(env.props.get(`translate:${S}`), undefined);
  const closed = post(env, { action: 'status', s: S, key: 'staff-passcode-123', status: 'closed' });
  assert.equal(closed.ok, true); assert.equal(closed.translationsPending, 0); assert.equal(closed.backup.rows, 2);
  const res = post(env, { action: 'results', s: S, key: 'staff-passcode-123' });
  assert.equal(res.translationsPending, 0);
  assert.equal(res.translations['Дуже добре'], 'EN(Дуже добре)');
  assert.equal(Object.keys(res.translations).length, 4);
});

test('a failing translation service never blocks closing or the backup', () => {
  const env = makeEnv(); seed(env);
  post(env, sub('n1', { i01: 6 }, { comments: { i01: 'Дуже добре' } }));
  env.LanguageApp.translate = () => { throw new Error('quota'); };
  const closed = post(env, { action: 'status', s: S, key: 'staff-passcode-123', status: 'closed' });
  assert.equal(closed.ok, true);
  assert.equal(closed.backup.emailedTo, 'school@example.com');
  assert.equal(closed.translationsPending, 1);
  assert.equal(env.triggers.length, 1, 'retry scheduled');
  const res = post(env, { action: 'results', s: S, key: 'staff-passcode-123' });
  assert.equal(res.ok, true); assert.equal(res.responses.length, 1); assert.equal(res.translationsPending, 1);
});

// ---------- data never disappears: hourly safety copies, blank rows never count ----------
test('opening arms an hourly safety copy; it emails only when new answers arrived; closing disarms it', () => {
  const env = makeEnv(); seed(env);
  env.book.getSheetByName('Seminars').data[1][9] = 'draft';
  withUi(env, [S]); env.menuOpen();
  assert.equal(env.triggers.filter((t) => t.getHandlerFunction() === 'hourlyBackup').length, 1);
  env.hourlyBackup(); assert.equal(env.mail.length, 0, 'nothing to copy yet');
  post(env, sub('n1', { i01: 6 }, { comments: { i01: 'Добре' } }));
  env.hourlyBackup(); assert.equal(env.mail.length, 1, 'one copy for the new answer');
  assert.match(env.mail[0].subject, /1 answers/); assert.equal(env.mail[0].attachments[0].content.split('\r\n').length, 2);
  env.hourlyBackup(); assert.equal(env.mail.length, 1, 'no new answers, no new email');
  post(env, sub('n2', { i01: 7 }));
  env.hourlyBackup(); assert.equal(env.mail.length, 2);
  assert.equal(tabNames(env).filter((n) => n.startsWith(`${S} · Answers ·`)).length, 0, 'hourly copies add no tabs');
  post(env, { action: 'status', s: S, key: 'staff-passcode-123', status: 'closed' });
  assert.equal(env.mail.length, 3, 'the close makes its own copy');
  env.hourlyBackup();
  assert.equal(env.triggers.filter((t) => t.getHandlerFunction() === 'hourlyBackup').length, 0, 'disarmed once nothing is open');
  assert.equal(env.mail.length, 3);
});

test('a blank or half-written row never counts as an answer', () => {
  const env = makeEnv(); seed(env);
  post(env, sub('n1', { i01: 6 }));
  const sh = env.book.getSheetByName(`${S} · Answers`);
  sh.insertRowBefore(2); // an empty row in the middle, as an interrupted insert could leave
  assert.equal(post(env, { action: 'progress', s: S, key: 'guide-key-1' }).answered, 1);
  assert.equal(post(env, { action: 'seminars', key: 'staff-passcode-123' }).seminars[0].answered, 1);
  post(env, { action: 'status', s: S, key: 'staff-passcode-123', status: 'closed' });
  const r = post(env, { action: 'results', s: S, key: 'staff-passcode-123' });
  assert.equal(r.responses.length, 1); assert.equal(r.answered, 1);
});

// ---------- drafts written by tools/save-draft.mjs; the guide opens the survey on the day ----------
const STAFF = 'staff-passcode-123';
function draftBody(extra = {}) {
  return {
    action: 'saveDraft', key: STAFF, base: 'UVT test 2026',
    seminar: { title_en: 'Dairy seminar in Israel', title_uk: 'Семінар в Ізраїлі', subtitle_en: 'Test group', subtitle_uk: 'Тестова група',
      start: '2026-10-04', end: '2026-10-11', languages: 'uk,en', default_lang: 'uk', report_name: 'the test group' },
    items: [
      { section_en: 'Monday, 5 October', section_uk: 'Понеділок, 5 жовтня', category: 'lecture', label_en: 'Lecture: farm economics', label_uk: 'Лекція: економіка ферми', detail_en: 'Milk price and quota', detail_uk: 'Ціна молока і квоти' },
      { section_en: 'Monday, 5 October', section_uk: 'Понеділок, 5 жовтня', category: 'tour', label_en: '+ Tour of Nazareth', label_uk: '=Екскурсія' },
      { section_en: 'Overall', section_uk: 'Загальна оцінка', category: 'overall', label_en: 'Recommend', label_uk: 'Рекомендація', key: 'recommend' },
      { section_en: 'Overall', section_uk: 'Загальна оцінка', category: 'overall', label_en: 'Overall', label_uk: 'Загалом', key: 'overall' },
    ],
    names: [
      { surname: 'Bondarenko', given: 'Andrii', surname_cyr: 'Бондаренко', given_cyr: 'Андрій' },
      { surname: 'Viunenko', given: 'Ivan', surname_cyr: 'В’юненко', given_cyr: 'Іван' },
    ],
    ...extra,
  };
}

test('a refused answer on a draft leaves no answers tab behind', () => {
  const env = makeEnv(); seed(env);
  env.book.getSheetByName('Seminars').data[1][9] = 'draft';
  assert.equal(post(env, sub('n1', { i01: 5 })).code, 'CLOSED');
  assert.equal(env.book.getSheetByName(`${S} · Answers`), null);
});

test('the guide may open a draft and nothing else; a closed survey stays closed', () => {
  const env = makeEnv(); seed(env);
  const status = (key, st) => post(env, { action: 'status', s: S, key, status: st });
  env.book.getSheetByName('Seminars').data[1][9] = 'draft';
  assert.equal(status('wrong-key-12345', 'open').code, 'UNAUTHORIZED');
  assert.equal(status('guide-key-1', 'closed').code, 'UNAUTHORIZED', 'closing deletes names: staff only');
  assert.equal(status('guide-key-1', 'draft').code, 'UNAUTHORIZED');
  assert.deepEqual(status('guide-key-1', 'open'), { ok: true, status: 'open' });
  assert.equal(get(env, { action: 'config', s: S }).seminar.status, 'open');
  assert.equal(env.triggers.filter((t) => t.getHandlerFunction() === 'hourlyBackup').length, 1, 'opening arms the hourly copy');
  assert.deepEqual(status('guide-key-1', 'open'), { ok: true, status: 'open' }, 'a second tap is harmless');
  assert.equal(post(env, sub('n1', { i01: 5 })).ok, true, 'answers are taken once open');
  assert.equal(status(STAFF, 'closed').ok, true);
  assert.equal(status(STAFF, 'open').code, 'CLOSED', 'never reopened');
  assert.equal(status(STAFF, 'draft').code, 'CLOSED', 'never back to draft, which would hide the results');
  assert.equal(status('guide-key-1', 'open').code, 'UNAUTHORIZED');
  assert.equal(post(env, { action: 'results', s: S, key: STAFF }).responses.length, 1);
  // a draft without names cannot be opened, by anyone
  const env2 = makeEnv(); seed(env2);
  env2.book.getSheetByName('Seminars').data[1][9] = 'draft';
  env2.book.getSheetByName(`${S} · Names`).data.splice(1);
  assert.equal(post(env2, { action: 'status', s: S, key: 'guide-key-1', status: 'open' }).code, 'INVALID');
});

test('save draft: a new seminar with its questions and names, hard-to-guess id, read back by the site', () => {
  const env = makeEnv(); seed(env);
  const r = post(env, draftBody());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.id, /^uvt-test-2026-[a-z2-9]{4}$/);
  assert.equal(r.guideKey.length, 10); assert.equal(r.items, 4); assert.equal(r.names, 2);
  const cfg = get(env, { action: 'config', s: r.id }).seminar;
  assert.equal(cfg.status, 'draft');
  assert.deepEqual(cfg.title, { en: 'Dairy seminar in Israel', uk: 'Семінар в Ізраїлі' });
  assert.deepEqual(cfg.dates, { start: '2026-10-04', end: '2026-10-11' });
  assert.deepEqual(cfg.languages, ['uk', 'en']); assert.equal(cfg.defaultLang, 'uk');
  assert.deepEqual(cfg.sections.map((x) => x.title.uk), ['Понеділок, 5 жовтня', 'Загальна оцінка']);
  assert.deepEqual(cfg.items.map((x) => x.id), ['i01', 'i02', 'i03', 'i04']);
  assert.deepEqual(cfg.items[0].detail, { en: 'Milk price and quota', uk: 'Ціна молока і квоти' });
  assert.equal(cfg.items[1].label.en, '+ Tour of Nazareth'); assert.equal(cfg.items[1].label.uk, '=Екскурсія');
  assert.deepEqual(cfg.items.map((x) => x.key || null), [null, null, 'recommend', 'overall']);
  assert.deepEqual(cfg.names.map((n) => [n.id, n.surnameCyr]), [['n01', 'Бондаренко'], ['n02', 'В’юненко']]);
  assert.equal(env.book.sheets.reduce((n, s) => n + s.formulas, 0), 0, 'text never becomes a formula');
  const list = post(env, { action: 'seminars', key: STAFF }).seminars;
  assert.deepEqual(list.map((x) => [x.id, x.status]), [[r.id, 'draft'], [S, 'open']]);
  // the whole day on the new draft: the guide opens it, someone answers, the staff close it
  assert.equal(post(env, { action: 'status', s: r.id, key: r.guideKey, status: 'open' }).ok, true);
  const answer = { action: 'submit', s: r.id, nameId: 'n02', submissionId: randomUUID(), answers: { i01: 6, i02: 'na', i03: 7, i04: 7 }, open: { q1: 'Ферми', q2: 'Більше часу' } };
  assert.equal(post(env, answer).ok, true);
  const head = env.book.getSheetByName(`${r.id} · Answers`).data[0];
  assert.deepEqual(head.slice(0, 5), ['response', '1. Lecture: farm economics', '2. + Tour of Nazareth', '3. Recommend', '4. Overall']);
  assert.equal(post(env, { action: 'status', s: r.id, key: STAFF, status: 'closed' }).ok, true);
  const res = post(env, { action: 'results', s: r.id, key: STAFF });
  assert.equal(res.invited, 2); assert.equal(res.responses.length, 1); assert.equal(res.responses[0].answers.i02, 'na');
});

test('save draft: rewrites a draft in place, never an open or closed seminar or one with answers', () => {
  const env = makeEnv(); seed(env);
  const first = post(env, draftBody());
  const changed = draftBody({ s: first.id, names: undefined });
  changed.items = changed.items.slice(1);
  changed.seminar = { ...changed.seminar, title_uk: 'Новий заголовок' };
  const again = post(env, changed);
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.id, first.id, 'same link'); assert.equal(again.guideKey, first.guideKey, 'same guide link');
  assert.equal(again.names, 2, 'names kept when none are sent');
  const cfg = get(env, { action: 'config', s: first.id }).seminar;
  assert.equal(cfg.items.length, 3); assert.equal(cfg.items[0].label.en, '+ Tour of Nazareth');
  assert.equal(cfg.title.uk, 'Новий заголовок'); assert.equal(cfg.status, 'draft');
  assert.equal(env.book.getSheetByName('Seminars').data.filter((x) => x[0] === first.id).length, 1, 'no second row');
  assert.equal(post(env, draftBody({ s: 'not-there-1234' })).code, 'NOT_FOUND');
  assert.equal(post(env, draftBody({ s: S })).code, 'LOCKED', 'an open survey keeps its questions');
  post(env, { action: 'status', s: first.id, key: STAFF, status: 'open' });
  assert.equal(post(env, draftBody({ s: first.id })).code, 'LOCKED');
  post(env, { action: 'status', s: first.id, key: STAFF, status: 'closed' });
  assert.equal(post(env, draftBody({ s: first.id })).code, 'LOCKED');
});

test('save draft: an empty answers tab left by an older version gets the new header', () => {
  const env = makeEnv(); seed(env);
  const d = post(env, draftBody());
  env.book.sheets.push(new FakeSheet(`${d.id} · Answers`, [['response', '1. Old question', 'Comment 1', 'Old open question']]));
  const changed = draftBody({ s: d.id });
  changed.items = changed.items.slice(2);
  assert.equal(post(env, changed).ok, true);
  assert.deepEqual(env.book.getSheetByName(`${d.id} · Answers`).data[0].filter(String),
    ['response', '1. Recommend', '2. Overall', 'Comment 1', 'Comment 2', 'What was the most valuable part of the seminar for you?', 'What could we do better?', 'Sent (Israel time)']);
});

test('save draft: staff passcode only, and bad input is refused with the reason', () => {
  const env = makeEnv(); seed(env);
  const problem = (body) => { const r = post(env, body); return r.ok ? 'ok' : `${r.code}${r.problem ? ` ${r.problem}` : ''}`; };
  assert.equal(problem(draftBody({ key: 'guide-key-1' })), 'UNAUTHORIZED');
  assert.equal(problem(draftBody({ key: undefined })), 'UNAUTHORIZED');
  assert.equal(problem(draftBody({ base: 'ab' })), 'INVALID base');
  assert.equal(problem(draftBody({ names: [{ surname: 'Bondarenko', given: 'FA1234567' }] })), 'INVALID name 1', 'never a passport number');
  assert.equal(problem(draftBody({ names: [{ given: 'Andrii' }] })), 'INVALID name 1');
  const items = (patch, i = 0) => { const b = draftBody(); b.items[i] = { ...b.items[i], ...patch }; return b; };
  assert.equal(problem(items({ category: 'zoo' })), 'INVALID item 1: category');
  assert.equal(problem(items({ label_en: '  ' })), 'INVALID item 1: label_en');
  assert.equal(problem(items({ label_uk: 'х'.repeat(301) })), 'INVALID item 1: label_uk');
  assert.equal(problem(items({ key: 'overall' }, 2)), 'INVALID item 4: key', 'one overall question only');
  assert.equal(problem(items({ optional: 'yes' })), 'INVALID item 1: optional');
  assert.equal(problem(draftBody({ items: [] })), 'INVALID items');
  assert.equal(problem(draftBody({ seminar: { ...draftBody().seminar, end: '2026-10-01' } })), 'INVALID dates');
  assert.equal(problem(draftBody({ seminar: { ...draftBody().seminar, languages: 'uk,ru' } })), 'INVALID languages');
  assert.equal(problem(draftBody({ seminar: { ...draftBody().seminar, default_lang: 'en', languages: 'uk' } })), 'INVALID default_lang');
  assert.equal(problem(draftBody()), 'ok');
  assert.equal(post(env, { action: 'seminars', key: STAFF }).seminars.length, 2, 'only the valid call wrote anything');
});

test('a lost reply: Google re-sends the request as an empty GET; the backend says LOST, and every action can be repeated safely', () => {
  const env = makeEnv(); seed(env);
  assert.deepEqual(get(env, {}), { ok: false, code: 'LOST' }, 'the bare address');
  assert.equal(get(env, { action: 'nope' }).code, 'INVALID');
  assert.deepEqual(JSON.parse(env.doPost({}).getContent()), { ok: false, code: 'LOST' });
  assert.deepEqual(JSON.parse(env.doPost({ postData: { contents: '' } }).getContent()), { ok: false, code: 'LOST' });
  // the same answer twice: stored once
  const a = sub('n1', { i01: 6 });
  assert.equal(post(env, a).ok, true); assert.deepEqual(post(env, a), { ok: true, repeat: true });
  // the same new name twice (the site picks its id): one row
  const add = { action: 'addName', s: S, key: 'guide-key-1', nameId: 'a1b2c3d4e5', surname: 'Viunenko', given: 'Ivan' };
  const first = post(env, add), again = post(env, add);
  assert.equal(first.ok, true); assert.equal(first.name.id, 'a1b2c3d4e5');
  assert.equal(again.ok, true); assert.equal(again.repeat, true); assert.equal(again.name.id, 'a1b2c3d4e5');
  assert.equal(env.book.getSheetByName(`${S} · Names`).data.filter((r) => r[0] === 'a1b2c3d4e5').length, 1);
  assert.equal(post(env, { ...add, nameId: 'bad id!' }).ok, true, 'an unusable id gets a fresh one');
  // closing twice: closed once, one backup
  assert.equal(post(env, { action: 'status', s: S, key: STAFF, status: 'closed' }).ok, true);
  assert.equal(post(env, { action: 'status', s: S, key: STAFF, status: 'closed' }).ok, true);
  assert.equal(env.mail.length, 1, 'one backup email');
});

test('backup copies are named in Israel time even when the Sheet was created in another time zone', () => {
  const env = makeEnv(); seed(env);
  env.book.tz = 'America/Los_Angeles'; // as the live Sheet turned out to be
  post(env, sub('n1', { i01: 6 }));
  const israel = () => env.Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM-dd HH.mm');
  const before = israel();
  const r = post(env, { action: 'status', s: S, key: STAFF, status: 'closed' });
  const after = israel();
  const stamp = r.backup.snapshot.split(' · Answers · ')[1].slice(0, 16);
  assert.ok(stamp === before || stamp === after, `${stamp} is Israel time (${before})`);
  assert.ok(env.mail[0].subject.includes(stamp));
  // the seminar's own dates are still read in the Sheet's zone (Sheets keeps dates at its local midnight)
  assert.deepEqual(get(env, { action: 'config', s: S }).seminar.dates.start.length, 10);
});

test('a test seminar can be deleted with the staff passcode, with all its tabs and flags; a real one never', () => {
  const env = makeEnv(); seed(env);
  post(env, sub('n1', { i01: 6 }));
  assert.equal(post(env, { action: 'deleteSeminar', s: S, key: STAFF }).code, 'INVALID', 'not a test id');
  const d = post(env, draftBody({ base: 'uvt-2026-test' }));
  assert.match(d.id, /^uvt-2026-test-/);
  post(env, { action: 'status', s: d.id, key: STAFF, status: 'open' });
  post(env, { action: 'submit', s: d.id, nameId: 'n01', submissionId: randomUUID(), answers: { i01: 5 }, comments: { i01: 'Добре' } });
  post(env, { action: 'status', s: d.id, key: STAFF, status: 'closed' }); // leaves a dated copy and an English tab
  assert.ok(tabNames(env).some((n) => n.startsWith(`${d.id} · Answers · `)));
  assert.equal(post(env, { action: 'deleteSeminar', s: d.id, key: 'guide-key-1' }).code, 'UNAUTHORIZED');
  const r = post(env, { action: 'deleteSeminar', s: d.id, key: STAFF });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.tabs.map((n) => n.replace(/ · \d.*$/, ' · <date>')).sort(), [`${d.id} · Answers`, `${d.id} · Answers · <date>`, `${d.id} · English`, `${d.id} · Items`, `${d.id} · Names`]);
  assert.ok(!tabNames(env).some((n) => n.startsWith(`${d.id} · `)));
  assert.ok(![...env.props.keys()].some((k) => k.includes(d.id)));
  assert.equal(get(env, { action: 'config', s: d.id }).code, 'NOT_FOUND');
  assert.deepEqual(post(env, { action: 'seminars', key: STAFF }).seminars.map((x) => x.id), [S], 'the real seminar is untouched');
  assert.equal(env.book.getSheetByName(`${S} · Answers`).getLastRow(), 2, 'its answer is untouched');
  assert.equal(post(env, { action: 'deleteSeminar', s: d.id, key: STAFF }).code, 'NOT_FOUND', 'a repeat is harmless');
});

test('staff can list what the Sheet holds (tabs, rows, answers); read-only and passcode only', () => {
  const env = makeEnv(); seed(env);
  post(env, sub('n1', { i01: 6 }));
  assert.equal(post(env, { action: 'tabs', key: 'guide-key-1' }).code, 'UNAUTHORIZED');
  const r = post(env, { action: 'tabs', key: STAFF });
  assert.equal(r.ok, true);
  const byName = Object.fromEntries(r.tabs.map((t) => [t.name, t]));
  assert.equal(byName['Seminars'].rows, 1);
  assert.equal(byName[`${S} · Names`].rows, 3);
  assert.equal(byName[`${S} · Answers`].answers, 1);
  assert.equal(byName[`${S} · Answers`].head, 'response');
  assert.equal(byName[`${S} · Items`].answers, null);
});
