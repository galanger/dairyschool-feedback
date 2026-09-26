// Entry point. One page per role: index.html is the participant's questionnaire and nothing else,
// guide.html is the guide's page (its key in the hash), staff.html is the passcode-protected staff
// page. Only the single-file prototype bundle has one page that switches views by hash, with a bar.
import { createApi, resetMock } from './api.js';
import { h } from './dom.js';

const inline = !!window.DSF_INLINE; // the prototype bundle

function modeFromPage() {
  const view = document.body.dataset.view;
  const hash = decodeURIComponent(location.hash.slice(1));
  if (view === 'guide') return { mode: 'guide', key: hash }; // guide.html#KEY, taken exactly as written
  if (view === 'staff') return { mode: 'results', key: null };
  if (inline) {
    if (hash.startsWith('guide')) return { mode: 'guide', key: hash.replace(/^guide-?/, '') };
    if (hash.startsWith('results')) return { mode: 'results', key: null };
  }
  return { mode: 'survey', key: null };
}

// Prototype bundle only: switch between the three roles' views.
function demoBar(mode) {
  const link = (href, label, on) => h('a', { href, 'aria-current': on ? 'page' : null }, label);
  return h('nav', { class: 'demo-bar', 'aria-label': 'Prototype views' },
    h('span', { class: 'demo-tag' }, 'Prototype'),
    link('#survey', 'Participant', mode === 'survey'),
    link('#guide-demo', 'Guide', mode === 'guide'),
    link('#results', 'Staff', mode === 'results'),
    h('button', { type: 'button', onclick: () => {
      resetMock();
      try { Object.keys(localStorage).filter((k) => k.startsWith('dsf:')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
      try { sessionStorage.clear(); } catch { /* ignore */ }
      location.hash = '#survey';
      boot(true);
    } }, 'Reset'));
}

// Keyboard users always get a visible focus ring, in every browser engine (Safari does not
// always apply :focus-visible when arrow keys move focus between radio buttons).
const KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter', 'Home', 'End']);
document.addEventListener('keydown', (e) => { if (KEYS.has(e.key)) document.body.classList.add('kbd'); }, true);
document.addEventListener('pointerdown', () => document.body.classList.remove('kbd'), true);

const cfg = window.DSF_CONFIG || {};
const demo = !cfg.backendUrl;
let api = null;
let generation = 0;
let lastMode = null;

async function boot(force = false) {
  const { mode, key } = modeFromPage();
  if (!force && mode === lastMode) return;
  lastMode = mode;
  const gen = ++generation;
  const params = new URLSearchParams(location.search);
  const seminarId = params.get('s') || cfg.defaultSeminar || '';
  if (!api || force) {
    let mockSeed = null;
    if (demo) mockSeed = await (await import('./demo-seed.js')).buildSeed();
    api = createApi({ backendUrl: cfg.backendUrl, mockSeed });
  }
  // clean up the previous view
  document.querySelectorAll('.demo-bar, .tip, .qr-full').forEach((el) => el.remove());
  if (inline) document.body.prepend(demoBar(mode));
  document.body.classList.toggle('staff', mode !== 'survey');
  const root = document.getElementById('app');
  window.scrollTo(0, 0);
  // Ask for the seminar while the survey code is still loading (saves a round trip on slow networks).
  const configRequest = mode === 'survey' && seminarId ? api.getConfig(seminarId) : null;
  const mod = await import(mode === 'guide' ? './guide.js' : mode === 'results' ? './results.js' : './survey.js');
  if (gen !== generation) return;
  mod.mount(root, { api, seminarId, key, cfg, demo, inline, configRequest, alive: () => gen === generation });
}

if (inline) window.addEventListener('hashchange', () => boot());
boot();
