// Guide view: the survey QR code, live progress and who still has to answer. No scores.
import { h, icon, store, swap, softFocus } from './dom.js';
import { makeT, formatDates, pick } from './i18n.js';
import { loadStyles, loadScript } from './loader.js';

export async function mount(root, { api, seminarId, key, cfg, alive = () => true }) {
  await loadStyles('assets/css/staff.css');
  // Guides are staff (usually Israeli): English by default, remembered separately from participants.
  let lang = store.get('dsf:guideLang') || 'en';
  let t = makeT(lang);
  let seminar = null, progress = null, updatedAt = 0, timer = null, tick = null, failed = null;

  const topbar = h('header', { class: 'topbar' });
  const main = h('main', { class: 'main' });
  swap(root, h('div', { class: 'app' }, topbar, main));

  const surveyUrl = () => {
    const base = cfg.publicUrl || `${location.origin}${location.pathname}`;
    return `${base}${base.includes('?') ? '&' : '?'}s=${encodeURIComponent(seminarId)}`;
  };

  function renderTop() {
    swap(topbar, h('div', { class: 'topbar-inner' },
      h('span', { class: 'logo-chip' }, h('img', { src: 'assets/img/logo.png', alt: 'Dairy School', width: '110', height: '26' })),
      h('div', { class: 'lang', role: 'group', 'aria-label': 'Language / Мова' },
        ['uk', 'en'].map((l) => h('button', { type: 'button', 'aria-pressed': String(l === lang),
          onclick: () => { lang = l; t = makeT(l); store.set('dsf:guideLang', l); document.documentElement.lang = l; render(); } },
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
    const total = p?.total ?? seminar.names.length;
    const answered = p ? (p.status === 'closed' ? p.answered : Math.max(0, total - (p.missing || []).length)) : 0;
    const missing = p?.missing || [];
    const known = !!p; // until the first progress arrives, show nothing rather than zeros
    const collator = new Intl.Collator(lang === 'uk' ? 'uk' : 'en');
    const sortedMissing = [...missing].sort((a, b) => collator.compare(fullName(a)[0], fullName(b)[0]));

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
        : h('div', { class: 'panel qr-card' },
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
          : h('p', { class: 'all-done' }, icon('checkCircle'), t('allDone')))));
  }

  async function refresh(manual) {
    const res = await api.getProgress(seminarId, key);
    if (res.ok) { progress = res; updatedAt = Date.now(); failed = null; } else failed = res.code;
    const count = document.querySelector('.qr-full .qr-count');
    if (count && progress) {
      const done = Math.max(0, progress.total - (progress.missing || []).length);
      const uk = makeT('uk'), en = makeT('en');
      count.textContent = `${uk('answeredCount', { a: done, t: progress.total })} · ${en('answeredCount', { a: done, t: progress.total })}`;
    }
    render();
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
