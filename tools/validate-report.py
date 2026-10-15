# Second, independent check of a built report, in Python (no code shared with the report or the JavaScript verifier).
# Usage: python3 -I tools/validate-report.py <export.json> <seminar id> <translations.json> <report.html> <report.pdf> [--names <names.csv>]
# Recomputes every figure from the raw export and compares it with the PDF text (pdftotext) and the HTML; checks the lists,
# the quotes, every comment badge and closing answer, the footer on every page, the title and that no participant name appears
# (names from the Names tab, or from --names once the close has emptied that tab). Needs poppler. Exit code 1 on any failure.
import json, re, sys, subprocess, math, html as hm
from collections import Counter
args = sys.argv[1:]
names_csv = None
if '--names' in args:
    i = args.index('--names'); names_csv = args[i + 1]; del args[i:i + 2]
if len(args) != 5:
    print(__doc__ or 'usage: python3 -I tools/validate-report.py <export.json> <seminar id> <translations.json> <report.html> <report.pdf> [--names <names.csv>]'); sys.exit(2)
exp, sid, trf, htmlf, pdff = args
X = json.load(open(exp, encoding='utf-8')); T = json.load(open(trf, encoding='utf-8'))
H = open(htmlf, encoding='utf-8').read()
tab = lambda n: X['tabs'].get(f'{sid} · {n}', [])
def pdftext(page):
    return subprocess.run(['pdftotext', '-layout', '-f', str(page), '-l', str(page), pdff, '-'], capture_output=True, text=True, check=True).stdout
info = subprocess.run(['pdfinfo', pdff], capture_output=True, text=True, check=True).stdout
pages = int(re.search(r'Pages:\s+(\d+)', info).group(1))
P = [pdftext(i + 1) for i in range(pages)]; ALL = '\n'.join(P)
norm = lambda s: re.sub(r'\s+', ' ', s).strip()
u = lambda s: hm.unescape(s)
fails = []; checks = 0
def ok(cond, what):
    global checks
    checks += 1
    if not cond: fails.append(what); print('FAIL', what)
rnd = lambda x: math.floor(x + 0.5)
def fmt_score(s, n):
    t = rnd(s * 10 / n)
    if t >= 70 and s < 7 * n: return f'{math.floor(s * 100 / n) / 100:.2f}'
    return f'{t / 10:.1f}'
def pct_of(s, n):
    p = rnd(100 * s / (7 * n)); return 99 if p >= 100 and s < 7 * n else p

sh = X['tabs'].get('Seminars', [])
sem = next((dict(zip(sh[0], [str(x) for x in r] + [''] * 20)) for r in sh[1:] if r and str(r[0]) == sid), {})
closed = sem.get('status', '').lower() == 'closed'; kind = 'Final report' if closed else 'Interim report'
ih = tab('Items')[0]
items = [dict(zip(ih, [str(x) for x in r] + [''] * (len(ih) - len(r)))) for r in tab('Items')[1:] if len(r) > 1 and r[1]]
head = tab('Answers')[0]
rows = [[str(x) for x in r] + [''] * (len(head) - len(r)) for r in tab('Answers')[1:] if r and str(r[0])]
N, K = len(rows), len(items); invited = int(sem.get('invited') or 0) or (len(tab('Names')) - 1)
S = []
for k, it in enumerate(items):
    vals = [r[1 + k].strip() for r in rows]
    nums = [float(v) for v in vals if v not in ('', 'NA')]
    n, s, na = len(nums), sum(nums), sum(1 for v in vals if v == 'NA')
    dist = Counter(int(v) for v in nums)
    S.append(dict(no=k + 1, label=it['label_en'], cat=it['category'], key=it['key'], n=n, na=na, sum=s, mean=s / n if n else None,
                  score=fmt_score(s, n) if n else None, pct=pct_of(s, n) if n else None, top2=sum(1 for v in nums if v >= 6),
                  dist=dist, all7=n > 0 and all(v == 7 for v in nums)))
blanks = sum(1 for r in rows for k in range(K) if r[1 + k].strip() == '')
MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']; ea = str(X['exportedAt'])  # en-GB short months, as the report prints them
as_of = f"{int(ea[8:10])} {MON[int(ea[5:7]) - 1]} {ea[0:4]}, {ea[11:16]} Israel time"
answered_pct = rnd(100 * N / invited)
print(f'{kind}: {N} responses, {K} items, invited {invited}, status {sem.get("status") or "?"}, blanks {blanks}, n/a {sum(s["na"] for s in S)}, {pages} pages')

# --- page 2 table
groups = re.findall(r'(\d+)(?:\s+\(\+(\d+) n/a\))?\s+(\d\.\d{1,2})\s+(\d+)%\s+(\d+)/(\d+)', P[1])
ok(len(groups) == K, f'table groups found {len(groups)} of {K}')
for s, g in zip(S, groups):
    e = (str(s['n']), str(s['na']) if s['na'] else '', s['score'], str(s['pct']), str(s['top2']), str(s['n']))
    ok(tuple(g) == e, f"row {s['no']}: pdf {g} vs {e}")
t2 = norm(P[1]); pos = 0; order = True
for s in S:
    i = t2.find(norm(s['label'])[:24], pos)
    if i < 0: order = False; print('  label missing or out of order:', s['no'], s['label'])
    else: pos = i
ok(order, 'all item labels present on page 2 in program order')
ok(f'{N} answers · n/a = didn’t take part' in t2, 'page 2 subtitle')

# --- areas
cat_label = {'lecture': 'Lectures', 'farm': 'Farm visits', 'tour': 'Tours', 'guide': 'Guides', 'hotel': 'Hotels', 'food': 'Food'}
areas = []
for c, lab in cat_label.items():
    xs = [s for s in S if not s['key'] and s['cat'] == c and s['n']]
    if not xs: continue
    m = sum(s['mean'] for s in xs)
    areas.append(dict(label=lab, k=len(xs), score=fmt_score(m, len(xs)), pct=pct_of(m, len(xs)), mean=m / len(xs)))
for a in areas:
    mm = re.search(re.escape(a['label']) + r'\s+(\d\.\d{1,2}) · (\d+)%', P[2])
    ok(bool(mm) and mm.group(1) == a['score'] and int(mm.group(2)) == a['pct'], f"area {a['label']}: {mm and mm.groups()} vs {a['score']} {a['pct']}")
    ok(f"{a['k']} item" in P[2], f"area {a['label']} item count {a['k']}")
ok(sum(a['k'] for a in areas) == len([s for s in S if not s['key'] and s['n']]), 'every program item belongs to exactly one area')
t1 = norm(P[0])
ok('By area: ' + ', '.join(f"{a['label']} {a['pct']}%" for a in sorted(areas, key=lambda a: -a['mean'])) + '.' in t1, 'by-area sentence')

# --- tiles, status, bar, key points
ov = next(s for s in S if s['key'] == 'overall'); rc = next(s for s in S if s['key'] == 'recommend')
prog = [s for s in S if not s['key'] and s['n']]
pm = sum(s['mean'] for s in prog); below = sum(1 for s in prog if s['pct'] < 80)
seq = lambda parts: re.search('.*?'.join(re.escape(p) for p in parts), t1) is not None
ok(seq(['Overall satisfaction', 'Would recommend', 'Program average', 'Answered']), 'tile labels in order')
ok(seq([f"{ov['score']} / 7 {ov['pct']}%", f"{rc['score']} / 7 {rc['pct']}%", f"{fmt_score(pm, len(prog))} / 7 {pct_of(pm, len(prog))}%", f"{N} of {invited} {answered_pct}%"]), 'tile values in order')
sub = lambda s: f"every one of the {s['n']} gave 7" if s['dist'][7] == s['n'] else f"{s['top2']} of {s['n']} gave 6 or 7"
ok(seq([sub(ov), sub(rc), f"{len(prog)} items · {below} below 80%", 'survey closed' if closed else 'survey still open']), 'tile sub-lines')
status_line = (f"Survey closed. {N} of {invited} participants answered ({answered_pct}%). Data as of {as_of}." if closed
               else f"{N} of {invited} participants have answered ({answered_pct}%) as of {as_of}")
ok(status_line in t1, 'status line with the export time')
ok(kind.upper() in P[0] and (('Survey closed.' in t1) if closed else ('The survey is still open' in t1)), f'wording matches the {sem.get("status") or "unknown"} status')
ok(sem.get('title_en', '') in t1 and f"{sem.get('subtitle_en', '')} · " in t1, 'title and subtitle')
total = sum(s['n'] for s in S); n7 = sum(s['dist'][7] for s in S); n6 = sum(s['dist'][6] for s in S); nl = total - n7 - n6
ok(total == N * K - sum(s['na'] for s in S) - blanks, 'ratings total = N×K − n/a − blanks')
ok(f"All {total} ratings given so far" in ALL and f"{N} people × {K} questions, minus n/a" in t1, 'bar heading')
ok(all(x in ALL for x in [f"Rated 7: {n7} ({rnd(100 * n7 / total)}%)", f"Rated 6: {n6} ({rnd(100 * n6 / total)}%)", f"Rated 5 or less: {nl} ({rnd(100 * nl / total)}%)"]), 'bar legend')
lo, hi = min(s['pct'] for s in prog), max(s['pct'] for s in prog)
los, his = min(prog, key=lambda s: s['mean'])['score'], max(prog, key=lambda s: s['mean'])['score']
ok((f"All {len(prog)} program items score between {lo}% and {hi}% ({los}–{his} out of 7)" in t1) == (below == 0), 'key point: range (only when nothing is below 80%)')
ok(f"{rnd(100 * (n7 + n6) / total)}% of the {total} individual ratings given so far were a 6 or a 7" in t1, 'key point: share')
ok(f"Overall satisfaction {ov['score']} ({ov['pct']}%), would recommend {rc['score']} ({rc['pct']}%)" in t1, 'key point: overall')
if ov['all7'] and rc['all7']: ok(f"Every one of the {N} who answered gave the top mark, 7, on both." in t1, 'key point: everyone gave 7 on both')
ok(('Nothing is below the 80% line' in t1) == (below == 0), 'below-80 wording')
tail = '' if closed else '; the picture firms up as more people answer'
ok(re.search(rf"With {N} answers, one person changing a rating from 7 to 1 would move an item[’']s score by {6 / N:.1f} points \({rnd(600 / (7 * N))}%\), so small differences between items mean little{re.escape(tail)}\. Answers are anonymous\.", t1) is not None, 'caution line')

# --- perfect and lower lists (page 1 sentence, page 3 html + pdf)
perfect = [s for s in prog if s['all7']]
if perfect:
    ok(f"A perfect 7 from everyone on {len(perfect)} of the {len(prog)} program items: " + '; '.join(s['label'] for s in perfect) + '.' in t1, 'perfect sentence')
t3 = norm(P[2])
ok((f"A perfect 7 from everyone {len(perfect)} of {len(prog)} items" in t3) == bool(perfect), 'perfect heading')
def lst(cls):
    mm = re.search(r'<ul class="' + cls + r'">(.*?)</ul>', H, re.S)
    return re.findall(r'<li>(?:<div class="lt">)?<span class="ln">(.*?)</span><span class="lv[^"]*">(.*?)</span>(?:</div>)?(?:<div class="le">(.*?)</div>)?(?:<div class="lq">(.*?)</div>)?</li>', mm.group(1), re.S) if mm else None
ph = lst('lst') or []
ok([u(x[0]) for x in ph] == [f"{s['no']}. {s['label']}" for s in perfect] and all(x[1] == f"{s['score']} · {s['pct']}%" for x, s in zip(ph, perfect)), 'perfect list (html) items and values')
for s in perfect: ok(norm(f"{s['no']}. {s['label']}")[:30] in t3, f"perfect {s['no']} on page 3")
lower = sorted(prog, key=lambda s: (s['mean'], s['pct'], s['no']))[:5]
ok("Lower end of the scale, still good: " + '; '.join(f"{s['label']} ({s['score']}, {s['pct']}%)" for s in lower) + ". The comments behind the lower marks are on page 3." in t1 if below == 0 else True, 'lower sentence')
def critical(s):
    k = s['no'] - 1
    for r in rows:
        c, v = r[1 + K + k].strip(), r[1 + k].strip()
        if c and v not in ('', 'NA') and float(v) <= 5: return c
    return None
lh = lst('lst low') or []
ok(len(lh) == len(lower), f'lower list (html) has {len(lower)} items')
for x, s in zip(lh, lower):
    dtext = f"{s['n']} answers · ratings given: " + ', '.join(f"{s['dist'][v]}× {v}" for v in (7, 6, 5, 4, 3, 2, 1) if s['dist'][v])
    c = critical(s); q = f'“{T[c]}”' if c and c in T else ''
    ok(u(x[0]) == f"{s['no']}. {s['label']}" and x[1] == f"{s['score']} · {s['pct']}%" and u(x[2]) == dtext and u(x[3]) == q, f"lower {s['no']}: html {[u(y) for y in x]} vs {[s['label'], s['score'], s['pct'], dtext, q]}")
    ok(norm(f"{s['no']}. {s['label']}")[:30] in t3 and dtext in t3 and (not q or norm(q)[:40] in t3), f"lower {s['no']} on page 3 (label, distribution, quote)")
ok(sum(1 for s in lower if critical(s)) == sum(1 for x in lh if x[3]), 'quotes appear exactly for lower items with a ≤5 comment')
ok(all(not s['all7'] for s in lower) and all(s['mean'] >= lower[-1]['mean'] for s in prog if s not in lower), 'lower list is exactly the lowest means')

# --- comments (html) vs data; badge classes; counts; presence in pdf
q_labels = [h for h in head[1 + 2 * K:] if h and h != 'Sent (Israel time)']
expected = Counter()
for r in rows:
    for k in range(K):
        c = r[1 + K + k].strip()
        if c:
            v = r[1 + k].strip(); b = 'n/a' if v == 'NA' else ('–' if v == '' else str(int(float(v))))
            expected[(k + 1, b, T.get(c, '(untranslated) ' + c))] += 1
got = Counter(); cls_pairs = set()
for g in re.finditer(r'<div class="cg"><h4>(\d+)\. (.*?)<small>(.*?)</small></h4><ul>(.*?)</ul></div>', H, re.S):
    s = S[int(g.group(1)) - 1]
    ok(u(g.group(2)).strip() == s['label'] and g.group(3) == f"{s['score']} · {s['pct']}%", f"comment group {g.group(1)} heading")
    for li in re.finditer(r'<span class="rb ?([^"]*)">([^<]*)</span><span>(.*?)</span></li>', g.group(4), re.S):
        got[(int(g.group(1)), li.group(2), u(li.group(3).replace('<br>', '\n')))] += 1; cls_pairs.add((li.group(1), li.group(2)))
ok(got == expected, f'comments html vs data: {sum(got.values())} in html vs {sum(expected.values())} in data')
ok(f"{sum(expected.values())} comments" in ALL, 'comment count heading')
badge_cls = {'n/a': 'none', '–': 'none'}
ok(all(c == badge_cls.get(v, 'top' if v.isdigit() and int(v) >= 6 else 'low' if v.isdigit() and int(v) <= 3 else 'mid') for c, v in cls_pairs), f'badge colours match the ratings: {sorted(cls_pairs)}')
t_comments = norm('\n'.join(P[3:]))
miss = [t for (_, _, t) in expected if norm(t)[:30] not in t_comments]
ok(not miss, f'every comment is in the pdf text: missing {miss[:3]}')

# --- open answers
open_exp = [Counter() for _ in q_labels]
for r in rows:
    for qi in range(len(q_labels)):
        t = r[1 + 2 * K + qi].strip()
        if t: open_exp[qi][T.get(t, '(untranslated) ' + t)] += 1
open_got = [(u(m.group(1)), int(m.group(2)), Counter(u(x.replace('<br>', '\n')) for x in re.findall(r'<li>(.*?)</li>', m.group(3), re.S)))
            for m in re.finditer(r'<section class="openq"><h3>(.*?) <small>(\d+) answers?</small></h3><ul class="ans">(.*?)</ul>', H, re.S)]
ok([g[0] for g in open_got] == q_labels and all(g[2] == e and g[1] == sum(e.values()) for g, e in zip(open_got, open_exp)), f'open answers html vs data: {[g[1] for g in open_got]} vs {[sum(e.values()) for e in open_exp]}')
n_open = sum(sum(e.values()) for e in open_exp)
ok(f"the two closing questions · {n_open} answers" in norm(ALL), 'open answers count heading')
miss = [a for e in open_exp for a in e if norm(a)[:30] not in norm(ALL)]
ok(not miss, f'every open answer is in the pdf: missing {miss[:3]}')

# --- translations, language, stray tokens
origs = {r[c].strip() for r in rows for c in range(1 + K, 1 + 2 * K + len(q_labels)) if r[c].strip()}
ok(all(o in T and T[o].strip() and T[o].strip() != o for o in origs), f'every original text ({len(origs)}) has a distinct translation')
ok(not any(re.search(r'[Ѐ-ӿ]', T[o]) for o in origs if o in T), 'no Cyrillic inside the used translations')
ok(not re.search(r'[Ѐ-ӿ]', ALL + H), 'no Cyrillic in the pdf or html')
ok(not re.search(r'undefined|NaN|\[object|not translated|&amp;|&quot;|&lt;|&gt;', ALL), 'no stray tokens in the pdf text')
ok(not re.search(r'undefined|NaN|\[object|class="untr"', H), 'no stray tokens in the html')

# --- names (surnames whole-word in both scripts, full names), footer, title
names = [dict(zip(tab('Names')[0], [str(x).strip() for x in r] + [''] * 5)) for r in tab('Names')[1:] if r and str(r[0])] if len(tab('Names')) > 1 else []
if not names and names_csv:
    lines = [l for l in open(names_csv, encoding='utf-8').read().splitlines() if l.strip()]
    hdr = [x.strip() for x in lines[0].split(',')]
    names = [dict(zip(hdr, [x.strip().strip('"') for x in l.split(',')] + [''] * 5)) for l in lines[1:]]
ok(bool(names), 'participant names available for the name check (Names tab, or --names <csv> after the close)')
body = ALL + '\n' + H
hits = []
for nm in names:
    for key in ('surname', 'surname_cyr'):
        if nm.get(key) and re.search(r'(?<!\w)' + re.escape(nm[key]) + r'(?!\w)', body, re.I): hits.append(nm[key])
    for full in (f"{nm.get('given', '')} {nm.get('surname', '')}", f"{nm.get('surname', '')} {nm.get('given', '')}", f"{nm.get('given_cyr', '')} {nm.get('surname_cyr', '')}", f"{nm.get('surname_cyr', '')} {nm.get('given_cyr', '')}"):
        if len(full.strip()) > 1 and full in body: hits.append(full)
ok(not hits, f'no participant surnames or full names: {hits}')
given_hits = sorted({nm['given'] for nm in names if nm.get('given') and re.search(r'(?<!\w)' + re.escape(nm['given']) + r'(?!\w)', body)})
if given_hits: print('note: given names appearing as whole words (may be hosts or ordinary words, judge by eye):', given_hits)
for i in range(1, pages + 1):
    ok(f"page {i} of {pages}" in P[i - 1] and f"{N} of {invited} answered" in P[i - 1] and f"data as of {as_of}" in P[i - 1] and kind in P[i - 1], f'footer on page {i}')
title = f"{sem.get('report_name') or sem.get('title_en') or ''} · {kind}"
ok(re.search(r'Title:\s+' + re.escape(title) + r'\s*$', info, re.M) is not None, f'pdf title "{title}"')
ok(re.search(r'Page size:\s+595\.\d+ x 842\.\d+ pts \(A4\)', info) is not None, 'A4 page size')
print(f'{checks - len(fails)} of {checks} checks passed' + (f' · {len(fails)} FAILED' if fails else '') + f' · {pages} pages')
sys.exit(1 if fails else 0)
