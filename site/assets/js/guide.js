// Guide view: the survey QR code, live progress and who still has to answer. No scores.
import { h, icon, store, swap, softFocus } from './dom.js';
import { makeT, formatDates, pick } from './i18n.js';
import { loadStyles, loadScript } from './loader.js';

export async function mount(root, { api, seminarId, key, cfg, inline = false, alive = () => true }) {
  await loadStyles('assets/css/staff.css');
  // Guides are staff (usually Israeli): English by default, remembered separately from participants.
  let lang = store.get('dsf:guideLang') || 'en';
  let t = makeT(lang);
  let seminar = null, progress = null, updatedAt = 0, timer = null, tick = null, failed = null;

  const topbar = h('header', { class: 'topbar' });
  const main = h('main', { class: 'main' });
  swap(root, h('div', { class: 'app' }, topbar, main));

  // The participants' page: the configured public address, else this site's folder (index.html);
  // the single-file prototype is its own participant page.
  const surveyUrl = () => {
    const base = cfg.publicUrl || (inline ? `${location.origin}${location.pathname}` : new URL('./', location.href).href);
    return `${base}${base.includes('?') ? '&' : '?'}s=${encodeURIComponent(seminarId)}`;
  };

  function renderTop() {
    swap(topbar, h('div', { class: 'topbar-inner' },
      h('span', { class: 'logo-chip' }, h('img', { src: 'assets/img/logo.png', alt: 'Dairy School', width: '110', height: '26' })),
      h('div', { class: 'lang', role: 'group', 'aria-label': 'Language / Мова' },
        ['uk', 'en'].map((l) => h('button', { type: 'button', 'aria-pressed': String(l === lang),
          onclick: () => { lang = l; t = makeT(l); store.set('dsf:guideLang', l); document.documentElement.lang = l; onDay = null; render(); } },
        l === 'uk' ? 'УКР' : 'EN')))));
  }

  function qrSvg(text) {
    // global `qrcode` from the vendored MIT library
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const box = h('div', { class: 'qr-box', role: 'img', 'aria-label': `QR: ${text}` });
    box.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
    return box;
  }

  function ago() {
    const s = Math.round((Date.now() - updatedAt) / 1000);
    if (s < 5) return t('justNow');
    if (s < 60) return t('secondsAgo', { n: s });
    return t('minutesAgo', { n: Math.round(s / 60) });
  }

  function fullName(n) {
    return lang === 'uk' && n.surnameCyr ? [`${n.surnameCyr} ${n.givenCyr}`, `${n.surname} ${n.given}`] : [`${n.surname} ${n.given}`, n.surnameCyr ? `${n.surnameCyr} ${n.givenCyr}` : ''];
  }

  function bigQR() {
    const uk = makeT('uk'), en = makeT('en');
    const p = progress;
    const done = p ? Math.max(0, p.total - (p.missing || []).length) : null;
    const overlay = h('div', { class: 'qr-full', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('guideScan') },
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => overlay.remove() }, icon('x'), t('close')),
      h('h2', { lang: 'uk' }, uk('guideScan')),
      h('p', { class: 'qr-en', lang: 'en' }, en('guideScan')),
      qrSvg(surveyUrl()),
      p && p.status !== 'closed' && h('p', { class: 'qr-count', 'aria-live': 'polite' }, `${uk('answeredCount', { a: done, t: p.total })} · ${en('answeredCount', { a: done, t: p.total })}`),
      h('p', { class: 'link-text' }, surveyUrl()));
    document.body.append(overlay);
    softFocus(overlay.querySelector('button'));
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.remove(); });
  }

  // ---------- a draft: the guide opens the survey when the group is ready ----------
  function draftPanel() {
    const msg = h('p', { class: 'onday-msg', role: 'status' });
    const confirm = h('div', { class: 'btn-row left confirm', hidden: true });
    const openBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
      swap(confirm, h('span', {}, t('openConfirm')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => {
          const b = e.currentTarget; // (currentTarget is null after the await)
          b.disabled = true; msg.classList.remove('err'); msg.textContent = '…';
          const r = await api.setStatus(seminarId, key, 'open');
          if (r.ok) { msg.textContent = ''; seminar.status = 'open'; if (progress) progress.status = 'open'; }
          else { b.disabled = false; msg.classList.add('err'); msg.textContent = t('openErr'); }
          refresh(false); // shows the QR code once open (also when a reply was lost but it went through)
        } }, t('open')),
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { swap(confirm); confirm.hidden = true; openBtn.hidden = false; } }, t('cancel')));
      confirm.hidden = false; openBtn.hidden = true;
    } }, t('openNow'));
    return h('div', { class: 'panel draft-panel' },
      h('p', { class: 'all-done' }, icon('lock'), t('guideDraft')),
      h('p', { class: 'hint' }, t('guideDraftHint')),
      h('div', { class: 'btn-row left' }, openBtn), confirm, msg);
  }

  // ---------- names on the day: an extra person, a no-show, a wrong tap ----------
  // Built once and kept across the 30 s refreshes, so a half-typed name is never wiped.
  let onDay = null;
  const selectOf = (id) => h('select', { id });
  // Nobody is ever pre-selected: a choice must be made, and a choice that no longer exists
  // (the person answered meanwhile) goes back to "Choose…" instead of silently becoming someone else.
  function fillSelect(sel, list) {
    const keep = list.some((n) => n.id === sel.value) ? sel.value : '';
    swap(sel, h('option', { value: '', disabled: true }, list.length ? t('choose') : t('nothingYet')),
      list.map((n) => h('option', { value: n.id }, fullName(n)[0])));
    sel.value = keep;
    sel.disabled = !list.length;
  }
  const byId = (list, id) => list.find((n) => n.id === id) || null;
  function onDayPanel() {
    if (!onDay) onDay = buildOnDay();
    const p = progress || {};
    fillSelect(onDay.rmSel, p.missing || []);
    fillSelect(onDay.wrongSel, p.done || []);
    fillSelect(onDay.realSel, p.missing || []);
    onDay.syncButtons();
    return onDay.root;
  }
  function buildOnDay() {
    const field = (key, extra = {}) => h('label', { class: 'fld' }, h('span', {}, t(key)), h('input', { type: 'text', class: 'search', autocomplete: 'off', autocapitalize: 'words', ...extra }));
    const status = () => h('p', { class: 'onday-msg', role: 'status' });
    const block = (summaryKey, ...body) => h('details', { class: 'onday' }, h('summary', {}, icon('chevron', 'chev'), t(summaryKey)), h('div', { class: 'onday-body' }, ...body));

    // 1. an extra person
    const inputs = { surname: field('surname', { required: true }), given: field('given'), surnameCyr: field('surnameCyr', { lang: 'uk' }), givenCyr: field('givenCyr', { lang: 'uk' }) };
    const addMsg = status();
    const addForm = h('form', { novalidate: true, class: 'onday-form', onsubmit: async (e) => {
      e.preventDefault();
      const val = (k) => inputs[k].querySelector('input').value.trim();
      const name = { surname: val('surname'), given: val('given'), surnameCyr: val('surnameCyr'), givenCyr: val('givenCyr') };
      if (!name.surname || /\d/.test(Object.values(name).join(''))) { addMsg.textContent = t('nameInvalid'); return; }
      addMsg.textContent = '…';
      const r = await api.addName(seminarId, key, name);
      if (!r.ok) { addMsg.textContent = r.code === 'INVALID' ? t('nameInvalid') : t('nameErr'); return; }
      Object.values(inputs).forEach((f) => { f.querySelector('input').value = ''; });
      addMsg.textContent = t('added', { name: fullName(r.name)[0] });
      refresh(false);
    } }, ...Object.values(inputs), h('div', { class: 'btn-row left' }, h('button', { class: 'btn btn-primary', type: 'submit' }, t('add'))), addMsg);

    // 2. a no-show
    const rmSel = selectOf('nm-remove');
    const rmMsg = status();
    const rmConfirm = h('div', { class: 'btn-row left confirm', hidden: true });
    const rmBtn = h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => {
      const n = byId(progress?.missing || [], rmSel.value);
      if (!n) return;
      swap(rmConfirm, h('span', {}, t('removeConfirm', { name: fullName(n)[0] })),
        h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
          swap(rmConfirm); rmConfirm.hidden = true; rmMsg.textContent = '…';
          const r = await api.removeName(seminarId, key, n.id);
          rmMsg.textContent = r.ok ? t('removed', { name: fullName(n)[0] }) : t('nameErr');
          refresh(false);
        } }, t('remove')),
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { swap(rmConfirm); rmConfirm.hidden = true; } }, t('cancel')));
      rmConfirm.hidden = false;
    } }, t('remove'));

    // 3. a wrong tap (confirmed first, like a removal)
    const wrongSel = selectOf('nm-wrong'), realSel = selectOf('nm-real');
    const fixMsg = status();
    const fixConfirm = h('div', { class: 'btn-row left confirm', hidden: true });
    const fixBtn = h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => {
      const wrong = byId(progress?.done || [], wrongSel.value), real = byId(progress?.missing || [], realSel.value);
      if (!wrong || !real) return;
      swap(fixConfirm, h('span', {}, t('fixConfirm', { wrong: fullName(wrong)[0], real: fullName(real)[0] })),
        h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
          swap(fixConfirm); fixConfirm.hidden = true; fixMsg.textContent = '…';
          const r = await api.swapName(seminarId, key, wrong.id, real.id);
          fixMsg.textContent = r.ok ? t('fixed', { wrong: fullName(wrong)[0], real: fullName(real)[0] }) : t('nameErr');
          refresh(false);
        } }, t('fix')),
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { swap(fixConfirm); fixConfirm.hidden = true; } }, t('cancel')));
      fixConfirm.hidden = false;
    } }, t('fix'));

    // Buttons stay off until a choice is made; a pending confirmation is dropped when the choice changes.
    const syncButtons = () => {
      rmBtn.disabled = !rmSel.value;
      fixBtn.disabled = !(wrongSel.value && realSel.value);
    };
    rmSel.addEventListener('change', () => { swap(rmConfirm); rmConfirm.hidden = true; syncButtons(); });
    wrongSel.addEventListener('change', () => { swap(fixConfirm); fixConfirm.hidden = true; syncButtons(); });
    realSel.addEventListener('change', () => { swap(fixConfirm); fixConfirm.hidden = true; syncButtons(); });

    const root = h('div', { class: 'panel onday-panel' },
      h('h2', {}, t('onDayTitle')), h('p', { class: 'hint' }, t('onDayHint')),
      block('addName', addForm),
      block('notAttending', h('label', { class: 'fld' }, h('span', {}, t('whoNotAttending')), rmSel), h('div', { class: 'btn-row left' }, rmBtn), rmConfirm, rmMsg),
      block('wrongName', h('label', { class: 'fld' }, h('span', {}, t('wrongPicked')), wrongSel), h('label', { class: 'fld' }, h('span', {}, t('realPerson')), realSel), h('div', { class: 'btn-row left' }, fixBtn), fixConfirm, fixMsg));
    return { root, rmSel, wrongSel, realSel, syncButtons };
  }

  function render() {
    renderTop();
    if (!key) {
      swap(main, h('section', { class: 'screen center' }, h('div', { class: 'badge-ok badge-info' }, icon('lock')), h('p', {}, t('guideNoKey'))));
      return;
    }
    if (!seminar) {
      swap(main, h('div', { class: 'loading', role: 'status' }, h('div', { class: 'spinner' }), t('loading')));
      return;
    }
    if (failed === 'UNAUTHORIZED') {
      swap(main, h('section', { class: 'screen center' }, h('div', { class: 'badge-ok badge-info' }, icon('lock')),
        h('h1', { tabindex: '-1' }, t('guideTitle')), h('p', {}, t('guideBadKey'))));
      return;
    }
    const url = surveyUrl();
    const copyBtn = h('button', { class: 'btn btn-secondary', type: 'button' }, icon('copy'), t('copyLink'));
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); copyBtn.lastChild.textContent = t('copied'); }
      catch { const r = document.createRange(); r.selectNodeContents(linkEl); getSelection().removeAllRanges(); getSelection().addRange(r); }
      setTimeout(() => { copyBtn.lastChild.textContent = t('copyLink'); }, 2000);
    });
    const linkEl = h('p', { class: 'link-text' }, url);
    const p = progress;
    const closed = p?.status === 'closed' || seminar.status === 'closed';
    // A draft gets no QR code: a link shared too early would only show a preview that can't send.
    const draft = !closed && (p?.status || seminar.status) === 'draft';
    const total = p?.total ?? seminar.names.length;
    const answered = p ? (p.status === 'closed' ? p.answered : Math.max(0, total - (p.missing || []).length)) : 0;
    const missing = p?.missing || [];
    const known = !!p; // until the first progress arrives, show nothing rather than zeros
    const collator = new Intl.Collator(lang === 'uk' ? 'uk' : 'en');
    const sortedMissing = [...missing].sort((a, b) => collator.compare(fullName(a)[0], fullName(b)[0]));

    // The on-the-day panel is kept, not rebuilt, so what the guide is typing survives a refresh.
    const active = document.activeElement;
    const keepFocus = onDay && onDay.root.contains(active) ? active : null;
    const sel = keepFocus && typeof keepFocus.selectionStart === 'number' ? [keepFocus.selectionStart, keepFocus.selectionEnd] : null;
    swap(main, h('section', { class: 'screen guide' },
      h('div', { class: 'title-block' },
        h('span', { class: 'eyebrow' }, t('guideTitle')),
        h('h1', { tabindex: '-1' }, pick(seminar.title, lang)),
        seminar.dates && h('p', {}, formatDates(seminar.dates.start, seminar.dates.end, lang))),
      h('div', { class: 'panel' },
        h('div', { class: 'big-count' }, h('b', { class: 'num' }, known ? answered : '–'), h('span', {}, `/ ${total} ${t('answeredLabel')}`)),
        h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(answered), 'aria-label': t('answeredCount', { a: answered, t: total }) },
          h('i', { style: `width:${total ? Math.round((answered / total) * 100) : 0}%` })),
        h('div', { class: 'refresh-row' },
          h('span', { class: `ago${failed ? ' warn' : ''}`, 'aria-live': 'polite' }, failed ? t('guideOffline') : updatedAt ? t('updated', { time: ago() }) : ''),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => refresh(true) }, icon('refresh'), t('refresh')))),
      closed
        ? h('div', { class: 'panel' }, h('p', { class: 'all-done' }, icon('lock'), t('guideClosed')))
        : draft ? draftPanel() : h('div', { class: 'panel qr-card' },
          h('h2', {}, t('guideScan')), qrSvg(url), linkEl,
          h('div', { class: 'btn-row' }, copyBtn,
            h('button', { class: 'btn btn-secondary', type: 'button', onclick: bigQR }, icon('expand'), t('bigQR')))),
      !closed && known && h('div', { class: 'panel' },
        h('h2', {}, `${t('stillToAnswer')} · ${sortedMissing.length}`),
        sortedMissing.length
          ? h('ul', { class: 'missing' }, sortedMissing.map((n) => {
            const [a, b] = fullName(n);
            return h('li', {}, h('span', { class: 'name-main' }, a), b && h('span', { class: 'name-alt' }, b));
          }))
          : h('p', { class: 'all-done' }, icon('checkCircle'), t('allDone'))),
      !closed && known && onDayPanel()));
    if (keepFocus && keepFocus.isConnected) {
      keepFocus.focus({ preventScroll: true });
      if (sel) { try { keepFocus.setSelectionRange(sel[0], sel[1]); } catch { /* not a text field */ } }
    }
  }

  // Re-render only when something changed; otherwise just update the "updated … ago" line.
  let lastSig = null;
  async function refresh(manual) {
    const res = await api.getProgress(seminarId, key);
    if (res.ok) { progress = res; updatedAt = Date.now(); failed = null; } else failed = res.code;
    const count = document.querySelector('.qr-full .qr-count');
    if (count && progress) {
      const done = Math.max(0, progress.total - (progress.missing || []).length);
      const uk = makeT('uk'), en = makeT('en');
      count.textContent = `${uk('answeredCount', { a: done, t: progress.total })} · ${en('answeredCount', { a: done, t: progress.total })}`;
    }
    const sig = JSON.stringify([failed, progress?.status, progress?.total, (progress?.missing || []).map((n) => n.id), (progress?.done || []).map((n) => n.id)]);
    if (manual || sig !== lastSig || !main.querySelector('.guide')) { lastSig = sig; render(); }
    else { const el = main.querySelector('.ago'); if (el && updatedAt) el.textContent = t('updated', { time: ago() }); }
    if (manual) main.querySelector('.refresh-row button')?.focus();
  }

  document.documentElement.lang = lang;
  render();
  if (!key) return;
  await loadScript('assets/vendor/qrcode.js');
  const cfgRes = await api.getConfig(seminarId);
  if (!cfgRes.ok) { swap(main, h('section', { class: 'screen center' }, h('p', {}, t(cfgRes.code === 'NOT_FOUND' ? 'notFound' : 'loadError')))); return; }
  seminar = cfgRes.seminar;
  await refresh(false);
  const every = 30000;
  const stop = () => { clearInterval(timer); clearInterval(tick); document.removeEventListener('visibilitychange', onVis); };
  const onVis = () => { if (!alive()) return stop(); if (!document.hidden) refresh(false); };
  timer = setInterval(() => { if (!alive()) return stop(); if (!document.hidden) refresh(false); }, every);
  tick = setInterval(() => { if (!alive()) return stop(); const el = main.querySelector('.ago'); if (el && updatedAt) el.textContent = t('updated', { time: ago() }); }, 5000);
  document.addEventListener('visibilitychange', onVis);
}
