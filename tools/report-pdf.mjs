// Results report as a PDF, interim (survey still open) or final (closed), from a read-only export of the Sheet.
//   node tools/report-pdf.mjs <export.json> <seminar id> <out.pdf> [--translations <orig→english json>] [--notes <json>] [--html <debug.html>]
// Same numbers as the staff results page: it uses the site's own analytics module. No names anywhere.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright-core';
const here = path.dirname(fileURLToPath(import.meta.url));
const { analyze, onePersonEffect, HIGHLIGHT_BELOW, CATEGORY_LABELS } = await import(path.join(here, '../site/assets/js/analytics.js'));

const args = process.argv.slice(2); const opt = {}; const pos = [];
for (let i = 0; i < args.length; i++) args[i].startsWith('--') ? (opt[args[i].slice(2)] = args[++i]) : pos.push(args[i]);
const [exportFile, id, outPdf] = pos;
if (!exportFile || !id || !outPdf) { console.error('usage: node tools/report-pdf.mjs <export.json> <seminar id> <out.pdf> [--translations f] [--notes f] [--html f]'); process.exit(2); }
const X = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
const T = opt.translations ? JSON.parse(fs.readFileSync(opt.translations, 'utf8')) : {};
const notes = opt.notes ? JSON.parse(fs.readFileSync(opt.notes, 'utf8')) : {};
const tab = (n) => X.tabs[`${id} · ${n}`] || [];
const objs = (rows) => rows.slice(1).filter((r) => r.some((v) => v !== '')).map((r) => Object.fromEntries(rows[0].map((k, i) => [k, r[i] ?? ''])));

// ---- seminar
const sem = objs(X.tabs.Seminars || []).find((r) => r.id === id);
if (!sem) { console.error(`seminar ${id} not in the Seminars tab`); process.exit(1); }
const status = String(sem.status).toLowerCase();
const items = objs(tab('Items')).map((o) => ({ id: o.id, no: Number(o.no), section: o.section_en, label: o.label_en, detail: o.detail_en, category: o.category || 'other', key: o.key || undefined, optional: /^(1|1\.0|true)$/i.test(String(o.optional)) }));
const head = tab('Answers')[0] || [];
const openQuestions = head.slice(1 + items.length * 2).filter((h) => h && h !== 'Sent (Israel time)').map((label, i) => ({ id: `q${i + 1}`, label }));
const responses = tab('Answers').slice(1).filter((r) => r[0]).map((r) => {
  const o = { answers: {}, comments: {}, open: {} }; let c = 1;
  items.forEach((it) => { const v = r[c++]; if (v === 'NA') o.answers[it.id] = 'na'; else if (v !== '' && v != null && Number.isFinite(Number(v))) o.answers[it.id] = Number(v); });
  items.forEach((it) => { const t = String(r[c++] || '').trim(); if (t) o.comments[it.id] = t; });
  openQuestions.forEach((q) => { const t = String(r[c++] || '').trim(); if (t) o.open[q.id] = t; });
  o.sentAt = String(r[c++] || '').trim(); return o;
});
const namesCount = objs(tab('Names')).length;
const invited = Number(sem.invited) || namesCount || null;
const A = analyze({ items, openQuestions, invited }, responses);
const closed = status === 'closed';
const kind = closed ? 'Final report' : 'Interim report';

// ---- helpers
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tr = (t) => (T[t] && T[t].trim() ? { en: T[t].trim(), ok: true } : { en: t, ok: false });
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const fmtDate = (iso, o) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o }).format(new Date(`${iso}T00:00:00Z`));
const dates = sem.start && sem.end ? (sem.start.slice(0, 7) === sem.end.slice(0, 7)
  ? `${fmtDate(sem.start, { day: 'numeric' })}–${fmtDate(sem.end, { day: 'numeric', month: 'long', year: 'numeric' })}`
  : `${fmtDate(sem.start, { day: 'numeric', month: 'long' })} – ${fmtDate(sem.end, { day: 'numeric', month: 'long', year: 'numeric' })}`) : '';
const asOf = (() => { const [d, t] = String(X.exportedAt || '').split(' '); return d ? `${fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' })}, ${(t || '').slice(0, 5)} Israel time` : 'now'; })();
const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(here, '../site/assets/img/logo.png')).toString('base64');
const program = A.items.filter((it) => !it.key && it.n > 0);
const ratingBadge = (r) => `<span class="rb ${Number.isInteger(r) ? (r >= 6 ? 'top' : r >= 4 ? 'mid' : 'low') : 'none'}">${Number.isInteger(r) ? r : r === 'na' ? 'n/a' : '–'}</span>`;
const nums = (it) => `${it.n}${it.na ? ` <small>(+${it.na} n/a)</small>` : ''}`;
const topText = (it) => (!it.n ? 'no answers yet' : it.dist[6] === it.n ? `every one of the ${it.n} gave 7` : `${it.top2} of ${it.n} gave 6 or 7`);
const allDist = new Array(7).fill(0); let allTotal = 0; A.items.forEach((it) => it.dist.forEach((c, i) => { allDist[i] += c; allTotal += c; }));
const n7 = allDist[6], n6 = allDist[5], nLow = allTotal - n7 - n6;
const effect = onePersonEffect(A.responses);
const cats = [...A.categories].sort((a, b) => b.mean - a.mean);
const perfect = program.filter((it) => it.dist[6] === it.n);
const lower = [...program].sort((a, b) => a.mean - b.mean || a.pct - b.pct || a.no - b.no).slice(0, 5).filter((it) => it.dist[6] !== it.n);
const minPct = Math.min(...program.map((it) => it.pct)), maxPct = Math.max(...program.map((it) => it.pct));
const minScore = program.reduce((m, it) => (it.mean < m.mean ? it : m)).score, maxScore = program.reduce((m, it) => (it.mean > m.mean ? it : m)).score;
const critical = (it) => it.comments.filter((c) => Number.isInteger(c.rating) && c.rating <= 5).slice(0, 1).map((c) => `“${esc(tr(c.text).en)}”`).join(' ');
const distText = (it) => [6, 5, 4, 3, 2, 1, 0].filter((i) => it.dist[i]).map((i) => `${it.dist[i]}× ${i + 1}`).join(', ');
const bar = (pct, cls = '') => `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, pct || 0))}%"></i></div>`;
const kpi = (label, it, cls = '') => `<div class="kpi ${cls}"><span class="lbl">${label}</span>${it && it.n ? `<div class="val"><b>${it.score}</b><span class="of">/ 7</span><span class="pct">${it.pct}%</span></div>` : '<div class="val"><b>–</b></div>'}<span class="sub">${it && it.n ? topText(it) : 'no answers yet'}</span></div>`;

// ---- key points (rule-based, every sentence carries its numbers)
const points = [];
if (A.below80 === 0) points.push(`<b>Nothing is below the ${HIGHLIGHT_BELOW}% line.</b> All ${A.programCount} program items score between ${minPct}% and ${maxPct}% (${minScore}–${maxScore} out of 7), and ${pctOf(n7 + n6, allTotal)}% of the ${allTotal} individual ratings given so far were a 6 or a 7.`);
else points.push(`<b>${A.below80} of ${A.programCount} program items are below ${HIGHLIGHT_BELOW}%</b> (marked in yellow on the next page): ${A.summary.attention.map((it) => `${esc(it.label)} (${it.score}, ${it.pct}%)`).join('; ')}.`);
if (A.overall?.n && A.recommend?.n) points.push(`<b>Overall satisfaction ${A.overall.score} (${A.overall.pct}%), would recommend ${A.recommend.score} (${A.recommend.pct}%).</b> ${A.overall.dist[6] === A.overall.n && A.recommend.dist[6] === A.recommend.n ? `Every one of the ${A.responses} who answered gave the top mark, 7, on both.` : `${topText(A.overall)} on satisfaction; ${topText(A.recommend)} on recommending.`}`);
if (perfect.length) points.push(`<b>A perfect 7 from everyone</b> on ${perfect.length} of the ${A.programCount} program items: ${perfect.map((it) => esc(it.label)).join('; ')}.`);
if (lower.length) points.push(`<b>Lower end of the scale, ${lower.every((it) => it.pct >= HIGHLIGHT_BELOW) ? 'still good' : 'to look at'}:</b> ${lower.map((it) => `${esc(it.label)} (${it.score}, ${it.pct}%)`).join('; ')}.${lower.some((it) => critical(it)) ? ' The comments behind the lower marks are on page 3.' : ''}`);
if (cats.length >= 2) points.push(`<b>By area:</b> ${cats.map((c) => `${c.label} ${c.pct}%`).join(', ')}.`);
if (notes.suggestions) points.push(`<b>What they ask for:</b> ${esc(notes.suggestions)}`);

// ---- page 2: every item, program order, by section
let lastSection = null; const rows = [];
for (const it of A.items) {
  const src = items.find((x) => x.id === it.id);
  if (src.section !== lastSection) { lastSection = src.section; rows.push(`<tr class="sec"><td colspan="7">${esc(lastSection)}</td></tr>`); }
  const hl = it.highlight ? ' hl' : '';
  rows.push(`<tr class="${hl.trim()}"><td class="no">${it.no}</td><td class="lbl">${esc(it.label)}</td><td class="r">${it.n ? nums(it) : '–'}</td><td class="r sc">${it.score}</td><td class="r sc">${it.pct == null ? '–' : `${it.pct}%`}</td><td class="bc">${it.n ? bar(it.pct, hl) : ''}</td><td class="r">${it.n ? `${it.top2}/${it.n}` : '–'}</td></tr>`);
}

// ---- page 3: areas + highs/lows
const areaRows = cats.map((c) => `<div class="arow"><span class="alabel">${esc(c.label)} <small>${c.count} item${c.count === 1 ? '' : 's'}</small></span>${bar(c.pct, 'thick')}<span class="aval"><b>${c.score}</b> · ${c.pct}%</span></div>`).join('');
const lowerRows = lower.map((it) => `<li><div class="lt"><span class="ln">${it.no}. ${esc(it.label)}</span><span class="lv ${it.highlight ? 'warn' : ''}">${it.score} · ${it.pct}%</span></div><div class="le">${it.n} answer${it.n === 1 ? '' : 's'} · ratings given: ${distText(it)}</div>${critical(it) ? `<div class="lq">${critical(it)}</div>` : ''}</li>`).join('');
const perfectRows = perfect.map((it) => `<li><span class="ln">${it.no}. ${esc(it.label)}</span><span class="lv good">7.0 · 100%</span></li>`).join('');

// ---- page 4: open questions
const openBlocks = A.openAnswers.map((q) => `<section class="openq"><h3>${esc(q.label)} <small>${q.answers.length} answer${q.answers.length === 1 ? '' : 's'}</small></h3><ul class="ans">${q.answers.map((t) => { const x = tr(t); return `<li>${esc(x.en).replace(/\n+/g, '<br>')}${x.ok ? '' : ' <small class="untr">(not translated)</small>'}</li>`; }).join('')}</ul></section>`).join('');

// ---- pages 5+: comments by item
const commentBlocks = A.items.filter((it) => it.comments.length).map((it) => `<div class="cg"><h4>${it.no}. ${esc(it.label)} <small>${it.score} · ${it.pct}%</small></h4><ul>${it.comments.map((c) => { const x = tr(c.text); return `<li>${ratingBadge(c.rating)}<span>${esc(x.en).replace(/\n+/g, '<br>')}${x.ok ? '' : ' <small class="untr">(not translated)</small>'}</span></li>`; }).join('')}</ul></div>`).join('');
const nComments = A.quality.itemComments, nOpen = A.quality.openComments;
const untranslated = [...new Set([...A.items.flatMap((it) => it.comments.map((c) => c.text)), ...A.openAnswers.flatMap((q) => q.answers)])].filter((t) => !tr(t).ok).length;

const statusLine = closed
  ? `<b>Survey closed.</b> ${A.responses} of ${invited ?? '?'} participants answered${invited ? ` (${pctOf(A.responses, invited)}%)` : ''}. Data as of ${asOf}.`
  : `<b>The survey is still open:</b> ${A.responses} of ${invited ?? '?'} participants have answered${invited ? ` (${pctOf(A.responses, invited)}%)` : ''} as of ${asOf}. The figures will move as more answers arrive; a final report follows once the survey is closed.`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(sem.report_name || sem.title_en)} · ${kind}</title><style>
:root { --ink:#0f1f28; --ink2:#44565f; --ink3:#5d6f78; --line:#d6dfdc; --brand:#0e76bb; --brand-strong:#0a5f98; --wash:#e5f0f8; --wash2:#f6f8f7; --good:#36660a; --goodwash:#ebf5de; --warn:#6b4700; --warnwash:#fff4d4; --warnline:#eccf7c; --low:#d24a43; --mid:#a8a59c; --top:#0e76bb; }
* { box-sizing: border-box; }
body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: var(--ink); font-size: 10pt; line-height: 1.38; margin: 0; }
.page { break-before: page; } .page.flow { break-before: auto; margin-top: 18px; }
h2, h3, h4 { break-after: avoid; }
.top { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--brand); padding-bottom: 7px; margin-bottom: 12px; }
.top img { height: 34px; } .kind { font-weight: 700; color: var(--brand-strong); letter-spacing: .04em; text-transform: uppercase; font-size: 9.5pt; }
h1 { font-size: 19pt; margin: 0 0 2px; line-height: 1.2; } .sub { margin: 0 0 12px; color: var(--ink2); font-size: 11pt; }
.status { display: flex; gap: 10px; align-items: flex-start; background: ${closed ? 'var(--wash2)' : 'var(--warnwash)'}; border: 1px solid ${closed ? 'var(--line)' : 'var(--warnline)'}; border-radius: 8px; padding: 9px 12px; font-size: 10pt; color: ${closed ? 'var(--ink)' : 'var(--warn)'}; margin-bottom: 14px; }
.status .dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: ${closed ? 'var(--ink3)' : '#e0a100'}; margin-top: 5px; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 10px; }
.kpi { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: #fff; } .kpi.hero { background: var(--brand-strong); border-color: var(--brand-strong); color: #fff; }
.kpi .lbl { display: block; font-size: 9pt; font-weight: 600; opacity: .9; } .kpi.hero .lbl, .kpi.hero .sub, .kpi.hero .of { color: #fff; opacity: .95; } .kpi .val { display: flex; align-items: baseline; gap: 4px; margin: 2px 0 1px; } .kpi .val b { font-size: 23pt; line-height: 1.1; } .kpi .of { font-size: 10pt; opacity: .8; } .kpi .pct { font-size: 12pt; font-weight: 650; margin-left: 5px; } .kpi .sub { display: block; font-size: 8.5pt; opacity: .85; }
.how { font-size: 8.8pt; color: var(--ink3); margin: 0 0 12px; }
h2 { font-size: 12.5pt; margin: 14px 0 7px; color: var(--brand-strong); } h2 small { font-weight: 400; color: var(--ink3); font-size: 9pt; margin-left: 6px; }
.stack { display: flex; height: 22px; border-radius: 6px; overflow: hidden; border: 1px solid var(--line); } .stack i { display: block; height: 100%; } .stack .s7 { background: var(--brand-strong); } .stack .s6 { background: #5aa6dc; } .stack .s5 { background: var(--mid); }
.legend { display: flex; gap: 16px; font-size: 9pt; color: var(--ink2); margin-top: 5px; } .legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; } .legend .l7::before { background: var(--brand-strong); } .legend .l6::before { background: #5aa6dc; } .legend .l5::before { background: var(--mid); }
.points { margin: 0; padding-left: 18px; } .points li { margin-bottom: 6px; } .points b { color: var(--ink); }
.caution { font-size: 8.8pt; color: var(--ink3); border-top: 1px solid var(--line); padding-top: 7px; margin-top: 12px; }
table.rt { width: 100%; border-collapse: collapse; font-size: 8.7pt; } .rt th { text-align: left; font-size: 7.6pt; letter-spacing: .05em; text-transform: uppercase; color: var(--ink2); background: var(--wash2); padding: 4px 5px; border-bottom: 1px solid var(--line); white-space: nowrap; } .rt th.r, .rt td.r { text-align: right; }
.rt td { padding: 2.4px 5px; border-bottom: 1px solid #eef1f0; vertical-align: middle; } .rt tr.sec td { background: var(--wash); color: var(--brand-strong); font-weight: 700; font-size: 8.7pt; padding: 3px 5px; border-bottom: 0; }
.rt td.no { color: var(--ink3); width: 20px; } .rt td.lbl { padding-right: 10px; } .rt td.sc { font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; } .rt td.r { white-space: nowrap; } .rt td.r small { color: var(--ink3); font-size: 7.6pt; } .rt td.bc { width: 118px; }
.rt tr.hl td { background: var(--warnwash); } .rt tr.hl td.sc { color: var(--warn); }
.bar { height: 9px; background: #eef1f0; border-radius: 5px; overflow: hidden; } .bar i { display: block; height: 100%; background: var(--brand); border-radius: 5px; } .bar.hl i { background: #e0a100; } .bar.thick { height: 14px; flex: 1; }
.foot { font-size: 8.5pt; color: var(--ink3); margin-top: 8px; }
.arow { display: flex; align-items: center; gap: 12px; margin: 7px 0; } .alabel { width: 140px; font-weight: 600; } .alabel small { display: block; font-weight: 400; color: var(--ink3); font-size: 8pt; } .aval { width: 90px; text-align: right; font-variant-numeric: tabular-nums; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin-top: 6px; }
.lst { list-style: none; margin: 0; padding: 0; } .lst li { padding: 6px 0; border-bottom: 1px solid #eef1f0; } .lst li:last-child { border-bottom: 0; }
.lt, .lst li { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; } .lst.low li { display: block; } .ln { font-weight: 600; } .lv { font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--brand-strong); } .lv.good { color: var(--good); } .lv.warn { color: var(--warn); }
.le { font-size: 8.5pt; color: var(--ink3); margin-top: 1px; } .lq { font-size: 9pt; color: var(--ink2); font-style: italic; margin-top: 2px; }
.openq h3 { font-size: 11pt; margin: 12px 0 5px; color: var(--ink); } .openq h3 small { font-weight: 400; color: var(--ink3); font-size: 9pt; } .ans { margin: 0; padding-left: 18px; } .ans li { margin-bottom: 4px; break-inside: avoid; }
.cols { column-count: 2; column-gap: 22px; } .cg { break-inside: avoid; margin-bottom: 9px; } .cg h4 { font-size: 9.5pt; margin: 0 0 3px; } .cg h4 small { font-weight: 400; color: var(--ink3); font-size: 8.5pt; white-space: nowrap; } .cg ul { list-style: none; margin: 0; padding: 0; } .cg li { display: flex; gap: 6px; align-items: flex-start; font-size: 8.9pt; margin-bottom: 3px; break-inside: avoid; }
.rb { flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 16px; padding: 0 3px; border-radius: 4px; font-size: 7.8pt; font-weight: 700; color: #fff; background: var(--mid); margin-top: 1px; } .rb.top { background: var(--top); } .rb.low { background: var(--low); } .rb.none { background: #cfd8d5; color: #333; }
.untr { color: var(--ink3); }
</style></head><body>

<section class="page flow" style="margin-top:0">
<div class="top"><img src="${logo}" alt=""><span class="kind">Seminar feedback · ${kind}</span></div>
<h1>${esc(sem.title_en)}</h1>
<p class="sub">${esc(sem.subtitle_en || sem.report_name || '')}${dates ? ` · ${dates}` : ''}</p>
<div class="status"><span class="dot"></span><span>${statusLine}</span></div>
<div class="kpis">${kpi('Overall satisfaction', A.overall, 'hero')}${kpi('Would recommend', A.recommend)}
<div class="kpi"><span class="lbl">Program average</span>${A.program ? `<div class="val"><b>${A.program.score}</b><span class="of">/ 7</span><span class="pct">${A.program.pct}%</span></div><span class="sub">${A.programCount} items · ${A.below80} below ${HIGHLIGHT_BELOW}%</span>` : '<div class="val"><b>–</b></div>'}</div>
<div class="kpi"><span class="lbl">Answered</span><div class="val"><b>${A.responses}</b>${invited ? `<span class="of">of ${invited}</span><span class="pct">${pctOf(A.responses, invited)}%</span>` : ''}</div><span class="sub">${closed ? 'survey closed' : 'survey still open'}</span></div></div>
<p class="how">How to read: <b>Score</b> = average of the 1–7 ratings given. <b>%</b> = score ÷ 7, as on the school’s paper sheets. “Didn’t take part” (n/a) and blanks are left out. Anything below ${HIGHLIGHT_BELOW}% is marked in yellow.</p>
<h2>All ${allTotal} ratings given so far <small>${A.responses} people × ${A.items.length} questions, minus n/a</small></h2>
<div class="stack"><i class="s7" style="width:${(100 * n7) / allTotal}%"></i><i class="s6" style="width:${(100 * n6) / allTotal}%"></i><i class="s5" style="width:${(100 * nLow) / allTotal}%"></i></div>
<div class="legend"><span class="l7">Rated 7: ${n7} (${pctOf(n7, allTotal)}%)</span><span class="l6">Rated 6: ${n6} (${pctOf(n6, allTotal)}%)</span><span class="l5">Rated 5 or less: ${nLow} (${pctOf(nLow, allTotal)}%)</span></div>
<h2>Key points</h2>
<ul class="points">${points.map((p) => `<li>${p}</li>`).join('')}</ul>
<p class="caution">With ${A.responses} answers, one person changing a rating from 7 to 1 would move an item’s score by ${effect ? effect.score.toFixed(1) : '–'} points (${effect ? effect.points : '–'}%), so small differences between items mean little${closed ? '' : '; the picture firms up as more people answer'}. Answers are anonymous. Comments were written in Ukrainian and translated into English for this report.</p>
</section>

<section class="page">
<h2 style="margin-top:0">Every question, in program order <small>${A.responses} answers · n/a = didn’t take part</small></h2>
<table class="rt"><thead><tr><th>#</th><th>Item</th><th class="r">Answers</th><th class="r">Score</th><th class="r">%</th><th>Bar (0–100%)</th><th class="r">Gave 6–7</th></tr></thead><tbody>${rows.join('')}</tbody></table>
<p class="foot">Score = average of the 1–7 ratings · % = score ÷ 7 · “Gave 6–7” = how many of those who rated it gave a 6 or a 7${A.below80 ? ` · yellow = below ${HIGHLIGHT_BELOW}%` : ''}.</p>
</section>

<section class="page">
<h2 style="margin-top:0">By area <small>average of the items in each area</small></h2>
${areaRows}
<div class="two">
<div><h2>A perfect 7 from everyone <small>${perfect.length} of ${A.programCount} items</small></h2>${perfect.length ? `<ul class="lst">${perfectRows}</ul>` : '<p class="foot">No item got a 7 from everyone.</p>'}</div>
<div><h2>Lower end of the scale <small>${lower.every((it) => it.pct >= HIGHLIGHT_BELOW) ? 'all still good' : 'to look at'}</small></h2><ul class="lst low">${lowerRows}</ul></div>
</div>
<p class="caution">Quotes under the lower items come from people who rated that item 5 or less. Every comment, with the rating its writer gave, is on the following pages.</p>
</section>

<section class="page flow">
<h2 style="margin-top:0">In their own words <small>the two closing questions · ${nOpen} answers</small></h2>
${openBlocks}
</section>

<section class="page flow">
<h2 style="margin-top:0">Comments on the program, item by item <small>${nComments} comments · the badge is the rating that person gave the item</small></h2>
<div class="cols">${commentBlocks}</div>
</section>
</body></html>`;

if (opt.html) fs.writeFileSync(opt.html, html);
const footer = `<div style="width:100%;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;font-size:7.5pt;color:#5d6f78;padding:0 13mm;display:flex;justify-content:space-between;"><span>${esc(sem.report_name || sem.subtitle_en || '')} · ${kind} · ${A.responses} of ${invited ?? '?'} answered · data as of ${esc(asOf)}</span><span>Israeli Dairy School · page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage();
await p.setContent(html, { waitUntil: 'load' });
await p.pdf({ path: outPdf, format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer, margin: { top: '13mm', bottom: '16mm', left: '13mm', right: '13mm' } });
await b.close();
console.log(`${kind}: ${A.responses} of ${invited} answered · overall ${A.overall?.score} (${A.overall?.pct}%) · recommend ${A.recommend?.score} (${A.recommend?.pct}%) · program ${A.program?.score} (${A.program?.pct}%) · ${A.below80} below ${HIGHLIGHT_BELOW}% · ${nComments} comments + ${nOpen} open answers · ${untranslated} untranslated · as of ${asOf}`);
console.log('pdf written:', outPdf, fs.statSync(outPdf).size, 'bytes');
