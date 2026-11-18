/* nonprofit_finances: IRS Form 990 figures by tax ID (ProPublica Nonprofit Explorer).
   Responses are synthetic, in the real response shape (invented filer, tax ID and figures; no recorded third-party content). */
const assert = require('assert');
const X = require('../extension/context-data.js');
require('../extension/context-nonprofit.js');
const S = X.REGISTERED.nonprofit_finances;

const NOW = new Date('2026-11-17T12:00:00Z');
const EIN = '012345678'; // leading zero: ProPublica returns it as the integer 12345678
const ENTITY = { q: 'Q999999', label: 'Example Civic Fund', ein: EIN, kind: 'organization' };
const F = { url: 'https://www.example.org/about', domain: 'example.org', group: 'organization', text: 'page text must never be sent' };
const row = (y, rev, extra) => Object.assign({ ein: 12345678, tax_prd: y * 100 + 12, tax_prd_yr: y, formtype: 0, totrevenue: rev, totfuncexpns: rev == null ? null : Math.round(rev * 0.9), totnetassetend: 4200000, pdf_url: null, compnsatncurrofcr: 999999 }, extra || {});
const body = (filings, org, without) => JSON.stringify({
  organization: Object.assign({ id: 12345678, ein: 12345678, name: 'Example Civic Fund Inc', careofname: '% A PERSON', city: 'Springfield', state: 'IL', subsection_code: 3, tax_period: '2025-12-01', revenue_amount: 1 }, org || {}),
  filings_with_data: filings, filings_without_data: without || [{ tax_prd: 202412, tax_prd_yr: 2024, formtype: 0, pdf_url: 'https://projects.propublica.org/nonprofits/download-filing?path=x.pdf' }],
  data_source: 'synthetic', api_version: 2 });
// newest first, as the API lists them; 2020 is absent from the extracts (filed as a PDF only), 2019 has a null figure
const HAPPY = [row(2023, 8500000), row(2022, 7900000), row(2021, 7100000), row(2019, null), row(2018, 5200000), row(2017, 4800000), row(2016, 3100000)];

function fakeIo(res) {
  const calls = [];
  return { calls, get: async (url, opt) => { calls.push({ url, opt }); return typeof res === 'function' ? res(url) : res; } };
}
const ok = (text) => ({ status: 200, text });

(async () => {
  let n = 0;
  // ---- applies / sends
  assert.strictEqual(S.basis, 'records'); assert.strictEqual(S.scope, 'entity');
  assert.ok(S.applies(ENTITY, F), 'applies with a tax ID');
  assert.ok(S.applies({ label: 'X', ein: '01-2345678' }, F), 'a dashed tax ID is accepted');
  assert.ok(!S.applies({ label: 'X', ein: '' }, F) && !S.applies({ label: 'X' }, F), 'no tax ID: does not apply');
  assert.ok(!S.applies({ label: 'X', ein: '12AB' }, F) && !S.applies({ label: 'X', ein: '1234567890' }, F), 'a malformed tax ID does not apply');
  assert.strictEqual(S.sends(ENTITY, F), 'the tax ID of Example Civic Fund to ProPublica Nonprofit Explorer');
  n += 4;

  // ---- happy path
  let io = fakeIo(ok(body(HAPPY)));
  let r = await S.run(ENTITY, F, io, NOW);
  assert.strictEqual(io.calls.length, 1, 'one request');
  assert.ok(/^https:\/\/projects\.propublica\.org\/nonprofits\/api\/v2\/organizations\/012345678\.json$/.test(io.calls[0].url), 'URL carries only the tax ID: ' + io.calls[0].url);
  assert.ok(!/example|Civic|page|text/i.test(io.calls[0].url), 'no page or name in the request');
  const c = r.chart;
  assert.strictEqual(c.kind, 'bars'); assert.strictEqual(c.resolution, 'year'); assert.strictEqual(c.nominal, true); assert.strictEqual(c.unit, 'US dollars'); assert.strictEqual(c.basis, 'records');
  assert.deepStrictEqual(c.points.map((p) => p.t), ['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023'], 'every year from first to last figure');
  assert.strictEqual(c.points.find((p) => p.t === '2019').v, null, 'a null figure stays missing');
  assert.strictEqual(c.points.find((p) => p.t === '2020').v, null, 'a year with no extract stays missing');
  assert.ok(!c.points.some((p) => p.t === '2024'), 'a filed return without figures is not drawn');
  assert.strictEqual(c.points.find((p) => p.t === '2023').v, 8500000);
  assert.ok(c.sentence.startsWith('Example Civic Fund Inc reported $8.5 million in revenue for 2023 on its IRS Form 990, and $7.7 million in expenses.'), c.sentence);
  assert.ok(/For 2016 it reported \$3\.1 million in revenue\./.test(c.sentence), c.sentence);
  assert.ok(/No figure is listed for 2019 and 2020\./.test(c.sentence), c.sentence);
  assert.ok(!/\$0\b/.test(c.sentence), 'a missing year never reads as $0');
  assert.ok(/one legal entity, tax ID 01-2345678\. Related organizations may file separately\./.test(c.note), c.note);
  assert.strictEqual(c.title, 'Revenue: Example Civic Fund Inc');
  assert.strictEqual(c.source.url, 'https://projects.propublica.org/nonprofits/organizations/012345678');
  assert.strictEqual(r.facts.length, 2);
  assert.strictEqual(r.facts[0].text, 'The IRS lists Example Civic Fund Inc as exempt under section 501(c)(3).');
  assert.strictEqual(r.facts[1].text, 'Example Civic Fund Inc reported $4.2 million in net assets at the end of 2023.');
  assert.ok(!/PERSON|999999/.test(JSON.stringify(r)), 'no officer names or pay reach the result');
  n += 6;

  // ---- a tax ID the router read from the page (and confirmed by name): the note says where it came from and which name the IRS has
  r = await S.run(Object.assign({}, ENTITY, { einFrom: 'page' }), F, fakeIo(ok(body(HAPPY))), NOW);
  assert.strictEqual(r.chart.note, 'The tax ID 01-2345678 was read from this page. The IRS lists it as Example Civic Fund Inc. These are the filings of that one legal entity; related organizations may file separately.');
  assert.ok(r.chart.sentence.startsWith('Example Civic Fund Inc reported $8.5 million'), 'the figures are the same record');
  // and one line above the chart says what is known and no more: the page prints this ID, and these are the filings under it
  assert.strictEqual(r.chart.relation, 'This page prints the tax ID 01-2345678. IRS filings under that ID are from Example Civic Fund Inc.');
  assert.ok(!/\bis\b|\bowned\b|\bits\b|this site|this organization/i.test(r.chart.relation), 'it does not say the site is the filer');
  assert.ok(!('relation' in (await S.run(ENTITY, F, fakeIo(ok(body(HAPPY))), NOW)).chart), 'a tax ID from Wikidata needs no such line');
  // a very long legal name is cut at a word so that both sentences still fit in the line (240 characters); a feed string is cut before it is cleaned
  { const longName = 'Example Civic Fund For The ' + 'Advancement And Betterment Of '.repeat(9) + 'Springfield';
    const rl = await S.run(Object.assign({}, ENTITY, { einFrom: 'page' }), F, fakeIo(ok(body(HAPPY, { name: longName }))), NOW);
    assert.ok(rl.chart.relation.length <= 240 && /^This page prints the tax ID 01-2345678\. IRS filings under that ID are from Example Civic Fund For The Advancement .*\u2026\.$/.test(rl.chart.relation) && !/Bettermen\u2026|Advancemen\u2026/.test(rl.chart.relation), rl.chart.relation);
    const t0 = Date.now(); const rh = await S.run(Object.assign({}, ENTITY, { einFrom: 'page' }), F, fakeIo(ok(body(HAPPY, { name: 'A ' + ' \t'.repeat(100000) + 'B' + '<'.repeat(100000) }))), NOW);
    assert.ok(Date.now() - t0 < 200 && rh.chart.title.length <= 'Revenue: '.length + 400, 'a 300,000-character name is cut to 400 characters first: ' + rh.chart.title.length); }
  n += 4;

  // ---- legal name as given, and a fiscal year that does not end in December
  const fy = HAPPY.filter((x) => x.totrevenue != null).map((x) => row(x.tax_prd_yr, x.totrevenue, { tax_prd: x.tax_prd_yr * 100 + 6, formtype: 1, totnetassetend: undefined, totnetassetsend: 50000 }));
  r = await S.run(ENTITY, F, fakeIo(ok(body(fy, { name: 'Example Civic Fund Of Springfield', subsection_code: 4 }))), NOW);
  assert.ok(r.chart.sentence.startsWith('Example Civic Fund Of Springfield reported $8.5 million in revenue for the fiscal year ending June 2023 on its IRS Form 990-EZ'), r.chart.sentence);
  assert.strictEqual(r.facts[0].text, 'The IRS lists Example Civic Fund Of Springfield as exempt under section 501(c)(4).');
  assert.strictEqual(r.facts[1].text, 'Example Civic Fund Of Springfield reported $50,000 in net assets at the end of June 2023.');
  n += 1;

  // ---- private foundation: no net-assets fact (990-PF has no such field)
  const pf = HAPPY.filter((x) => x.totrevenue != null).map((x) => row(x.tax_prd_yr, x.totrevenue, { formtype: 2, totnetassetend: undefined }));
  r = await S.run(ENTITY, F, fakeIo(ok(body(pf))), NOW);
  assert.ok(/IRS Form 990-PF/.test(r.chart.sentence) && r.facts.length === 1, 'PF: form named, one fact');
  n += 1;

  // ---- fewer than 6 years with a figure: no chart
  r = await S.run(ENTITY, F, fakeIo(ok(body([row(2023, 1e6), row(2022, 1e6), row(2021, null), row(2020, 1e6), row(2019, 1e6), row(2018, 1e6)]))), NOW);
  assert.strictEqual(r, null, 'five figures is not enough');
  n += 1;

  // ---- unfinished period dropped (a period ending after now), which leaves too few years
  const fresh = [row(2026, 9e6, { tax_prd: 202612 }), row(2025, 8e6), row(2024, 7e6), row(2023, 6e6), row(2022, 5e6), row(2021, 4e6)];
  r = await S.run(ENTITY, F, fakeIo(ok(body(fresh))), NOW);
  assert.strictEqual(r, null, 'a period that has not ended is dropped');
  r = await S.run(ENTITY, F, fakeIo(ok(body(fresh.concat([row(2020, 3e6)])))), NOW);
  assert.ok(r.chart.points[r.chart.points.length - 1].t === '2025', 'series ends at the last finished period');
  n += 1;

  // ---- two periods ending in one year (change of fiscal year): that year is blank, not summed
  const split = HAPPY.filter((x) => x.totrevenue != null).concat([row(2022, 2000000, { tax_prd: 202206 }), row(2015, 2500000)]);
  r = await S.run(ENTITY, F, fakeIo(ok(body(split))), NOW);
  assert.strictEqual(r.chart.points.find((p) => p.t === '2022').v, null, 'a split year stays missing');
  n += 1;

  // ---- wrong identifier: the record is another tax ID
  r = await S.run(ENTITY, F, fakeIo(ok(body(HAPPY, { ein: 87654321 }))), NOW);
  assert.strictEqual(r, null, 'a record for another tax ID is not used');
  n += 1;

  // ---- HTTP errors and malformed JSON: null, never throw
  for (const res of [{ status: 404, text: '{"error":"Not Found"}' }, { status: 500, text: '' }, ok('<html>oops'), ok('{"organization":'), ok('null'), ok('{"organization":{"ein":12345678,"name":"X"},"filings_with_data":"bad"}')]) {
    r = await S.run(ENTITY, F, fakeIo(res), NOW);
    assert.strictEqual(r, null, 'null for ' + res.status + ' ' + res.text.slice(0, 20));
  }
  r = await S.run({ label: 'No ID' }, F, fakeIo(() => { throw new Error('must not be called'); }), NOW);
  assert.strictEqual(r, null, 'no tax ID: no request, null');
  n += 2;

  // ---- six years of $0 are not a revenue history; a return for a short period after a change of fiscal year is not a full year
  { const zeros = [row(2023, 100), row(2022, 0), row(2021, 0), row(2020, 0), row(2019, 0), row(2018, 0)];
    assert.strictEqual(await S.run(ENTITY, F, fakeIo(ok(body(zeros))), NOW), null, 'five $0 years and one figure: no chart'); n++;
    const moved = [row(2023, 9e6, { tax_prd: 202306 }), row(2022, 4e6, { tax_prd: 202206 }), row(2021, 8e6), row(2020, 7e6), row(2019, 6e6), row(2018, 5e6), row(2017, 4e6), row(2016, 3e6)];
    const rm = await S.run(ENTITY, F, fakeIo(ok(body(moved))), NOW);
    assert.strictEqual(rm.chart.points.find((p) => p.t === '2022').v, null, 'the six-month return after the fiscal year moved is left blank'); n++; }
  console.log('Context nonprofit_finances: ' + n + ' checks passed (tax-ID lookup, gaps kept, fiscal years, form types, 6-year rule, unfinished period, identity, errors).');
})().catch((e) => { console.error(e); process.exit(1); });
