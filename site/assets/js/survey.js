// Participant survey: welcome → name → sections → last questions → send → thanks.
import { h, icon, store, uuid, reducedMotion, swap, append, softFocus } from './dom.js';
import { makeT, formatDates, pick } from './i18n.js';

export function mount(root, { api, seminarId, cfg, configRequest = null, alive = () => true }) {
  const K = { draft: `dsf:${seminarId}:draft`, done: `dsf:${seminarId}:done`, cfg: `dsf:${seminarId}:cfg`, lang: 'dsf:lang' };
  const S = {
    seminar: null, lang: null, userLang: store.get(K.lang), t: makeT('en'),
    screen: 'loading', sectionIndex: 0, draft: null, sending: false, error: null, loadError: null,
    offline: false, closedWhileSending: false, confirmRestart: false,
  };
  let slowTimer = null;
  let reloadTimer = null;

  // ---------- layout ----------
  const topbar = h('header', { class: 'topbar' });
  const main = h('main', { class: 'main', id: 'main' });
  const bar = h('div', { class: 'bar', hidden: true });
  swap(root, h('div', { class: 'app' }, topbar, main, bar));

  // Only a tap on the language switch is remembered; defaults are not.
  function setLang(lang, remember = false) {
    S.lang = lang; S.t = makeT(lang);
    if (remember) { S.userLang = lang; store.set(K.lang, lang); }
    document.documentElement.lang = lang;
  }
  const guessLang = () => S.userLang || (/^(uk|ru)\b/i.test(navigator.language || '') ? 'uk' : 'en');

  function renderTopbar() {
    const langs = S.seminar?.languages || [];
    const sw = langs.length > 1 ? h('div', { class: 'lang', role: 'group', 'aria-label': 'Language / Мова' },
      langs.map((l) => h('button', {
        type: 'button', lang: l, 'aria-pressed': String(l === S.lang),
        onclick: () => { if (l !== S.lang) { setLang(l, true); render(); } },
      }, l === 'uk' ? 'УКР' : l.toUpperCase()))) : null;
    swap(topbar, h('div', { class: 'topbar-inner' },
      h('span', { class: 'logo-chip' }, h('img', { src: 'assets/img/logo.png', alt: 'Dairy School — The Israeli Experience', width: '110', height: '26' })),
      sw));
    if (S.preview) topbar.append(h('p', { class: 'preview-flag' }, t('previewFlag')));
  }

  function setBar(...children) {
    const content = children.filter(Boolean);
    bar.hidden = !content.length;
    bar.classList.remove('prompting');
    swap(bar, ...content);
  }

  function show(screen, { focus = true } = {}) {
    S.screen = screen;
    render();
    window.scrollTo(0, 0);
    if (focus) main.querySelector('h1')?.focus({ preventScroll: true });
    if (screen === 'names' || screen === 'section') armBack();
  }

  // ---------- phone Back button ----------
  // While inside the survey we keep one extra history entry, so the phone's Back button
  // goes to the previous page of the survey (like our own Back button) instead of leaving.
  let backArmed = false, armedHash = '';
  function armBack() {
    if (backArmed) return;
    try { history.pushState({ dsfBack: true }, ''); backArmed = true; armedHash = location.hash; } catch { /* ignore */ }
  }
  function goBack() {
    if (S.screen === 'section') {
      if (S.sectionIndex > 0) { S.sectionIndex--; saveDraft(); show('section'); } else show('names');
      return true;
    }
    if (S.screen === 'names') { show('welcome'); return true; }
    return false;
  }
  function onPop() {
    if (!alive()) return window.removeEventListener('popstate', onPop);
    if (!backArmed || location.hash !== armedHash) return; // a link, not the Back button
    backArmed = false;
    goBack();
  }
  window.addEventListener('popstate', onPop);
  const onOnline = () => {
    if (!alive()) return window.removeEventListener('online', onOnline);
    if (S.offline) { S.offline = false; document.querySelector('.offline-note')?.remove(); }
  };
  window.addEventListener('online', onOnline);

  // ---------- on-screen keyboard ----------
  // Hide the bottom bar while the keyboard is open so it can never cover the text being typed.
  const vv = window.visualViewport;
  if (vv) {
    const onVV = () => {
      if (!alive()) return vv.removeEventListener('resize', onVV);
      document.body.classList.toggle('kb-open', window.innerHeight - vv.height * vv.scale > 150);
    };
    vv.addEventListener('resize', onVV);
  }

  // ---------- data helpers ----------
  const t = (...a) => S.t(...a);
  t.plural = (...a) => S.t.plural(...a);
  const sem = () => S.seminar;
  const L = (v) => pick(v, S.lang);
  const useCyr = () => S.lang === 'uk';
  const nameParts = (n) => (useCyr() && n.surnameCyr ? [n.surnameCyr, n.givenCyr] : [n.surname, n.given]);
  const altParts = (n) => (useCyr() ? [n.surname, n.given] : n.surnameCyr ? [n.surnameCyr, n.givenCyr] : null);
  const fullName = (n) => { const [s, g] = nameParts(n); return `${g} ${s}`; };
  const person = () => sem().names.find((n) => n.id === S.draft?.nameId) || null;

  function buildSections(s) {
    return s.sections.map((sec) => ({ ...sec, items: s.items.filter((it) => it.section === sec.id) }))
      .filter((sec) => sec.items.length);
  }
  let sections = [];
  const lastIndex = () => sections.length - 1;
  const answer = (id) => S.draft.answers[id];
  const isAnswered = (it) => answer(it.id) !== undefined && answer(it.id) !== null;
  const hasComment = (it) => !!(S.draft.comments[it.id] || '').trim();
  // Every item needs a rating (or "didn't take part"); a comment is welcome but not required.
  // Optional items ("for the ladies") may be left untouched. The two closing questions are required.
  const missingOf = (it) => {
    if (answer(it.id) === 'na') return null;
    if (!isAnswered(it)) return it.optional && !hasComment(it) ? null : 'rating';
    return null;
  };
  const incompleteIn = (sec) => sec.items.map((it) => ({ it, need: missingOf(it) })).filter((m) => m.need);
  const openMissing = () => (sem().openQuestions || []).filter((q) => !(S.draft.open[q.id] || '').trim()).map((q) => ({ q, need: 'open' }));

  function saveDraft() {
    S.draft.updatedAt = Date.now();
    S.draft.sectionIndex = S.sectionIndex;
    S.canSave = store.set(K.draft, S.draft);
    // Offline copy of the survey while answering: questions plus this person's name only.
    if (S.canSave && S.draft.nameId && S.seminar && !S.offline) {
      store.set(K.cfg, { ...S.seminar, names: S.seminar.names.filter((n) => n.id === S.draft.nameId) });
    }
  }
  function newDraft(nameId = null) {
    S.draft = { nameId, answers: {}, comments: {}, open: {}, submissionId: uuid(), sectionIndex: 0 };
    S.pendingName = null;
    S.sawEnd = false;
    S.sectionIndex = 0;
  }

  // ---------- boot ----------
  async function load() {
    S.screen = 'loading'; render();
    const early = configRequest; configRequest = null; // the early request is used once; retries fetch again
    const res = await (early || api.getConfig(seminarId));
    let seminar = res.ok ? res.seminar : null;
    S.offline = false;
    if (!seminar && res.code !== 'NOT_FOUND') {
      // No connection: reopen the survey last loaded on this phone, so saved answers aren't stranded.
      const cached = store.get(K.cfg);
      if (cached && cached.status === 'open') { seminar = cached; S.offline = true; }
    }
    if (!seminar) {
      S.loadError = res.code === 'NOT_FOUND' ? 'notFound' : 'loadError';
      if (!S.lang) setLang(guessLang());
      // Google is sometimes unreachable for a few minutes: besides the button, try again by itself.
      clearTimeout(reloadTimer);
      if (S.loadError === 'loadError') reloadTimer = setTimeout(() => { if (alive() && S.screen === 'error') load(); }, 15000);
      return show('error', { focus: false });
    }
    S.seminar = seminar;
    sections = buildSections(S.seminar);
    const langs = S.seminar.languages || ['en'];
    setLang(langs.includes(S.userLang) ? S.userLang : (S.seminar.defaultLang || langs[0]));
    S.preview = S.seminar.status === 'draft';
    if (S.seminar.status !== 'open' && !S.preview) return show('closed', { focus: false });
    if (store.get(K.done)) return show('already', { focus: false });
    const d = store.get(K.draft);
    if (d && d.submissionId && d.answers) {
      S.draft = { comments: {}, open: {}, ...d };
      S.sectionIndex = Math.min(d.sectionIndex || 0, lastIndex());
    }
    show('welcome', { focus: false });
  }

  // ---------- render ----------
  function render() {
    if (!S.lang) setLang(guessLang());
    renderTopbar();
    const screens = { loading, error, welcome, names, section, thanks, already, closed };
    swap(main, S.offline && ['welcome', 'names', 'section'].includes(S.screen) && h('p', { class: 'offline-note', role: 'status' }, icon('alert'), t('offlineCached')),
      screens[S.screen]());
    main.querySelectorAll('textarea.cmt').forEach(growBox); // sized once mounted (a saved comment may be long)
  }
  // Comment boxes start one line high and grow with the text.
  function growBox(el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }

  function loading() {
    setBar();
    return h('div', { class: 'loading', role: 'status' }, h('div', { class: 'spinner' }), S.t('loading'));
  }

  // Before the seminar loads we don't know its language, so errors are shown in both.
  function error() {
    setBar();
    const other = S.lang === 'uk' ? 'en' : 'uk';
    const t2 = makeT(other);
    const title = S.loadError === 'notFound' ? 'notFoundTitle' : 'loadErrorTitle';
    return h('section', { class: 'screen center' },
      h('div', { class: 'badge-ok badge-info' }, icon('alert')),
      h('h1', { tabindex: '-1' }, t(title)),
      h('p', {}, t(S.loadError)),
      h('p', { class: 'second-lang', lang: other }, h('b', {}, t2(title)), ' · ', t2(S.loadError)),
      S.loadError === 'loadError' && h('button', { class: 'btn btn-secondary', type: 'button', onclick: load }, icon('refresh'), `${t('retryLoad')} · ${t2('retryLoad')}`),
      S.loadError === 'loadError' && h('p', { class: 'second-lang' }, `${t('autoRetry')} · ${t2('autoRetry')}`));
  }

  function welcome() {
    const s = sem();
    const d = S.draft;
    const resuming = d && d.nameId && Object.keys(d.answers).length + Object.keys(d.comments).length > 0 && person();
    let notice = null;
    if (resuming) {
      notice = S.confirmRestart
        ? h('div', { class: 'notice', role: 'region', 'aria-label': t('resumeConfirm') },
          h('h2', {}, t('resumeConfirm')),
          h('div', { class: 'stack' },
            h('button', { class: 'btn btn-danger', type: 'button', onclick: () => { S.confirmRestart = false; store.del(K.draft); newDraft(); show('names'); } }, t('resumeDelete')),
            h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { S.confirmRestart = false; show('welcome', { focus: false }); } }, t('cancel'))))
        : h('div', { class: 'notice', role: 'region', 'aria-label': t('resumeTitle') },
          h('h2', {}, t('resumeTitle')),
          h('p', {}, t('resumeAs', { name: fullName(person()) })),
          h('div', { class: 'stack' },
            h('button', { class: 'btn btn-primary', type: 'button', onclick: () => show('section') }, t('resumeContinue')),
            h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { S.confirmRestart = true; show('welcome', { focus: false }); } }, t('resumeRestart'))));
    }
    const fact = (ico, text) => h('li', {}, h('span', { class: 'fact-ico' }, icon(ico)), h('span', { class: 'fact-txt' }, text));
    const node = h('section', { class: 'screen' },
      h('div', { class: 'hero' },
        h('span', { class: 'eyebrow' }, t('eyebrow')),
        h('h1', { tabindex: '-1' }, L(s.title)),
        s.subtitle && h('p', { class: 'sub' }, L(s.subtitle)),
        s.dates && h('span', { class: 'dates' }, icon('calendar'), formatDates(s.dates.start, s.dates.end, S.lang))),
      h('p', { class: 'intro' }, t('intro')),
      notice,
      h('ul', { class: 'facts' },
        fact('check', t('factScale')), fact('clock', t('factTime')), fact('once', t('factOnce')), fact('lock', t('factPrivate'))),
      h('details', { class: 'privacy' },
        h('summary', {}, icon('chevron', 'chev'), t('privacyMore')),
        h('p', {}, t('privacyText'))));
    setBar(resuming ? null : h('div', { class: 'bar-inner' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { if (!S.draft) newDraft(); show('names'); } }, t('start'))));
    return node;
  }

  // The names list refreshes itself, so a name added by staff (or one just used) shows up.
  let namesFresh = 0;
  async function refreshNames(force = false) {
    if (!force && Date.now() - namesFresh < 5000) return;
    namesFresh = Date.now();
    const res = await api.getConfig(seminarId);
    if (!res.ok || S.screen !== 'names') return;
    if (S.offline) { S.offline = false; document.querySelector('.offline-note')?.remove(); }
    const st = res.seminar.status;
    if (st !== 'open' && !(st === 'draft' && S.preview)) return show('closed');
    if (S.preview && st === 'open') { S.preview = false; S.seminar.status = 'open'; renderTopbar(); } // opened meanwhile
    const sig = (list) => list.map((n) => `${n.id}:${n.answered ? 1 : 0}`).join('|');
    if (sig(res.seminar.names) === sig(S.seminar.names)) return; // nothing changed: leave the screen alone
    S.seminar.names = res.seminar.names;
    const y = window.scrollY;
    const active = document.activeElement;
    const focusId = active?.id || (active?.name === 'who' ? `who:${active.value}` : null);
    const helpOpen = !document.getElementById('name-help')?.hidden;
    const q = document.getElementById('name-search')?.value;
    main.classList.add('no-anim');
    render();
    requestAnimationFrame(() => main.classList.remove('no-anim'));
    window.scrollTo(0, y);
    if (helpOpen) { const hp = document.getElementById('name-help'); if (hp) hp.hidden = false; }
    if (q) { const inp = document.getElementById('name-search'); inp.value = q; inp.dispatchEvent(new Event('input')); }
    if (focusId) {
      const el = focusId.startsWith('who:') ? main.querySelector(`input[name="who"][value="${focusId.slice(4)}"]`) : document.getElementById(focusId);
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }
  }
  const namesTimer = setInterval(() => {
    if (!alive()) return clearInterval(namesTimer);
    if (S.screen === 'names' && !document.hidden) refreshNames(true);
  }, 15000);

  function names() {
    const s = sem();
    refreshNames();
    const collator = new Intl.Collator(S.lang === 'uk' ? 'uk' : 'en');
    const sorted = [...s.names].sort((a, b) => collator.compare(nameParts(a).join(' '), nameParts(b).join(' ')));
    const free = (id) => id && s.names.some((n) => n.id === id && !n.answered);
    let chosen = free(S.pendingName) ? S.pendingName : free(S.draft?.nameId) ? S.draft.nameId : null;
    const help = h('p', { class: 'name-help', hidden: true, id: 'name-help' }, t('nameMissingHelp'), ' ',
      h('button', { class: 'linkbtn', type: 'button', onclick: () => refreshNames(true) }, icon('refresh'), t('refreshList')));
    const cont = h('button', { class: 'btn btn-primary', type: 'button', disabled: !chosen }, '');
    // Two intentional lines ("Continue as" / the name) instead of an accidental wrap.
    const setCont = () => {
      const n = s.names.find((x) => x.id === chosen);
      cont.disabled = !n;
      if (n) swap(cont, h('span', { class: 'btn-2l' }, h('small', {}, `${t('continueAsLead')} `), h('b', {}, fullName(n))));
      else cont.textContent = t('chooseName');
    };
    const list = h('ul', { class: 'names', id: 'names-list' },
      sorted.map((n) => {
        const [sur, giv] = nameParts(n);
        const alt = altParts(n);
        const input = h('input', { type: 'radio', name: 'who', value: n.id, disabled: n.answered, checked: n.id === chosen,
          'aria-label': `${sur} ${giv}${n.answered ? ` — ${t('namesAnswered')}` : ''}` });
        const row = h('label', { class: `name-opt${n.answered ? ' is-done' : ''}${n.id === chosen ? ' is-selected' : ''}` },
          input,
          h('span', { class: 'name-txt' },
            h('span', { class: 'name-main' }, h('b', {}, sur), ' ', giv),
            alt && h('span', { class: 'name-alt', lang: useCyr() ? 'en' : 'uk' }, alt.join(' ')),
            n.answered && h('span', { class: 'chip chip-done' }, icon('check'), t('namesAnswered'))),
          !n.answered && h('span', { class: 'radio', 'aria-hidden': 'true' }));
        input.addEventListener('change', () => {
          chosen = n.id; S.pendingName = n.id;
          list.querySelectorAll('.name-opt').forEach((el) => el.classList.toggle('is-selected', el === row));
          setCont();
        });
        input.addEventListener('focus', () => row.classList.add('is-focus'));
        input.addEventListener('blur', () => row.classList.remove('is-focus'));
        return h('li', {}, row);
      }));
    setCont();
    // Long lists get a search box (matches either script, ignores case and apostrophes).
    let search = null;
    if (s.names.length > 25) {
      const norm = (x) => String(x).toLowerCase().replace(/['’ʼ`\-\s]/g, '');
      const noMatch = h('p', { class: 'name-help', hidden: true, role: 'status' }, t('noMatch'));
      const input = h('input', { type: 'search', id: 'name-search', class: 'search', placeholder: t('searchName'),
        'aria-label': t('searchName'), 'aria-controls': 'names-list', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
      input.addEventListener('input', () => {
        const q = norm(input.value);
        let shown = 0;
        list.querySelectorAll('li').forEach((li) => {
          const hit = !q || norm(li.textContent).includes(q);
          li.hidden = !hit; if (hit) shown++;
        });
        noMatch.hidden = shown > 0;
      });
      search = h('div', { class: 'search-wrap' }, input, noMatch);
    }
    cont.addEventListener('click', () => {
      if (!chosen) return;
      if (!S.draft) newDraft();
      S.draft.nameId = chosen;
      saveDraft();
      S.error = null;
      show('section');
    });
    setBar(h('div', { class: 'bar-inner' }, backButton(), cont));
    return h('section', { class: 'screen' },
      h('div', { class: 'title-block' }, h('h1', { tabindex: '-1', id: 'names-h' }, t('namesTitle')), h('p', { id: 'names-sub' }, t('namesSub'))),
      search,
      h('fieldset', { class: 'plain', 'aria-labelledby': 'names-h', 'aria-describedby': 'names-sub' }, list),
      h('div', {},
        h('button', { class: 'linkbtn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'name-help',
          onclick: (e) => {
            help.hidden = !help.hidden;
            e.currentTarget.setAttribute('aria-expanded', String(!help.hidden));
            if (!help.hidden) help.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
          } },
        icon('users'), t('nameMissing')),
        help));
  }

  const backButton = () => h('button', { class: 'btn btn-secondary btn-back', type: 'button', onclick: goBack }, icon('back'), h('span', {}, t('back')));

  // ---------- rating card ----------
  function itemCard(it) {
    const id = it.id;
    const card = h('div', { class: 'item', id: `card-${id}` });
    const echo = h('span', { class: 'sr-only', 'aria-live': 'polite' });
    const isRec = it.key === 'recommend';
    const minTxt = it.anchors ? L(it.anchors.min) : t(isRec ? 'recMin' : 'scaleMin');
    const maxTxt = it.anchors ? L(it.anchors.max) : t(isRec ? 'recMax' : 'scaleMax');
    const radios = [1, 2, 3, 4, 5, 6, 7].map((n) => h('label', {},
      h('input', { type: 'radio', name: `r-${id}`, value: String(n),
        'aria-label': n === 1 ? `1 — ${minTxt}` : n === 7 ? `7 — ${maxTxt}` : String(n) }),
      h('span', { 'aria-hidden': 'true' }, n)));
    const scaleWrap = h('div', { class: 'scale-wrap' },
      h('div', { class: 'scale' }, radios),
      h('div', { class: 'anchors', 'aria-hidden': 'true' }, h('span', {}, minTxt), h('span', {}, maxTxt)));
    const legend = h('legend', {}, h('span', { class: 't' }, L(it.label)), icon('checkCircle', 'ok'));
    const flag = h('p', { class: 'flag', hidden: true }, icon('alert'), h('span', {}, t('noAnswerYet')));
    const fieldset = h('fieldset', {}, flag, legend, it.detail && h('p', { class: 'detail' }, L(it.detail)), scaleWrap);
    const naBtn = h('button', { type: 'button', class: 'linkbtn quiet', 'aria-pressed': 'false' }, icon('skip'), t('na'));
    const naState = h('div', { class: 'na-state', hidden: true },
      h('span', {}, t('naOn')),
      h('button', { type: 'button', class: 'linkbtn' }, t('undo')));
    // A comment box under every item, as on the paper form. Never required.
    const ta = h('textarea', { id: `c-${id}`, class: 'cmt', maxlength: '1000', rows: '1', placeholder: t('commentLabel'),
      'aria-label': `${t('commentLabel')} — ${L(it.label)}` });
    append(card, [fieldset, naState, !it.key && h('div', { class: 'item-actions' }, naBtn), h('div', { class: 'comment' }, ta), echo]);
    let beforeNa = null; // the rating to restore if "didn't take part" is undone

    // A flagged card stays flagged until it is complete; the flag says what is still missing.
    const setFlag = () => { card.classList.add('flash'); flag.hidden = false; };
    const refreshFlag = () => {
      if (flag.hidden) return;
      if (missingOf(it)) setFlag(); else { card.classList.remove('flash'); flag.hidden = true; }
    };
    const sync = () => {
      const v = answer(id);
      const isNa = v === 'na';
      card.classList.toggle('answered', v != null);
      card.classList.toggle('is-na', isNa);
      card.classList.toggle('complete', v != null && !missingOf(it)); // the tick appears once rating and comment are both there
      refreshFlag();
      scaleWrap.hidden = isNa;
      naState.hidden = !isNa;
      naBtn.hidden = isNa;
      naBtn.setAttribute('aria-pressed', String(isNa));
      radios.forEach((l) => { l.firstChild.checked = String(v) === l.firstChild.value; });
      echo.textContent = Number.isInteger(v) ? t('echo', { n: v }) : '';
    };
    card.markMissing = () => setFlag();

    radios.forEach((l) => l.firstChild.addEventListener('change', (e) => {
      S.draft.answers[id] = Number(e.target.value);
      sync(); saveDraft();
    }));
    naBtn.addEventListener('click', () => {
      beforeNa = Number.isInteger(answer(id)) ? answer(id) : null;
      S.draft.answers[id] = 'na'; sync(); saveDraft();
      softFocus(naState.querySelector('button'));
    });
    naState.querySelector('button').addEventListener('click', () => {
      if (beforeNa) S.draft.answers[id] = beforeNa; else delete S.draft.answers[id];
      sync(); saveDraft();
      softFocus(radios[(beforeNa || 1) - 1].firstChild);
    });
    let tmr;
    ta.addEventListener('input', () => {
      growBox(ta);
      S.draft.comments[id] = ta.value; refreshFlag();
      card.classList.toggle('complete', isAnswered(it) && !missingOf(it));
      clearTimeout(tmr);
      tmr = setTimeout(saveDraft, 250);
    });
    ta.addEventListener('blur', () => { S.draft.comments[id] = ta.value; saveDraft(); });

    ta.value = S.draft.comments[id] || '';
    sync();
    return card;
  }

  // ---------- section screens ----------
  let updateSummary = () => {};
  function section() {
    const i = S.sectionIndex;
    const sec = sections[i];
    const isLast = i === lastIndex();
    const total = sections.length;
    const count = h('span', { class: 'num' });
    const updateCount = () => {
      count.textContent = t('answeredHere', { a: sec.items.filter(isAnswered).length, t: sec.items.length });
    };
    updateSummary = () => {};
    const itemsEl = h('div', { class: 'items' }, sec.items.map(itemCard));
    const onAnswer = () => {
      updateCount(); updateSummary();
      if (bar.classList.contains('prompting')) { const n = bar.querySelector('.bar-note'); if (n) closePrompt(n); }
    };
    itemsEl.addEventListener('change', onAnswer);
    itemsEl.addEventListener('input', onAnswer);
    itemsEl.addEventListener('click', () => setTimeout(onAnswer, 0));
    updateCount();

    const head = h('div', { class: 'progress' },
      h('div', { class: 'progress-meta' }, h('span', {}, t('step', { n: i + 1, total })), count),
      h('div', { class: 'segments', 'aria-hidden': 'true' },
        sections.map((_, k) => h('i', { class: k < i ? 'done' : k === i ? 'now' : '' }))));

    const children = [head,
      h('div', { class: 'sec-head' }, h('h1', { tabindex: '-1' }, isLast ? t('lastTitle') : L(sec.title)),
        !isLast && h('p', { class: 'scale-hint' }, t('scaleHint'))),
      itemsEl];

    let summaryEl = null;
    if (isLast) { const blocks = finalBlocks(); summaryEl = blocks.summary; children.push(...blocks.nodes); }
    if (S.canSave !== false) children.push(h('span', { class: 'saved' }, icon('check'), t('saved')));

    const note = h('div', { class: 'bar-note', hidden: true });
    const next = h('button', { class: 'btn btn-primary', type: 'button' });
    if (!isLast) {
      swap(next, t('next'), icon('chevron'));
      next.addEventListener('click', () => tryNext(sec, note));
    } else {
      // The open questions sit below the ratings: "Next" scrolls down to them first, and the
      // button becomes "Send" once the summary above it has been on screen.
      let armed = false;
      const arm = () => {
        if (armed) return;
        armed = true;
        S.sawEnd = true; // once seen, Send stays ready (e.g. after changing the name)
        next.id = 'send';
        swap(next, t('send'));
        if (S.sending) setSending(next, true);
      };
      swap(next, t('toEnd'), icon('chevron', 'down'));
      next.addEventListener('click', () => {
        if (armed) return trySend(note, next);
        const target = [...main.querySelectorAll('.q-open, .summary')].find((el) => el.getBoundingClientRect().top > window.innerHeight * 0.45);
        (target || summaryEl)?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      });
      if ('IntersectionObserver' in window && summaryEl) {
        const io = new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting)) { arm(); io.disconnect(); }
        }, { threshold: 0.6 });
        requestAnimationFrame(() => io.observe(summaryEl));
      } else arm();
      if (S.error || S.sending || S.sawEnd) arm();
    }
    setBar(note, h('div', { class: 'bar-inner' }, backButton(), next));
    return h('section', { class: 'screen' }, children);
  }

  // "Next" with unrated items: a note that offers to show them or to go on (people can come back;
  // the last page lists whatever is still missing). "Send" offers no way past: everything is needed.
  function needPrompt(note, missing, onContinue = null) {
    const count = (need, base) => { const n = missing.filter((m) => m.need === need).length; return n ? t.plural(base, n) : null; };
    const lines = [count('rating', 'needRating'), count('open', 'needOpen')].filter(Boolean);
    const onlyOpen = missing.every((m) => m.need === 'open');
    swap(note, h('div', { class: 'soft', role: 'alert' },
      h('p', {}, h('b', {}, lines.join(' ')), ' ', t(onContinue ? 'needLater' : onlyOpen ? 'needOpenHint' : 'needHint')),
      h('div', { class: 'stack' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { closePrompt(note); flash(missing); } }, t('showMe')),
        onContinue && h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { closePrompt(note); onContinue(); } }, t('continueAnyway')))));
    note.hidden = false;
    bar.classList.add('prompting');
  }
  function closePrompt(note) { note.hidden = true; bar.classList.remove('prompting'); }
  // Flags the incomplete cards on this page; if they are all on other pages, jumps to the first one.
  function flash(missing) {
    const here = missing.map((m) => ({ ...m, el: document.getElementById(m.it ? `card-${m.it.id}` : `q-${m.q.id}`) })).filter((m) => m.el);
    if (!here.length) return jumpTo(missing[0].it, missing[0].need);
    here.forEach((m) => m.el.markMissing?.(m.need));
    here[0].el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    softFocus(here[0].el.querySelector(here[0].need === 'rating' ? 'input' : 'textarea'));
  }
  function tryNext(sec, note) {
    const missing = incompleteIn(sec);
    const go = () => { S.sectionIndex++; saveDraft(); show('section'); };
    if (missing.length) return needPrompt(note, missing, go);
    go();
  }

  function finalBlocks() {
    const s = sem();
    const opens = (s.openQuestions || []).map((q) => {
      const ta = h('textarea', { id: `o-${q.id}`, maxlength: '2000', rows: '3' });
      ta.value = S.draft.open[q.id] || '';
      const flag = h('p', { class: 'flag', hidden: true }, icon('alert'), h('span', {}, t('noAnswerYet')));
      const card = h('div', { class: 'q-open', id: `q-${q.id}` }, flag, h('label', { for: `o-${q.id}` }, L(q.label)), ta);
      card.markMissing = () => { card.classList.add('flash'); flag.hidden = false; };
      let tmr;
      ta.addEventListener('input', () => {
        S.draft.open[q.id] = ta.value;
        if (ta.value.trim()) { card.classList.remove('flash'); flag.hidden = true; }
        if (bar.classList.contains('prompting')) { const n = bar.querySelector('.bar-note'); if (n) closePrompt(n); }
        clearTimeout(tmr); tmr = setTimeout(saveDraft, 250);
      });
      ta.addEventListener('blur', () => { S.draft.open[q.id] = ta.value; saveDraft(); });
      return card;
    });
    const allItems = sections.flatMap((sec) => sec.items).filter((it) => !it.optional);
    const here = new Set(sections[lastIndex()].items.map((it) => it.id));
    const p = person();
    const counts = h('div', {});
    const summary = h('div', { class: 'summary' }, counts,
      p && h('div', { class: 'as-line' },
        h('span', {}, t('nameOnList', { name: fullName(p) })),
        h('button', { class: 'linkbtn', type: 'button', onclick: () => show('names') }, t('change'))));
    // Recomputed whenever an answer on this page changes.
    updateSummary = () => {
      const missing = allItems.filter((it) => !isAnswered(it));
      const elsewhere = sections.flatMap((sec) => incompleteIn(sec)).filter((m) => !here.has(m.it.id)); // items on this page are right above
      swap(counts,
        h('p', { class: 'big' }, t('answeredOf', { a: allItems.length - missing.length, t: allItems.length })),
        elsewhere.length > 0 && h('div', {},
          h('p', { class: 'muted' }, t('notAnswered')),
          h('ul', {}, elsewhere.slice(0, 8).map((m) => h('li', {},
            h('button', { type: 'button', onclick: () => jumpTo(m.it, m.need) }, L(m.it.label)))))));
    };
    updateSummary();
    const errorBox = h('div', { id: 'send-error' });
    if (S.error) errorBox.append(errorAlert(S.error));
    return { nodes: [...opens, summary, errorBox], summary };
  }

  // Go back to the page of an unrated item: every unrated item on that page is flagged, so the
  // person sees at once what is left there, and the requested one is scrolled into view.
  function jumpTo(it, need = 'rating') {
    const idx = sections.findIndex((sec) => sec.items.includes(it));
    if (idx < 0) return;
    S.sectionIndex = idx; saveDraft(); show('section', { focus: false });
    incompleteIn(sections[idx]).forEach((m) => document.getElementById(`card-${m.it.id}`)?.markMissing?.(m.need));
    const card = document.getElementById(`card-${it.id}`);
    if (card) { card.markMissing?.(need); card.scrollIntoView({ block: 'start' }); softFocus(card.querySelector(need === 'comment' ? 'textarea' : 'input')); }
  }

  function errorAlert(code) {
    const p = person();
    const title = h('p', { class: 'alert-title' }, icon('alert'), t(code === 'NAME_TAKEN' ? 'nameUsedTitle' : 'failedTitle'));
    if (code === 'NAME_TAKEN') {
      return h('div', { class: 'alert alert-error', role: 'alert' }, title,
        h('p', {}, t('nameTaken', { name: p ? fullName(p) : '' })),
        h('div', { class: 'stack' },
          h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => document.getElementById('send')?.click() }, icon('refresh'), t('retry')),
          h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => {
            if (p) p.answered = true; // show it as taken right away
            S.error = null; S.pendingName = null; namesFresh = 0;
            show('names');
          } }, t('notMyName'))));
    }
    if (code === 'NAME_UNKNOWN') {
      return h('div', { class: 'alert alert-error', role: 'alert' }, title,
        h('p', {}, t('nameUnknown')),
        h('div', { class: 'stack' }, h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { S.error = null; S.pendingName = null; namesFresh = 0; show('names'); } }, t('chooseAgain'))));
    }
    return h('div', { class: 'alert alert-error', role: 'alert' }, title,
      h('p', {}, t('failed')),
      h('div', { class: 'stack' }, h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => document.getElementById('send')?.click() }, icon('refresh'), t('retry'))));
  }

  function setSending(btn, on) {
    btn.disabled = on;
    btn.classList.toggle('is-sending', on);
    swap(btn, ...(on ? [h('span', { class: 'spinner', 'aria-hidden': 'true' }), t('sending')] : [t('send')]));
  }

  async function trySend(note, btn) {
    if (S.sending) return;
    // make sure the latest typing is stored
    main.querySelectorAll('textarea').forEach((ta) => ta.dispatchEvent(new Event('blur')));
    // Everything must be complete: every item on every page and the closing questions.
    const missing = [...sections.flatMap((sec) => incompleteIn(sec)), ...openMissing()];
    if (missing.length) return needPrompt(note, missing);
    if (S.preview) {
      // It may have been opened meanwhile (the guide opens it when the group is ready): look first.
      S.sending = true; setSending(btn, true);
      const fresh = await api.getConfig(seminarId);
      S.sending = false;
      btn = document.getElementById('send') || btn;
      note = bar.querySelector('.bar-note') || note;
      setSending(btn, false);
      if (!fresh.ok || fresh.seminar.status === 'draft') {
        swap(note, h('div', { class: 'soft', role: 'status' }, h('p', {}, h('b', {}, t('previewSendTitle')), ' ', t('previewSendText'))));
        note.hidden = false;
        return;
      }
      S.preview = false; S.seminar.status = fresh.seminar.status; renderTopbar();
    }
    S.sending = true; S.error = null;
    const errBox = document.getElementById('send-error'); errBox?.replaceChildren();
    setSending(btn, true);
    clearTimeout(slowTimer);
    // The page may re-render while sending (language switch, Back): always talk to the live bar.
    const liveNote = () => bar.querySelector('.bar-note') || note;
    slowTimer = setTimeout(() => { const n = liveNote(); swap(n, h('div', { class: 'soft', role: 'status' }, h('p', {}, t('slow')))); n.hidden = false; }, 6000);
    const d = S.draft;
    const payload = {
      s: seminarId, nameId: d.nameId, submissionId: d.submissionId,
      answers: d.answers, comments: cleanText(d.comments), open: cleanText(d.open),
    };
    let res = await api.submit(payload);
    // The server was briefly busy (many people sending at once): retry quietly, same submission id.
    for (let attempt = 0; attempt < 3 && res.code === 'BUSY'; attempt++) {
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2000));
      res = await api.submit(payload);
    }
    clearTimeout(slowTimer); liveNote().hidden = true;
    S.sending = false;
    if (res.ok) {
      const who = person();
      if (who) who.answered = true; // greyed out at once if someone else uses this phone next
      store.set(K.done, true);
      store.del(K.draft);
      store.del(K.cfg);
      S.draft = null;
      S.offline = false;
      return show('thanks', { focus: false });
    }
    if (res.code === 'CLOSED') { S.closedWhileSending = true; return show('closed'); }
    S.error = res.code;
    setSending(document.getElementById('send') || btn, false);
    const box = document.getElementById('send-error');
    if (box) { swap(box, errorAlert(res.code)); box.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); }
  }

  const cleanText = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, (v || '').trim()]).filter(([, v]) => v));

  // ---------- end states ----------
  function anotherPerson() {
    return [h('hr', { class: 'divider' }),
      h('p', {}, t('anotherQ')),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { store.del(K.done); store.del(K.draft); newDraft(); show('welcome'); } }, t('anotherBtn'))];
  }
  // A short ask for a Google review, one tap to Google's own review box (only when a link is set).
  function reviewAsk() {
    const url = cfg.reviewUrl;
    if (!url || !/^https:\/\//.test(url)) return null;
    const star = () => { const s = icon('star'); return s; };
    return h('div', { class: 'review' },
      h('div', { class: 'stars', 'aria-hidden': 'true' }, star(), star(), star(), star(), star()),
      h('h2', {}, t('reviewTitle')),
      h('p', {}, t('reviewText')),
      h('a', { class: 'btn btn-primary review-btn', href: url, target: '_blank', rel: 'noopener' }, t('reviewBtn')));
  }
  function thanks() {
    setBar();
    return h('section', { class: 'screen center' },
      h('div', { class: 'badge-ok' }, icon('check')),
      h('h1', { tabindex: '-1' }, t('thanksTitle')),
      h('p', {}, t('thanksText')),
      reviewAsk(),
      h('p', {}, t('thanksTrip')),
      ...anotherPerson());
  }
  function already() {
    setBar();
    return h('section', { class: 'screen center' },
      h('div', { class: 'badge-ok' }, icon('check')),
      h('h1', { tabindex: '-1' }, t('alreadyTitle')),
      h('p', {}, t('alreadyText')),
      reviewAsk(),
      ...anotherPerson());
  }
  function closed() {
    setBar();
    return h('section', { class: 'screen center' },
      h('div', { class: 'badge-ok badge-info' }, icon('lock')),
      h('h1', { tabindex: '-1' }, t('closedTitle')),
      h('p', {}, t(S.closedWhileSending ? 'closedWhileSending' : 'closedText')));
  }

  load();
}
