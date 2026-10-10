// Paper backup of a questionnaire (usage: node tools/paper-questionnaire.mjs <spec.json> <out.pdf>): the same questions as the live survey, Ukrainian first,
// English small, 1–7 boxes + "didn't take part", a comment line each, the two closing questions.
import fs from 'node:fs'; import { chromium } from 'playwright-core';
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const logo = 'data:image/png;base64,' + fs.readFileSync('site/assets/img/logo.png').toString('base64');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pages = []; spec.items.forEach((it, i) => { let p = pages.find((x) => x.en === it.section_en); if (!p) { p = { en: it.section_en, uk: it.section_uk, items: [] }; pages.push(p); } p.items.push({ n: i + 1, ...it }); });
const boxes = (it) => `<div class="scale">${[1,2,3,4,5,6,7].map((n) => `<span class="box">${n}</span>`).join('')}<span class="na"><span class="box sq"></span>Не брали участі <i>· didn’t take part</i></span></div>`;
const anchors = (it) => it.key === 'recommend' ? '1 — не рекомендували б · 7 — дуже рекомендували б' : '1 — зовсім не задоволені · 7 — дуже задоволені';
const item = (it) => `<div class="q"><div class="qh"><span class="no">${it.n}.</span><div><div class="uk">${esc(it.label_uk)}</div><div class="en">${esc(it.label_en)}</div>${it.detail_uk ? `<div class="det">${esc(it.detail_uk)} <i>· ${esc(it.detail_en)}</i></div>` : ''}</div></div>${boxes(it)}<div class="cmt"><span>Коментар · comment:</span></div></div>`;
const html = `<!doctype html><html lang="uk"><head><meta charset="utf-8"><style>
@page { size: A4; margin: 12mm 13mm 14mm; }
body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; font-size: 10.5pt; color: #111; margin: 0; }
header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0e76bb; padding-bottom: 6px; margin-bottom: 8px; }
header img { height: 38px; } header .t { text-align: right; } header .t b { font-size: 13pt; display: block; } header .t span { color: #444; font-size: 9.5pt; }
.intro { font-size: 9.5pt; color: #222; border: 1px solid #cfd8d5; border-radius: 6px; padding: 6px 9px; margin-bottom: 8px; line-height: 1.35; }
.name { display: flex; gap: 10px; align-items: baseline; margin: 6px 0 10px; font-size: 10pt; } .name .line { flex: 1; border-bottom: 1px solid #333; height: 14px; }
h2 { font-size: 11.5pt; margin: 10px 0 4px; padding: 3px 8px; background: #e5f0f8; color: #0a5c93; border-radius: 4px; break-after: avoid; } h2 i { font-weight: 400; color: #44565f; font-style: normal; font-size: 9.5pt; }
.q { break-inside: avoid; border-bottom: 1px solid #e3e8e6; padding: 4px 0 5px; }
.qh { display: flex; gap: 6px; } .no { font-weight: 700; min-width: 20px; }
.uk { font-weight: 700; } .en { color: #555; font-size: 9pt; } .det { color: #444; font-size: 9pt; } .det i { color: #777; font-style: normal; }
.scale { display: flex; align-items: center; gap: 5px; margin: 4px 0 2px 26px; font-size: 9.5pt; }
.box { display: inline-flex; width: 18px; height: 18px; border: 1px solid #333; border-radius: 3px; align-items: center; justify-content: center; font-size: 9.5pt; }
.na { display: inline-flex; align-items: center; gap: 5px; margin-left: 10px; color: #333; } .na i { color: #777; font-style: normal; } .sq { width: 14px; height: 14px; }
.cmt { display: flex; align-items: baseline; gap: 6px; margin: 2px 0 0 26px; font-size: 8.5pt; color: #666; } .cmt::after { content: ""; flex: 1; border-bottom: 1px dotted #888; height: 10px; }
.anch { margin: 0 0 2px 26px; font-size: 8.5pt; color: #666; }
.open { break-inside: avoid; margin-top: 8px; } .open .uk { font-size: 11pt; } .lines { margin-top: 4px; } .lines div { border-bottom: 1px solid #999; height: 22px; }
footer { margin-top: 10px; font-size: 9pt; color: #555; text-align: center; }
</style></head><body>
<header><img src="${logo}" alt=""><div class="t"><b>${esc(spec.seminar.title_uk)}</b><span>${esc(spec.seminar.title_en)} · ${esc(spec.seminar.subtitle_en)} · 4–11 жовтня 2026 · 4–11 October 2026</span></div></header>
<div class="intro"><b>Відгук про семінар.</b> Оцініть, будь ласка, кожну частину семінару від 1 до 7 і позначте одну клітинку (1 — зовсім не задоволені, 7 — дуже задоволені). Якщо ви не брали участі — позначте «Не брали участі». Коментарі вітаються. Відповіді зберігаються без вашого імені. Два останні запитання — обов’язкові.<br><i style="color:#555">Seminar feedback. Please rate each part from 1 to 7 and tick one box (1 = not satisfied at all, 7 = very satisfied). If you didn’t take part, tick “didn’t take part”. Comments are welcome. Answers are kept without your name. The last two questions are required.</i></div>
<div class="name"><span>Ім’я (необов’язково) · Name (optional):</span><span class="line"></span></div>
${pages.map((p) => `<h2>${esc(p.uk)} <i>· ${esc(p.en)}</i></h2>${p.items.map((it) => (it.key ? `<div class="q"><div class="qh"><span class="no">${it.n}.</span><div><div class="uk">${esc(it.label_uk)}</div><div class="en">${esc(it.label_en)}</div></div></div><div class="anch">${anchors(it)}</div>${boxes(it).replace(/<span class="na">.*<\/span><\/div>$/, '</div>')}<div class="cmt"><span>Коментар · comment:</span></div></div>` : item(it))).join('')}`).join('')}
<h2>Останні запитання <i>· Last questions (required)</i></h2>
<div class="open"><div class="uk">Що було для вас найціннішим на семінарі?</div><div class="en">What was the most valuable part of the seminar for you?</div><div class="lines"><div></div><div></div><div></div></div></div>
<div class="open"><div class="uk">Що ми могли б зробити краще?</div><div class="en">What could we do better?</div><div class="lines"><div></div><div></div><div></div></div></div>
<footer>Дякуємо! · Thank you! &nbsp;·&nbsp; Israeli Dairy School · Alon Hagalil 17920 Israel · info@dairyschool.co.il · www.dairyschool.co.il</footer>
</body></html>`;
(async () => {
  const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage();
  await p.setContent(html, { waitUntil: 'load' });
  const out = process.argv[3];
  await p.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await b.close(); console.log('pdf written:', out, fs.statSync(out).size, 'bytes');
})();
