/* park_visits: National Park Service recreation visits by month.
   Responses are synthetic, in the real response shape (invented park values; no recorded third-party content). */
const assert = require('assert');
const X = require('../extension/context-data.js');
require('../extension/context-parks.js');
const S = X.REGISTERED.park_visits;

const NOW = new Date('2026-11-17T12:00:00Z');
const F = (url, domain) => ({ url, domain: domain || 'nps.gov', group: 'organization', text: 'page text must never be sent' });
const PAGE = F('https://www.nps.gov/grca/planyourvisit/index.htm');
// a seasonal curve; 2024 and 2025 complete, as the service publishes whole months
const base = [100, 120, 200, 300, 400, 500, 600, 550, 400, 300, 150, 110].map((n) => n * 1000);
const row = (y, m, v, extra) => Object.assign({ Month: m, NonRecreationVisitors: 5, RecreationVisitors: v, UnitCode: 'GRCA', UnitName: 'Example Canyon NP', Year: y }, extra || {});
const rows = (years, f) => [].concat(...years.map((y) => base.map((v, i) => row(y, i + 1, f ? f(y, i + 1, v) : v))));
const ok = (a) => ({ status: 200, text: JSON.stringify(a) });
const fakeIo = (res) => { const calls = []; return { calls, get: async (url, opt) => { calls.push({ url, opt }); return typeof res === 'function' ? res(url) : res; } }; };

(async () => {
  let n = 0;
  // ---- applies / sends: only a park's own pages
  assert.strictEqual(S.basis, 'statistic'); assert.strictEqual(S.scope, 'page');
  for (const u of ['https://www.nps.gov/grca/planyourvisit/index.htm', 'https://www.nps.gov/acad/', 'https://www.nps.gov/ACAD/learn/x.htm', 'https://www.nps.gov/yell'])
    assert.ok(S.applies(F(u)), 'applies: ' + u);
  for (const u of ['https://www.nps.gov/subjects/climatechange/index.htm', 'https://www.nps.gov/orgs/1207/index.htm', 'https://www.nps.gov/aboutus/index.htm', 'https://www.nps.gov/index.htm',
    'https://www.nps.gov/planyourvisit/index.htm', 'https://www.nps.gov/', 'https://www.nps.gov/news/x.htm', 'https://www.nps.gov/kids/', 'https://www.nps.gov/grc/', 'https://www.nps.gov/grcaa/', 'https://www.nps.gov/gr1a/'])
    assert.ok(!S.applies(F(u)), 'does not apply: ' + u);
  assert.ok(!S.applies(F('https://www.example.com/grca/page', 'example.com')), 'four letters on another site');
  assert.ok(!S.applies(F('https://www.nps.gov.example.com/grca/', 'example.com')), 'look-alike host');
  assert.ok(!S.applies({}) && !S.applies(null), 'no facts');
  assert.strictEqual(S.sends(PAGE), "the park's four-letter code (GRCA), taken from this page's address, to the National Park Service's visitor statistics service");
  n += 5;

  // ---- happy path: one request, only the code leaves
  let io = fakeIo(ok(rows([2021, 2022, 2023, 2024, 2025], (y, m, v) => v * (1 + (y - 2021) / 100))));
  let r = await S.run(PAGE, io, NOW);
  assert.strictEqual(io.calls.length, 1, 'one request');
  assert.strictEqual(io.calls[0].url, 'https://irmaservices.nps.gov/v3/rest/stats/visitation?unitCodes=GRCA&startMonth=1&startYear=2021&endMonth=11&endYear=2026');
  assert.strictEqual(io.calls[0].opt.accept, 'application/json');
  assert.ok(!/nps\.gov\/grca|planyourvisit|page|text/i.test(io.calls[0].url), 'no page address or text in the request');
  const c = r.chart;
  assert.strictEqual(c.basis, 'statistic'); assert.strictEqual(c.kind, 'bars'); assert.strictEqual(c.resolution, 'month'); assert.strictEqual(c.unit, 'recreation visits');
  assert.strictEqual(c.about, 'subject'); assert.strictEqual(c.aboutLabel, 'Example Canyon NP'); assert.strictEqual(c.title, 'Recreation visits: Example Canyon NP');
  assert.strictEqual(c.points.length, 60); assert.strictEqual(c.points[0].t, '2021-01'); assert.strictEqual(c.points[59].t, '2025-12');
  assert.strictEqual(c.source.url, 'https://irma.nps.gov/Stats/SSRSReports/Park%20Specific%20Reports/Recreation%20Visitors%20By%20Month%20(1979%20-%20Last%20Calendar%20Year)?Park=GRCA');
  assert.ok(/^Example Canyon NP reported 3,\d{3},\d{3} recreation visits in 2025\. In 2024 it reported 3,\d{3},\d{3}, so 2025 was 1 percent higher\. The busiest month of 2025 was July \([\d,]+\)\. The quietest was January \([\d,]+\)\.$/.test(c.sentence), c.sentence);
  assert.ok(/recreation visit is one entry/.test(c.note) && /Dec 2025/.test(c.note), c.note);
  assert.ok(!/because|due to|\bsurge|\bboom|collapse/i.test(c.sentence), 'observation only');
  assert.deepStrictEqual(r.facts, []);
  n += 6;

  // ---- a missing month stays a gap (null, never 0), and the sentence says so; the year is then not a full year
  io = fakeIo(ok(rows([2021, 2022, 2023, 2024, 2025]).filter((x) => !(x.Year === 2023 && x.Month === 5))));
  r = await S.run(PAGE, io, NOW);
  assert.strictEqual(r.chart.points.find((p) => p.t === '2023-05').v, null, 'absent row is a gap');
  assert.strictEqual(r.chart.points.length, 60);
  assert.ok(/One month has no figure\./.test(r.chart.sentence), r.chart.sentence);
  io = fakeIo(ok(rows([2021, 2022, 2023, 2024, 2025], (y, m, v) => (y === 2025 && m === 3 ? null : v))));
  r = await S.run(PAGE, io, NOW);
  assert.strictEqual(r.chart.points.find((p) => p.t === '2025-03').v, null, 'null stays null');
  assert.ok(/in 2024\./.test(r.chart.sentence) && !/ 2025 was /.test(r.chart.sentence), 'latest complete year is 2024, no comparison with an incomplete year: ' + r.chart.sentence);
  n += 2;

  // ---- months not published yet are missing, not zero: the series ends at the last row
  io = fakeIo(ok(rows([2025]).concat(rows([2024]), rows([2023]), rows([2022]))));
  r = await S.run(PAGE, io, NOW);
  assert.strictEqual(r.chart.points[r.chart.points.length - 1].t, '2025-12', 'no 2026 months invented');
  assert.ok(!r.chart.points.some((p) => p.t.startsWith('2026')));
  n += 1;

  // ---- a true zero (closed month) is kept as 0 and named
  io = fakeIo(ok(rows([2021, 2022, 2023, 2024, 2025], (y, m, v) => (m === 1 || m === 2 || m === 12 ? 0 : v))));
  r = await S.run(PAGE, io, NOW);
  assert.strictEqual(r.chart.points.find((p) => p.t === '2025-01').v, 0, 'a reported zero stays 0');
  assert.ok(/It reported 0 visits in January, February and December\./.test(r.chart.sentence), r.chart.sentence);
  n += 1;

  // ---- the month in progress is dropped
  io = fakeIo(ok(rows([2021, 2022, 2023, 2024, 2025]).concat([row(2026, 1, 90000), row(2026, 3, 95000), row(2026, 11, 5000)])));
  r = await S.run(PAGE, io, NOW);
  assert.ok(!r.chart.points.some((p) => p.t === '2026-11'), 'November 2026 is in progress');
  assert.strictEqual(r.chart.points[r.chart.points.length - 1].t, '2026-03', 'trailing months after the last published one are cut');
  assert.strictEqual(r.chart.points.find((p) => p.t === '2026-02').v, null, 'a month between two published rows stays a gap');
  assert.ok(/in 2025\./.test(r.chart.sentence), 'the last complete year, not a part year: ' + r.chart.sentence);
  n += 2;

  // ---- not a unit: the service answers with an empty list
  io = fakeIo(ok([]));
  assert.strictEqual(await S.run(F('https://www.nps.gov/zzzz/index.htm'), io, NOW), null, 'empty answer');
  assert.strictEqual(io.calls.length, 1);
  // rows for another unit are not used
  assert.strictEqual(await S.run(PAGE, fakeIo(ok(rows([2023, 2024, 2025], (y, m, v) => v).map((x) => Object.assign(x, { UnitCode: 'YELL' })))), NOW), null, 'another unit');
  // a page that is not a park's: no request at all
  assert.strictEqual(await S.run(F('https://www.nps.gov/subjects/x.htm'), fakeIo(() => { throw new Error('must not be called'); }), NOW), null);
  n += 3;

  // ---- HTTP error and non-JSON: null, never throw
  for (const res of [{ status: 500, text: '' }, { status: 404, text: '[]' }, { status: 200, text: '<html>maintenance' }, { status: 200, text: '{"error":"x"}' }, { status: 200, text: 'null' }, { status: 200, text: '' }]) {
    assert.strictEqual(await S.run(PAGE, fakeIo(res), NOW), null, 'null for ' + res.status + ' ' + res.text.slice(0, 12));
  }
  assert.strictEqual(await S.run(PAGE, fakeIo(null), NOW), null, 'no answer');
  n += 2;

  // ---- fewer than 8 months with visits: null (zeros do not count)
  assert.strictEqual(await S.run(PAGE, fakeIo(ok(rows([2025]).slice(0, 7))), NOW), null, 'seven months');
  assert.strictEqual(await S.run(PAGE, fakeIo(ok(rows([2025], (y, m, v) => (m <= 6 ? v : 0)))), NOW), null, 'six months and six zeros');
  assert.ok(await S.run(PAGE, fakeIo(ok(rows([2025]).slice(0, 8))), NOW), 'eight months is enough');
  n += 3;

  // ---- a year in which every month reported 0 (a unit closed all year): the sentence says only that, with no busiest month and no percentage
  io = fakeIo(ok(rows([2021, 2022, 2023, 2024, 2025], (y, m, v) => (y === 2025 ? 0 : v))));
  r = await S.run(PAGE, io, NOW);
  assert.strictEqual(r.chart.sentence, 'Example Canyon NP reported no recreation visits in 2025.');
  assert.strictEqual(r.chart.points.filter((p) => p.t.startsWith('2025-') && p.v === 0).length, 12, 'the twelve reported zeros are still drawn as zeros');
  // the year before was the empty one: the comparison is left out, the rest stands
  io = fakeIo(ok(rows([2021, 2022, 2023, 2024, 2025], (y, m, v) => (y === 2024 ? 0 : v))));
  r = await S.run(PAGE, io, NOW);
  assert.ok(/^Example Canyon NP reported 3,730,000 recreation visits in 2025\. The busiest month of 2025 was July \(600,000\)\. The quietest was January \(100,000\)\.$/.test(r.chart.sentence), r.chart.sentence);
  n += 3;

  // ---- not on a news article, and not under a news path: a press release under a park's address is about its own story
  const NEWS = 'https://www.nps.gov/grca/learn/news/new-superintendent-named.htm';
  for (const f of [F(NEWS), Object.assign(F(NEWS), { group: 'other' }), F('https://www.nps.gov/grca/learn/News/index.htm'), F('https://www.nps.gov/grca/news/'), Object.assign(F('https://www.nps.gov/grca/planyourvisit/index.htm'), { group: 'news' }), Object.assign(F('https://www.nps.gov/grca/'), { group: 'news' })]) {
    assert.ok(!S.applies(f), 'does not apply: ' + f.url + ' (' + f.group + ')');
    assert.strictEqual(await S.run(f, fakeIo(() => { throw new Error('must not be called'); }), NOW), null, 'and nothing is asked: ' + f.url);
  }
  for (const g of ['organization', 'other', 'evergreen', 'shop']) assert.ok(S.applies(Object.assign(F('https://www.nps.gov/grca/planyourvisit/newsstand-hours.htm'), { group: g })), 'still applies on a park page of group ' + g + ' ("news" inside a word is not a news path)');
  { const art = X.pageFacts({ url: NEWS, title: 'New superintendent named - Example Canyon National Park (U.S. National Park Service)', siteName: 'National Park Service', pageKind: 'article', isArticle: true, text: 'The National Park Service has named a new superintendent.' });
    art.site = null; art.subject = null;
    assert.deepStrictEqual([art.group, X.candidates(art, {}).some((c) => c.id === 'park_visits')], ['news', false], 'a press release: the park chart is not offered');
    const plan = X.pageFacts({ url: 'https://www.nps.gov/grca/planyourvisit/index.htm', title: 'Plan Your Visit - Example Canyon National Park (U.S. National Park Service)', siteName: 'National Park Service', pageKind: 'page', text: 'Plan your visit.' });
    plan.site = null; plan.subject = null;
    assert.strictEqual(X.candidates(plan, {})[0].id, 'park_visits', 'a park\'s own page: still offered first'); }
  n += 4;

  // ---- a row with an impossible year is dropped: only 1900 to the current year. (A six-digit year once kept the month loop running until memory ran out.)
  { const odd = rows([2021, 2022, 2023, 2024, 2025]).concat([row(100000, 1, 5), row(1e21, 1, 5), row(999999999, 12, 5), row(1899, 6, 5), row(2027, 1, 5), row(-5, 1, 5), row(2024.5, 1, 5), row('20250', 1, 5)]);
    const t0 = Date.now(); r = await S.run(PAGE, fakeIo(ok(odd)), NOW); const took = Date.now() - t0;
    assert.ok(r && r.chart && took < 500, 'answered in ' + took + ' ms');
    assert.deepStrictEqual([r.chart.points.length, r.chart.points[0].t, r.chart.points[59].t], [60, '2021-01', '2025-12'], 'only the real years are drawn');
    const t1 = Date.now(); const lone = await S.run(PAGE, fakeIo(ok([row(100000, 1, 5), row(2025, 1, 5)])), NOW);
    assert.ok(lone === null && Date.now() - t1 < 500, 'one real month and one impossible row: nothing, at once');
    // 1900 and the current year are inside the range
    r = await S.run(PAGE, fakeIo(ok(rows([2025]).concat([row(2026, 1, 90000)]))), NOW);
    assert.strictEqual(r.chart.points[r.chart.points.length - 1].t, '2026-01', 'a published month of the current year is kept'); }
  n += 4;

  console.log('Context park_visits: ' + n + ' checks passed (park pages only, not news, one request with the code only, gaps kept, true zeros kept, an all-zero year, month in progress dropped, unpublished months, impossible years, not a unit, errors, minimum).');
})().catch((e) => { console.error(e); process.exit(1); });
