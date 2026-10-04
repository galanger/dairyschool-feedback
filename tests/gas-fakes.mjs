// In-memory imitation of Google Sheets / Apps Script services for running backend/Code.gs in Node.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

// ---------- fakes ----------
export class FakeRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => {
      const v = this.sheet.data[this.r - 1 + i]?.[this.c - 1 + j];
      return v === undefined ? '' : v;
    }));
  }
  setValues(rows) {
    rows.forEach((row, i) => row.forEach((v, j) => this.sheet.put(this.r + i, this.c + j, v)));
    return this;
  }
  setValue(v) { this.sheet.put(this.r, this.c, v); return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.put(this.r + i, this.c + j, ''); return this; }
  createTextFinder(text) {
    const range = this;
    return {
      matchEntireCell() { return this; },
      findNext() {
        const vals = range.getValues();
        for (let i = 0; i < vals.length; i++) for (let j = 0; j < vals[i].length; j++) {
          if (String(vals[i][j]) === text) return { row: range.r + i };
        }
        return null;
      },
    };
  }
}
export class FakeSheet {
  constructor(name, data = []) { this.name = name; this.data = data.map((r) => [...r]); this.formulas = 0; }
  put(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    // Imitate Sheets: "'text" is stored as text, "=…" would become a live formula.
    if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
    else if (typeof v === 'string' && /^[=+]/.test(v)) this.formulas++;
    this.data[r - 1][c - 1] = v;
  }
  getName() { return this.name; }
  setName(n) { if (this.book && this.book.sheets.some((s) => s !== this && s.name === n)) throw new Error(`A sheet named "${n}" already exists`); this.name = n; return this; }
  getLastRow() { let n = this.data.length; while (n && this.data[n - 1].every((v) => v === '' || v == null)) n--; return n; }
  getLastColumn() { return Math.max(0, ...this.data.map((r) => r.length)); }
  getRange(r, c, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc); }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  insertRowBefore(r) { this.data.splice(r - 1, 0, []); }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  appendRow(v) { this.data.splice(this.getLastRow(), 0, [...v]); }
  setFrozenRows() {}
  clearContents() { this.data = []; }
  copyTo(book) { const s = new FakeSheet(`Copy of ${this.name}`, this.data); s.book = book; book.sheets.push(s); return s; }
  protect() { const sheet = this; return { setDescription(d) { sheet.protection = d; return this; }, setWarningOnly(w) { sheet.warningOnly = w; return this; } }; }
}
export class FakeBook {
  constructor() { this.sheets = []; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); s.book = this; this.sheets.push(s); return s; }
  getSheets() { return [...this.sheets]; }
  deleteSheet(s) { const i = this.sheets.indexOf(s); if (i < 0) throw new Error('no such sheet'); if (this.sheets.length === 1) throw new Error('cannot delete the only sheet'); this.sheets.splice(i, 1); }
  getSpreadsheetTimeZone() { return this.tz || 'Asia/Jerusalem'; }
}

export function makeEnv({ random } = {}) {
  const book = new FakeBook();
  const props = new Map();
  const mail = [];
  const triggers = [];
  let locked = false;
  const env = {
    book, props, mail, triggers,
    ScriptApp: {
      getProjectTriggers: () => [...triggers],
      deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: (fn) => { const create = (how) => () => { const t = { getHandlerFunction: () => fn, how }; triggers.push(t); return t; }; return { timeBased: () => ({ after: (ms) => ({ create: create({ after: ms }) }), everyHours: (h) => ({ create: create({ everyHours: h }) }) }) }; },
    },
    MailApp: { sendEmail: (m) => { mail.push(m); } },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'school@example.com' }), getScriptTimeZone: () => 'Asia/Jerusalem' },
    SpreadsheetApp: { getActiveSpreadsheet: () => book, flush() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null),
      setProperty: (k, v) => { props.set(k, String(v)); },
      deleteProperty: (k) => { props.delete(k); },
      getKeys: () => [...props.keys()],
    }) },
    LockService: { getScriptLock: () => ({
      tryLock: () => { if (locked) return false; locked = true; return true; },
      releaseLock: () => { locked = false; },
    }) },
    holdLock: () => { locked = true; }, freeLock: () => { locked = false; },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s }) },
    Utilities: {
      getUuid: () => randomUUID(),
      newBlob: (content, type, name) => ({ content, type, name }),
      formatDate: (d, tz, fmt) => {
        const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        if (!fmt || !fmt.includes('HH')) return day;
        const sep = fmt.includes('HH:') ? ':' : '.'; // Sheets tab names use dots, the time sent uses colons
        const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d).replace(/:/g, sep);
        return `${day} ${fmt.includes('ss') ? time : time.slice(0, 5)}`;
      },
    },
    LanguageApp: { translate: (t) => (/[а-яіїєґ]/i.test(t) ? `EN(${t})` : t) },
    Math: random ? Object.assign(Object.create(Math), { random }) : Math,
    JSON, Date, String, Number, Object, Array, parseInt, RegExp,
  };
  vm.createContext(env);
  vm.runInContext(readFileSync('backend/Code.gs', 'utf8'), env);
  return env;
}

