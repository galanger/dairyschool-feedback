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

test('stored answers carry no name, no time, no language', () => {
  const env = makeEnv(); seed(env);
  post(env, sub('n1', { i01: 6 }, { comments: { i01: 'Дуже добре' }, lang: 'uk', name: 'Bondarenko' }));
  const sheet = env.book.getSheetByName(`${S} · Answers`);
  const flat = JSON.stringify(sheet.data);
  assert.ok(!/Bondarenko|Бондаренко|n1|uk"/.test(flat), flat);
  assert.deepEqual(sheet.data[0].slice(0, 2), ['response', '1. Lecture: heat stress']);
  assert.ok(!sheet.data[0].some((h) => /time|date|name|lang/i.test(h)));
  // the once-only flag lives apart from the answers and has no timestamp
  assert.deepEqual([...env.props.keys()].filter((k) => k.startsWith('used:')), [`used:${S}:n1`]);
  assert.equal(env.props.get(`used:${S}:n1`), '1');
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
  env.menuSetup(); // running again changes nothing
  assert.equal(env.props.get('ADMIN_KEY'), key);
  assert.equal(tabNames(env).filter((n) => n === 'Seminars').length, 1);
});

test('menu: new seminar copies the questions and starts as a draft with a guide key', () => {
  const env = makeEnv();
  withUi(env, []); env.menuSetup();
  const said = withUi(env, ['UVT 2026', '']);
  env.menuNewSeminar();
  const row = env.book.getSheetByName('Seminars').data[1];
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
  assert.match(said.at(-1), /https:\/\/feedback\.dairyschool\.co\.il\/\?s=uvt-2026-ab12#guide-guide-key-1/);
  assert.match(said.at(-1), /#results/);
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
