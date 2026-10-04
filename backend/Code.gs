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

// Google sometimes loses a reply: the request runs, but fetching its answer redirects back to
// this address as a bare GET, which arrives here without any content. LOST tells the site so;
// it then asks again, which every action allows (repeats are recognised, nothing counts twice).
function doGet(e) {
  return respond_(function () {
    var p = (e && e.parameter) || {};
    if (p.action === 'config') return getConfig_(p.s);
    if (!p.action) return { ok: false, code: 'LOST' };
    return { ok: false, code: 'INVALID' };
  });
}

function doPost(e) {
  return respond_(function () {
    var raw = e && e.postData && e.postData.contents;
    if (!raw) return { ok: false, code: 'LOST' };
    if (raw.length > MAX_BODY) return { ok: false, code: 'INVALID' };
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
      case 'saveDraft': return saveDraft_(p);
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

function answersHead_(cfg) {
  return ['response'].concat(
    cfg.items.map(function (it) { return it.no + '. ' + it.label.en; }),
    cfg.items.map(function (it) { return 'Comment ' + it.no; }),
    cfg.openQuestions.map(function (q) { return q.label.en; }));
}

function answersSheet_(id, cfg) {
  var sh = tab_(id, 'Answers');
  if (sh) return sh;
  sh = book_().insertSheet(id + ' · Answers');
  var head = answersHead_(cfg);
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

// Backup names and emails carry the school's time (the script's zone, Israel), whatever zone the
// Sheet itself was created with.
function localZone_() {
  try { return Session.getScriptTimeZone() || book_().getSpreadsheetTimeZone(); } catch (err) { return book_().getSpreadsheetTimeZone(); }
}

function csvCell_(v) {
  var s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // never a live formula in a spreadsheet that opens the CSV
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function countAnswers_(sh) {
  if (!sh || sh.getLastRow() < 2) return 0;
  return sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().filter(function (r) { return r[0] !== '' && r[0] != null; }).length;
}

// opts.snapshot === false: email only (the hourly safety copies do not add tabs).
function backup_(id, why, opts) {
  var sh = tab_(id, 'Answers');
  var rows = countAnswers_(sh);
  var out = { rows: rows };
  if (!sh) return out;
  var stamp = Utilities.formatDate(new Date(), localZone_(), 'yyyy-MM-dd HH.mm.ss');
  if (!(opts && opts.snapshot === false)) {
    var base = (id + ' · Answers · ' + stamp).slice(0, 90), name = base;
    for (var k = 2; book_().getSheetByName(name); k++) name = base + ' (' + k + ')'; // never collide, never overwrite
    var copy = sh.copyTo(book_()).setName(name);
    protect_(copy, 'Backup copy: never edit or delete by hand');
    out.snapshot = copy.getName();
  }
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
    var existing = tab_(id, 'Answers');
    // A retry of a submission that already went through succeeds again.
    if (existing && existing.getLastRow() > 1) {
      var found = existing.getRange(2, 1, existing.getLastRow() - 1, 1).createTextFinder(String(p.submissionId)).matchEntireCell(true).findNext();
      if (found) return { ok: true, repeat: true };
    }
    if (String(row.status).toLowerCase() !== 'open') return { ok: false, code: 'CLOSED' };
    var nameId = String(p.nameId || '');
    if (!names_(id).some(function (n) { return n.id === nameId; })) return { ok: false, code: 'NAME_UNKNOWN' };
    if (isUsed_(id, nameId)) return { ok: false, code: 'NAME_TAKEN' };
    // The answers tab is made by the first real answer (never by a refused one), so a draft's
    // questions can still change without leaving a stale header behind.
    var sheet = existing || answersSheet_(id, cfg);

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
  var answered = countAnswers_(sh);
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
    // The site picks the new id, so a request repeated after a lost reply finds the row it added.
    var want = String(p.nameId || '');
    if (/^a[0-9a-z]{8,24}$/.test(want)) {
      var had = names_(id).filter(function (x) { return x.id === want; })[0];
      if (had) { had.answered = isUsed_(id, want); return { ok: true, name: had, repeat: true }; }
    }
    var sh = tab_(id, 'Names');
    if (!sh) {
      sh = book_().insertSheet(id + ' · Names');
      sh.getRange(1, 1, 1, NAME_COLS.length).setValues([NAME_COLS]);
      sh.setFrozenRows(1);
    }
    n.id = /^a[0-9a-z]{8,24}$/.test(want) ? want : 'a' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    sh.appendRow([n.id, n.surname, n.given, n.surnameCyr, n.givenCyr]);
    n.answered = false;
    return { ok: true, name: n };
  });
}

function removeName_(id, key, nameId) {
  return withNames_(id, key, function () {
    if (isUsed_(id, nameId)) return { ok: false, code: 'NAME_TAKEN' }; // already answered: keep
    var sh = tab_(id, 'Names');
    if (!sh || sh.getLastRow() < 2) return { ok: true, gone: true };
    var ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
    for (var r = 1; r < ids.length; r++) {
      if (String(ids[r][0]) === String(nameId)) { sh.deleteRow(r + 1); return { ok: true }; }
    }
    return { ok: true, gone: true }; // not on the list (any more): removed already, e.g. a repeated request
  });
}

function swapName_(id, key, wrongId, realId) {
  return withNames_(id, key, function () {
    var names = names_(id);
    var has = function (x) { return names.some(function (n) { return n.id === x; }); };
    if (!has(wrongId) || !has(realId) || wrongId === realId) return { ok: false, code: 'NAME_UNKNOWN' };
    if (!isUsed_(id, wrongId) && isUsed_(id, realId)) return { ok: true, repeat: true }; // done already
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
  return values.filter(function (r) { return r[0] !== '' && r[0] != null; }).map(function (r) {
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
  var answered = countAnswers_(sh);
  var invited = String(row.status).toLowerCase() === 'closed' ? Number(row.invited) || null : names_(id).length;
  cfg.names = [];
  if (cfg.status !== 'closed') return { ok: false, code: 'LOCKED', seminar: cfg, invited: invited, answered: answered };
  var responses = readResponses_(id, cfg);
  var translations = translations_(id);
  var pending = uniqueTexts_(responses).filter(function (t) { return !(t in translations); }).length;
  return { ok: true, seminar: cfg, invited: invited, answered: answered, responses: responses, translations: translations, translationsPending: pending };
}

function listSeminars_(key) {
  if (!isAdmin_(key)) return { ok: false, code: 'UNAUTHORIZED' };
  var sheet = book_().getSheetByName(SEMINARS);
  var values = sheet.getDataRange().getValues().slice(1).filter(function (r) { return r[0]; });
  return { ok: true, seminars: values.map(function (r) {
    var o = {}; SEMINAR_COLS.forEach(function (c, i) { o[c] = r[i]; });
    var sh = tab_(o.id, 'Answers');
    return { id: String(o.id), title: bi_(o.title_en, o.title_uk), dates: { start: isoDate_(o.start), end: isoDate_(o.end) },
      status: String(o.status || 'draft').toLowerCase(), answered: countAnswers_(sh),
      invited: String(o.status).toLowerCase() === 'closed' ? Number(o.invited) || null : names_(o.id).length };
  }).reverse() };
}

function setStatus_(id, key, status) {
  var admin = isAdmin_(key);
  // Besides the staff, the guide may open a draft: the guide is with the group and knows when it
  // is ready to answer. Closing (which deletes the names) stays with the staff.
  if (!admin && status !== 'open') return { ok: false, code: 'UNAUTHORIZED' };
  if (['open', 'closed', 'draft'].indexOf(status) < 0) return { ok: false, code: 'INVALID' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, code: 'BUSY' };
  try {
    var row = seminarRow_(id);
    if (!row) return { ok: false, code: admin ? 'NOT_FOUND' : 'UNAUTHORIZED' };
    var was = String(row.status).toLowerCase();
    if (!admin) {
      if (!isGuide_(row, key) || (was !== 'draft' && was !== 'open')) return { ok: false, code: 'UNAUTHORIZED' };
      if (was === 'open') return { ok: true, status: 'open' }; // two taps, or two guides: already done
    }
    // A closed survey stays closed: its names are gone and its results are final.
    if (was === 'closed' && status !== 'closed') return { ok: false, code: 'CLOSED' };
    var sheet = book_().getSheetByName(SEMINARS);
    var col = function (name) { return SEMINAR_COLS.indexOf(name) + 1; };
    if (status === 'closed' && String(row.status).toLowerCase() !== 'closed') {
      var names = names_(id);
      sheet.getRange(row._row, col('invited')).setValue(names.length);
      deleteNames_(id, names);
      props_().deleteProperty('backedUp:' + id);
      sheet.getRange(row._row, col('status')).setValue('closed');
      SpreadsheetApp.flush();
      // Backups first, always. Translations get a short time budget here and finish in the
      // background (translatePending), so closing never waits on Google Translate.
      var backup;
      try { backup = backup_(id, 'survey closed'); } catch (err) { backup = { error: String((err && err.message) || err) }; }
      var pending = 0;
      try { pending = translateBatch_(id, 15000); } catch (err) { pending = -1; }
      if (pending !== 0) scheduleTranslate_(id);
      return { ok: true, status: 'closed', backup: backup, translationsPending: pending < 0 ? null : pending };
    }
    if (status === 'open' && !names_(id).length) return { ok: false, code: 'INVALID' };
    sheet.getRange(row._row, col('status')).setValue(status);
    if (status === 'open') ensureHourlyBackup_();
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

// ---------------------------------------------------------------- drafts
// tools/save-draft.mjs writes a seminar from a file (staff passcode): a new draft, or a rewrite of
// a draft that has no answers (titles, dates, questions, names). Open and closed seminars, and
// answers, are never touched by it; the Sheet stays the place to read and edit everything.
var CATEGORIES = ['lecture', 'farm', 'tour', 'partners', 'guide', 'hotel', 'food', 'other', 'overall'];

// Clean text within max characters; null when invalid (too long, not text, or required and empty).
function draftText_(v, max, required) {
  if (v == null || v === '') return required ? null : '';
  if (typeof v !== 'string') return null;
  var s = cleanText_(v, max + 1);
  return s.length > max || (required && !s) ? null : s;
}

function draftProblem_(p) {
  var sem = p.seminar;
  if (!sem || typeof sem !== 'object') return 'seminar';
  if (draftText_(sem.title_en, 200, true) === null) return 'title_en';
  var opt = ['title_uk', 'subtitle_en', 'subtitle_uk', 'report_name'];
  for (var i = 0; i < opt.length; i++) if (draftText_(sem[opt[i]], 200, false) === null) return opt[i];
  var day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(String(sem.start)) || !day.test(String(sem.end)) || String(sem.end) < String(sem.start)) return 'dates';
  var langs = String(sem.languages || '').split(/[,\s]+/).filter(String);
  if (!langs.length || langs.some(function (l) { return l !== 'uk' && l !== 'en'; })) return 'languages';
  if (langs.indexOf(String(sem.default_lang)) < 0) return 'default_lang';
  var items = p.items;
  if (!Array.isArray(items) || !items.length || items.length > 80) return 'items';
  var keys = {};
  for (var k = 0; k < items.length; k++) {
    var it = items[k] || {}, at = 'item ' + (k + 1) + ': ';
    if (draftText_(it.label_en, 300, true) === null) return at + 'label_en';
    if (draftText_(it.label_uk, 300, false) === null) return at + 'label_uk';
    if (draftText_(it.section_en, 100, true) === null) return at + 'section_en';
    if (draftText_(it.section_uk, 100, false) === null) return at + 'section_uk';
    if (draftText_(it.detail_en, 300, false) === null || draftText_(it.detail_uk, 300, false) === null) return at + 'detail';
    if (CATEGORIES.indexOf(it.category) < 0) return at + 'category';
    if (it.optional != null && typeof it.optional !== 'boolean') return at + 'optional';
    if (it.key) {
      if ((it.key !== 'overall' && it.key !== 'recommend') || keys[it.key]) return at + 'key';
      keys[it.key] = true;
    }
  }
  if (p.names != null) {
    if (!Array.isArray(p.names) || p.names.length > 150) return 'names';
    for (var n = 0; n < p.names.length; n++) {
      var x = p.names[n] || {}, f = ['surname', 'given', 'surname_cyr', 'given_cyr'];
      for (var j = 0; j < f.length; j++) {
        var v = draftText_(x[f[j]], 60, f[j] === 'surname');
        if (v === null || /\d/.test(v)) return 'name ' + (n + 1); // never a passport number
      }
    }
  }
  return null;
}

function saveDraft_(p) {
  if (!isAdmin_(p.key)) return { ok: false, code: 'UNAUTHORIZED' };
  var problem = draftProblem_(p);
  if (problem) return { ok: false, code: 'INVALID', problem: problem };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, code: 'BUSY' };
  try {
    var sheet = book_().getSheetByName(SEMINARS);
    if (!sheet) return { ok: false, code: 'INVALID', problem: 'run First setup in the Sheet' };
    var row = null, id;
    if (p.s) {
      row = seminarRow_(p.s);
      if (!row) return { ok: false, code: 'NOT_FOUND' };
      // Answers are stored in the order of the questions, so only a draft without answers changes.
      if (String(row.status).toLowerCase() !== 'draft' || countAnswers_(tab_(row.id, 'Answers')) > 0) return { ok: false, code: 'LOCKED' };
      id = String(row.id);
    } else {
      var base = String(p.base || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
      if (base.length < 3) return { ok: false, code: 'INVALID', problem: 'base' };
      do { id = base + '-' + randomKey_(4); } while (seminarRow_(id)); // hard to guess, still readable
    }
    var t = function (v, max) { return asText_(draftText_(v, max, false)); };

    var itemRows = [ITEM_COLS].concat(p.items.map(function (it, i) {
      return [i + 1, 'i' + ('0' + (i + 1)).slice(-2), t(it.section_en, 100), t(it.section_uk, 100), it.category,
        t(it.label_en, 300), t(it.label_uk, 300), t(it.detail_en, 300), t(it.detail_uk, 300), it.optional === true, it.key || ''];
    }));
    var items = tab_(id, 'Items') || book_().insertSheet(id + ' · Items');
    items.clearContents();
    items.getRange(1, 1, itemRows.length, ITEM_COLS.length).setValues(itemRows);
    items.setFrozenRows(1);

    // Names: replaced when given; otherwise the ones already there stay.
    var names = tab_(id, 'Names');
    if (p.names || !names) {
      names = names || book_().insertSheet(id + ' · Names');
      names.clearContents();
      var nameRows = [NAME_COLS].concat((p.names || []).map(function (x, i) {
        return ['n' + ('0' + (i + 1)).slice(-2), t(x.surname, 60), t(x.given, 60), t(x.surname_cyr, 60), t(x.given_cyr, 60)];
      }));
      names.getRange(1, 1, nameRows.length, NAME_COLS.length).setValues(nameRows);
      names.setFrozenRows(1);
    }

    // The seminar row. On a rewrite the id, the status (draft) and the guide key stay.
    var sem = p.seminar;
    var guideKey = row ? String(row.guide_key) : randomKey_(10);
    var fields = { id: id, title_en: t(sem.title_en, 200), title_uk: t(sem.title_uk, 200), subtitle_en: t(sem.subtitle_en, 200),
      subtitle_uk: t(sem.subtitle_uk, 200), start: t(sem.start, 10), end: t(sem.end, 10), languages: t(sem.languages, 20),
      default_lang: t(sem.default_lang, 5), status: 'draft', guide_key: guideKey, report_name: t(sem.report_name, 200), invited: '' };
    var at = row ? row._row : sheet.getLastRow() + 1;
    sheet.getRange(at, 1, 1, SEMINAR_COLS.length).setValues([SEMINAR_COLS.map(function (c) { return fields[c]; })]);

    // An empty answers tab (left by an older version) gets the new questions as its header.
    var ans = tab_(id, 'Answers');
    if (ans) {
      var head = answersHead_(seminarConfig_(seminarRow_(id)));
      ans.getRange(1, 1, 1, Math.max(ans.getLastColumn(), head.length)).clearContent();
      ans.getRange(1, 1, 1, head.length).setValues([head]);
    }
    SpreadsheetApp.flush();
    return { ok: true, id: id, guideKey: guideKey, items: p.items.length, names: names_(id).length };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- translations
// English versions of the comments, written as plain values (no live formulas). Google Translate
// takes a moment per text and a group writes hundreds, so the work runs within a time budget and
// the remainder is finished by a background trigger; results show what is ready.

function uniqueTexts_(responses) {
  var texts = {};
  responses.forEach(function (r) {
    Object.keys(r.comments).forEach(function (k) { texts[r.comments[k]] = true; });
    Object.keys(r.open).forEach(function (k) { texts[r.open[k]] = true; });
  });
  return Object.keys(texts);
}

// Translates texts that have no translation yet, for at most budgetMs. Returns how many are left.
function translateBatch_(id, budgetMs) {
  var row = seminarRow_(id);
  if (!row) return 0;
  var cfg = seminarConfig_(row);
  var have = translations_(id);
  var todo = uniqueTexts_(readResponses_(id, cfg)).filter(function (t) { return !(t in have); });
  if (!todo.length) return 0;
  var sh = tab_(id, 'English');
  if (!sh) { sh = book_().insertSheet(id + ' · English'); sh.getRange(1, 1, 1, 2).setValues([['original', 'english']]); }
  var start = Date.now(), out = [];
  for (var i = 0; i < todo.length && Date.now() - start < budgetMs; i++) {
    var en = '';
    try { en = LanguageApp.translate(todo[i], '', 'en'); } catch (err) { en = ''; }
    if (en) out.push([asText_(todo[i]), asText_(en)]); // a failed one is simply tried again later
  }
  if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, 2).setValues(out);
  return todo.length - out.length;
}

// ---------------------------------------------------------------- hourly safety copies
// While a survey is open, a trigger emails the CSV in every hour that brought new answers, so a
// copy exists off the Sheet before the survey is even closed. It disarms itself when nothing is open.
function ensureHourlyBackup_() {
  var armed = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'hourlyBackup'; });
  if (!armed) ScriptApp.newTrigger('hourlyBackup').timeBased().everyHours(1).create();
}

function hourlyBackup() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var sheet = book_().getSheetByName(SEMINARS);
    var open = 0;
    (sheet ? sheet.getDataRange().getValues().slice(1) : []).forEach(function (r) {
      var o = {}; SEMINAR_COLS.forEach(function (c, i) { o[c] = r[i]; });
      if (!o.id || String(o.status).toLowerCase() !== 'open') return;
      open++;
      var id = String(o.id);
      var rows = countAnswers_(tab_(id, 'Answers'));
      if (rows > Number(props_().getProperty('backedUp:' + id) || 0)) {
        try { backup_(id, 'hourly safety copy', { snapshot: false }); props_().setProperty('backedUp:' + id, String(rows)); } catch (err) { /* next hour */ }
      }
    });
    if (!open) ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'hourlyBackup') ScriptApp.deleteTrigger(t); });
  } finally {
    lock.releaseLock();
  }
}

function scheduleTranslate_(id) {
  props_().setProperty('translate:' + id, '1');
  var armed = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'translatePending'; });
  if (!armed) ScriptApp.newTrigger('translatePending').timeBased().after(60 * 1000).create();
}

// Background trigger: translates what is left, a few minutes at a time, then removes itself.
function translatePending() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var left = 0;
    props_().getKeys().filter(function (k) { return k.indexOf('translate:') === 0; }).forEach(function (k) {
      var id = k.slice('translate:'.length);
      var tries = Number(props_().getProperty('translateTries:' + id) || 0) + 1;
      var pending = 0;
      try { pending = translateBatch_(id, 200000); } catch (err) { pending = 1; }
      if (pending > 0 && tries < 8) { props_().setProperty('translateTries:' + id, String(tries)); left += pending; }
      else { props_().deleteProperty(k); props_().deleteProperty('translateTries:' + id); }
    });
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'translatePending') ScriptApp.deleteTrigger(t); });
    if (left > 0) ScriptApp.newTrigger('translatePending').timeBased().after(60 * 1000).create();
  } finally {
    lock.releaseLock();
  }
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
  var site = props_().getProperty('SITE_URL');
  if (!site) return say_('Set the survey address first: Dairy School → Set survey address.');
  var base = siteBase_(site);
  say_('Participants (QR code):\n' + base + '?s=' + row.id +
    '\n\nGuide (progress and names, never scores):\n' + base + 'guide.html?s=' + row.id + '#' + row.guide_key +
    '\n\nStaff (passcode; results after closing):\n' + base + 'staff.html?s=' + row.id);
}

// "https://feedback.example/" or "https://x.github.io/repo/index.html" → the site folder, with a slash.
function siteBase_(site) {
  var b = String(site).replace(/[?#].*$/, '');
  if (!/\/$/.test(b)) b = b.replace(/[^/]*$/, '');
  return b;
}

function menuOpen() {
  var row = pickSeminar_('Open survey');
  if (!row) return;
  var n = names_(row.id).length;
  if (!n) return say_('Add the names first, in "' + row.id + ' · Names".');
  var nameErrors = names_(row.id).filter(function (x) { return /\d/.test(x.surname + x.given); });
  if (nameErrors.length) return say_('Some names contain digits (a passport number?). Fix them first: ' + nameErrors.map(function (x) { return x.surname; }).join(', '));
  book_().getSheetByName(SEMINARS).getRange(row._row, SEMINAR_COLS.indexOf('status') + 1).setValue('open');
  ensureHourlyBackup_();
  say_('The survey "' + row.id + '" is open for ' + n + ' people.\n\nWhile it is open, a safety copy of the answers is emailed in every hour that brings new answers.');
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
  try { say_(backupText_(backup_(row.id, 'manual backup')) || 'Nothing to back up yet.'); }
  catch (err) { say_('The backup could not be made: ' + ((err && err.message) || err)); }
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
  // A small open sample seminar with invented names, so the live site can be tried and tested
  // end to end right away. Close it from the staff page when done; it stays as a reference.
  if (!seminarRow_('sample')) {
    var sid = 'sample';
    var items = tab_('template', 'Items').copyTo(b).setName(sid + ' · Items');
    items.getRange(2, 6, 4, 2).setValues([
      ['Lecture: dairy farming in Israel', 'Лекція: молочне скотарство в Ізраїлі'],
      ['Farm visit: a family dairy farm', 'Відвідування ферми: сімейна молочна ферма'],
      ['Accommodation: the hotel', 'Проживання: готель'],
      ['How strongly would you recommend our seminars to your colleagues?', 'Наскільки ви рекомендували б наші семінари колегам?']]);
    var names = b.insertSheet(sid + ' · Names');
    names.getRange(1, 1, 4, NAME_COLS.length).setValues([NAME_COLS,
      ['n01', 'Bondarenko', 'Andrii', 'Бондаренко', 'Андрій'],
      ['n02', 'Melnyk', 'Oleksandr', 'Мельник', 'Олександр'],
      ['n03', 'Hnatiuk', 'Olena', 'Гнатюк', 'Олена']]);
    names.setFrozenRows(1);
    var today = new Date();
    b.getSheetByName(SEMINARS).appendRow(SEMINAR_COLS.map(function (c) {
      return { id: sid, title_en: 'Sample seminar (invented names)', title_uk: 'Пробний семінар (вигадані імена)',
        subtitle_en: 'For trying the survey', subtitle_uk: 'Щоб спробувати опитування',
        start: today, end: today, languages: 'uk,en', default_lang: 'uk', status: 'open', guide_key: randomKey_(10), report_name: 'a sample group' }[c] || '';
    }));
    ensureHourlyBackup_();
    msg += '\n\nA sample seminar "sample" is open with three invented names, so the site can be tried right away. Dairy School → Get links shows its links.';
  }
  say_(msg);
}
