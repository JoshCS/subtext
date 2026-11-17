/* SEC sources (extension/context-sec.js): revenue from 10-K company concepts and recent filings from the submissions file.
   Responses are synthetic, in the SEC's real response shapes (no recorded third-party content). */
const assert = require('assert');
const X = require('../extension/context-sec.js');
const FIN = X.REGISTERED.sec_financials, FIL = X.REGISTERED.sec_filings;
const NOW = new Date('2026-11-17T12:00:00Z');
const ENT = { q: 'Q1', label: 'Example Corp', cik: '1234567', kind: 'organization' };

function fakeIo(routes) {
  const calls = [];
  return { calls, get: async (url) => { calls.push(url); for (const [re, body] of routes) if (re.test(url)) return typeof body === 'function' ? body(url) : { status: 200, text: typeof body === 'string' ? body : JSON.stringify(body) }; return { status: 404, text: '' }; } };
}
// one annual row as a 10-K reports it; `fy` is the filing's year, as in the real files
const row = (endY, val, o) => Object.assign({ start: (endY - 1) + '-12-27', end: endY + '-12-26', val, accn: '0001234567-' + String(endY + 1).slice(2) + '-000010', fy: endY, fp: 'FY', form: '10-K', filed: (endY + 1) + '-02-20' }, o || {});
const concept = (tag, rows) => ({ cik: 1234567, taxonomy: 'us-gaap', tag, label: tag, entityName: 'EXAMPLE CORP', units: { USD: rows } });
// the comparative row of an older year inside a later 10-K (same period, later filing)
const comp = (endY, val, filedY) => row(endY, val, { accn: '0001234567-' + String(filedY).slice(2) + '-000010', fy: filedY - 1, filed: filedY + '-02-20' });

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
(async () => {
  // ---- applies / sends / URLs
  ok(!FIN.applies({ label: 'No CIK Inc', cik: '' }, {}) && !FIL.applies({ label: 'x' }, {}), 'an entity without a CIK does not apply');
  ok(!FIN.applies({ label: 'x', cik: '12a4' }, {}), 'a CIK that is not digits does not apply');
  ok(FIN.applies(ENT, {}) && FIN.applies({ label: 'x', cik: '0000320193' }, {}), 'digits apply, with or without the leading zeros Wikidata stores');
  ok(FIN.sends(ENT, {}) === 'the SEC company number of Example Corp to the SEC', FIN.sends(ENT, {}));

  // ---- tag switch: Revenues to 2017, the ASC 606 tag from 2016 (overlap 2016-2017 with equal figures), joined without double counting
  const rev = [];
  for (let y = 2012; y <= 2017; y++) rev.push(row(y, 1e9 + (y - 2012) * 1e8));
  rev.push(comp(2016, 1.4e9, 2019)); // the same 2016 period again in a later filing: one value, not two
  const asc = [comp(2016, 1.4e9, 2018), comp(2017, 1.5e9, 2019)];
  for (let y = 2018; y <= 2025; y++) asc.push(row(y, 1.6e9 + (y - 2018) * 1e8));
  asc.push(row(2025, 0.45e9, { start: '2025-09-28', end: '2025-12-26' })); // a fourth-quarter row inside the 10-K: ignored
  asc.push(row(2024, 0.4e9, { start: '2024-06-29', end: '2024-09-28', form: '10-Q', fp: 'Q3' })); // a 10-Q row: ignored
  asc.push(row(2026, 9e9, { start: '2025-12-27', end: '2026-12-26', filed: '2026-11-10' })); // the unfinished fiscal year: dropped
  const ni = [row(2024, 2e8), row(2025, -9.3e7)];
  let io = fakeIo([[/\/Revenues\.json$/, concept('Revenues', rev)], [/\/RevenueFromContractWithCustomerExcludingAssessedTax\.json$/, concept('RevenueFromContractWithCustomerExcludingAssessedTax', asc)], [/\/NetIncomeLoss\.json$/, concept('NetIncomeLoss', ni)]]);
  let r = await FIN.run(ENT, {}, io, NOW, {});
  ok(r && r.chart, 'chart drawn');
  const c = r.chart;
  ok(c.points.map((p) => p.t).join(',') === '2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025', 'one point per fiscal year, 2012 to 2025: ' + c.points.map((p) => p.t));
  ok(c.points.find((p) => p.t === '2016').v === 1.4e9 && c.points.find((p) => p.t === '2017').v === 1.5e9, 'overlap years counted once (later filing wins)');
  ok(c.points.find((p) => p.t === '2025').v === 2.3e9, 'the quarterly row inside the 10-K is ignored');
  ok(!c.points.some((p) => p.t === '2026'), 'the unfinished fiscal year is dropped');
  ok(c.kind === 'bars' && c.resolution === 'year' && c.nominal === true && c.unit === 'US dollars' && c.basis === 'records', 'shape');
  ok(/reported \$2\.3 billion in revenue for fiscal 2025 and a net loss of \$93 million \(SEC annual report\); revenue was \$1 billion in fiscal 2012\./.test(c.sentence), c.sentence);
  ok(io.calls.length <= 3 && io.calls.every((u) => /^https:\/\/data\.sec\.gov\/api\/xbrl\/companyconcept\/CIK0001234567\/us-gaap\/[A-Za-z]+\.json$/.test(u)), 'at most 3 requests, each carrying only the CIK: ' + io.calls);

  // ---- a missing year stays null and is never $0 in the sentence; the label is the company's own fiscal year
  const gap = []; for (let y = 2017; y <= 2025; y++) if (y !== 2021 && y !== 2025) gap.push(row(y, 3e8 + (y - 2017) * 1e7));
  gap.push(row(2025, 0, { val: null })); // a row with no value is not a figure
  gap.push(row(2024, 3.9e8));
  io = fakeIo([[/\/Revenues\.json$/, concept('Revenues', gap)]]);
  r = await FIN.run(ENT, {}, io, NOW, {});
  ok(r && r.chart.points.find((p) => p.t === '2021').v === null, 'the missing year is v: null');
  ok(r.chart.points[r.chart.points.length - 1].t === '2024', 'a null latest value does not start the series');
  ok(!/\$0\b/.test(r.chart.sentence) && /fiscal 2024/.test(r.chart.sentence) && /no tagged revenue figure/.test(r.chart.note), r.chart.sentence + ' | ' + r.chart.note);
  // a retailer whose year ends in early February calls it the year before (its latest 10-K says so)
  const retail = []; for (let y = 2018; y <= 2025; y++) retail.push(row(y, 1e9, { start: (y - 1) + '-02-02', end: y + '-02-01', fy: y - 1, accn: '0001234567-' + String(y).slice(2) + '-000020', filed: y + '-03-10' }));
  io = fakeIo([[/\/Revenues\.json$/, concept('Revenues', retail)]]);
  r = await FIN.run(ENT, {}, io, NOW, {});
  ok(r && r.chart.points[r.chart.points.length - 1].t === '2024', 'a year ending 1 February 2025 is fiscal 2024 when the filer labels it so');

  // ---- foreign filer (no 10-K rows), too few years, HTTP 403, malformed JSON
  io = fakeIo([[/\/Revenues\.json$/, concept('Revenues', [row(2023, 1e9, { form: '20-F' }), row(2024, 1e9, { form: '20-F' })])]]);
  ok((await FIN.run(ENT, {}, io, NOW, {})) === null, '20-F figures draw no chart');
  ok(io.calls.length === 3 && /IncludingAssessedTax/.test(io.calls[2]), 'with no recent figure, the third request tries the third revenue tag');
  io = fakeIo([[/\/Revenues\.json$/, concept('Revenues', [row(2023, 1e9), row(2024, 1.1e9)])]]);
  ok((await FIN.run(ENT, {}, io, NOW, {})) === null, 'two years are not a series');
  io = { get: async () => ({ status: 403, text: 'Your Request Originates from an Undeclared Automated Tool' }) };
  ok((await FIN.run(ENT, {}, io, NOW, {})) === null && (await FIL.run(ENT, {}, io, NOW, {})) === null, 'HTTP 403 returns null');
  io = { get: async () => ({ status: 200, text: '{"units": {"USD": [' }) };
  ok((await FIN.run(ENT, {}, io, NOW, {})) === null && (await FIL.run(ENT, {}, io, NOW, {})) === null, 'malformed JSON returns null');
  io = { get: async () => { throw new Error('should not be called'); } };
  ok((await FIN.run({ label: 'x' }, {}, io, NOW, {})) === null && (await FIL.run({ label: 'x' }, {}, io, NOW, {})) === null, 'no CIK, no request');

  // ---- filings: item translation
  const D = FIL.sec.describe;
  ok(D('8-K', '5.02,9.01').text === '8-K: departure or appointment of a director or senior officer' && D('8-K', '5.02').weight === 2, '5.02 named without claiming which officer');
  ok(D('8-K', '2.02,9.01').text === '8-K: results of operations' && D('8-K', '2.02').weight === 1, 'results are a regular report');
  ok(/bankruptcy/.test(D('8-K', '1.03').text) && /delisting/.test(D('8-K', '3.01').text) && /restatement/.test(D('8-K', '4.02').text), 'bankruptcy, delisting, restatement');
  ok(D('8-K', '7.01,8.01').text === '8-K: disclosure to investors (Regulation FD)', 'other events dropped when another item names the report');
  ok(D('10-K', '').text === '10-K: annual report' && D('S-1', '').weight === 2 && D('25-NSE', '').weight === 2, 'forms');
  ok(D('4', '').weight === 0 && D('144', '').weight === 0 && D('SC 13G/A', '').weight === 0 && D('S-8', '').weight === 0, 'insider and routine forms left out');

  // ---- filings: list, ranking, o.month
  const F = [
    ['2026-11-12', '4', ''], ['2026-11-04', '10-Q', ''], ['2026-11-04', '8-K', '2.02,9.01'], ['2026-10-20', '144', ''],
    ['2026-04-28', '10-Q', ''], ['2026-04-24', '8-K', '2.02,9.01'], ['2026-04-09', '8-K', '5.02,9.01'], ['2026-04-02', '8-K', '7.01'],
    ['2026-03-30', '4', ''], ['2026-03-15', 'DEF 14A', ''], ['2026-02-20', '10-K', ''], ['2026-02-02', '8-K', '1.01,2.03'], ['2025-06-01', '8-K', '1.03']
  ];
  const sub = { cik: '1234567', name: 'Example Corp', filings: { recent: {
    accessionNumber: F.map((x, i) => '0001234567-26-' + String(100 + i).padStart(6, '0')), filingDate: F.map((x) => x[0]), form: F.map((x) => x[1]), items: F.map((x) => x[2]),
    primaryDocument: F.map((x, i) => 'doc' + i + '.htm'), primaryDocDescription: F.map((x) => x[1]) }, files: [] } };
  io = fakeIo([[/data\.sec\.gov\/submissions\/CIK0001234567\.json$/, sub]]);
  r = await FIL.run(ENT, {}, io, NOW, {});
  ok(r && r.chart.kind === 'list' && r.chart.rows.length === 6, 'six rows at most');
  ok(io.calls.length === 1 && io.calls[0] === 'https://data.sec.gov/submissions/CIK0001234567.json', 'one request, CIK only');
  ok(r.chart.rows.some((x) => /departure or appointment/.test(x.text)) && r.chart.rows.some((x) => /material agreement/.test(x.text)), 'events kept ahead of routine reports');
  ok(!r.chart.rows.some((x) => /^4\b|^144/.test(x.text)) && !r.chart.rows.some((x) => x.t < '2025-11-17'), 'insider forms and filings older than 12 months left out');
  ok(r.chart.rows.every((x, i, a) => !i || a[i - 1].t >= x.t), 'newest first');
  ok(r.chart.rows[0].url === 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000101/0001234567-26-000101-index.htm', r.chart.rows[0].url);
  ok(/filed 9 reports with the SEC in the 12 months to 17 November 2026, including a departure or appointment of a director or senior officer on 9 April\./.test(r.chart.sentence), r.chart.sentence);
  r = await FIL.run(ENT, {}, io, NOW, { month: '2026-04' });
  ok(r.chart.rows.every((x) => x.t >= '2026-03-01' && x.t <= '2026-04-31') && r.chart.rows.length === 5, 'o.month: that month and the one before: ' + r.chart.rows.map((x) => x.t));
  ok(/filed 5 reports with the SEC in March and April 2026, including a departure or appointment of a director or senior officer on 9 April 2026\./.test(r.chart.sentence), r.chart.sentence);
  r = await FIL.run(ENT, {}, io, NOW, { month: '2026-01' });
  ok(/December 2025 and January 2026/.test(r ? r.chart.sentence : '') || r === null, 'a month across the new year');
  ok((await FIL.run(ENT, {}, io, NOW, { month: '2026-08' })) === null, 'a month with no material filing: null');
  const old = JSON.parse(JSON.stringify(sub)); old.filings.files = [{ name: 'CIK0001234567-submissions-001.json' }];
  io = fakeIo([[/submissions/, old]]);
  ok((await FIL.run(ENT, {}, io, NOW, { month: '2019-05' })) === null && io.calls.length === 1, 'a month older than the recent list: null, no second request');

  // ---- two tags that never agree on a shared year are not joined: only the tag with the latest year is drawn
  { const oldTag = []; for (let y = 2012; y <= 2019; y++) oldTag.push(row(y, 10e9));
    const newTag = []; for (let y = 2018; y <= 2025; y++) newTag.push(row(y, 4e9)); // 2018 and 2019 are reported by both, at 10 against 4
    const io2 = fakeIo([[/\/Revenues\.json$/, concept('Revenues', oldTag)], [/\/RevenueFromContractWithCustomerExcludingAssessedTax\.json$/, concept('RevenueFromContractWithCustomerExcludingAssessedTax', newTag)], [/NetIncomeLoss/, concept('NetIncomeLoss', [])]]);
    const r2 = await FIN.run(ENT, {}, io2, NOW, {});
    ok(r2 && r2.chart && r2.chart.points.every((p) => p.v == null || p.v === 4e9) && r2.chart.points[0].t === '2018', 'disagreeing tags are not joined into a false fall: ' + JSON.stringify(r2 && r2.chart && r2.chart.points.slice(0, 3))); }
  // ---- a busy filer whose recent list reaches back only weeks: the sentence does not claim twelve months
  { const N = 1000; const dates = Array.from({ length: N }, (_, i) => new Date(NOW.getTime() - (1 + (i % 50)) * 864e5).toISOString().slice(0, 10)).sort().reverse();
    const sub = { name: 'EXAMPLE CORP', filings: { recent: { form: Array(N).fill('8-K'), filingDate: dates, accessionNumber: Array.from({ length: N }, (_, i) => '0001234567-26-' + String(100000 + i)), primaryDocument: Array(N).fill('a.htm'), items: Array(N).fill('2.02') }, files: [{ name: 'x.json' }] } };
    const r3 = await FIL.run(ENT, {}, fakeIo([[/submissions/, sub]]), NOW, {});
    ok(r3 && r3.chart && !/in the 12 months/.test(r3.chart.sentence) && /since /.test(r3.chart.sentence), 'a list that goes back 50 days is not twelve months: ' + (r3 && r3.chart && r3.chart.sentence)); }
  console.log('Context SEC: ' + n + ' checks passed (tag join, missing year, quarters, unfinished year, fiscal labels, 8-K items, month filter, 403, bad JSON, no CIK).');
})().catch((e) => { console.error(e); process.exit(1); });
