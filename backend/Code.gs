/**
 * Dairy School seminar feedback — Google Apps Script backend.
 * @OnlyCurrentDoc
 *
 * Bound to one Google Sheet. The site calls it as a web app ("Execute as: me",
 * "Anyone"). Same contract as site/assets/js/api.js (mock).
 *
 * Sheet layout
 *   Seminars          one row per seminar (id, titles, dates, status, guide key…)
 *   <id> · Items      the questions, in order (edit freely until the survey opens)
 *   <id> · Names      participant names (deleted when the survey closes)
 *   <id> · Answers    one row per response: no name, no time, random row order
 *   <id> · English    comment translations, filled when the survey closes
 *   <id> · Answers · <date>  dated copies made at close and by "Back up answers now"
 * Script properties
 *   ADMIN_KEY         staff passcode;  SITE_URL  public survey address;  BACKUP_EMAIL  where CSV backups go
 *   used:<id>:<name>  once-only flags, kept apart from the answers
 * Nothing here ever deletes or overwrites an answer: submit_ only inserts rows, closing removes
 * only the names, and the Answers tabs are protected against accidental edits by hand.
 */

var SEMINARS = 'Seminars';
var SEMINAR_COLS = ['id', 'title_en', 'title_uk', 'subtitle_en', 'subtitle_uk', 'start', 'end', 'languages', 'default_lang', 'status', 'guide_key', 'report_name', 'invited'];
var ITEM_COLS = ['no', 'id', 'section_en', 'section_uk', 'category', 'label_en', 'label_uk', 'detail_en', 'detail_uk', 'optional', 'key'];
var NAME_COLS = ['id', 'surname', 'given', 'surname_cyr', 'given_cyr'];
var OPEN_QUESTIONS = [
  { id: 'q1', label: { en: 'What was the most valuable part of the seminar for you?', uk: 'Що було для вас найціннішим на семінарі?' } },
  { id: 'q2', label: { en: 'What could we do better?', uk: 'Що ми могли б зробити краще?' } },
];
var MAX_BODY = 60000;

// ---------------------------------------------------------------- web app

function doGet(e) {
  return respond_(function () {
    var p = (e && e.parameter) || {};
    if (p.action === 'config') return getConfig_(p.s);
    return { ok: false, code: 'INVALID' };
  });
}

function doPost(e) {
  return respond_(function () {
    var raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > MAX_BODY) return { ok: false, code: 'INVALID' };
    var p;
    try { p = JSON.parse(raw); } catch (err) { return { ok: false, code: 'INVALID' }; }
    switch (p.action) {
      case 'submit': return submit_(p);
      case 'progress': return progress_(p.s, p.key);
      case 'results': return results_(p.s, p.key);
      case 'status': return setStatus_(p.s, p.key, p.status);
      case 'seminars': return listSeminars_(p.key);
      case 'addName': return addName_(p.s, p.key, p);
      case 'removeName': return removeName_(p.s, p.key, p.nameId);
      case 'swapName': return swapName_(p.s, p.key, p.wrongId, p.realId);
      default: return { ok: false, code: 'INVALID' };
    }
  });
}

// Always JSON, never an HTML error page (that would hide the reason from the browser).
function respond_(fn) {
  var out;
  try { out = fn(); } catch (err) { out = { ok: false, code: 'SERVER' }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- reading

function book_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function props_() { return PropertiesService.getScriptProperties(); }
function tab_(id, kind) { return book_().getSheetByName(id + ' · ' + kind); }

function rows_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var head = values[0].map(function (h) { return String(h).trim(); });
  return values.slice(1).filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = {}; head.forEach(function (h, i) { o[h] = r[i]; }); return o;
  });
}

function seminarRow_(id) {
  if (!id || !/^[a-z0-9-]{3,40}$/.test(String(id))) return null;
  var sheet = book_().getSheetByName(SEMINARS);
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(id)) {
      var o = {}; SEMINAR_COLS.forEach(function (c, i) { o[c] = values[r][i]; });
      o._row = r + 1;
      return o;
    }
  }
  return null;
}

function bi_(en, uk) { var o = { en: String(en || '') }; if (uk) o.uk = String(uk); return o; }
function isoDate_(v) {
  // Sheets stores dates at local midnight, so format them in the spreadsheet's own time zone.
  if (v instanceof Date) return Utilities.formatDate(v, book_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  return String(v || '');
}

function seminarConfig_(row) {
  var id = row.id;
  var items = rows_(tab_(id, 'Items')).map(function (r, i) {
    var it = {
      id: String(r.id || ('i' + ('0' + (i + 1)).slice(-2))), no: Number(r.no) || i + 1,
      section: 'sec-' + String(r.section_en || 'Program'), category: String(r.category || 'other').toLowerCase(),
      label: bi_(r.label_en, r.label_uk),
    };
    if (r.detail_en) it.detail = bi_(r.detail_en, r.detail_uk);
    if (r.optional === true || String(r.optional).toUpperCase() === 'TRUE') it.optional = true;
    if (r.key) it.key = String(r.key).toLowerCase();
    it._sectionTitle = bi_(r.section_en || 'Program', r.section_uk);
    return it;
  });
  var sections = [];
  items.forEach(function (it) {
    if (!sections.some(function (s) { return s.id === it.section; })) sections.push({ id: it.section, title: it._sectionTitle });
    delete it._sectionTitle;
  });
  var langs = String(row.languages || 'en').split(/[,\s]+/).filter(String);
  return {
    id: id, title: bi_(row.title_en, row.title_uk),
    subtitle: row.subtitle_en ? bi_(row.subtitle_en, row.subtitle_uk) : null,
    reportName: row.report_name ? { en: String(row.report_name) } : null,
    dates: { start: isoDate_(row.start), end: isoDate_(row.end) },
    languages: langs, defaultLang: String(row.default_lang || langs[0]),
    status: String(row.status || 'draft').toLowerCase(),
    sections: sections, items: items, openQuestions: OPEN_QUESTIONS,
  };
}

function names_(id) {
  return rows_(tab_(id, 'Names')).filter(function (r) { return r.id && r.surname; }).map(function (r) {
    return { id: String(r.id), surname: String(r.surname), given: String(r.given || ''),
      surnameCyr: String(r.surname_cyr || ''), givenCyr: String(r.given_cyr || '') };
  });
}
function usedKey_(id, nameId) { return 'used:' + id + ':' + nameId; }
function isUsed_(id, nameId) { return props_().getProperty(usedKey_(id, nameId)) === '1'; }

function getConfig_(id) {
  var row = seminarRow_(id);
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  var cfg = seminarConfig_(row);
  // Names are only served while the survey is open or being previewed.
  cfg.names = (cfg.status === 'open' || cfg.status === 'draft') ? names_(id).map(function (n) {
    n.answered = isUsed_(id, n.id); return n;
  }) : [];
  return { ok: true, seminar: cfg };
}

// ---------------------------------------------------------------- submitting

function cleanText_(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}
// A leading apostrophe makes Sheets keep text as typed ("=1+1", "10/10", "- too long").
function asText_(s) { return s ? "'" + s : ''; }

function answersSheet_(id, cfg) {
  var sh = tab_(id, 'Answers');
  if (sh) return sh;
  sh = book_().insertSheet(id + ' · Answers');
  var head = ['response'].concat(
    cfg.items.map(function (it) { return it.no + '. ' + it.label.en; }),
    cfg.items.map(function (it) { return 'Comment ' + it.no; }),
    cfg.openQuestions.map(function (q) { return q.label.en; }));
  sh.getRange(1, 1, 1, head.length).setValues([head]);
  sh.setFrozenRows(1);
  protect_(sh, 'Answers: never edit or delete by hand');
  return sh;
}

// Warns anyone editing a tab by hand. A safety net, so a failure here is ignored.
function protect_(sh, why) {
  try { sh.protect().setDescription(why).setWarningOnly(true); } catch (err) { /* ignore */ }
}

// ---------------------------------------------------------------- backups
// Answers are never deleted or overwritten by this script. On top of that: a dated copy of the
// answers tab inside this spreadsheet, and the same rows as a CSV by email.

function backupEmail_() {
  var e = props_().getProperty('BACKUP_EMAIL');
  if (e) return e;
  try { return Session.getEffectiveUser().getEmail() || ''; } catch (err) { return ''; }
}

function csvCell_(v) {
  var s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // never a live formula in a spreadsheet that opens the CSV
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function backup_(id, why) {
  var sh = tab_(id, 'Answers');
  var rows = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
  var out = { rows: rows };
  if (!sh) return out;
  var stamp = Utilities.formatDate(new Date(), book_().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH.mm');
  var copy = sh.copyTo(book_()).setName((id + ' · Answers · ' + stamp).slice(0, 100));
  protect_(copy, 'Backup copy: never edit or delete by hand');
  out.snapshot = copy.getName();
  var to = backupEmail_();
  if (!to) return out;
  try {
    var csv = sh.getDataRange().getValues().map(function (r) { return r.map(csvCell_).join(','); }).join('\r\n');
    MailApp.sendEmail({
      to: to,
      subject: 'Dairy School feedback backup · ' + id + ' · ' + stamp + ' · ' + rows + ' answers',
      body: 'Backup of the answers of "' + id + '" (' + why + '): ' + rows + ' answers, no names.\n' +
        'Keep this email; the attached CSV opens in Excel or Google Sheets. The same rows stay in the Sheet in the tab "' + id + ' · Answers" and in the copy "' + out.snapshot + '".',
      attachments: [Utilities.newBlob('\ufeff' + csv, 'text/csv', id + '-answers-' + stamp.replace(/[ .:]/g, '-') + '.csv')],
    });
    out.emailedTo = to;
  } catch (err) {
    out.emailError = String((err && err.message) || err);
  }
  return out;
}

function submit_(p) {
  var id = p.s;
  var row = seminarRow_(id);
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  if (!p.submissionId || !/^[0-9a-f-]{16,40}$/i.test(String(p.submissionId)) || typeof p.answers !== 'object') {
    return { ok: false, code: 'INVALID' };
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, code: 'BUSY' };
  try {
    var cfg = seminarConfig_(row);
    var sheet = answersSheet_(id, cfg);
    // A retry of a submission that already went through succeeds again.
    if (sheet.getLastRow() > 1) {
      var found = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(String(p.submissionId)).matchEntireCell(true).findNext();
      if (found) return { ok: true, repeat: true };
    }
    if (String(row.status).toLowerCase() !== 'open') return { ok: false, code: 'CLOSED' };
    var nameId = String(p.nameId || '');
    if (!names_(id).some(function (n) { return n.id === nameId; })) return { ok: false, code: 'NAME_UNKNOWN' };
    if (isUsed_(id, nameId)) return { ok: false, code: 'NAME_TAKEN' };

    var values = [String(p.submissionId)];
    cfg.items.forEach(function (it) {
      var v = p.answers[it.id];
      values.push(v === 'na' ? 'NA' : (typeof v === 'number' && v % 1 === 0 && v >= 1 && v <= 7) ? v : '');
    });
    var comments = p.comments || {}, open = p.open || {};
    cfg.items.forEach(function (it) { values.push(asText_(cleanText_(comments[it.id], 1000))); });
    cfg.openQuestions.forEach(function (q) { values.push(asText_(cleanText_(open[q.id], 2000))); });

    // Random position: row order says nothing about who answered when.
    var last = sheet.getLastRow();
    var at = 2 + Math.floor(Math.random() * last); // 2 .. last+1
    if (at <= last) sheet.insertRowBefore(at); else at = last + 1;
    sheet.getRange(at, 1, 1, values.length).setValues([values]);
    props_().setProperty(usedKey_(id, nameId), '1');
    SpreadsheetApp.flush();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- staff

function isAdmin_(key) {
  var k = props_().getProperty('ADMIN_KEY');
  return !!k && typeof key === 'string' && key.length >= 8 && key === k;
}
function isGuide_(row, key) {
  return isAdmin_(key) || (!!row.guide_key && typeof key === 'string' && key === String(row.guide_key));
}

function progress_(id, key) {
  var row = seminarRow_(id);
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  if (!isGuide_(row, key)) return { ok: false, code: 'UNAUTHORIZED' };
  var status = String(row.status).toLowerCase();
  var sh = tab_(id, 'Answers');
  var answered = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
  if (status === 'closed') return { ok: true, status: status, total: Number(row.invited) || answered, answered: answered, missing: [], done: [] };
  var names = names_(id), missing = [], done = [];
  names.forEach(function (n) { (isUsed_(id, n.id) ? done : missing).push(n); });
  return { ok: true, status: status, total: names.length, answered: answered, missing: missing, done: done };
}

// ---------------------------------------------------------------- names on the day
// An extra person, a no-show, or someone who tapped the wrong name: the guide fixes it from the
// guide page (guide key or staff passcode) while the survey is open. Phones pick it up within 15 s.

function withNames_(id, key, fn) {
  var row = seminarRow_(id);
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  if (!isGuide_(row, key)) return { ok: false, code: 'UNAUTHORIZED' };
  var status = String(row.status).toLowerCase();
  if (status !== 'open' && status !== 'draft') return { ok: false, code: 'CLOSED' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, code: 'BUSY' };
  try { return fn(row); } finally { lock.releaseLock(); }
}

function addName_(id, key, p) {
  return withNames_(id, key, function () {
    var n = { surname: cleanText_(p.surname, 60), given: cleanText_(p.given, 60),
      surnameCyr: cleanText_(p.surnameCyr, 60), givenCyr: cleanText_(p.givenCyr, 60) };
    if (!n.surname) return { ok: false, code: 'INVALID' };
    if (/\d/.test(n.surname + n.given + n.surnameCyr + n.givenCyr)) return { ok: false, code: 'INVALID' }; // never a passport number
    var sh = tab_(id, 'Names');
    if (!sh) {
      sh = book_().insertSheet(id + ' · Names');
      sh.getRange(1, 1, 1, NAME_COLS.length).setValues([NAME_COLS]);
      sh.setFrozenRows(1);
    }
    n.id = 'a' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    sh.appendRow([n.id, n.surname, n.given, n.surnameCyr, n.givenCyr]);
    n.answered = false;
    return { ok: true, name: n };
  });
}

function removeName_(id, key, nameId) {
  return withNames_(id, key, function () {
    if (isUsed_(id, nameId)) return { ok: false, code: 'NAME_TAKEN' }; // already answered: keep
    var sh = tab_(id, 'Names');
    if (!sh || sh.getLastRow() < 2) return { ok: false, code: 'NAME_UNKNOWN' };
    var ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
    for (var r = 1; r < ids.length; r++) {
      if (String(ids[r][0]) === String(nameId)) { sh.deleteRow(r + 1); return { ok: true }; }
    }
    return { ok: false, code: 'NAME_UNKNOWN' };
  });
}

function swapName_(id, key, wrongId, realId) {
  return withNames_(id, key, function () {
    var names = names_(id);
    var has = function (x) { return names.some(function (n) { return n.id === x; }); };
    if (!has(wrongId) || !has(realId) || wrongId === realId) return { ok: false, code: 'NAME_UNKNOWN' };
    if (!isUsed_(id, wrongId) || isUsed_(id, realId)) return { ok: false, code: 'INVALID' };
    props_().deleteProperty(usedKey_(id, wrongId));
    props_().setProperty(usedKey_(id, realId), '1');
    return { ok: true };
  });
}

function readResponses_(id, cfg) {
  var sh = tab_(id, 'Answers');
  if (!sh || sh.getLastRow() < 2) return [];
  var width = 1 + cfg.items.length * 2 + cfg.openQuestions.length;
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues();
  return values.map(function (r) {
    var o = { answers: {}, comments: {}, open: {} }, c = 1;
    cfg.items.forEach(function (it) {
      var v = r[c++];
      if (v === 'NA') o.answers[it.id] = 'na';
      else if (typeof v === 'number' && v >= 1 && v <= 7) o.answers[it.id] = v;
    });
    cfg.items.forEach(function (it) { var t = String(r[c++] || '').trim(); if (t) o.comments[it.id] = t; });
    cfg.openQuestions.forEach(function (q) { var t = String(r[c++] || '').trim(); if (t) o.open[q.id] = t; });
    return o;
  });
}

function translations_(id) {
  var out = {};
  rows_(tab_(id, 'English')).forEach(function (r) { if (r.original) out[String(r.original)] = String(r.english || ''); });
  return out;
}

function results_(id, key) {
  if (!isAdmin_(key)) return { ok: false, code: 'UNAUTHORIZED' };
  var row = seminarRow_(id);
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  var cfg = seminarConfig_(row);
  var sh = tab_(id, 'Answers');
  var answered = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
  var invited = String(row.status).toLowerCase() === 'closed' ? Number(row.invited) || null : names_(id).length;
  cfg.names = [];
  if (cfg.status !== 'closed') return { ok: false, code: 'LOCKED', seminar: cfg, invited: invited, answered: answered };
  return { ok: true, seminar: cfg, invited: invited, answered: answered, responses: readResponses_(id, cfg), translations: translations_(id) };
}

function listSeminars_(key) {
  if (!isAdmin_(key)) return { ok: false, code: 'UNAUTHORIZED' };
  var sheet = book_().getSheetByName(SEMINARS);
  var values = sheet.getDataRange().getValues().slice(1).filter(function (r) { return r[0]; });
  return { ok: true, seminars: values.map(function (r) {
    var o = {}; SEMINAR_COLS.forEach(function (c, i) { o[c] = r[i]; });
    var sh = tab_(o.id, 'Answers');
    return { id: String(o.id), title: bi_(o.title_en, o.title_uk), dates: { start: isoDate_(o.start), end: isoDate_(o.end) },
      status: String(o.status || 'draft').toLowerCase(), answered: sh ? Math.max(0, sh.getLastRow() - 1) : 0,
      invited: String(o.status).toLowerCase() === 'closed' ? Number(o.invited) || null : names_(o.id).length };
  }).reverse() };
}

function setStatus_(id, key, status) {
  if (!isAdmin_(key)) return { ok: false, code: 'UNAUTHORIZED' };
  if (['open', 'closed', 'draft'].indexOf(status) < 0) return { ok: false, code: 'INVALID' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, code: 'BUSY' };
  try {
    var row = seminarRow_(id);
    if (!row) return { ok: false, code: 'NOT_FOUND' };
    var sheet = book_().getSheetByName(SEMINARS);
    var col = function (name) { return SEMINAR_COLS.indexOf(name) + 1; };
    if (status === 'closed' && String(row.status).toLowerCase() !== 'closed') {
      var names = names_(id);
      sheet.getRange(row._row, col('invited')).setValue(names.length);
      deleteNames_(id, names);
      sheet.getRange(row._row, col('status')).setValue('closed');
      SpreadsheetApp.flush();
      translateComments_(id);
      return { ok: true, status: 'closed', backup: backup_(id, 'survey closed') };
    }
    if (status === 'open' && !names_(id).length) return { ok: false, code: 'INVALID' };
    sheet.getRange(row._row, col('status')).setValue(status);
    return { ok: true, status: status };
  } finally {
    lock.releaseLock();
  }
}

// Names and once-only flags are deleted for good when a survey closes.
function deleteNames_(id, names) {
  names.forEach(function (n) { props_().deleteProperty(usedKey_(id, n.id)); });
  var sh = tab_(id, 'Names');
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
}

// English versions of all comments, written once as plain values (no live formulas).
function translateComments_(id) {
  var row = seminarRow_(id);
  var cfg = seminarConfig_(row);
  var texts = {};
  readResponses_(id, cfg).forEach(function (r) {
    Object.keys(r.comments).forEach(function (k) { texts[r.comments[k]] = true; });
    Object.keys(r.open).forEach(function (k) { texts[r.open[k]] = true; });
  });
  var list = Object.keys(texts);
  if (!list.length) return;
  var sh = tab_(id, 'English') || book_().insertSheet(id + ' · English');
  sh.clearContents();
  var out = [['original', 'english']];
  list.forEach(function (t) {
    var en = '';
    try { en = LanguageApp.translate(t, '', 'en'); } catch (err) { en = ''; }
    out.push([asText_(t), asText_(en)]);
  });
  sh.getRange(1, 1, out.length, 2).setValues(out);
}

// ---------------------------------------------------------------- Sheet menu

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Dairy School')
    .addItem('First setup', 'menuSetup')
    .addItem('New seminar…', 'menuNewSeminar')
    .addItem('Get links…', 'menuLinks')
    .addSeparator()
    .addItem('Open survey…', 'menuOpen')
    .addItem('Close survey…', 'menuClose')
    .addItem('Fix a wrong name…', 'menuSwap')
    .addItem('Back up answers now…', 'menuBackup')
    .addSeparator()
    .addItem('Set staff passcode…', 'menuPasscode')
    .addItem('Set survey address…', 'menuSiteUrl')
    .addItem('Set backup email…', 'menuBackupEmail')
    .addToUi();
}

function ask_(title, prompt) {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt(title, prompt, ui.ButtonSet.OK_CANCEL);
  return r.getSelectedButton() === ui.Button.OK ? r.getResponseText().trim() : null;
}
function say_(msg) { SpreadsheetApp.getUi().alert(msg); }
function randomKey_(len) {
  var chars = 'abcdefghijkmnpqrstuvwxyz23456789', s = '';
  var bytes = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  for (var i = 0; i < len; i++) s += chars.charAt(parseInt(bytes.substr(i * 2 % 60, 2), 16) % chars.length);
  return s;
}

function menuNewSeminar() {
  var base = ask_('New seminar', 'Short name, e.g. uvt-2026 (letters, numbers, dashes):');
  if (!base) return;
  base = base.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 24);
  var id = base + '-' + randomKey_(4); // hard to guess, still readable
  var from = ask_('Start from', 'Copy the questions from which seminar? (leave empty for the blank template)');
  var src = tab_(from || 'template', 'Items');
  if (!src) return say_('Couldn’t find the questions of "' + (from || 'template') + '".');
  src.copyTo(book_()).setName(id + ' · Items');
  var names = book_().insertSheet(id + ' · Names');
  names.getRange(1, 1, 1, NAME_COLS.length).setValues([NAME_COLS]);
  names.setFrozenRows(1);
  var row = SEMINAR_COLS.map(function (c) {
    return { id: id, title_en: base, languages: 'uk,en', default_lang: 'uk', status: 'draft', guide_key: randomKey_(10) }[c] || '';
  });
  book_().getSheetByName(SEMINARS).appendRow(row);
  say_('Created seminar "' + id + '" as a draft.\n\n1. Fill in the title and dates in the Seminars tab.\n2. Edit "' + id + ' · Items".\n3. Paste the names (names only, never passport numbers) into "' + id + ' · Names".\n4. Preview with Dairy School → Get links, then Open survey.');
}

function pickSeminar_(verb) {
  var id = ask_(verb, 'Seminar id (first column of the Seminars tab):');
  if (!id) return null;
  var row = seminarRow_(id);
  if (!row) { say_('No seminar with id "' + id + '".'); return null; }
  return row;
}

function menuLinks() {
  var row = pickSeminar_('Get links');
  if (!row) return;
  var site = props_().getProperty('SITE_URL') || '(set the survey address first)';
  var sep = site.indexOf('?') >= 0 ? '&' : '?';
  say_('Participants (QR code):\n' + site + sep + 's=' + row.id +
    '\n\nGuide (progress only, no scores):\n' + site + sep + 's=' + row.id + '#guide-' + row.guide_key +
    '\n\nResults (staff passcode):\n' + site + sep + 's=' + row.id + '#results');
}

function menuOpen() {
  var row = pickSeminar_('Open survey');
  if (!row) return;
  var n = names_(row.id).length;
  if (!n) return say_('Add the names first, in "' + row.id + ' · Names".');
  var nameErrors = names_(row.id).filter(function (x) { return /\d/.test(x.surname + x.given); });
  if (nameErrors.length) return say_('Some names contain digits (a passport number?). Fix them first: ' + nameErrors.map(function (x) { return x.surname; }).join(', '));
  book_().getSheetByName(SEMINARS).getRange(row._row, SEMINAR_COLS.indexOf('status') + 1).setValue('open');
  say_('The survey "' + row.id + '" is open for ' + n + ' people.');
}

function menuClose() {
  var row = pickSeminar_('Close survey');
  if (!row) return;
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert('Close "' + row.id + '"?', 'Nobody can answer after this, and the list of names is deleted for good. Answers stay, without names.', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  var res = setStatus_(row.id, props_().getProperty('ADMIN_KEY'), 'closed');
  say_(res.ok ? 'Closed. The results page is now open to staff.\n\n' + backupText_(res.backup) : 'Couldn’t close: ' + res.code);
}

function backupText_(b) {
  if (!b) return '';
  var s = b.rows + ' answers kept.';
  if (b.snapshot) s += '\nA dated copy was added as the tab "' + b.snapshot + '".';
  if (b.emailedTo) s += '\nA CSV copy was emailed to ' + b.emailedTo + '.';
  else if (b.emailError) s += '\nThe backup email could not be sent (' + b.emailError + ').';
  return s;
}

function menuBackup() {
  var row = pickSeminar_('Back up answers now');
  if (!row) return;
  say_(backupText_(backup_(row.id, 'manual backup')) || 'Nothing to back up yet.');
}

function menuBackupEmail() {
  var e = ask_('Backup email', 'Backups of the answers are emailed to this address (empty = the account that owns this Sheet):');
  if (e === null) return;
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return say_('That doesn’t look like an email address.');
  if (e) props_().setProperty('BACKUP_EMAIL', e); else props_().deleteProperty('BACKUP_EMAIL');
  say_('Saved.');
}

// Someone answered under the wrong name: free that name, and lock the name of the
// person who really answered, so nobody can answer twice through the fix.
function menuSwap() {
  var row = pickSeminar_('Fix a wrong name');
  if (!row) return;
  var names = names_(row.id);
  var find = function (q) {
    q = String(q || '').toLowerCase();
    return names.filter(function (n) { return (n.surname + ' ' + n.given + ' ' + n.surnameCyr + ' ' + n.givenCyr).toLowerCase().indexOf(q) >= 0; });
  };
  var wrong = find(ask_('Fix a wrong name', 'Surname that was chosen by mistake:'));
  if (wrong.length !== 1) return say_('Type a surname that matches exactly one person.');
  var real = find(ask_('Fix a wrong name', 'Surname of the person who actually answered:'));
  if (real.length !== 1) return say_('Type a surname that matches exactly one person.');
  if (!isUsed_(row.id, wrong[0].id)) return say_(wrong[0].surname + ' has not answered yet; nothing to fix.');
  if (isUsed_(row.id, real[0].id)) return say_(real[0].surname + ' has already answered; nothing to fix.');
  props_().deleteProperty(usedKey_(row.id, wrong[0].id));
  props_().setProperty(usedKey_(row.id, real[0].id), '1');
  say_('Done. ' + wrong[0].surname + ' can now answer; ' + real[0].surname + ' is marked as answered.');
}

function menuPasscode() {
  var k = ask_('Staff passcode', 'New passcode for the results page (at least 12 characters):');
  if (!k) return;
  if (k.length < 12) return say_('Use at least 12 characters.');
  props_().setProperty('ADMIN_KEY', k);
  say_('Saved. Share it only with the school team.');
}

function menuSiteUrl() {
  var u = ask_('Survey address', 'Public address of the survey site, e.g. https://feedback.dairyschool.co.il/');
  if (!u) return;
  if (!/^https:\/\//.test(u)) return say_('The address must start with https://');
  props_().setProperty('SITE_URL', u);
  say_('Saved.');
}

// Creates the Seminars tab, the question template and a staff passcode (safe to run again).
function menuSetup() {
  var b = book_();
  if (!b.getSheetByName(SEMINARS)) {
    var sem = b.insertSheet(SEMINARS);
    sem.getRange(1, 1, 1, SEMINAR_COLS.length).setValues([SEMINAR_COLS]);
    sem.setFrozenRows(1);
  }
  if (!tab_('template', 'Items')) {
    var t = b.insertSheet('template · Items');
    var rows = [ITEM_COLS,
      [1, 'i01', 'Day 1', 'День 1', 'lecture', 'Lecture: …', 'Лекція: …', '', '', false, ''],
      [2, 'i02', 'Day 1', 'День 1', 'farm', 'Farm visit: …', 'Відвідування ферми: …', '', '', false, ''],
      [3, 'i03', 'Guides, hotels and food', 'Гіди, готелі та харчування', 'hotel', 'Accommodation: …', 'Проживання: …', '', '', false, ''],
      [4, 'i04', 'Overall', 'Загальна оцінка', 'overall', 'How strongly would you recommend our seminars to your colleagues?', 'Наскільки ви рекомендували б наші семінари колегам?', '', '', false, 'recommend'],
      [5, 'i05', 'Overall', 'Загальна оцінка', 'overall', 'Your overall satisfaction with the seminar', 'Ваша загальна задоволеність семінаром', '', '', false, 'overall']];
    t.getRange(1, 1, rows.length, ITEM_COLS.length).setValues(rows);
    t.setFrozenRows(1);
  }
  var msg = 'Setup done.';
  if (!props_().getProperty('ADMIN_KEY')) {
    var k = randomKey_(6) + '-' + randomKey_(6) + '-' + randomKey_(6);
    props_().setProperty('ADMIN_KEY', k);
    msg += '\n\nStaff passcode for the results page:\n' + k + '\n\nKeep it in a safe place. You can change it with Dairy School → Set staff passcode.';
  }
  say_(msg);
}
