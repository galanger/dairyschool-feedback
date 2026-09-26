// Staff results: passcode → seminar → (open: progress + close) / (closed: analysis).
import { h, icon, swap } from './dom.js';
import { pick, formatDates } from './i18n.js';
import { analyze, toCSV, onePersonEffect, CATEGORY_LABELS, HIGHLIGHT_BELOW, MIN_N, SCALE_MAX } from './analytics.js';
import { loadStyles } from './loader.js';

const KEY_STORE = 'dsf:staffKey';
const en = (v) => pick(v, 'en');
const SVG = 'http://www.w3.org/2000/svg';
const REF = (HIGHLIGHT_BELOW / 100) * SCALE_MAX; // 5.6 on the 1–7 scale
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// Rating colours: 1–3 low, 4–5 middle, 6–7 top (the same "top" as "gave 6 or 7").
const band = (i) => (i < 3 ? 'var(--viz-low)' : i < 5 ? 'var(--viz-mid)' : 'var(--viz-high)');

export async function mount(root, { api, seminarId, demo }) {
  await loadStyles('assets/css/staff.css');
  document.documentElement.lang = 'en';
  document.title = 'Results · Dairy School feedback';
  const topbar = h('header', { class: 'topbar' }, h('div', { class: 'topbar-inner' },
    h('span', { class: 'logo-chip' }, h('img', { src: 'assets/img/logo.png', alt: 'Dairy School', width: '110', height: '26' })),
    h('span', { class: 'chip chip-closed' }, icon('lock'), 'Staff only')));
  const main = h('main', { class: 'main rs', id: 'main' });
  swap(root, h('div', { class: 'app' }, topbar, main));
  const tip = h('div', { class: 'tip', role: 'tooltip', hidden: true });
  document.body.append(tip);

  // Printing: only the client sheet is printable, as one A4 page (see staff.css).
  let fitSheet = null;
  window.addEventListener('beforeprint', () => {
    if (fitSheet) fitSheet();
    else { document.body.classList.remove('print-sheet'); document.getElementById('print-root')?.remove(); }
  });
  window.addEventListener('afterprint', () => {
    document.body.classList.remove('print-sheet');
    document.getElementById('print-root')?.remove();
  });

  let key = null;
  try { key = sessionStorage.getItem(KEY_STORE); } catch { /* ignore */ }
  let seminars = [];
  let current = seminarId;
  let justClosed = null; // backup details returned when the survey was closed from this page

  // ---------- passcode ----------
  function gate(message) {
    const input = h('input', { type: 'password', id: 'pass', autocomplete: 'current-password', required: true, 'aria-describedby': 'pass-err' });
    const err = h('p', { class: 'err', id: 'pass-err', role: 'alert' }, message || '');
    const form = h('form', { novalidate: true },
      h('label', { for: 'pass' }, 'Staff passcode'), input, err,
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Open results'),
      demo && h('p', { class: 'hint' }, 'Prototype: any passcode works.'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!input.value.trim()) { err.textContent = 'Enter the passcode.'; return; }
      key = input.value.trim();
      const ok = await start();
      if (ok) { try { sessionStorage.setItem(KEY_STORE, key); } catch { /* ignore */ } }
    });
    swap(main, h('section', { class: 'panel gate' }, h('h1', { tabindex: '-1' }, 'Seminar results'),
      h('p', { class: 'muted' }, 'Only the Dairy School team can open this page.'), form));
    input.focus();
  }

  async function start() {
    swap(main, h('div', { class: 'loading', role: 'status' }, h('div', { class: 'spinner' }), 'Loading…'));
    const res = await api.listSeminars(key);
    if (!res.ok) {
      key = null; try { sessionStorage.removeItem(KEY_STORE); } catch { /* ignore */ }
      gate(res.code === 'UNAUTHORIZED' ? 'That passcode didn’t work. Check it and try again.' : 'Couldn’t connect. Check the internet connection and try again.');
      return false;
    }
    seminars = res.seminars;
    if (!seminars.some((x) => x.id === current)) current = seminars[0]?.id;
    await showSeminar(current);
    return true;
  }

  // ---------- header ----------
  function header(sem, extra, actions) {
    const select = seminars.length > 1 && h('label', {}, h('span', { class: 'sr-only' }, 'Seminar'),
      h('select', { onchange: (e) => showSeminar(e.target.value) },
        seminars.map((x) => h('option', { value: x.id, selected: x.id === current }, `${en(x.title)}${x.status === 'open' ? ' · open' : ''}`))));
    return h('div', { class: 'rs-head' },
      h('div', {},
        h('h1', { tabindex: '-1' }, en(sem.title)),
        h('div', { class: 'meta' },
          sem.dates && h('span', {}, formatDates(sem.dates.start, sem.dates.end, 'en')),
          h('span', { class: `chip ${sem.status === 'open' ? 'chip-open' : 'chip-closed'}` }, sem.status === 'open' ? 'Open' : 'Closed'),
          extra)),
      h('div', { class: 'head-actions' }, select, actions));
  }

  async function showSeminar(id) {
    current = id;
    fitSheet = null;
    swap(main, h('div', { class: 'loading', role: 'status' }, h('div', { class: 'spinner' }), 'Loading…'));
    const res = await api.getResults(id, key);
    if (!res.ok && res.code === 'UNAUTHORIZED') return gate('Please enter the passcode again.');
    if (!res.ok && res.code === 'LOCKED') return renderOpen(res);
    if (!res.ok) {
      swap(main, h('div', { class: 'panel' }, h('p', {}, 'Couldn’t load the results. Check the connection and try again.'),
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => showSeminar(id) }, icon('refresh'), 'Try again')));
      return;
    }
    renderDashboard(res);
  }

  // ---------- survey still open ----------
  function renderOpen(res) {
    const sem = res.seminar;
    const total = res.invited || sem.names?.length || 0;
    const confirmBox = h('div', { class: 'closing', hidden: true },
      h('p', {}, h('b', {}, res.answered < total ? `Only ${res.answered} of ${total} have answered. Close anyway? ` : 'Close the survey now? '),
        'Nobody can answer after this, and the list of names is deleted for good, so it can’t be reopened. Answers stay, without names, and a backup copy is emailed to the school.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-danger', type: 'button', onclick: async (e) => {
          e.currentTarget.disabled = true;
          const r = await api.setStatus(current, key, 'closed');
          if (r.ok) { justClosed = r.backup || {}; const l = await api.listSeminars(key); if (l.ok) seminars = l.seminars; showSeminar(current); }
          else { e.currentTarget.disabled = false; confirmBox.append(h('p', { class: 'err' }, 'Couldn’t close the survey. Try again.')); }
        } }, 'Close survey'),
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { confirmBox.hidden = true; openBtn.hidden = false; } }, 'Cancel')));
    const openBtn = h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { confirmBox.hidden = false; openBtn.hidden = true; } }, icon('lock'), 'Close survey…');
    swap(main, h('section', { class: 'rs' },
      header(sem, h('span', {}, `${res.answered} of ${total} answered`)),
      h('div', { class: 'panel' },
        h('h2', {}, 'The survey is still open'),
        h('div', { class: 'big-count' }, h('b', { class: 'num' }, res.answered), h('span', {}, `/ ${total} answered`)),
        h('div', { class: 'meter' }, h('i', { style: `width:${total ? Math.round((res.answered / total) * 100) : 0}%` })),
        h('p', { class: 'muted' }, 'Results open when you close the survey. Until then nobody, including staff, can see answers here, so watching the guide list can’t reveal who wrote what.'),
        openBtn, confirmBox)));
    main.querySelector('h1')?.focus({ preventScroll: true });
  }

  // ---------- dashboard ----------
  function renderDashboard(res) {
    const sem = res.seminar;
    const model = {
      items: sem.items.map((it) => ({ ...it, label: en(it.label) })),
      openQuestions: (sem.openQuestions || []).map((q) => ({ ...q, label: en(q.label) })),
      invited: res.invited || null,
    };
    const A = analyze(model, res.responses);
    const translations = res.translations || {};
    const tr = (text) => (translations[text] && translations[text] !== text ? translations[text] : null);
    const ratingNote = (r) => (Number.isInteger(r) ? `rated ${r}` : r === 'na' ? 'didn’t take part' : 'no rating');
    const commentList = (list) => h('ul', { class: 'cmts' }, list.map((c) => {
      const text = typeof c === 'string' ? c : c.text;
      return h('li', {}, h('span', { class: 'ctext' }, text),
        typeof c !== 'string' && h('span', { class: 'cmeta' }, ratingNote(c.rating)),
        tr(text) && h('span', { class: 'tr' }, `Translation: ${tr(text)}`));
    }));
    const rate = A.invited ? ` of ${A.invited} invited (${Math.round((A.responses / A.invited) * 100)}%)` : '';

    // Shown once, right after closing from this page: what was kept and where the copies went.
    function closedNote() {
      const b = justClosed; justClosed = null;
      const parts = [`Survey closed. ${plural(b.rows ?? A.responses, 'answer')} kept.`];
      if (b.snapshot) parts.push(`A dated copy of the answers was added to the Sheet (“${b.snapshot}”).`);
      if (b.emailedTo) parts.push(`A CSV copy was emailed to ${b.emailedTo}.`);
      else if (demo) parts.push('On the live system a CSV copy is also emailed to the school.');
      else if (b.emailError) parts.push('The backup email could not be sent; download the CSV from the Data tab.');
      return h('div', { class: 'panel closed-note', role: 'status' }, h('p', {}, icon('checkCircle'), h('span', {}, parts.join(' '))));
    }

    if (!A.responses) {
      swap(main, h('section', { class: 'rs' },
        header(sem, h('span', {}, `0 responses${rate}`)),
        justClosed && closedNote(),
        h('div', { class: 'panel' }, h('h2', {}, 'No answers were received'),
          h('p', { class: 'muted' }, 'The survey closed before anyone answered.'))));
      return;
    }

    let tab = 'items';
    let sortBy = 'order';
    const panels = h('div', {});
    const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Result views' });
    const nComments = A.quality.itemComments + A.quality.openComments;
    const TABS = [['items', 'Items'], ['categories', 'Areas'], ['comments', `Comments (${nComments})`], ['sheet', 'Client sheet'], ['data', 'Data']];
    let afterMount = [];
    function setTab(id, focusRow) {
      tab = id;
      fitSheet = null;
      afterMount = [];
      swap(tabs, ...TABS.map(([k, label]) => h('button', { type: 'button', role: 'tab', id: `tab-${k}`, 'aria-selected': String(k === tab), 'aria-controls': 'tabpanel', onclick: () => setTab(k) }, label)));
      const views = { items: itemsView, categories: categoriesView, comments: commentsView, sheet: sheetView, data: dataView };
      swap(panels, h('div', { role: 'tabpanel', id: 'tabpanel', 'aria-labelledby': `tab-${tab}` }, views[tab](focusRow)));
      // Measure right after insertion (synchronously), not on the next paint: phones may delay paints.
      afterMount.forEach((f) => f());
    }
    const goTab = (id, opts = {}) => {
      if (opts.sort) sortBy = opts.sort;
      setTab(id, opts.row);
      const target = opts.row ? document.getElementById(`row-${opts.row}`) : tabs;
      target?.scrollIntoView({ block: opts.row ? 'center' : 'start', behavior: 'smooth' });
      if (opts.row) target?.focus({ preventScroll: true });
    };

    swap(main, h('section', { class: 'rs' },
      header(sem, h('span', {}, `${plural(A.responses, 'response')}${rate}`),
        h('button', { class: 'btn btn-primary head-btn', type: 'button', onclick: () => goTab('sheet') }, icon('printer'), 'Client results sheet')),
      justClosed && closedNote(),
      kpis(),
      h('p', { class: 'hint how' }, `Score = average of the 1–7 ratings. % = score ÷ 7, as on your paper sheets. Yellow = below ${HIGHLIGHT_BELOW}%. “Didn’t take part” and blanks are left out. With ${A.responses} answers, one person can move a score by up to ${onePersonEffect(A.responses).points} points.`),
      summaryPanel(),
      h('div', {}, tabs, h('div', { style: 'height:16px' }), panels)));
    setTab('items');
    main.querySelector('h1')?.focus({ preventScroll: true });

    function kpis() {
      const scoreTile = (cls, label, it) => h('div', { class: `kpi ${cls}` },
        h('span', { class: 'lbl' }, label),
        it && it.n ? h('div', { class: 'val' }, h('b', {}, it.score), h('span', { class: 'of' }, '/ 7'), h('span', { class: 'pct' }, `${it.pct}%`)) : h('div', { class: 'val' }, h('b', {}, '–')),
        h('span', { class: 'sub' }, it && it.n ? `${it.top2} of ${it.n} gave 6 or 7` : 'No answers yet'));
      return h('div', { class: 'kpis' },
        scoreTile('hero', 'Overall satisfaction', A.overall),
        scoreTile('', 'Would recommend', A.recommend),
        h('div', { class: 'kpi' }, h('span', { class: 'lbl' }, `Below ${HIGHLIGHT_BELOW}%`),
          h('div', { class: 'val' }, h('b', {}, A.below80), h('span', { class: 'of' }, `of ${A.programCount} items`)),
          A.below80 ? h('button', { class: 'linkbtn kpi-link', type: 'button', onclick: () => goTab('items', { sort: 'low' }) }, 'Show them →') : h('span', { class: 'sub' }, 'Nothing below 80%')),
        h('div', { class: 'kpi' }, h('span', { class: 'lbl' }, 'Responses'),
          h('div', { class: 'val' }, h('b', {}, A.responses), A.invited && h('span', { class: 'of' }, `of ${A.invited}`)),
          h('span', { class: 'sub' }, A.invited ? `${Math.round((A.responses / A.invited) * 100)}% answered` : 'Invited count not recorded')));
    }

    function evidence(it) {
      return [`${plural(it.n, 'answer')}`, `${it.low} gave 1–3`, `${it.top2} gave 6–7`].join(' · ');
    }
    function summaryPanel() {
      const S = A.summary;
      const show = (it) => h('button', { class: 'linkbtn', type: 'button', onclick: () => goTab('items', { row: it.id }) }, 'Show →');
      const attention = h('div', { class: 'sum-col' },
        h('h2', {}, `Needs attention (${S.attention.length})`),
        S.attention.length ? h('ul', { class: 'sum-list' }, S.attention.map((it) => h('li', {},
          h('div', { class: 'sum-top' }, h('span', { class: 'sum-name' }, it.label), h('span', { class: 'mark' }, `${it.score} · ${it.pct}%`)),
          h('div', { class: 'sum-ev' }, evidence(it),
            it.justBelow && h('span', { class: 'chip chip-soft' }, 'just below 80%'),
            it.split && h('span', { class: 'chip chip-soft' }, 'opinions split'),
            it.fewAnswers && h('span', { class: 'chip chip-soft' }, 'few answers')),
          it.comments[0] && h('p', { class: 'sum-quote' }, `“${it.comments[0].text}”`, h('span', { class: 'cmeta' }, ` — ${ratingNote(it.comments[0].rating)}`)),
          show(it))))
          : h('p', { class: 'muted' }, 'Nothing scored below 80%.'));
      const good = h('div', { class: 'sum-col' },
        h('h2', {}, 'Went well'),
        S.strengths.length ? h('ul', { class: 'sum-list' }, S.strengths.map((it) => h('li', {},
          h('div', { class: 'sum-top' }, h('span', { class: 'sum-name' }, it.label), h('span', { class: 'good' }, `${it.score} · ${it.pct}%`)),
          h('div', { class: 'sum-ev' }, evidence(it)))))
          : h('p', { class: 'muted' }, 'No item scored 90% or more with at least half the group answering.'));
      const notes = [];
      S.split.forEach((it) => notes.push(h('li', {}, h('b', {}, 'Opinions split: '), `${it.label} ${it.score} (${it.pct}%): ${it.low} gave 1–3, ${it.top2} gave 6–7. `, show(it))));
      if (S.areas) {
        const { best, worst, driver } = S.areas;
        notes.push(h('li', {}, h('b', {}, 'Areas: '), `strongest ${best.label} (${best.score}), weakest ${worst.label} (${worst.score})${driver ? `, pulled down by ${driver.label} (${driver.score})` : ''}.`));
      }
      S.participation.forEach((it) => notes.push(h('li', {}, h('b', {}, 'Fewer answers: '), `${it.label}: rated by ${it.n} of ${A.responses} (${it.na} didn’t take part, ${it.blank} left blank).`)));
      if (nComments) notes.push(h('li', {}, h('b', {}, 'Comments: '), `${plural(nComments, 'written comment')}. `, h('button', { class: 'linkbtn', type: 'button', onclick: () => goTab('comments') }, 'Read them →')));
      return h('div', { class: 'panel summary-panel' },
        h('div', { class: 'sum-grid' }, attention, good),
        notes.length > 0 && h('ul', { class: 'sum-notes' }, notes));
    }

    // ---- items ----
    // Bars show each rating's share of the item's answers, on one scale for every row.
    function miniHist(it) {
      const W = 8, G = 2, H = 30;
      const svg = s('svg', { class: 'hist', width: 7 * W + 6 * G, height: H + 2, viewBox: `0 0 ${7 * W + 6 * G} ${H + 2}`, role: 'img',
        'aria-label': `Ratings: ${it.dist.map((c, i) => `${i + 1}: ${c}`).join(', ')}` });
      it.dist.forEach((c, i) => {
        const bh = c ? Math.max(2, (c / it.n) * H) : 1;
        const r = s('rect', { x: i * (W + G), y: H - bh + 1, width: W, height: bh, rx: c ? 1.5 : 0, fill: c ? band(i) : 'var(--viz-grid)' });
        r.dataset.tip = `${i + 1}: ${plural(c, 'person', 'people')}`;
        svg.append(r);
      });
      return svg;
    }
    function bigHist(it) {
      const W = 30, G = 10, H = 110, top = 18, base = top + H;
      const width = 7 * W + 6 * G;
      const svg = s('svg', { class: 'hist', width, height: base + 22, viewBox: `0 0 ${width} ${base + 22}`, role: 'img',
        'aria-label': `Ratings: ${it.dist.map((c, i) => `${i + 1}: ${c}`).join(', ')}` });
      it.dist.forEach((c, i) => {
        const x = i * (W + G);
        const bh = c ? Math.max(3, (c / Math.max(...it.dist)) * H) : 0;
        if (c) svg.append(s('path', { d: `M${x},${base} V${base - bh + 3} Q${x},${base - bh} ${x + 3},${base - bh} H${x + W - 3} Q${x + W},${base - bh} ${x + W},${base - bh + 3} V${base} Z`, fill: band(i) }));
        svg.append(s('text', { x: x + W / 2, y: base - bh - 5, 'text-anchor': 'middle', 'font-weight': c ? '700' : '400' }, c));
        svg.append(s('text', { x: x + W / 2, y: base + 16, 'text-anchor': 'middle' }, i + 1));
      });
      svg.append(s('line', { class: 'axis', x1: 0, x2: width, y1: base + 0.5, y2: base + 0.5 }));
      return svg;
    }
    function legend() {
      return h('span', { class: 'legend' }, 'Ratings:',
      h('span', {}, h('i', { style: 'background:var(--viz-low)' }), '1–3 low'),
      h('span', {}, h('i', { style: 'background:var(--viz-mid)' }), '4–5 middle'),
      h('span', {}, h('i', { style: 'background:var(--viz-high)' }), '6–7 top'));
    }

    function itemsView(openId) {
      const sorters = {
        order: (a, b) => a.no - b.no,
        low: (a, b) => (a.n ? a.mean : 99) - (b.n ? b.mean : 99) || a.no - b.no,
        lowcount: (a, b) => b.low - a.low || a.no - b.no,
      };
      const tbody = h('tbody', {});
      const num = (v) => (v ? v : h('span', { class: 'zero' }, '0'));
      const fill = () => {
        tbody.replaceChildren();
        [...A.items].sort(sorters[sortBy]).forEach((it) => {
          const hl = it.highlight ? ' hl' : '';
          const btn = h('button', { type: 'button', class: 'rowbtn', id: `row-${it.id}`, 'aria-expanded': 'false', 'aria-controls': `detail-${it.id}` }, it.label);
          const sub = [CATEGORY_LABELS[it.category] || it.category, it.optional && 'optional'].filter(Boolean).join(' · ');
          const row = h('tr', { class: 'row' },
            h('td', { class: 'idx num col-x' }, it.no),
            h('td', { class: 'lbl' }, btn,
              h('small', {}, sub, h('span', { class: 'phone-only' }, ` · ${plural(it.n, 'answer')}${it.fewAnswers ? ' (few)' : ''}${it.comments.length ? ` · ${plural(it.comments.length, 'comment')}` : ''}`))),
            h('td', { class: 'r num col-x' }, it.n || h('span', { class: 'zero' }, '–'), it.fewAnswers ? h('span', {}, ' ', h('span', { class: 'chip chip-few' }, 'few')) : null),
            h('td', { class: `r score${hl}` }, h('span', {}, it.score)),
            h('td', { class: `r score${hl}` }, h('span', {}, it.pct == null ? '–' : `${it.pct}%`)),
            h('td', { class: 'c col-x' }, it.n ? miniHist(it) : h('span', { class: 'zero' }, '–')),
            h('td', { class: 'r num col-x' }, it.n ? num(it.low) : '–'),
            h('td', { class: 'r num col-x' }, num(it.comments.length)));
          const detail = h('tr', { class: 'detail', id: `detail-${it.id}`, hidden: true }, h('td', { colspan: '8' },
            h('div', { class: 'detail-grid' },
              h('div', {}, h('h3', { class: 'dh' }, 'Ratings'), it.n ? bigHist(it) : h('p', { class: 'hint' }, 'No ratings.'),
                h('p', { class: 'hint' }, `${plural(it.n, 'answer')} · ${it.na} didn’t take part · ${it.blank} left blank`),
                it.n > 0 && h('p', { class: 'hint' }, `${it.low} gave 1–3 · ${it.top2} gave 6–7.`),
                it.effect && h('p', { class: 'hint' }, `With ${plural(it.n, 'answer')}, one person can move this score by up to ${it.effect.score.toFixed(1)} (${it.effect.points} points).`)),
              h('div', {}, h('h3', { class: 'dh' }, `Comments (${it.comments.length})`),
                it.comments.length ? commentList(it.comments) : h('p', { class: 'hint' }, 'No comments on this item.')))));
          const toggle = () => {
            const open = detail.hidden;
            detail.hidden = !open;
            btn.setAttribute('aria-expanded', String(open));
            row.classList.toggle('open', open);
          };
          // The whole row is clickable with a mouse; keyboard and screen readers use the button.
          row.addEventListener('click', (e) => { if (e.target !== btn) toggle(); });
          btn.addEventListener('click', toggle);
          tbody.append(row, detail);
          if (openId === it.id) toggle();
        });
      };
      fill();
      const sortSel = h('select', { onchange: (e) => { sortBy = e.target.value; fill(); } },
        h('option', { value: 'order', selected: sortBy === 'order' }, 'Program order'),
        h('option', { value: 'low', selected: sortBy === 'low' }, 'Lowest score first'),
        h('option', { value: 'lowcount', selected: sortBy === 'lowcount' }, 'Most 1–3 ratings'));
      return h('div', { class: 'rs' },
        h('div', { class: 'toolbar' }, h('label', {}, 'Sort', sortSel), legend()),
        h('div', { class: 'table-wrap' }, h('table', { class: 'rt' },
          h('caption', {}, 'Select an item to see its ratings and comments.'),
          h('thead', {}, h('tr', {},
            h('th', { class: 'col-x' }, '#'), h('th', {}, 'Item'), h('th', { class: 'r col-x' }, 'Answers'), h('th', { class: 'r' }, 'Score'), h('th', { class: 'r' }, '%'),
            h('th', { class: 'c col-x' }, 'Ratings'), h('th', { class: 'r col-x' }, 'Rated 1–3'), h('th', { class: 'r col-x' }, 'Comments'))),
          tbody)));
    }

    // ---- areas: every item as a small dot, the area average as a larger one ----
    function categoriesView() {
      const cats = A.categories;
      if (!cats.length) return h('p', { class: 'muted' }, 'Not enough answers yet.');
      const all = cats.flatMap((c) => c.itemMeans.map((m) => m.mean));
      const lo = Math.max(1, Math.min(4, Math.floor(Math.min(...all))));
      const avail = Math.round(panels.clientWidth || main.clientWidth || 760) - 38;
      const width = Math.max(300, Math.min(820, avail));
      const rowH = 44, left = Math.min(150, Math.round(width * 0.34)), right = 72, top = 34;
      const plotW = width - left - right;
      const x = (v) => left + ((v - lo) / (SCALE_MAX - lo)) * plotW;
      const height = top + cats.length * rowH + 12;
      const svg = s('svg', { class: 'dotplot', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
        'aria-label': `Average score by area, scale from ${lo} to 7` });
      for (let v = lo; v <= SCALE_MAX; v++) {
        svg.append(s('line', { class: 'grid', x1: x(v), x2: x(v), y1: top - 6, y2: height - 8 }));
        svg.append(s('text', { x: x(v), y: height, 'text-anchor': 'middle', class: 'tick' }, v));
      }
      svg.append(s('line', { class: 'ref', x1: x(REF), x2: x(REF), y1: top - 12, y2: height - 8 }));
      svg.append(s('text', { class: 'reflbl', x: x(REF), y: top - 18, 'text-anchor': 'middle' }, `80% = ${REF.toFixed(1)}`));
      cats.forEach((c, i) => {
        const y = top + i * rowH + rowH / 2;
        svg.append(s('text', { class: 'name', x: 0, y: y + 5 }, c.label));
        const dot = s('circle', { class: 'dot', cx: x(c.mean), cy: y, r: 7.5 });
        dot.dataset.tip = `${c.label}: ${c.score} (${c.pct}%) · average of ${plural(c.items, 'item')}`;
        svg.append(dot);
        c.itemMeans.forEach((m) => {
          const below = m.pct < HIGHLIGHT_BELOW;
          const d = s('circle', { class: `idot${below ? ' below' : ''}`, cx: x(m.mean), cy: y, r: 4.5 });
          d.dataset.tip = `${m.label}: ${m.score} (${m.pct}%)`;
          svg.append(d);
        });
        svg.append(s('text', { x: width - right + 10, y: y + 5, 'font-weight': '700' }, c.score));
      });
      const S = A.summary;
      return h('div', { class: 'rs' },
        h('div', { class: 'panel' }, h('h2', {}, 'Average score by area'),
          h('p', { class: 'hint' }, `Large dot = the area’s average (each item counted equally). Small dots = its items; hollow = an item below 80%.${lo > 1 ? ` The scale starts at ${lo}.` : ''}`),
          svg,
          S.areas?.driver && h('p', { class: 'hint' }, `${S.areas.worst.label} is pulled down by ${S.areas.driver.label} (${S.areas.driver.score}); its other items average higher.`)),
        h('div', { class: 'table-wrap' }, h('table', { class: 'rt' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Area'), h('th', { class: 'r col-x' }, 'Items'), h('th', { class: 'r' }, 'Score'), h('th', { class: 'r' }, '%'), h('th', {}, 'Lowest item'))),
          h('tbody', {}, cats.map((c) => {
            const lowest = [...c.itemMeans].sort((a, b) => a.mean - b.mean)[0];
            return h('tr', {}, h('td', {}, c.label), h('td', { class: 'r num col-x' }, c.count), h('td', { class: 'r score' }, c.score), h('td', { class: 'r num' }, `${c.pct}%`),
              h('td', {}, lowest ? `${lowest.label} (${lowest.score})` : '–'));
          })))));
    }

    // ---- comments ----
    function commentsView() {
      const withC = A.items.filter((it) => it.comments.length);
      const groups = [
        ...A.openAnswers.filter((q) => q.answers.length).map((q) => h('div', { class: 'cgroup' },
          h('h3', {}, q.label, h('span', { class: 'score' }, plural(q.answers.length, 'answer'))), commentList(q.answers))),
        ...withC.sort((a, b) => (a.n ? a.mean : 9) - (b.n ? b.mean : 9)).map((it) => h('div', { class: 'cgroup' },
          h('h3', {}, `${it.no}. ${it.label}`, h('span', { class: `score${it.highlight ? ' mark' : ''}` }, it.n ? `${it.score} (${it.pct}%)` : '')), commentList(it.comments))),
      ];
      return groups.length
        ? h('div', { class: 'panel' }, h('p', { class: 'hint' }, 'Open questions first, then comments on items, lowest score first. Each comment shows how its writer rated the item.'), ...groups)
        : h('p', { class: 'muted' }, 'No written comments.');
    }

    // ---- classic paper sheet for the client ----
    function sheetView() {
      const d = sem.dates?.start ? new Date(`${sem.dates.start}T12:00:00`) : null;
      const month = d ? d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '';
      const titleInput = h('input', { type: 'text', class: 'title-input', value: `Satisfaction results for ${en(sem.reportName || sem.title)}${month ? `, ${month}` : ''}`, 'aria-label': 'Report title' });
      const withN = h('input', { type: 'checkbox', id: 'withn' });
      const heading = h('h2', {}, titleInput.value);
      titleInput.addEventListener('input', () => { heading.textContent = titleInput.value; });
      const tbody = h('tbody', {});
      const headRow = h('tr', {});
      const few = A.items.some((it) => it.fewAnswers);
      const build = () => {
        swap(headRow, h('th', {}), h('th', {}, 'Topic'), withN.checked && h('th', {}, 'Answers'), h('th', {}, 'Results', h('br'), h('small', {}, 'Score 1-7')), h('th', {}, 'Results', h('br'), '%'));
        swap(tbody, ...A.items.map((it) => h('tr', {},
          h('td', { class: 'n' }, it.no), h('td', {}, it.label, it.fewAnswers ? ' †' : ''),
          withN.checked && h('td', { class: 'n' }, it.n),
          h('td', { class: `v${it.highlight ? ' hl' : ''}` }, h('span', {}, it.score)),
          h('td', { class: `v${it.highlight ? ' hl' : ''}` }, h('span', {}, it.pct == null ? '–' : `${it.pct}%`)))));
      };
      withN.addEventListener('change', build);
      build();
      const sheet = h('div', { class: 'sheet' },
        h('div', { class: 's-logo' }, h('img', { src: 'assets/img/logo.png', alt: 'Dairy School — The Israeli Experience' })),
        heading,
        h('table', {}, h('thead', {}, headRow), tbody),
        h('p', { class: 'note' }, `${A.responses} questionnaires. Score = average of the 1–7 ratings; % = average ÷ 7. Highlighted: below ${HIGHLIGHT_BELOW}%.${few ? ' † fewer than 5 answers.' : ''}`),
        h('div', { class: 'foot' }, 'Alon Hagalil 17920 Israel, Tel: +972544865282/316, Fax: +9729502395,', h('br'),
          'Email: info@dairyschool.co.il', h('br'), h('b', {}, 'www.dairyschool.co.il')));
      // One A4 page, always: print a compact copy, shrunk if a long program would overflow.
      const A4_PX = 1090; // A4 is 1122px at 96dpi; keep ~3% spare because print layout runs slightly taller
      fitSheet = () => {
        if (!sheet.isConnected) return;
        let root = document.getElementById('print-root');
        if (!root) { root = h('div', { id: 'print-root' }); document.body.append(root); }
        const copy = sheet.cloneNode(true);
        copy.classList.add('for-print');
        copy.style.transform = '';
        swap(root, copy);
        root.style.cssText = 'display:block;position:absolute;left:-10000px;top:0;width:794px';
        copy.style.setProperty('--fit', Math.min(1, A4_PX / copy.scrollHeight).toFixed(3));
        root.style.cssText = '';
        document.body.classList.add('print-sheet');
      };
      // On narrow screens show the whole page scaled down as one picture (transform, not zoom:
      // iOS Safari applies zoom to widths but not to text). Kept up to date on resize/rotation.
      const holder = h('div', { class: 'sheet-holder' }, sheet);
      const stage = h('div', { class: 'sheet-stage' }, holder);
      const fitPreview = () => {
        const w = stage.clientWidth - 36;
        const k = w > 0 && w < 794 ? w / 794 : 1;
        sheet.style.transform = k < 1 ? `scale(${k.toFixed(3)})` : '';
        holder.style.width = k < 1 ? `${Math.floor(794 * k)}px` : '';
        holder.style.height = k < 1 ? `${Math.ceil(sheet.offsetHeight * k)}px` : '';
      };
      afterMount.push(fitPreview);
      if ('ResizeObserver' in window) new ResizeObserver(fitPreview).observe(stage);
      return h('div', { class: 'rs' },
        h('div', { class: 'toolbar' },
          titleInput,
          h('label', { for: 'withn' }, withN, 'Show number of answers'),
          h('button', { class: 'btn btn-primary', type: 'button', style: 'flex:0 0 auto;min-height:44px;font-size:15px', onclick: () => { fitSheet(); window.print(); } }, icon('printer'), 'Print or save as PDF')),
        h('p', { class: 'hint' }, 'The same layout as your paper results sheets. Comments are not included, so it is ready to send to the client.'),
        demo && h('p', { class: 'hint' }, 'The prototype preview may block printing; the live site prints this sheet on one A4 page.'),
        stage);
    }

    // ---- data & export ----
    function dataView() {
      const csv = () => toCSV(model, res.responses, 'en');
      const status = h('span', { class: 'hint', role: 'status' });
      const Q = A.quality;
      return h('div', { class: 'rs' },
        h('div', { class: 'dq' },
          h('div', {}, h('b', {}, A.responses), h('span', {}, 'responses')),
          h('div', {}, h('b', {}, Q.straightLiners), h('span', {}, 'gave every item the same score')),
          h('div', {}, h('b', {}, Q.blanksMain), h('span', {}, `blanks on main items${Q.blanksOptional ? ` · ${Q.blanksOptional} on optional items` : ''}`)),
          h('div', {}, h('b', {}, Q.itemComments + Q.openComments), h('span', {}, 'written comments'))),
        h('div', { class: 'panel' },
          h('h2', {}, 'Export'),
          h('p', { class: 'muted' }, 'One row per response, no names. Ratings 1–7, NA = didn’t take part, empty = left blank.'),
          h('div', { class: 'btn-row', style: 'justify-content:flex-start' },
            h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => {
              try {
                const blob = new Blob(['﻿' + csv()], { type: 'text/csv;charset=utf-8' });
                const a = h('a', { href: URL.createObjectURL(blob), download: `${current}-responses.csv` });
                document.body.append(a); a.click(); a.remove();
                status.textContent = 'Download started.';
              } catch { status.textContent = 'Download is blocked here. Use Copy CSV.'; }
            } }, icon('download'), 'Download CSV'),
            h('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => {
              try { await navigator.clipboard.writeText(csv()); status.textContent = 'CSV copied. Paste it into Excel or Google Sheets.'; }
              catch { status.textContent = 'Copy was blocked by the browser.'; }
            } }, icon('copy'), 'Copy CSV')),
          demo && h('p', { class: 'hint' }, 'The prototype preview blocks file downloads; use Copy CSV here. The live site downloads the file.'),
          status),
        h('div', { class: 'panel defs' },
          h('h2', {}, 'Where the answers live'),
          h('p', {}, `In the school’s Google Sheet, tab “${current} · Answers”: one row per response, no names, no times. Nothing in this system ever deletes or overwrites answers; closing the survey removes only the list of names.`),
          h('p', {}, 'Safety copies: Google keeps the Sheet’s version history; closing the survey adds a dated copy of the answers as a new tab and emails a CSV to the school, and Dairy School → Back up answers now in the Sheet does the same at any time. Download the CSV above as your own copy.')),
        h('div', { class: 'panel defs' },
          h('h2', {}, 'How the numbers are calculated'),
          h('p', {}, 'Score: the average of the 1–7 ratings given. “Didn’t take part” and blanks are counted but left out.'),
          h('p', {}, 'Score %: the exact average divided by 7, rounded, the same rule as the Dairy School paper sheets, so years compare directly. 99% is the most shown unless every rating is 7.'),
          h('p', {}, `Yellow: below ${HIGHLIGHT_BELOW}%, whatever the number of answers (as on paper). Items with fewer than ${MIN_N} answers are marked “few” here and † on the client sheet.`),
          h('p', {}, 'Areas: the average of the items in the area, each item counted equally. The Areas view also shows every item, so one weak item is easy to spot.'),
          h('p', {}, 'Small groups: everyone in the group is asked, so these are the group’s actual answers, not a sample. What matters is how much one person can move a score: with about 20 answers, 3–4 points.')));
    }
  }

  // Tooltips for chart marks (mouse only; every value is also in the tables).
  main.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.dataset.tip; tip.hidden = false;
  });
  main.addEventListener('pointermove', (e) => { if (!tip.hidden) { tip.style.left = `${e.clientX + 12}px`; tip.style.top = `${e.clientY - 34}px`; } });
  main.addEventListener('pointerleave', () => { tip.hidden = true; });
  window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

  if (key) { const ok = await start(); if (!ok) return; } else gate();
}
