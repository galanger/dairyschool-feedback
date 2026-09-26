// A closed sample seminar with invented answers, so the staff page can show what results look
// like before any real seminar has run. Nothing here comes from a real person or a real seminar.
import { DEMO_SEMINAR } from './demo-data.js';

const N = 18; // responses, of 20 invited

// Typical rating per item and how much people disagree; a few items are deliberately weak,
// one is split, the optional "for the ladies" items are rated by a few people only.
const PROFILE = {
  i01: [6.3, 0.6], i02: [6.6, 0.5], i03: [6.1, 0.8], i04: [5.9, 0.9], i05: [4.3, 1.2], i06: [6.4, 0.6],
  i07: [5.8, 0.9], i08: [6.2, 0.7], i09: null /* split, set by hand */, i10: [6.0, 0.8], i11: [6.5, 0.6], i12: [6.3, 0.7],
  i13: [5.7, 0.9], i14: [6.6, 0.5], i15: [6.7, 0.5], i16: [6.4, 0.7], i17: [6.8, 0.4], i18: [6.2, 0.8],
  i19: [6.0, 0.8], i20: [6.1, 0.8], i21: [5.5, 0.8], i22: [5.9, 0.9], i23: [5.3, 0.9], i24: [6.6, 0.6], i25: [6.4, 0.6],
};
const SPLIT_I09 = [2, 3, 2, 3, 7, 6, 7, 7, 6, 7, 3, 7, 6, 7, 2, 6, 7, 6];
// Who rated the optional items (indexes of responses); everyone else "didn't take part" or left it blank.
const OPTIONAL_RATERS = { i06: [1, 4, 9, 13], i10: [1, 4, 6, 9, 13, 16], i12: [1, 4, 6, 9, 11, 13, 16] };
const OPTIONAL_BLANK = { i06: [3, 7], i10: [3], i12: [7] };
const MAIN_BLANKS = [[5, 'i13'], [12, 'i22']]; // two people skipped one main item each

// Comments in Ukrainian, with the English the backend would add at close. [item, response index, text, english]
const COMMENTS = [
  ['i01', 0, 'Чудовий початок семінару, дуже гостинно.', 'A great start to the seminar, very hospitable.'],
  ['i02', 2, 'Лекції були змістовні та практичні.', 'The lectures were substantive and practical.'],
  ['i02', 10, 'Хотілося б більше прикладів з наших умов.', 'We would like more examples from our own conditions.'],
  ['i05', 3, 'Замало часу на фермі, не побачили доїльної зали.', 'Too little time on the farm, we did not see the milking parlour.'],
  ['i05', 8, 'Ферма цікава, але екскурсія була дуже короткою.', 'An interesting farm, but the tour was very short.'],
  ['i05', 14, 'Не вистачило пояснень щодо годівлі.', 'Not enough explanation about feeding.'],
  ['i09', 0, 'Занадто швидко, важко було встигати за перекладом.', 'Too fast, it was hard to keep up with the translation.'],
  ['i09', 4, 'Найкращі лекції семінару!', 'The best lectures of the seminar!'],
  ['i09', 10, 'Багато цифр, мало часу на запитання.', 'Lots of numbers, little time for questions.'],
  ['i11', 6, 'Практика на фермах — найцінніше.', 'The practice on the farms was the most valuable part.'],
  ['i14', 9, 'Незабутньо.', 'Unforgettable.'],
  ['i15', 12, 'Класно!', 'Great!'],
  ['i17', 1, 'Дуже уважний гід, усе пояснював.', 'A very attentive guide, explained everything.'],
  ['i19', 7, 'Зручний готель, тихо.', 'A comfortable hotel, quiet.'],
  ['i21', 5, 'Довго чекали на страви.', 'We waited a long time for the food.'],
  ['i21', 15, 'Смачно, але дорого для групи.', 'Tasty, but expensive for a group.'],
  ['i22', 11, 'Номери потребують ремонту.', 'The rooms need renovation.'],
  ['i23', 2, 'Сніданки одноманітні.', 'The breakfasts were monotonous.'],
  ['i23', 16, 'Мало овочів на вечерю.', 'Few vegetables at dinner.'],
  ['i25', 13, 'Дякуємо за організацію!', 'Thank you for the organisation!'],
];
const Q1 = [ // what was most valuable
  ['Візити на ферми та спілкування з фермерами.', 'The farm visits and talking with the farmers.'],
  ['Лекції про годівлю та відтворення.', 'The lectures on feeding and reproduction.'],
  ['Побачити, як працює кормовий центр.', 'Seeing how the feed centre works.'],
  ['Практичні приклади з ізраїльських ферм.', 'Practical examples from Israeli farms.'],
  ['Обмін досвідом у групі.', 'The exchange of experience within the group.'],
  ['Показники ферм і як їх досягають.', 'The farm figures and how they are achieved.'],
  ['Уся програма, особливо ферми.', 'The whole programme, especially the farms.'],
  ['Розмова з керівником ферми про менеджмент стада.', 'The talk with the farm manager about herd management.'],
  ['Лекції Еяля Франка.', 'Eyal Frank’s lectures.'],
  ['Організація і гід.', 'The organisation and the guide.'],
  ['Кормовий центр і сімейна ферма.', 'The feed centre and the family farm.'],
  ['Нові знайомства.', 'New contacts.'],
];
const Q2 = [ // what could we do better
  ['Більше часу на фермах, менше в автобусі.', 'More time on the farms, less on the bus.'],
  ['Дати матеріали лекцій заздалегідь.', 'Send the lecture materials in advance.'],
  ['Покращити харчування в готелі в Єрусалимі.', 'Improve the food at the hotel in Jerusalem.'],
  ['Додати візит до племінного центру.', 'Add a visit to a breeding centre.'],
  ['Більше часу на запитання після лекцій.', 'More time for questions after the lectures.'],
  ['Показати доїльну залу в роботі.', 'Show a milking parlour in operation.'],
  ['Менше екскурсій, більше ферм.', 'Fewer sightseeing tours, more farms.'],
  ['Усе добре, нічого міняти.', 'Everything was good, nothing to change.'],
  ['Довший семінар.', 'A longer seminar.'],
  ['Переклад лекцій повільніше.', 'Slower translation of the lectures.'],
];

// Small deterministic generator, so the demo looks the same on every phone.
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export function buildDemoResults() {
  const rnd = rng(2026);
  const responses = [];
  for (let i = 0; i < N; i++) {
    const answers = {}, comments = {}, open = {};
    for (const it of DEMO_SEMINAR.items) {
      if (it.optional) {
        if (OPTIONAL_BLANK[it.id]?.includes(i)) continue;
        if (!OPTIONAL_RATERS[it.id]?.includes(i)) { answers[it.id] = 'na'; continue; }
      }
      if (it.id === 'i09') { answers[it.id] = SPLIT_I09[i]; continue; }
      const [mean, spread] = PROFILE[it.id];
      const noise = (rnd() + rnd() + rnd() - 1.5) * 1.6 * spread;
      answers[it.id] = Math.max(1, Math.min(7, Math.round(mean + noise)));
    }
    responses.push({ id: `demo-r${i + 1}`, answers, comments, open });
  }
  // one person gave every item the top mark (the Data tab counts these)
  for (const it of DEMO_SEMINAR.items) if (responses[6].answers[it.id] !== 'na' && it.id in responses[6].answers) responses[6].answers[it.id] = 7;
  for (const [i, id] of MAIN_BLANKS) delete responses[i].answers[id];
  const translations = {};
  for (const [id, i, uk, en] of COMMENTS) { responses[i].comments[id] = uk; translations[uk] = en; }
  Q1.forEach(([uk, en], k) => { responses[k].open.q1 = uk; translations[uk] = en; });
  Q2.forEach(([uk, en], k) => { responses[k + 3].open.q2 = uk; translations[uk] = en; });
  return {
    ...DEMO_SEMINAR,
    id: 'demo-results',
    title: { en: 'Demo results · sample group, March 2026', uk: 'Демо-результати · пробна група, березень 2026' },
    subtitle: { en: 'Invented answers, to show what results look like', uk: 'Вигадані відповіді, щоб показати, як виглядають результати' },
    reportName: { en: 'a sample group' },
    dates: { start: '2026-03-08', end: '2026-03-15' },
    status: 'closed',
    invited: 20,
    names: [],
    used: {},
    responses,
    translations,
  };
}
