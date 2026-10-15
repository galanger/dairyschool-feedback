// Independent check of a built report
// (usage: node tools/verify-report.mjs <export.json> <seminar id> <translations.json> <report.html> <report.pdf> [--names <names.csv>]).
// Recomputes every number from the raw export without analytics.js and compares it with the PDF text (pdftotext), checks every
// comment badge and translation in the HTML against the data, the lists and quotes, the footer on every page, the title, and
// that no participant name appears anywhere. Names come from the Names tab, or from --names (the private names CSV) once the
// close has emptied that tab. Needs poppler (pdftotext, pdfinfo). Exit code 1 when any check fails.
import fs from 'node:fs'; import { execFileSync } from 'node:child_process';
const argv = process.argv.slice(2); const ni = argv.indexOf('--names'); const namesCsv = ni >= 0 ? argv.splice(ni, 2)[1] : null;
const [exportFile, id, trFile, htmlFile, pdfFile] = argv;
if (!exportFile || !id || !trFile || !htmlFile || !pdfFile) { console.error('usage: node tools/verify-report.mjs <export.json> <seminar id> <translations.json> <report.html> <report.pdf> [--names <names.csv>]'); process.exit(2); }
const X = JSON.parse(fs.readFileSync(exportFile, 'utf8')); const T = JSON.parse(fs.readFileSync(trFile, 'utf8'));
const html = fs.readFileSync(htmlFile, 'utf8');
const pageText = (n) => execFileSync('pdftotext', ['-layout', '-f', String(n), '-l', String(n), pdfFile, '-']).toString();
const info = execFileSync('pdfinfo', [pdfFile]).toString();
const pages = Number(/Pages:\s+(\d+)/.exec(info)[1]);
const txt = Array.from({ length: pages }, (_, i) => pageText(i + 1));
const all = txt.join('\n'); const norm = (s) => s.replace(/\s+/g, ' ').trim();
let fails = 0, checks = 0;
const ok = (cond, what) => { checks++; if (!cond) { fails++; console.log('FAIL', what); } };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

const tab = (n) => X.tabs[`${id} · ${n}`] || [];
const semRows = X.tabs.Seminars || []; const semRow = semRows.slice(1).find((r) => String(r[0]) === id) || [];
const sem = Object.fromEntries((semRows[0] || []).map((k, i) => [k, String(semRow[i] ?? '')]));
const closed = sem.status.toLowerCase() === 'closed'; const kind = closed ? 'Final report' : 'Interim report';
const ih = tab('Items')[0]; const items = tab('Items').slice(1).filter((r) => r[1]).map((r) => Object.fromEntries(ih.map((k, i) => [k, String(r[i] ?? '')])));
const head = tab('Answers')[0]; const rows = tab('Answers').slice(1).filter((r) => r[0]).map((r) => [...r, ...new Array(head.length - r.length).fill('')].map((x) => String(x ?? '')));
const N = rows.length, invited = Number(sem.invited) || (tab('Names').length - 1);
const fmtScore = (sum, n) => { const t = Math.round((sum * 10) / n); return t >= 70 && sum < 7 * n ? (Math.floor((sum * 100) / n) / 100).toFixed(2) : (t / 10).toFixed(1); };
const pctOf = (sum, n) => { const p = Math.round((sum * 100) / (7 * n)); return p >= 100 && sum < 7 * n ? 99 : p; };
const stat = (k) => { const v = rows.map((r) => r[1 + k].trim()); const nums = v.filter((x) => x !== '' && x !== 'NA').map(Number); const na = v.filter((x) => x === 'NA').length;
  const sum = nums.reduce((a, b) => a + b, 0), n = nums.length; const dist = [1, 2, 3, 4, 5, 6, 7].map((s) => nums.filter((x) => x === s).length);
  return { n, na, sum, mean: sum / n, score: fmtScore(sum, n), pct: pctOf(sum, n), top2: nums.filter((x) => x >= 6).length, dist, all7: n > 0 && nums.every((x) => x === 7) }; };
const S = items.map((it, k) => ({ no: k + 1, label: it.label_en, cat: it.category, key: it.key, ...stat(k) }));
const ea = String(X.exportedAt); // the report formats the date with Intl en-GB (so September is "Sept"); do the same here
const asOf = `${new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${ea.slice(0, 10)}T00:00:00Z`))}, ${ea.slice(11, 16)} Israel time`;
const answeredPct = Math.round((100 * N) / invited);
console.log(`${kind}: ${N} responses, ${items.length} items, invited ${invited}, status ${sem.status || '?'}, ${pages} pages`);

// --- page 2 table: one number group per item, in order
const groups = [...txt[1].matchAll(/(\d+)(?:\s+\(\+(\d+) n\/a\))?\s+(\d\.\d{1,2})\s+(\d+)%\s+(\d+)\/(\d+)/g)];
ok(groups.length === S.length, `table rows found: ${groups.length} of ${S.length}`);
S.forEach((s, i) => { const g = groups[i]; if (!g) return;
  ok(+g[1] === s.n && (+g[2] || 0) === s.na && g[3] === s.score && +g[4] === s.pct && +g[5] === s.top2 && +g[6] === s.n, `row ${s.no} ${s.label}: pdf ${g.slice(1).join('|')} vs ${[s.n, s.na, s.score, s.pct, s.top2, s.n].join('|')}`);
  ok(norm(txt[1]).includes(norm(s.label).slice(0, 24)), `row ${s.no} label present`); });
// --- areas
const catLabel = { lecture: 'Lectures', farm: 'Farm visits', tour: 'Tours', guide: 'Guides', hotel: 'Hotels', food: 'Food' };
const cats = Object.entries(catLabel).map(([c, label]) => { const xs = S.filter((s) => !s.key && s.cat === c && s.n); const m = xs.reduce((a, s) => a + s.mean, 0); return { label, k: xs.length, score: fmtScore(m, xs.length), pct: pctOf(m, xs.length), mean: m / xs.length }; }).filter((c) => c.k);
for (const c of cats) { const m = new RegExp(`${esc(c.label)}\\s+(\\d\\.\\d{1,2}) · (\\d+)%`).exec(txt[2]); ok(m && m[1] === c.score && +m[2] === c.pct, `area ${c.label}: ${m && m.slice(1)} vs ${c.score} ${c.pct}`); ok(txt[2].includes(`${c.k} item`), `area ${c.label} item count ${c.k}`); }
ok(all.includes(`By area: ${[...cats].sort((a, b) => b.mean - a.mean).map((c) => `${c.label} ${c.pct}%`).join(', ')}.`), 'by-area sentence order and values');
// --- KPIs and totals
const ov = S.find((s) => s.key === 'overall'), rc = S.find((s) => s.key === 'recommend'); const prog = S.filter((s) => !s.key && s.n);
const pm = prog.reduce((a, s) => a + s.mean, 0); const below = prog.filter((s) => s.pct < 80).length;
const t1 = norm(txt[0]); const seq = (parts) => new RegExp(parts.map(esc).join('.*?')).test(t1);
ok(seq(['Overall satisfaction', 'Would recommend', 'Program average', 'Answered']), 'tile labels in order');
ok(seq([`${ov.score} / 7 ${ov.pct}%`, `${rc.score} / 7 ${rc.pct}%`, `${fmtScore(pm, prog.length)} / 7 ${pctOf(pm, prog.length)}%`, `${N} of ${invited} ${answeredPct}%`]), 'tile values in order (overall, recommend, program, answered)');
const subOf = (s) => (s.dist[6] === s.n ? `every one of the ${s.n} gave 7` : `${s.top2} of ${s.n} gave 6 or 7`);
ok(seq([subOf(ov), subOf(rc), `${prog.length} items · ${below} below 80%`, closed ? 'survey closed' : 'survey still open']), 'tile sub-lines');
ok(t1.includes(closed ? `Survey closed. ${N} of ${invited} participants answered (${answeredPct}%). Data as of ${asOf}.` : `${N} of ${invited} participants have answered (${answeredPct}%) as of ${asOf}`), 'status line with the export time');
ok(txt[0].includes(kind.toUpperCase()) && t1.includes(closed ? 'Survey closed.' : 'The survey is still open'), `wording matches the ${sem.status || 'unknown'} status`);
const total = S.reduce((a, s) => a + s.n, 0), n7 = S.reduce((a, s) => a + s.dist[6], 0), n6 = S.reduce((a, s) => a + s.dist[5], 0), nl = total - n7 - n6;
ok(all.includes(`All ${total} ratings given so far`) && all.includes(`Rated 7: ${n7} (${Math.round((100 * n7) / total)}%)`) && all.includes(`Rated 6: ${n6} (${Math.round((100 * n6) / total)}%)`) && all.includes(`Rated 5 or less: ${nl} (${Math.round((100 * nl) / total)}%)`), 'ratings distribution bar');
ok(t1.includes(`All ${prog.length} program items score between ${Math.min(...prog.map((s) => s.pct))}% and ${Math.max(...prog.map((s) => s.pct))}%`) === (below === 0), 'key point: range (only when nothing is below 80%)');
ok(t1.includes(`${Math.round((100 * (n7 + n6)) / total)}% of the ${total} individual ratings`), 'key point: share of 6–7');
ok(t1.includes(`With ${N} answers, one person changing a rating from 7 to 1 would move an item’s score by ${(6 / N).toFixed(1)} points (${Math.round(600 / (7 * N))}%), so small differences between items mean little${closed ? '' : '; the picture firms up as more people answer'}. Answers are anonymous.`), 'caution line');
// --- perfect and lower lists
const perfect = prog.filter((s) => s.all7); ok(all.includes(`A perfect 7 from everyone on ${perfect.length} of the ${prog.length} program items`) === (perfect.length > 0), `perfect count ${perfect.length}`);
for (const s of perfect) ok(norm(txt[2]).includes(norm(`${s.no}. ${s.label}`).slice(0, 30)), `perfect list has ${s.no}`);
const lower = [...prog].sort((a, b) => a.mean - b.mean || a.pct - b.pct || a.no - b.no).slice(0, 5);
for (const s of lower) { ok(norm(txt[2]).includes(norm(`${s.no}. ${s.label}`).slice(0, 30)), `lower list has ${s.no}`);
  const d = [6, 5, 4, 3, 2, 1, 0].filter((i) => s.dist[i]).map((i) => `${s.dist[i]}× ${i + 1}`).join(', '); ok(norm(txt[2]).includes(`${s.n} answers · ratings given: ${d}`), `lower ${s.no} distribution "${d}"`); }
// --- comments: badges + translations (HTML), counts (PDF)
const expected = []; const openQ = head.slice(1 + items.length * 2).filter((h) => h && h !== 'Sent (Israel time)'); const openExp = openQ.map(() => []);
rows.forEach((r) => { items.forEach((it, k) => { const c = r[1 + items.length + k].trim(); if (c) { const v = r[1 + k].trim(); expected.push(`${k + 1}|${v === 'NA' ? 'n/a' : v === '' ? '–' : String(Number(v))}|${T[c] || `(untranslated) ${c}`}`); } });
  openQ.forEach((q, i) => { const t = r[1 + items.length * 2 + i].trim(); if (t) openExp[i].push(T[t] || `(untranslated) ${t}`); }); });
const unesc = (s) => s.replace(/<br>/g, '\n').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
const got = []; for (const g of html.matchAll(/<div class="cg"><h4>(\d+)\. [\s\S]*?<ul>([\s\S]*?)<\/ul><\/div>/g)) for (const li of g[2].matchAll(/<span class="rb[^"]*">([^<]*)<\/span><span>([\s\S]*?)<\/span><\/li>/g)) got.push(`${g[1]}|${li[1]}|${unesc(li[2])}`);
ok(got.length === expected.length && JSON.stringify(got.sort()) === JSON.stringify(expected.sort()), `comment badges+texts: ${got.length} in html vs ${expected.length} expected`);
const openGot = [...html.matchAll(/<section class="openq">[\s\S]*?<ul class="ans">([\s\S]*?)<\/ul>/g)].map((m) => [...m[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => unesc(x[1])));
ok(openGot.length === openQ.length && JSON.stringify(openGot.map((l) => l.sort())) === JSON.stringify(openExp.map((l) => l.sort())), `open answers: ${openGot.map((l) => l.length)} vs ${openExp.map((l) => l.length)}`);
ok(all.includes(`${expected.length} comments`) && all.includes(`${openExp.reduce((a, l) => a + l.length, 0)} answers`), 'comment and open-answer counts in headings');
const origs = new Set([...rows.flatMap((r) => r.slice(1 + items.length, 1 + items.length * 2 + openQ.length))].map((t) => t.trim()).filter(Boolean));
ok([...origs].every((t) => T[t] && T[t].trim() && T[t] !== t), `every original has a distinct translation (${origs.size})`);
ok(!/undefined|NaN|\[object|not translated|&amp;|&quot;/.test(all), 'no stray tokens in the PDF text');
ok(!/[Ѐ-ӿ]/.test(all), 'no Cyrillic left in the PDF (all translated)');
// --- footer on every page, title
for (let i = 1; i <= pages; i++) ok(txt[i - 1].includes(`page ${i} of ${pages}`) && txt[i - 1].includes(`${N} of ${invited} answered`) && txt[i - 1].includes(kind) && txt[i - 1].includes(`data as of ${asOf}`), `footer on page ${i}`);
ok(new RegExp(`Title:\\s+${esc(`${sem.report_name || sem.title_en || ''} · ${kind}`)}\\s*$`, 'm').test(info), `pdf title "${sem.report_name || sem.title_en} · ${kind}"`);
// --- no participant names (Names tab, or --names once the close has emptied the tab)
const nameRows = (() => { const t = tab('Names'); if (t.length > 1) return t.slice(1).map((r) => Object.fromEntries(t[0].map((k, i) => [k, String(r[i] ?? '').trim()])));
  if (!namesCsv) return []; const [h, ...rs] = fs.readFileSync(namesCsv, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split(',').map((x) => x.trim().replace(/^"|"$/g, ''))); return rs.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] || '']))); })();
const body = all + '\n' + html; const word = (w) => new RegExp(`(?<!\\p{L})${esc(w)}(?!\\p{L})`, 'iu');
const hits = []; for (const n of nameRows) { for (const k of ['surname', 'surname_cyr']) if (n[k] && word(n[k]).test(body)) hits.push(n[k]);
  for (const full of [`${n.given} ${n.surname}`, `${n.surname} ${n.given}`, `${n.given_cyr} ${n.surname_cyr}`, `${n.surname_cyr} ${n.given_cyr}`]) if (full.trim().length > 1 && body.includes(full)) hits.push(full); }
ok(nameRows.length > 0, 'participant names available for the name check (Names tab, or pass --names <csv> after the close)');
ok(!hits.length, `no participant names anywhere: ${hits.join(', ')}`);
console.log(`${checks - fails} of ${checks} checks passed${fails ? ` · ${fails} FAILED` : ''} · ${pages} pages`);
process.exit(fails ? 1 : 0);
