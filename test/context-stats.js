/* Official statistics source (extension/context-stats.js): the matcher, the arithmetic, the parsers and the request rules.
   Responses are synthetic, in each source's real response shape (no recorded third-party content). */
const assert = require('assert');
const X = require('../extension/context-data.js');
const S = require('../extension/context-stats.js');

const NOW = new Date('2026-11-17T12:00:00Z');
const src = X.REGISTERED.official_statistic;
let n = 0; const ok = (c, msg) => { assert.ok(c, msg); n++; }; const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };
const page = (title, text, country, extra) => Object.assign({ url: 'https://news.example/a', title, text, published: '', site: country ? { country } : null }, extra || {});
function fakeIo(routes) {
  const calls = [];
  return { calls, get: async (url) => { calls.push(url); for (const [re, body] of routes) if (re.test(url)) { const r = typeof body === 'function' ? body(url, calls.length) : body; return r && typeof r === 'object' && 'text' in r && 'status' in r ? r : { status: 200, text: typeof r === 'string' ? r : JSON.stringify(r) }; } return { status: 404, text: '' }; } };
}
// BLS v2 shape: newest first, M13 is the annual average, '-' is a month not published
function bls(code, from, to, valueAt) {
  const data = [];
  for (let k = to; k >= from; k--) { const y = Math.floor(k / 12), m = (k % 12) + 1; const v = valueAt(y, m); data.push({ year: String(y), period: 'M' + String(m).padStart(2, '0'), periodName: 'x', value: v == null ? '-' : String(v), footnotes: [{}] }); }
  data.push({ year: '2024', period: 'M13', periodName: 'Annual', value: '999', footnotes: [{}] });
  return { status: 'REQUEST_SUCCEEDED', responseTime: 10, message: [], Results: { series: [{ seriesID: code, data }] } };
}
const K = (y, m) => y * 12 + m - 1;

(async () => {
  ok(src && src.basis === 'statistic' && src.scope === 'page', 'registered as a page-scope statistic source');

  // ---------- matcher: pages about a named statistic ----------
  const pos = [
    [page('US inflation rises to 3.1% in September', 'Consumer prices rose 3.1% from a year earlier, the Labor Department said on Wednesday.', ''), 'us_cpi', 'US', 'headline'],
    [page('What the September price report means for your grocery bill', 'Consumer prices rose 3.1% over the year. Inflation was 2.9% in August. Shelter costs pushed the consumer price index up 0.4% in the month. Economists expected inflation of 3.0%.', 'US'), 'us_cpi', 'US', 'text'],
    [page('Core inflation holds at 2.8%, keeping the Fed cautious', 'Core inflation, which excludes food and energy, was 2.8% for a third month.', 'US'), 'us_core_cpi', 'US', 'headline'],
    [page('Unemployment rate ticks up to 4.3% as hiring slows', 'The unemployment rate rose to 4.3% in October from 4.2%, the Bureau of Labor Statistics said.', 'US'), 'us_unemployment', 'US', 'headline'],
    [page('UK unemployment rises to 4.9%, highest in four years', 'The jobless rate rose to 4.9% in the three months to August, the ONS said.', 'US'), 'gb_unemployment', 'GB', 'headline'],
    [page('Eurozone inflation slows to 2.1% in October', 'Inflation in the euro area eased to 2.1% from 2.2%, a flash estimate showed.', 'US'), 'eu_hicp', 'EA', 'headline'],
    [page('German inflation jumps to 2.8% on energy costs', 'Inflation rose to 2.8% in October, the statistics office said.', 'GB'), 'eu_hicp', 'DE', 'headline'],
    [page("Japan's GDP contracts at a 1.8% annualised pace", 'Gross domestic product shrank 0.4% in the quarter, or 1.8% annualised.', 'US'), 'wb_gdp', 'JP', 'headline'],
    [page('Mortgage rates fall to 6.2%, lowest since spring', 'The average 30-year fixed mortgage rate fell to 6.2% this week, Freddie Mac said.', 'US'), 'us_mortgage30', 'US', 'headline'],
    [page('Fed cuts the federal funds rate by a quarter point', 'The Federal Reserve lowered the federal funds rate by 25 basis points to a range of 3.75% to 4%.', 'US'), 'us_policy_rate', 'US', 'headline'],
    [page('Gas prices climb to $3.40 a gallon ahead of the holiday', 'Drivers are paying $3.40 a gallon for regular, up 12 cents from a week ago.', 'US'), 'us_gasoline', 'US', 'headline'],
    [page('Median household income rose to $83,730 in 2024, Census says', 'Median household income was $83,730, up 1.3% after adjusting for inflation.', 'US'), 'us_median_income', 'US', 'headline'],
    [page('Wage growth slows as average hourly earnings rise 3.8%', 'Average hourly earnings rose 3.8% from a year earlier, down from 4.0%.', 'US'), 'us_earnings', 'US', 'headline'],
    [page('Hiring stalls across the provinces', "Canada's jobless rate rose to 7.1% in October. Canada's unemployment rate is the highest since 2016 outside the pandemic. Economists had expected the Canadian unemployment rate to hold at 7.0%.", 'US'), 'wb_unemployment', 'CA', 'text']
  ];
  for (const [f, id, country, where] of pos) {
    const m = S.match(f);
    ok(m && m.id === id && m.country === country && m.where === where, 'match: ' + f.title + ' -> ' + JSON.stringify(m));
  }

  // ---------- matcher: controls that must return nothing ----------
  const neg = [
    page('Easy weeknight pasta with peas and lemon', 'Bring 4 quarts of water to a boil. Prices for peas vary by season. Add 1 cup of peas. Serves 4.', 'US'),
    page('Bike floor pump with gauge', 'Perfect tire inflation in seconds. Fits Presta and Schrader valves. 160 psi max. Now 20% off. Inflation pressure gauge included.', 'US'),
    page('Voters say the economy is their top issue', 'In our poll, 41% named the economy first. The economy was also first in 2024. Health care was second at 18%.', 'US'),
    page('One more loss could send the coach to the unemployment line', 'The team is 2-9. Another loss would put him in the unemployment line, fans say. He has won 18% of games. The unemployment line is long for coaches.', 'US'),
    page('Tyre inflation: what pressure should you run?', 'Correct tyre inflation is about 32 psi, or 2.2 bar. Check tyre inflation monthly; under-inflation raises fuel use by 3%. Tyre inflation also changes with temperature.', 'GB'),
    page('Social media and the inflation of the ego', 'A study found 60% of users post to be seen. Ego inflation grows with likes. Ego inflation, the authors write, rose 12% among teens.', 'US'),
    page('Protect your paycheck with our unemployment insurance', 'Our unemployment insurance covers 70% of your salary. Unemployment insurance from us starts at $9 a month. Get unemployment insurance today and save 10%.', 'US'),
    page('California unemployment rate climbs to 5.5%', 'California unemployment rose to 5.5% in October, the state said. California unemployment is the highest of any state.', 'US'),
    page('Venezuela inflation tops 200%', 'Inflation in Venezuela was above 200% last year. Venezuela inflation has been above 100% since 2015.', 'US'),
    page('Club confirms record transfer fee', 'The club paid 80 million. With inflation at 3%, the fee is still below the 2017 record. The striker scored 22 goals.', 'GB'),
    page('Inflation cools to 2.9% in October', 'Prices rose 2.9% from a year earlier, down from 3.1%.', ''),
    page('Youth unemployment hits 15% in Spain', 'Youth unemployment rose to 15% in October. Youth unemployment is twice the EU average at 14.8%.', 'ES'),
    page('What the Inflation Reduction Act means for solar buyers', 'The Inflation Reduction Act gives a 30% tax credit. The Inflation Reduction Act credit lasts until 2032. Panels cost 10% less than last year.', 'US'),
    page('Inflation and unemployment both edge up', 'Inflation rose to 3.1% and unemployment rose to 4.3%.', 'US')
  ];
  neg.push(
    page('Unemployment rate rises to 4.4% after German carmaker shuts plant', 'The unemployment rate rose to 4.4% in October.', 'US'),
    page('Inflation rises to 3.1% as Chinese imports get pricier', 'Prices rose 3.1% over the year.', 'US'),
    page('Gas prices jump 8% as cold snap lifts heating demand', 'Heating bills could rise 8% this winter.', 'US'),
    page('How to file for unemployment: what you need', 'Unemployment pays 50% of wages for up to 26 weeks. Bring two forms of ID.', 'US')
  );
  for (const f of neg) eq(S.match(f), null, 'no match: ' + f.title);
  const m15 = S.match(page('15-year mortgage rates fall to 5.4% as 30-year rates hold', 'The 15-year rate fell to 5.4%. The 30-year fixed rate held at 6.2%, Freddie Mac said.', 'US'));
  eq(m15, null, 'a headline about 15-year rates does not count; one 30-year mention is not enough');
  const m30 = S.match(page('Mortgage rates: the 30-year fixed rate holds at 6.2%', 'The 15-year rate fell to 5.4%. The 30-year fixed rate held at 6.2%, Freddie Mac said.', 'US'));
  ok(m30 && m30.id === 'us_mortgage30' && m30.where === 'headline', 'the 30-year headline still counts');
  ok(S.match(page('15-year mortgage rates fall to 5.4%', 'The 15-year fixed fell to 5.4%, Freddie Mac said.', 'US')) === null, '15-year rates alone: no 30-year chart');
  const boe = S.match(page('UK inflation rises to 3.8%, Bank of England says', 'Inflation rose to 3.8%, the Bank of England said.', 'US'));
  ok(boe && boe.country === 'GB', 'Bank of England is not a subnational place');
  const nyf = S.match(page('Fed holds the federal funds rate at 3.75% to 4%', 'The federal funds rate, published by the New York Fed, averaged 3.88%.', 'US'));
  ok(nyf && nyf.country === 'US', 'New York Fed is not a state');
  ok(S.match(page('Inflation rises to 3.1% in September', 'Consumer prices rose 3.1% over the year.', 'XX')) === null, 'an unknown site country gives no match');
  ok(S.match(page('Inflation rises to 3.1% in September', 'Consumer prices rose 3.1% over the year.', 'AQ')) === null, 'a country with no series gives no match');
  ok(!src.applies(page('Easy pasta', 'water', 'US')), 'applies() is false on a recipe');

  // ---------- CPI index to 12-month change; a missing month stays missing; the unfinished month is dropped ----------
  const pc = S.pct12([{ t: '2025-09', v: 300 }].concat(Array.from({ length: 11 }, (_, i) => ({ t: '2025-' + String(10 + i).padStart(2, '0'), v: 301 }))).slice(0, 4).concat([{ t: '2026-09', v: 309.3 }]));
  eq(pc.find((p) => p.t === '2026-09').v, 3.1, '309.3 against 300 a year earlier is 3.1%');
  eq(pc.find((p) => p.t === '2025-09').v, null, 'no base month gives no change, not 0');
  // index rises 0.25% a month; October 2025 not published; November 2026 is the current (unfinished) month
  const level = (y, m) => (y === 2025 && m === 10 ? null : Math.round(300 * Math.pow(1.0025, K(y, m) - K(2022, 1)) * 1000) / 1000);
  const cpiBody = bls('CUUR0000SA0', K(2022, 1), K(2026, 11), level);
  let io = fakeIo([[/api\.bls\.gov\/publicAPI\/v2\/timeseries\/data\/CUUR0000SA0/, cpiBody]]);
  const f1 = page('US inflation rises to 3.1% in September', 'Consumer prices rose 3.1% from a year earlier, the BLS said.', '', { published: '2026-10-15' });
  const r1 = await src.run(f1, io, NOW, {});
  const pts = r1.chart.points;
  ok(pts.length === 36 && pts[pts.length - 1].t === '2026-10', 'monthly: 36 months, ending before the current month (' + pts[pts.length - 1].t + ')');
  ok(!pts.some((p) => p.t === '2026-11'), 'the unfinished current month is dropped');
  eq(pts.find((p) => p.t === '2025-10').v, null, 'the missing month stays null');
  eq(pts.find((p) => p.t === '2026-10').v, null, 'a change that needs the missing month stays null');
  eq(pts.find((p) => p.t === '2026-09').v, 3.0, '12 months of 0.25% a month is 3.0%');
  ok(/^US consumer prices rose 3\.0% over the 12 months to September 2026 \(BLS, CPI-U, all items\)\./.test(r1.chart.sentence), r1.chart.sentence);
  ok(/No 12-month figure for October 2026: the index for October 2025 is missing\./.test(r1.chart.sentence), 'says why the latest month has no figure');
  ok(/A year earlier the figure was 3\.0%\./.test(r1.chart.sentence) && /The highest in the last three years was/.test(r1.chart.sentence), 'year-earlier and window high/low');
  eq(r1.chart.mark, { t: '2026-10', label: 'page published' }, 'publication date marked');
  ok(r1.chart.basis === 'statistic' && r1.chart.unit === 'percent' && r1.chart.resolution === 'month' && /bls\.gov/.test(r1.chart.source.url) && r1.chart.note, 'chart fields');
  eq(io.calls.length, 1, 'one request');
  ok(/\/data\/CUUR0000SA0\?startyear=2022&endyear=2026$/.test(io.calls[0]), 'the request carries only the series code and years: ' + io.calls[0]);
  eq(src.sends(f1), 'the series code CUUR0000SA0 to the US Bureau of Labor Statistics', 'sends');
  ok(r1.facts.length === 1 && r1.facts[0].text === '3.1%.' && r1.facts[0].label === 'The page states', 'the page\'s own number, as a fact');
  const amb = await src.run(page('US inflation report', 'Inflation was 3.1% in September, up from 2.9% in August. Inflation of 3.1% was above forecasts. A year ago inflation was 2.4%.', 'US'), fakeIo([[/CUUR0000SA0/, cpiBody]]), NOW, {});
  ok(amb && amb.facts.length === 0, 'two numbers near the phrase: no page number');

  // falling prices and slowing inflation are worded differently
  const fall = bls('CUUR0000SA0', K(2022, 1), K(2026, 10), (y, m) => 300 - (K(y, m) - K(2022, 1)) * 0.3);
  const r2 = await src.run(f1, fakeIo([[/CUUR0000SA0/, fall]]), NOW, {});
  ok(/^US consumer prices fell 1\.\d% over the 12 months to October 2026/.test(r2.chart.sentence), r2.chart.sentence);
  const slow = bls('CUUR0000SA0', K(2022, 1), K(2026, 10), (y, m) => 300 * Math.pow(1.002, K(y, m) - K(2022, 1)) + (K(y, m) - K(2022, 1)) * 0);
  const r3 = await src.run(f1, fakeIo([[/CUUR0000SA0/, slow]]), NOW, {});
  ok(/rose 2\.4%/.test(r3.chart.sentence) && !/fell/.test(r3.chart.sentence), 'positive change reads as a rise');

  // ---------- errors give null, never throw; at most 2 requests ----------
  io = fakeIo([[/api\.bls\.gov/, { status: 500, text: 'oops' }]]);
  eq(await src.run(f1, io, NOW, {}), null, 'HTTP error gives null');
  ok(io.calls.length <= 2, 'at most 2 requests after an error (' + io.calls.length + ')');
  eq(await src.run(f1, fakeIo([[/api\.bls\.gov/, '<html><title>Missing Key</title></html>']]), NOW, {}), null, 'an HTML page with status 200 gives null');
  eq(await src.run(f1, fakeIo([[/api\.bls\.gov/, { status: 'REQUEST_SUCCEEDED', Results: { series: [{ seriesID: 'OTHER', data: [] }] } }]]), NOW, {}), null, 'another series in the response gives null');
  eq(await src.run(f1, { get: async () => { throw new Error('network'); } }, NOW, {}), null, 'a throwing io gives null');
  io = fakeIo([[/publicAPI\/v2/, { status: 'REQUEST_NOT_PROCESSED', message: ['daily threshold'] }]]);
  { const lim = await src.run(f1, io, NOW, {}); ok(lim && lim.chart === null && /25 a day/.test(lim.error), 'a refused BLS request (daily limit) gives no chart and says why'); }
  eq(io.calls.length, 1, 'BLS: one request, no retry');
  const pn = (title, text) => src.run(page(title, text, 'US'), fakeIo([[/CUUR0000SA0/, cpiBody]]), NOW, {}).then((r) => r && r.facts.map((x) => x.text));
  eq(await pn('Inflation: 60% of Americans say prices are too high', 'Inflation was 3.1% in September. Inflation rose 3.1% over the year. Consumer prices rose 3.1%.'), ['3.1%.'], 'a survey share after a colon is not the page\'s inflation figure');
  eq(await pn('US inflation eases to 2.1% from 2.2%', 'Prices rose 2.1%.'), ['2.1%.'], 'the earlier figure after "from" is not counted');
  eq(await src.run(page('Easy pasta', 'water', 'US'), fakeIo([]), NOW, {}), null, 'no match: no chart, no request');

  // ---------- World Bank: retry once on a timeout; only indicator and country codes are sent ----------
  const wb = (iso, code, from, to, valAt) => [{ page: 1, pages: 1, per_page: 50, total: to - from + 1 }, Array.from({ length: to - from + 1 }, (_, i) => ({ indicator: { id: code, value: 'x' }, country: { id: iso, value: 'x' }, countryiso3code: 'XXX', date: String(to - i), value: valAt(to - i), unit: '', obs_status: '', decimal: 1 }))];
  const fJ = page("Japan's GDP contracts at a 1.8% annualised pace", 'Gross domestic product shrank 0.4% in the quarter.', 'US');
  io = fakeIo([[/api\.worldbank\.org/, (url, k) => (k === 1 ? { status: 0, text: '' } : { status: 200, text: JSON.stringify(wb('JP', 'NY.GDP.MKTP.KD.ZG', 2010, 2025, (y) => (y === 2018 ? null : y === 2025 ? -0.4 : 1.1))) })]]);
  const r5 = await src.run(fJ, io, NOW, {});
  ok(r5 && io.calls.length === 2, 'World Bank timeout retried once');
  ok(/\/country\/JP\/indicator\/NY\.GDP\.MKTP\.KD\.ZG\?format=json&date=2010:2025$/.test(io.calls[1]), 'World Bank URL: only the indicator and country codes ' + io.calls[1]);
  ok(/^Real GDP in Japan shrank 0\.4% in 2025/.test(r5.chart.sentence) && r5.chart.resolution === 'year' && r5.chart.points.length >= 10, r5.chart.sentence);
  eq(r5.chart.points.find((p) => p.t === '2018').v, null, 'a missing year stays null');
  const r5b = await src.run(Object.assign({}, fJ, { published: '2026-11-07' }), fakeIo([[/api\.worldbank\.org/, wb('JP', 'NY.GDP.MKTP.KD.ZG', 2010, 2025, () => 1)]]), NOW, {});
  eq(r5b.chart.mark, undefined, 'a publication date beyond the drawn window is not marked');
  ok(!r5.chart.points.some((p) => p.t === '2026'), 'the current year is not in the chart');
  eq(src.sends(fJ), 'the indicator code NY.GDP.MKTP.KD.ZG and the country code JP to the World Bank', 'World Bank sends');
  eq(await src.run(fJ, fakeIo([[/api\.worldbank\.org/, [{ message: [{ id: '120', key: 'Invalid value' }] }]]]), NOW, {}), null, 'World Bank error body gives null');
  // a response for another country is not this country's series
  eq(await src.run(fJ, fakeIo([[/api\.worldbank\.org/, wb('CN', 'NY.GDP.MKTP.KD.ZG', 2010, 2025, () => 5)]]), NOW, {}), null, 'a response for another country gives null');

  // ---------- Eurostat: sparse values, trailing gap trimmed, Greece is EL ----------
  const times = Array.from({ length: 40 }, (_, i) => { const k = K(2023, 1) + i; return Math.floor(k / 12) + '-' + String((k % 12) + 1).padStart(2, '0'); });
  const value = {}; times.forEach((t, i) => { if (i !== 20 && i < 38) value[String(i)] = 2 + (i % 5) / 10; });
  const euro = { version: '2.0', class: 'dataset', value, id: ['freq', 'unit', 'coicop18', 'geo', 'time'], size: [1, 1, 1, 1, times.length], dimension: { time: { category: { index: Object.fromEntries(times.map((t, i) => [t, i])) } } } };
  io = fakeIo([[/eurostat/, euro]]);
  const fG = page('Greek inflation rises to 2.4%', 'Inflation in Greece rose to 2.4% in September.', 'US');
  const r6 = await src.run(fG, io, NOW, {});
  ok(r6 && /geo=EL&/.test(io.calls[0]) && !/Greek|Greece/.test(io.calls[0]), 'Eurostat request uses the code EL and no page words');
  ok(r6.chart.points[r6.chart.points.length - 1].t === times[37] && r6.chart.points.some((p) => p.t === times[20] && p.v === null), 'trailing gap trimmed, interior gap kept');
  ok(/^Consumer prices in Greece rose/.test(r6.chart.sentence), r6.chart.sentence);
  eq(await src.run(fG, fakeIo([[/eurostat/, Object.assign({}, euro, { size: [1, 2, 1, 1, times.length] })]]), NOW, {}), null, 'two series in one Eurostat answer gives null');

  // ---------- ONS three-month average dated by its last month ----------
  const months = Array.from({ length: 40 }, (_, i) => { const k = K(2023, 6) + i; const y = Math.floor(k / 12), m = k % 12; const a = (m + 11) % 12, b = (m + 1) % 12; return { date: y + ' ' + ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][m], value: String(4 + (i % 4) / 10), label: (m === 0 ? y - 1 : y) + ' ' + ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][a] + '-' + ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][b] }; });
  const ons = S.parseOns(JSON.stringify({ years: [], quarters: [], months }));
  const kEnd = K(2023, 6) + 39 + 1; const wantEnd = Math.floor(kEnd / 12) + '-' + String((kEnd % 12) + 1).padStart(2, '0'); // the month after the middle month
  eq(ons.points[ons.points.length - 1].t, wantEnd, 'ONS point dated by the last of its three months');
  ok(ons.points.every((p, i) => i === 0 || p.t > ons.points[i - 1].t) && ons.points.length === 40, 'ONS points in order across year ends');
  const r7 = await src.run(page('UK unemployment rises to 4.9%', 'The jobless rate rose to 4.9%.', 'US'), fakeIo([[/ons\.gov\.uk/, { years: [], quarters: [], months }]]), NOW, {});
  ok(r7 && /in the three months to /.test(r7.chart.sentence), r7 && r7.chart.sentence);

  // ---------- FRED: quarterly annualized rate, '.' is missing ----------
  const fred = 'observation_date,A191RL1Q225SBEA\n' + Array.from({ length: 27 }, (_, i) => { const k = K(2020, 1) + i * 3; return Math.floor(k / 12) + '-' + String((k % 12) + 1).padStart(2, '0') + '-01,' + (i === 24 ? '.' : (1 + i / 10).toFixed(1)); }).join('\n');
  const fU = page('US GDP grows at 2.8% rate in third quarter', 'Gross domestic product grew at a 2.8% annual rate.', 'US');
  io = fakeIo([[/fred\.stlouisfed\.org/, fred]]);
  const r8 = await src.run(fU, io, NOW, {});
  ok(r8 && r8.chart.resolution === 'quarter' && /grew at an annual rate of/.test(r8.chart.sentence), r8 && r8.chart.sentence);
  ok(!r8.chart.points.some((p) => p.t === '2026-10'), 'the unfinished quarter is dropped');
  ok(/id=A191RL1Q225SBEA&cosd=\d{4}-01-01$/.test(io.calls[0]), 'FRED URL carries only the series code and a start date');
  eq(await src.run(fU, fakeIo([[/fred/, 'observation_date,SOMETHINGELSE\n2026-01-01,1']]), NOW, {}), null, 'another FRED series gives null');

  // homonyms of "CPI", statistics that are not consumer prices, and places with no series: never a guess
  for (const [t, x, c] of [
    ['CPI wins two seats in Kerala', 'The CPI won 2 seats, 40% of those it contested. CPI leaders said the CPI vote rose 3%.', 'IN'],
    ['Mobile game CPI hits $3.12', 'CPI rose to $3.12 per install. CPI was $2.80. CPI up 11%.', 'US'],
    ['Denmark leads the CPI', 'The Corruption Perceptions Index gives Denmark 90%. The CPI score. CPI 88%.', 'US'],
    ["Zambia's inflation rate hits 16%", 'Inflation in Zambia rose to 16%. Inflation was 14% a month ago. Inflation 16%.', 'US'],
    ['European inflation eases to 2.1%', 'European inflation fell to 2.1%. Inflation was 2.4%. Inflation 2.1%.', 'US'],
    ['Unemployment in Gaza reaches 80%', 'Unemployment in Gaza is 80%. Unemployment was 45%. Unemployment 80%.', 'US'],
    ['Unemployment in Georgia falls to 3%', 'Unemployment in Georgia fell to 3%. Unemployment was 3.4%. Unemployment 3%.', 'US'],
    ['Wholesale inflation cools to 2%', 'Wholesale inflation fell to 2%. Producer prices rose 0.1%. Wholesale inflation 2%.', 'US']
  ]) eq(S.match(page(t, x, c)), null, 'no series for: ' + t);
  console.log('Context stats: ' + n + ' checks passed (matcher ' + pos.length + ' pages, ' + neg.length + ' controls; arithmetic, gaps, unfinished periods, errors, request contents).');
})().catch((e) => { console.error(e); process.exit(1); });
