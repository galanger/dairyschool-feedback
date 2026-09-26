// Talks to the Google Apps Script backend, or to an in-browser mock with the
// same rules for the demo and for tests.
//
// Every call resolves to { ok: true, ... } or { ok: false, code } where code is
// one of: NETWORK, TIMEOUT, NOT_FOUND, CLOSED, NAME_TAKEN, NAME_UNKNOWN,
// INVALID, UNAUTHORIZED, LOCKED, SERVER.

const TIMEOUT_MS = 45000;

export function createApi(cfg) {
  return cfg.backendUrl ? remoteApi(cfg.backendUrl) : mockApi(cfg);
}

// ---------- Remote (Apps Script web app) ----------
function remoteApi(url) {
  async function call(method, params) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      let res;
      if (method === 'GET') {
        const qs = new URLSearchParams(params).toString();
        res = await fetch(`${url}?${qs}`, { signal: ctrl.signal, redirect: 'follow' });
      } else {
        // text/plain keeps this a CORS "simple request": no preflight, which Apps Script can't answer.
        res = await fetch(url, {
          method: 'POST', body: JSON.stringify(params), signal: ctrl.signal, redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        });
      }
      if (!res.ok) return { ok: false, code: 'SERVER' };
      const data = await res.json().catch(() => null);
      return data && typeof data.ok === 'boolean' ? data : { ok: false, code: 'SERVER' };
    } catch (e) {
      return { ok: false, code: e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK' };
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    getConfig: (seminar) => call('GET', { action: 'config', s: seminar }),
    submit: (payload) => call('POST', { action: 'submit', ...payload }),
    getProgress: (seminar, key) => call('POST', { action: 'progress', s: seminar, key }),
    getResults: (seminar, key) => call('POST', { action: 'results', s: seminar, key }),
    setStatus: (seminar, key, status) => call('POST', { action: 'status', s: seminar, key, status }),
    listSeminars: (key) => call('POST', { action: 'seminars', key }),
    addName: (seminar, key, name) => call('POST', { action: 'addName', s: seminar, key, ...name }),
    removeName: (seminar, key, nameId) => call('POST', { action: 'removeName', s: seminar, key, nameId }),
    swapName: (seminar, key, wrongId, realId) => call('POST', { action: 'swapName', s: seminar, key, wrongId, realId }),
  };
}

// ---------- Mock (demo + tests) ----------
// Same rules as the backend: once-only by name, idempotent by submission id,
// results only after closing, names deleted on close.
const STORE_KEY = 'dsf-demo-v1';
let memory = null;

function load(seed) {
  let state = null;
  try { state = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { /* storage blocked */ }
  if (!state) state = memory;
  if (!state || state.version !== seed.version) state = JSON.parse(JSON.stringify(seed));
  memory = state;
  return state;
}
function save(state) {
  memory = state;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* keep in memory */ }
}

export function resetMock() {
  memory = null;
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}

function publicConfig(s) {
  const { responses, used, adminNote, ...rest } = s;
  return {
    ...rest,
    names: (s.names || []).map((n) => ({ ...n, answered: !!used[n.id] })),
  };
}

function mockApi(cfg) {
  const seed = cfg.mockSeed;
  const delay = () => new Promise((r) => setTimeout(r, cfg.mockLatency ?? (250 + Math.random() * 450)));
  if (!globalThis.__dsfMock) globalThis.__dsfMock = { failNext: 0, slowNext: 0, busyNext: 0 };
  const hooks = globalThis.__dsfMock;

  async function run(fn) {
    if (hooks.slowNext) { hooks.slowNext--; await new Promise((r) => setTimeout(r, 7000)); }
    await delay();
    if (hooks.failNext) { hooks.failNext--; return { ok: false, code: 'NETWORK' }; }
    const state = load(seed);
    const out = fn(state);
    save(state);
    return out;
  }
  const staffOk = (key) => typeof key === 'string' && key.length > 0;

  return {
    getConfig: (id) => run((st) => {
      const s = st.seminars[id];
      if (!s) return { ok: false, code: 'NOT_FOUND' };
      return { ok: true, seminar: publicConfig(s) };
    }),

    submit: (p) => run((st) => {
      if (hooks.busyNext) { hooks.busyNext--; return { ok: false, code: 'BUSY' }; }
      const s = st.seminars[p.s];
      if (!s) return { ok: false, code: 'NOT_FOUND' };
      if (!p.submissionId || typeof p.answers !== 'object') return { ok: false, code: 'INVALID' };
      // A retry of a submission that already went through succeeds again.
      if (s.responses.some((r) => r.id === p.submissionId)) return { ok: true, repeat: true };
      if (s.status !== 'open') return { ok: false, code: 'CLOSED' };
      if (!s.names.some((n) => n.id === p.nameId)) return { ok: false, code: 'NAME_UNKNOWN' };
      if (s.used[p.nameId]) return { ok: false, code: 'NAME_TAKEN' };
      const clean = sanitize(s, p);
      if (!clean) return { ok: false, code: 'INVALID' };
      s.used[p.nameId] = true;
      // Insert at a random position: row order says nothing about who answered when.
      s.responses.splice(Math.floor(Math.random() * (s.responses.length + 1)), 0, { id: p.submissionId, ...clean });
      return { ok: true };
    }),

    getProgress: (id, key) => run((st) => {
      const s = st.seminars[id];
      if (!s) return { ok: false, code: 'NOT_FOUND' };
      if (!staffOk(key)) return { ok: false, code: 'UNAUTHORIZED' };
      const total = s.status === 'closed' ? s.invited : s.names.length;
      const missing = s.names.filter((n) => !s.used[n.id]);
      const done = s.names.filter((n) => s.used[n.id]);
      return { ok: true, status: s.status, total, answered: s.responses.length, missing, done };
    }),

    // Names on the day (guide or staff, while open): an extra person, a no-show, a wrong tap.
    addName: (id, key, n) => run((st) => {
      const s = st.seminars[id];
      if (!s) return { ok: false, code: 'NOT_FOUND' };
      if (!staffOk(key)) return { ok: false, code: 'UNAUTHORIZED' };
      if (s.status === 'closed') return { ok: false, code: 'CLOSED' };
      const clean = (v) => (typeof v === 'string' ? v.trim().slice(0, 60) : '');
      const name = { id: `a${Math.random().toString(36).slice(2, 10)}`, surname: clean(n.surname), given: clean(n.given), surnameCyr: clean(n.surnameCyr), givenCyr: clean(n.givenCyr) };
      if (!name.surname || /\d/.test(name.surname + name.given + name.surnameCyr + name.givenCyr)) return { ok: false, code: 'INVALID' };
      s.names.push(name);
      return { ok: true, name: { ...name, answered: false } };
    }),
    removeName: (id, key, nameId) => run((st) => {
      const s = st.seminars[id];
      if (!s) return { ok: false, code: 'NOT_FOUND' };
      if (!staffOk(key)) return { ok: false, code: 'UNAUTHORIZED' };
      if (s.status === 'closed') return { ok: false, code: 'CLOSED' };
      if (s.used[nameId]) return { ok: false, code: 'NAME_TAKEN' };
      const i = s.names.findIndex((n) => n.id === nameId);
      if (i < 0) return { ok: false, code: 'NAME_UNKNOWN' };
      s.names.splice(i, 1);
      return { ok: true };
    }),
    swapName: (id, key, wrongId, realId) => run((st) => {
      const s = st.seminars[id];
      if (!s) return { ok: false, code: 'NOT_FOUND' };
      if (!staffOk(key)) return { ok: false, code: 'UNAUTHORIZED' };
      if (s.status === 'closed') return { ok: false, code: 'CLOSED' };
      const has = (x) => s.names.some((n) => n.id === x);
      if (!has(wrongId) || !has(realId) || wrongId === realId) return { ok: false, code: 'NAME_UNKNOWN' };
      if (!s.used[wrongId] || s.used[realId]) return { ok: false, code: 'INVALID' };
      delete s.used[wrongId]; s.used[realId] = true;
      return { ok: true };
    }),

    getResults: (id, key) => run((st) => {
      const s = st.seminars[id];
      if (!s) return { ok: false, code: 'NOT_FOUND' };
      if (!staffOk(key)) return { ok: false, code: 'UNAUTHORIZED' };
      const base = { seminar: publicConfig(s), invited: s.invited ?? s.names.length, answered: s.responses.length };
      if (s.status !== 'closed') return { ok: false, code: 'LOCKED', ...base };
      return { ok: true, ...base, responses: s.responses.map(({ id: _id, ...r }) => r) };
    }),

    setStatus: (id, key, status) => run((st) => {
      const s = st.seminars[id];
      if (!s) return { ok: false, code: 'NOT_FOUND' };
      if (!staffOk(key)) return { ok: false, code: 'UNAUTHORIZED' };
      let backup = null;
      if (status === 'closed' && s.status !== 'closed') {
        s.invited = s.names.length;
        s.names = [];          // names are deleted when the survey closes
        s.used = {};
        // The real backend also copies the answers to a dated tab and emails a CSV.
        backup = { rows: s.responses.length, snapshot: `${id} · Answers · ${new Date().toISOString().slice(0, 10)}`, emailedTo: null };
      }
      if (status === 'open' && !s.names.length) return { ok: false, code: 'INVALID' };
      s.status = status;
      return backup ? { ok: true, status, backup } : { ok: true, status };
    }),

    listSeminars: (key) => run((st) => {
      if (!staffOk(key)) return { ok: false, code: 'UNAUTHORIZED' };
      return { ok: true, seminars: Object.values(st.seminars).map((s) => ({
        id: s.id, title: s.title, dates: s.dates, status: s.status,
        answered: s.responses.length, invited: s.status === 'closed' ? s.invited : s.names.length,
      })) };
    }),
  };
}

// Keeps only known items, valid ratings and bounded text (the backend does the same).
export function sanitize(seminar, p) {
  const ids = new Set(seminar.items.map((it) => it.id));
  const qids = new Set((seminar.openQuestions || []).map((q) => q.id));
  const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : '');
  const answers = {}, comments = {}, open = {};
  for (const [k, v] of Object.entries(p.answers || {})) {
    if (!ids.has(k)) continue;
    if (Number.isInteger(v) && v >= 1 && v <= 7) answers[k] = v;
    else if (v === 'na') answers[k] = 'na';
  }
  for (const [k, v] of Object.entries(p.comments || {})) {
    const c = text(v, 1000);
    if (ids.has(k) && c) comments[k] = c;
  }
  for (const [k, v] of Object.entries(p.open || {})) {
    const c = text(v, 2000);
    if (qids.has(k) && c) open[k] = c;
  }
  return { answers, comments, open };
}
