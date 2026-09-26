// Runs inside real Mobile Safari (iOS Simulator). Polls the host for commands and performs them
// the way a person would (scroll into view, tap), then reports back once the screen has settled.
(function () {
  const INSTANCE = Math.random().toString(36).slice(2); // one per page load
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const find = (sel, text) => {
    const all = [...document.querySelectorAll(sel)];
    return text ? all.find((el) => el.textContent.includes(text)) : all[0];
  };
  // Wait (up to 5 s) for the element, like a person waiting for the screen to appear.
  const $ = async (sel, text) => {
    for (let t = 0; t < 50; t++) { const el = find(sel, text); if (el) return el; await sleep(100); }
    throw new Error(`not found: ${sel}${text ? ` "${text}"` : ''}`);
  };
  // Like a finger: tap whatever is actually on screen at the element's centre.
  async function tap(el) {
    // A person puts the keyboard away before tapping anything else (the bottom bar hides while it is open).
    const active = document.activeElement;
    if (active && active !== document.body && !el.contains(active)) { active.blur(); await sleep(400); }
    if (el.closest('[hidden]') || !el.getClientRects().length) throw new Error('target is hidden');
    el.scrollIntoView({ block: 'center' });
    await sleep(250);
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !(el.contains(hit) || hit.contains(el) || hit.closest('label') === el)) {
      throw new Error(`something else is under the finger: ${hit?.outerHTML.slice(0, 80)}`);
    }
    hit.click();
  }
  const ops = {
    async tap({ sel, text }) { await tap(await $(sel, text)); },
    async fill({ sel, value }) {
      const el = await $(sel); el.scrollIntoView({ block: 'center' }); el.focus();
      el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.blur();
    },
    async rate({ card = 0, value }) {
      await $('.item');
      const c = document.querySelectorAll('.item')[card];
      await tap(c.querySelector(`.scale label:nth-child(${value})`));
    },
    async rateAll({ value, comment = 'Добре, дякуємо.' }) {
      for (const c of document.querySelectorAll('.item')) {
        if (!c.classList.contains('answered')) await tap(c.querySelector(`.scale label:nth-child(${value})`));
        const ta = c.querySelector('textarea.cmt');
        if (ta && !c.classList.contains('is-na') && !ta.value) { ta.value = comment; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new Event('blur')); }
      }
    },
    async state() { return JSON.stringify({ answers: Object.keys(JSON.parse(localStorage.getItem('dsf:demo:draft') || '{}').answers || {}).length }); },
    async show({ sel, text, block = 'start' }) { (await $(sel, text)).scrollIntoView({ block }); },
    async select({ sel, value }) { const el = await $(sel); el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); },
    async top() { window.scrollTo(0, 0); },
    async bottom() { window.scrollTo(0, document.documentElement.scrollHeight); },
    async hash({ value }) { location.hash = value; },
    async clear() { localStorage.clear(); sessionStorage.clear(); },
    async mock({ failNext = 0, slowNext = 0, busyNext = 0 }) { window.__dsfMock = { failNext, slowNext, busyNext }; },
    async wait({ ms }) { await sleep(ms); },
    async text({ sel }) { return (await $(sel)).innerText; },
    async probeZoom() {
      const d = document.createElement('div'); d.style.width = '400px'; d.textContent = 'x';
      document.body.append(d);
      d.style.zoom = '0.5';
      const out = { set: d.style.zoom, computed: getComputedStyle(d).zoom, rectW: Math.round(d.getBoundingClientRect().width),
        ro: typeof ResizeObserver, stageW: document.querySelector('.sheet-stage')?.clientWidth };
      d.remove();
      const sh = document.querySelector('.sheet');
      if (sh) { sh.style.zoom = '0.403'; out.sheetAfter = { set: sh.style.zoom, rectW: Math.round(sh.getBoundingClientRect().width) }; }
      return JSON.stringify(out);
    },
    async probeSheet() {
      const st = await $('.sheet-stage'), sh = document.querySelector('.sheet');
      return JSON.stringify({ stageW: st.clientWidth, styleZoom: sh.style.zoom, cssZoom: getComputedStyle(sh).zoom,
        rectW: Math.round(sh.getBoundingClientRect().width), offsetW: sh.offsetWidth, h2font: getComputedStyle(sh.querySelector('h2')).fontSize,
        textAdjust: getComputedStyle(document.documentElement).webkitTextSizeAdjust, ua: navigator.userAgent.slice(0, 60) });
    },
  };
  // Every request has a deadline: one stalled request must never freeze the tour.
  async function timedFetch(url, opts = {}, ms = 4000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctrl.signal, cache: 'no-store' }); } finally { clearTimeout(timer); }
  }
  async function ack(id, ok, info) {
    for (let i = 0; i < 5; i++) {
      try { await timedFetch('/__ack', { method: 'POST', body: JSON.stringify({ id, ok, info }) }); return; } catch { await sleep(300); }
    }
  }
  async function loop() {
    for (;;) {
      let cmd = null;
      try {
        const r = await timedFetch(`/__cmd?i=${INSTANCE}`);
        if (r.status === 200) cmd = await r.json();
      } catch { /* host not ready */ }
      if (!cmd) { await sleep(250); continue; }
      if (cmd.op === 'reload' || cmd.op === 'goto') {
        await ack(cmd.id, true, 'navigating');
        if (cmd.op === 'reload') location.reload(); else location.href = cmd.url;
        return;
      }
      try {
        const info = await ops[cmd.op](cmd);
        await sleep(cmd.settle ?? 700);
        await ack(cmd.id, true, info ?? (document.querySelector('main h1')?.textContent || ''));
      } catch (e) {
        await ack(cmd.id, false, String(e.message || e));
      }
    }
  }
  loop();
})();
