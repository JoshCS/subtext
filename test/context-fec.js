/* FEC committee source. Synthetic responses in the OpenFEC response shape (no recorded third-party content). */
const assert = require('assert');
const X = require('../extension/context-fec.js');
const F = X.fec;
const src = X.REGISTERED.fec_committee;

const NOW = new Date('2026-11-17T12:00:00Z');
const KEY = 'test-key-abc123';
const O = { keys: { fec: KEY } };
const org = { q: 'Q1', label: 'Lockheed Martin', kind: 'organization' };
const committee = (o) => Object.assign({ committee_id: 'C00000001', name: 'EXAMPLE CORP EMPLOYEES POLITICAL ACTION COMMITTEE', committee_type: 'Q', designation: 'B', organization_type: 'C', affiliated_committee_name: 'LOCKHEED MARTIN CORPORATION' }, o);
const totals = (cycles) => ({ pagination: { count: cycles.length }, results: cycles.map(([cycle, receipts, end]) => ({ cycle, receipts, disbursements: receipts, coverage_end_date: end || (cycle + '-12-31T00:00:00') })) });

function fakeIo(routes) {
  const calls = [];
  return { calls, get: async (url) => { calls.push(url); for (const [re, res] of routes) if (re.test(url)) return res; return { status: 404, text: '' }; } };
}
const ok = (body) => ({ status: 200, text: JSON.stringify(body) });

(async () => {
  // ---- page signal
  assert.ok(F.pageSignal({ title: 'Team owners gave millions in political donations', text: '' }), 'headline word');
  assert.ok(F.pageSignal({ title: 'Billionaire tax measure heads to the election', text: '' }), 'election in the headline');
  assert.ok(!F.pageSignal({ title: 'Your donation feeds a family', text: 'Make a donation today. Donors like you help. Every donation counts.' }), 'charity donation page');
  assert.ok(!F.pageSignal({ title: 'Pac-12 title game preview', text: 'The Pac-12 race. pac. The Pac-12 again.' }), 'Pac-12 is not a PAC');
  assert.ok(F.pageSignal({ title: 'A quiet season', text: 'The PAC said. Lobbying rose. Another contribution was filed.' }), 'three body words');
  assert.ok(!F.pageSignal({ title: 'Our new running shoes', text: 'Free shipping on every order. Shop now.' }), 'shoe shop');
  assert.ok(!F.pageSignal({ title: 'How to fix a running toilet', text: 'The election of parts matters.' }), 'one stray word is not enough');

  // ---- applies
  assert.ok(src.applies(org, { title: 'Defense firm PAC donations', text: '' }, O), 'organization plus signal');
  assert.ok(!src.applies(org, { title: 'New fighter jet unveiled', text: 'It flies fast.' }, O), 'organization without signal');
  assert.ok(!src.applies({ label: '??', kind: 'organization' }, { title: 'PAC donations', text: '' }, O), 'no usable name');
  assert.ok(!src.applies({ label: 'Jane Example', kind: 'person' }, { title: 'PAC donations', text: '' }, O), 'never a person');
  assert.ok(src.applies({ label: 'Example Victory Fund', kind: 'organization', country: 'US', instanceOf: ['Q2101438'] }, { title: 'Weather', text: '' }, O), 'a US political committee needs no page signal');
  assert.ok(!src.applies({ label: 'Conservative Party', kind: 'organization', country: 'GB', instanceOf: ['Q7278'] }, { title: 'PAC donations', text: '' }, O), 'a party of another country is never looked up at the FEC');
  assert.ok(!src.applies({ label: 'Conservative Party', kind: 'organization', country: '', instanceOf: ['Q7278'] }, { title: 'Weather', text: '' }, O), 'nor a party whose country is unknown');
  assert.strictEqual(F.currentCycle(new Date('2027-01-05T00:00:00Z')), 2026, 'in January the cycle just ended is still open: year-end reports are not in');
  assert.strictEqual(F.currentCycle(new Date('2027-02-05T00:00:00Z')), 2028);

  // ---- matching
  const exact = committee({});
  assert.strictEqual(F.matchCommittee(org, [exact]).committee.committee_id, 'C00000001', 'connected organization matches after normalizing');
  assert.strictEqual(F.matchCommittee({ label: 'Lockheed', kind: 'organization' }, [exact]), null, 'near name rejected');
  assert.strictEqual(F.matchCommittee(org, [committee({ committee_type: 'C' })]), null, 'same name, wrong committee type');
  assert.strictEqual(F.matchCommittee(org, [committee({ organization_type: null })]), null, 'no connected organization type');
  assert.strictEqual(F.matchCommittee(org, [committee({ committee_type: 'W' })]), null, 'non-contribution account type left out');
  assert.strictEqual(F.matchCommittee(org, [committee({ cycles: [2024, 2026] }), committee({ committee_id: 'C00000002', cycles: [2024, 2026] })], NOW), null, 'two filing now: not chosen');
  assert.strictEqual(F.matchCommittee(org, [committee({ cycles: [2024, 2026] }), committee({ committee_id: 'C00000002', cycles: [1998, 2000] })], NOW).committee.committee_id, 'C00000001', 'a terminated namesake does not block');
  const party = { label: 'Example Party of Ohio', kind: 'organization', instanceOf: ['Q7278'] };
  assert.ok(F.matchCommittee(party, [committee({ name: 'EXAMPLE PARTY OF OHIO', committee_type: 'Y', affiliated_committee_name: null })]), 'a party matches by its registered name');
  assert.strictEqual(F.matchCommittee(party, [committee({ name: 'EXAMPLE PARTY OF OHIO', committee_type: 'H', affiliated_committee_name: null })]), null, 'never a candidate committee');

  // ---- cycles
  const pts = F.cyclePoints(totals([[2026, 5e6], [2024, 4e6], [2020, 3e6], [2018, 2e6]]).results, NOW);
  assert.deepStrictEqual(pts.map((p) => p.t), ['2018', '2020', '2022', '2024'], 'current cycle dropped, gap kept');
  assert.strictEqual(pts[2].v, null, 'a cycle with no filing stays null');
  assert.strictEqual(F.cyclePoints(totals([[2024, null]]).results, NOW)[0].v, null, 'a missing figure stays null, not zero');

  // ---- happy path
  let io = fakeIo([[/\/committees\//, ok({ results: [exact] })], [/\/totals\//, ok(totals([[2026, 3.8e6, '2026-10-14T00:00:00'], [2024, 4.1e6], [2022, 4.3e6], [2020, 4.8e6], [2018, 4.7e6], [2016, 4.7e6]]))]]);
  const r = await src.run(org, {}, io, NOW, O);
  assert.ok(r && r.chart, 'chart returned');
  assert.strictEqual(io.calls.length, 2, 'two requests');
  assert.strictEqual(r.chart.resolution, 'cycle');
  assert.strictEqual(r.chart.nominal, true);
  assert.ok(!r.chart.points.some((p) => p.t === '2026'), 'open cycle not drawn');
  assert.ok(/C00000001/.test(r.chart.sentence) && /connected organization as "LOCKHEED MARTIN CORPORATION"/.test(r.chart.sentence), r.chart.sentence);
  assert.ok(/still open/.test(r.chart.sentence) && /14 Oct 2026/.test(r.chart.sentence), 'open cycle stated in words');
  assert.strictEqual(r.chart.source.url, 'https://www.fec.gov/data/committee/C00000001/');

  // ---- the key never reaches a returned field
  assert.ok(!JSON.stringify(r).includes(KEY), 'key not in result');
  assert.strictEqual(src.sends(org, {}), "the organization name 'Lockheed Martin' to the FEC (nothing is sent without your key)", 'sends names what leaves, with the contract arguments');

  // ---- errors
  for (const [status, msg] of [[429, F.MSG.limit], [403, F.MSG.badkey], [500, F.MSG.failed]]) {
    io = fakeIo([[/./, { status, text: '{"error":{"code":"X"}}' }]]);
    const e = await src.run(org, {}, io, NOW, O);
    assert.ok(e && e.chart === null && e.error === msg, status + ' gives the message');
    assert.ok(!JSON.stringify(e).includes(KEY), status + ': key not in result');
  }
  const thrown = await src.run(org, {}, { get: async () => { throw new Error('GET https://api.open.fec.gov/?api_key=' + KEY); } }, NOW, O);
  assert.ok(thrown.error === F.MSG.failed && !JSON.stringify(thrown).includes(KEY), 'exception text not passed on');

  // ---- no key: no request
  io = fakeIo([]);
  const nk = await src.run(org, {}, io, NOW, {});
  assert.strictEqual(io.calls.length, 0, 'no request without a key');
  assert.strictEqual(nk.error, F.MSG.nokey);

  // ---- too few cycles: nothing
  io = fakeIo([[/\/committees\//, ok({ results: [exact] })], [/\/totals\//, ok(totals([[2024, 1e5], [2022, 1e5]]))]]);
  assert.strictEqual(await src.run(org, {}, io, NOW, O), null, 'too few cycles');

  console.log('Context FEC: page signal, matching, cycles, errors and key handling passed.');
})().catch((e) => { console.error(e); process.exit(1); });
