import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  formatScore, scorePercent, itemStats, analyze, toCSV, isStraightLine, onePersonEffect,
} from '../site/assets/js/analytics.js';

test('score keeps one decimal, rounding half up', () => {
  assert.equal(formatScore(121, 20), '6.1'); // 6.05
  assert.equal(formatScore(82, 20), '4.1');
  assert.equal(formatScore(140, 20), '7.0');
  assert.equal(formatScore(0, 0), '–');
});

test('a mean just under 7 is never shown as 7.0 or 100%', () => {
  assert.equal(formatScore(139, 20), '6.95'); // like the 2023 sheet's 6.95
  assert.equal(scorePercent(139, 20), 99);
  assert.equal(formatScore(209, 30), '6.96');
  assert.equal(scorePercent(140, 20), 100);
});

test('percent is the exact mean divided by 7', () => {
  assert.equal(scorePercent(118, 20), 84); // 5.9 → 84%, as on the 2023 sheet
  assert.equal(scorePercent(112, 20), 80); // exactly 5.6 → 80%
  assert.equal(scorePercent(111, 20), 79); // 5.55 → 79.3%
  assert.equal(scorePercent(0, 0), null);
});

test('item stats count ratings, "didn\'t take part" and blanks separately', () => {
  const s = itemStats([7, 7, 'na', null, 5, 1, undefined]);
  assert.equal(s.n, 4);
  assert.equal(s.na, 1);
  assert.equal(s.blank, 2);
  assert.deepEqual(s.dist, [1, 0, 0, 0, 1, 0, 2]);
  assert.equal(s.low, 1);
  assert.equal(s.top2, 2);
  assert.equal(s.score, '5.0');
  assert.equal(s.pct, 71);
  assert.equal(s.fewAnswers, true);
  assert.equal(s.highlight, true, 'highlighted below 80% whatever n, like the paper sheet');
});

test('highlight and "just below" use the displayed percent', () => {
  const at79 = itemStats([6, 6, 5, 5, 6, 6, 5, 5, 6, 6, 5, 5, 6, 6, 5, 5, 6, 6, 5, 5]); // 5.5
  assert.equal(at79.pct, 79);
  assert.equal(at79.highlight, true);
  assert.equal(at79.justBelow, true);
  const ok = itemStats([6, 6, 6, 5, 5]); // 5.6 → 80%
  assert.equal(ok.pct, 80);
  assert.equal(ok.highlight, false);
  assert.equal(itemStats([1, 2, 3, 4, 5]).justBelow, false);
});

test('split opinions: a real low group and a real top group', () => {
  // 2023 "Lectures by Eyal Frank": 6 gave 2–3, 8 gave 6–7, none gave 4
  const eyal = itemStats([2, 2, 2, 3, 3, 3, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7]);
  assert.equal(eyal.split, true);
  assert.equal(itemStats([5, 5, 6, 6, 5, 6, 5, 6, 5, 6]).split, false, 'agreement is not a split');
  assert.equal(itemStats([1, 7, 7]).split, false, 'too few answers to call it');
});

test('one person can move a score by 6/n points of the scale', () => {
  assert.deepEqual(onePersonEffect(21), { score: 6 / 21, points: 4 });
  assert.deepEqual(onePersonEffect(6), { score: 1, points: 14 });
  assert.equal(onePersonEffect(0), null);
});

test('ignores junk values', () => {
  const s = itemStats([0, 8, 3.5, '7', 'x', 7]);
  assert.equal(s.n, 1);
  assert.equal(s.blank, 5);
});

const seminar = {
  invited: 6,
  items: [
    { id: 'a', no: 1, label: 'Farm visit', category: 'farm' },
    { id: 'b', no: 2, label: 'Lecture', category: 'lecture' },
    { id: 'c', no: 3, label: 'Ladies tour', category: 'partners', optional: true },
    { id: 'r', no: 4, label: 'Recommend', category: 'overall', key: 'recommend' },
    { id: 'o', no: 5, label: 'Overall', category: 'overall', key: 'overall' },
  ],
  openQuestions: [{ id: 'q1', label: 'Most valuable' }],
};
const R = (a, b, c, r, o, extra = {}) => ({ answers: { a, b, c, r, o }, ...extra });
const responses = [
  R(2, 7, 'na', 7, 6, { comments: { a: 'More cow management' } }),
  R(3, 7, null, 6, 6),
  R(4, 6, 7, 7, 7, { open: { q1: 'The lectures' } }),
  R(4, 7, 'na', 6, 6),
  R(5, 6, 'na', 7, 7, { comments: { a: '  ' } }),
];

test('analyze builds items, areas, headline and quality', () => {
  const r = analyze(seminar, responses);
  assert.equal(r.responses, 5);
  assert.equal(r.responseRate, 5 / 6);
  const farm = r.items.find((i) => i.id === 'a');
  assert.equal(farm.score, '3.6');
  assert.equal(farm.pct, 51);
  assert.equal(farm.highlight, true);
  assert.equal(farm.low, 2);
  assert.deepEqual(farm.comments, [{ text: 'More cow management', rating: 2 }], 'comment keeps its writer\'s rating');
  assert.equal(r.overall.score, '6.4');
  assert.equal(r.recommend.top2, 5);
  assert.equal(r.program.items, 3, 'program average excludes recommend/overall');
  assert.equal(r.below80, 1);
  assert.deepEqual(r.categories.map((c) => c.category), ['lecture', 'farm', 'partners']);
  assert.equal(r.openAnswers[0].answers[0], 'The lectures');
  assert.equal(r.quality.itemComments, 1);
  assert.equal(r.quality.blanksMain, 0);
  assert.equal(r.quality.blanksOptional, 1);
});

test('summary: needs attention, went well, and no noise from optional items', () => {
  const r = analyze(seminar, responses);
  assert.deepEqual(r.summary.attention.map((i) => i.id), ['a']);
  assert.deepEqual(r.summary.strengths.map((i) => i.id), ['b']);
  assert.deepEqual(r.summary.participation, [], 'optional partner items are expected to be skipped');
});

// The real 2023 forms (private file, present only on the owner's machine).
const PRIVATE = 'private/bovicura-2023-school-reading.json';
test('2023 forms: the summary finds what the paper sheet highlighted, plus the split', { skip: !existsSync(PRIVATE) }, () => {
  const resp = JSON.parse(readFileSync(PRIVATE, 'utf8'));
  const cats = ['tour', 'lecture', 'tour', 'farm', 'farm', 'partners', 'tour', 'tour', 'lecture', 'partners', 'farm', 'partners', 'tour', 'tour', 'tour', 'tour', 'guide', 'guide', 'hotel', 'food', 'food', 'hotel', 'food', 'overall', 'overall'];
  const items = cats.map((c, i) => ({ id: `i${String(i + 1).padStart(2, '0')}`, no: i + 1, label: `#${i + 1}`, category: c,
    optional: [6, 10, 12].includes(i + 1), key: i === 23 ? 'recommend' : i === 24 ? 'overall' : undefined }));
  const r = analyze({ items }, resp);
  assert.deepEqual(r.summary.attention.map((i) => i.no), [5, 9, 10, 23], 'the four yellow rows of the 2023 sheet, lowest first');
  assert.equal(r.items[8].split, true, 'Eyal Frank lectures: opinions split');
  assert.equal(r.items[22].justBelow, true, 'hotel food 78%: just below');
  assert.equal(r.summary.areas.worst.label, 'Farm visits');
  assert.equal(r.summary.areas.driver.label, '#5', 'pulled down by the family dairy farm');
  assert.ok(r.summary.strengths.every((i) => i.n >= 11), 'strengths need at least half the group');
});

test('CSV neutralises formulas and quotes text', () => {
  const csv = toCSV(seminar, [
    R(5, 'na', null, 7, 7, { comments: { a: '=HYPERLINK("x")' }, open: { q1: 'good, "very"' } }),
  ]);
  const [head, row] = csv.split('\r\n');
  assert.match(head, /^response,1\. Farm visit/);
  assert.match(row, /^1,5,NA,,7,7,/);
  assert.match(row, /"'=HYPERLINK\(""x""\)"/);
  assert.match(row, /"good, ""very"""/);
});

test('straight-line answers are detected only with 10+ ratings', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `i${i}` }));
  const all7 = { answers: Object.fromEntries(items.map((it) => [it.id, 7])) };
  assert.equal(isStraightLine(all7, items), true);
  const mixed = { answers: { ...all7.answers, i3: 6 } };
  assert.equal(isStraightLine(mixed, items), false);
  const few = { answers: { i0: 7, i1: 7 } };
  assert.equal(isStraightLine(few, items), false);
});
