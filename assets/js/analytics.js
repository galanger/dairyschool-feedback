// Pure analysis of seminar feedback. No DOM, no network: the results page and
// the Node tests both import this file.
//
// Conventions kept from the school's paper reports:
//   score   = mean of the 1–7 ratings given (didn't take part / blank excluded)
//   score % = exact mean ÷ 7, rounded to a whole percent
//   an item is highlighted when its displayed % is below 80
// Everyone in a group is asked, so these are counts of a whole group, not a sample:
// small-group caution is shown as "how much one person can move the score".

export const SCALE_MAX = 7;
export const HIGHLIGHT_BELOW = 80; // percent, compared with the displayed (rounded) value
export const JUST_BELOW = 75;      // 75–79%: "just below", often one person away from 80
export const MIN_N = 5;            // fewer ratings than this: marked "few answers"
export const LOW_MAX = 3;          // ratings 1..3 count as low
export const TOP_MIN = 6;          // ratings 6..7 count as top

export const CATEGORY_LABELS = {
  lecture: 'Lectures',
  farm: 'Farm visits',
  tour: 'Tours',
  partners: 'Partner program',
  guide: 'Guides',
  hotel: 'Hotels',
  food: 'Food',
  other: 'Other',
  overall: 'Overall',
};

// A stored answer is 1..7, 'na' (didn't take part) or null/undefined (blank).
export function isRating(v) {
  return Number.isInteger(v) && v >= 1 && v <= SCALE_MAX;
}

// Mean shown with one decimal, like the paper sheet. A mean just under 7 is
// never shown as "7.0": it gets two decimals (the 2023 sheet shows 6.95).
export function formatScore(sum, n) {
  if (!n) return '–';
  const tenths = Math.round((sum * 10) / n);
  if (tenths >= SCALE_MAX * 10 && sum < SCALE_MAX * n) {
    return (Math.floor((sum * 100) / n) / 100).toFixed(2);
  }
  return (tenths / 10).toFixed(1);
}

// Whole percent of the exact mean. Never 100 unless every rating is 7.
export function scorePercent(sum, n) {
  if (!n) return null;
  const pct = Math.round((sum * 100) / (SCALE_MAX * n));
  if (pct >= 100 && sum < SCALE_MAX * n) return 99;
  return pct;
}

// How far one person changing their rating (1 ↔ 7) can move the score.
export function onePersonEffect(n) {
  if (!n) return null;
  return { score: (SCALE_MAX - 1) / n, points: Math.round((100 * (SCALE_MAX - 1)) / (SCALE_MAX * n)) };
}

function median(sorted) {
  if (!sorted.length) return null;
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

export function itemStats(values) {
  const dist = new Array(SCALE_MAX).fill(0);
  let sum = 0, n = 0, na = 0, blank = 0;
  const ratings = [];
  for (const v of values) {
    if (isRating(v)) { dist[v - 1]++; sum += v; n++; ratings.push(v); }
    else if (v === 'na') na++;
    else blank++;
  }
  ratings.sort((a, b) => a - b);
  const mean = n ? sum / n : null;
  const low = dist.slice(0, LOW_MAX).reduce((a, b) => a + b, 0);
  const top2 = dist.slice(TOP_MIN - 1).reduce((a, b) => a + b, 0);
  const pct = scorePercent(sum, n);
  return {
    n, na, blank, sum, mean, dist, low, top2,
    median: median(ratings),
    score: formatScore(sum, n),
    pct,
    effect: onePersonEffect(n),
    fewAnswers: n > 0 && n < MIN_N,
    // Same rule as the paper sheets: below 80%, whatever the number of answers.
    highlight: pct !== null && pct < HIGHLIGHT_BELOW,
    justBelow: pct !== null && n >= MIN_N && pct >= JUST_BELOW && pct < HIGHLIGHT_BELOW,
    // Opinions split: a real group rated it low AND a real group rated it top.
    split: n >= MIN_N && low >= Math.max(2, Math.ceil(n * 0.2)) && top2 >= Math.ceil(n * 0.4),
  };
}

// Average of item means (every item weighs the same), shown the same way.
function averageOfItems(items) {
  const withData = items.filter((it) => it.n > 0);
  if (!withData.length) return null;
  const sum = withData.reduce((a, it) => a + it.mean, 0);
  const k = withData.length;
  return { mean: sum / k, items: k, score: formatScore(sum, k), pct: scorePercent(sum, k) };
}

function label(item, lang = 'en') {
  if (typeof item.label === 'string') return item.label;
  return item.label?.[lang] ?? item.label?.en ?? item.id;
}

export function isStraightLine(response, items) {
  const rated = items
    .filter((it) => !it.key)
    .map((it) => response.answers?.[it.id])
    .filter(isRating);
  return rated.length >= 10 && rated.every((r) => r === rated[0]);
}

// seminar: { items:[{id,no,label,category,key?,optional?}], openQuestions:[{id,label}], invited? }
// responses: [{ answers:{itemId: 1..7|'na'|null}, comments:{itemId:text}, open:{qId:text} }]
export function analyze(seminar, responses, opts = {}) {
  const lang = opts.lang || 'en';
  const items = seminar.items.map((it) => {
    const stats = itemStats(responses.map((r) => r.answers?.[it.id] ?? null));
    // Each comment keeps its writer's own rating of the item, for context.
    const comments = responses
      .map((r) => ({ text: typeof r.comments?.[it.id] === 'string' ? r.comments[it.id].trim() : '', rating: r.answers?.[it.id] ?? null }))
      .filter((c) => c.text);
    return { id: it.id, no: it.no, label: label(it, lang), category: it.category || 'other',
      key: it.key || null, optional: !!it.optional, comments, ...stats };
  });

  const byKey = (k) => items.find((it) => it.key === k) || null;
  const programItems = items.filter((it) => !it.key);

  const categoryOrder = Object.keys(CATEGORY_LABELS).filter((c) => c !== 'overall');
  const categories = categoryOrder
    .map((c) => {
      const inCat = programItems.filter((it) => it.category === c);
      if (!inCat.length) return null;
      const avg = averageOfItems(inCat);
      return avg && { category: c, label: CATEGORY_LABELS[c], count: inCat.length,
        itemMeans: inCat.filter((it) => it.n).map((it) => ({ id: it.id, label: it.label, mean: it.mean, score: it.score, pct: it.pct })), ...avg };
    })
    .filter(Boolean);

  const openAnswers = (seminar.openQuestions || []).map((q) => ({
    id: q.id,
    label: label(q, lang),
    answers: responses
      .map((r) => r.open?.[q.id])
      .filter((t) => typeof t === 'string' && t.trim())
      .map((t) => t.trim()),
  }));

  const sumBy = (list, f) => list.reduce((a, it) => a + f(it), 0);
  const quality = {
    straightLiners: responses.filter((r) => isStraightLine(r, seminar.items)).length,
    blanksMain: sumBy(items.filter((it) => !it.optional), (it) => it.blank),
    blanksOptional: sumBy(items.filter((it) => it.optional), (it) => it.blank),
    itemComments: sumBy(items, (it) => it.comments.length),
    openComments: sumBy(openAnswers, (q) => q.answers.length),
  };

  const result = {
    responses: responses.length,
    invited: seminar.invited ?? null,
    responseRate: seminar.invited ? responses.length / seminar.invited : null,
    items,
    overall: byKey('overall'),
    recommend: byKey('recommend'),
    program: averageOfItems(programItems),
    below80: programItems.filter((it) => it.highlight).length,
    programCount: programItems.filter((it) => it.n).length,
    categories,
    openAnswers,
    quality,
  };
  result.summary = summarize(result);
  return result;
}

// Plain, rule-based observations, grouped for the page. Every entry carries its evidence.
export function summarize(r) {
  const program = r.items.filter((it) => !it.key && it.n > 0);

  const attention = program.filter((it) => it.highlight).sort((a, b) => a.mean - b.mean);

  const enough = Math.max(MIN_N, Math.ceil(r.responses / 2));
  const strengths = program
    .filter((it) => it.pct >= 90 && it.n >= enough)
    .sort((a, b) => b.mean - a.mean || b.n - a.n)
    .slice(0, 3);

  // Split items that are not already listed under attention.
  const split = program.filter((it) => it.split && !it.highlight);

  let areas = null;
  if (r.categories.length >= 2) {
    const sorted = [...r.categories].sort((a, b) => b.mean - a.mean);
    const best = sorted[0], worst = sorted[sorted.length - 1];
    if (best.mean - worst.mean >= 0.3) {
      // Name the item that drags the weakest area down, if one clearly does.
      const lows = [...worst.itemMeans].sort((a, b) => a.mean - b.mean);
      let driver = null;
      if (lows.length >= 2) {
        const rest = lows.slice(1).reduce((a, x) => a + x.mean, 0) / (lows.length - 1);
        if (rest - lows[0].mean >= 0.5) driver = lows[0];
      }
      areas = { best, worst, driver };
    }
  }

  // Main-program items many people skipped (optional partner items are expected to be skipped).
  const participation = r.responses >= MIN_N
    ? r.items.filter((it) => !it.key && !it.optional && it.n < r.responses * 0.6)
    : [];

  return { attention, strengths, split, areas, participation };
}

// One CSV row per response (anonymous). Ratings: 1–7, "NA" = didn't take part, empty = blank.
export function toCSV(seminar, responses, lang = 'en') {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    // Neutralise spreadsheet formulas and quote when needed.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const items = seminar.items;
  const qs = seminar.openQuestions || [];
  const head = ['response', ...items.map((it) => `${it.no}. ${label(it, lang)}`),
    ...items.map((it) => `Comment ${it.no}`), ...qs.map((q) => label(q, lang))];
  const rows = responses.map((r, i) => [
    i + 1,
    ...items.map((it) => { const v = r.answers?.[it.id]; return v === 'na' ? 'NA' : isRating(v) ? v : ''; }),
    ...items.map((it) => r.comments?.[it.id] || ''),
    ...qs.map((q) => r.open?.[q.id] || ''),
  ]);
  return [head, ...rows].map((row) => row.map(esc).join(',')).join('\r\n');
}
