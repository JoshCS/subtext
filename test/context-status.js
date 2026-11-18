/* status_incidents: incidents a vendor reported on its own status page (Atlassian Statuspage public feed, /api/v2/incidents.json).
   Responses are synthetic, in the real response shape (invented vendor, hosts, ids, names and dates; no recorded third-party content). */
const assert = require('assert');
const X = require('../extension/context-data.js');
require('../extension/context-status.js');
const S = X.REGISTERED.status_incidents;

const NOW = new Date('2026-11-17T12:00:00Z');
const ORIGIN = 'https://status.example.com';
const FEED = ORIGIN + '/api/v2/incidents.json';
const F = (extra) => Object.assign({ url: 'https://www.example.com/pricing?plan=team', domain: 'example.com', registrable: 'example.com', siteName: 'Example Co', brand: 'Example Co', group: 'other', root: false,
  title: 'Pricing', text: 'page text must never be sent', statusPages: [ORIGIN] }, extra || {});

let seq = 0;
/* one entry as Statuspage lists it. `at` is the creation time; it is resolved two hours later unless `extra` says otherwise. */
const inc = (at, impact, extra) => {
  const id = 'inc' + String(++seq).padStart(9, '0');
  const created = at.length === 10 ? at + 'T09:30:00.000Z' : at;
  const resolved = new Date(Date.parse(created) + 2 * 3600e3).toISOString();
  return Object.assign({ id, name: 'Elevated error rates on the Example API', status: 'resolved', created_at: created, updated_at: resolved, monitoring_at: null, resolved_at: resolved,
    impact, shortlink: 'https://stspg.io/' + id, started_at: created, page_id: 'pg1example00',
    incident_updates: [{ id: 'upd' + id, status: 'resolved', body: 'This incident has been resolved.', incident_id: id, created_at: resolved, updated_at: resolved, display_at: resolved, affected_components: null }],
    components: [{ id: 'cmp1example0', name: 'API', status: 'operational', page_id: 'pg1example00' }], reminder_intervals: null }, extra || {});
};
// the vendor lists entries by when they were resolved, newest first
const byResolved = (list) => list.slice().sort((a, b) => Date.parse(b.resolved_at || '2100-01-01') - Date.parse(a.resolved_at || '2100-01-01'));
const body = (list, page) => JSON.stringify({ page: Object.assign({ id: 'pg1example00', name: 'Example Co', url: ORIGIN, time_zone: 'Etc/UTC', updated_at: '2026-11-17T06:00:00.000Z' }, page || {}), incidents: byResolved(list) });

function fakeIo(res) {
  const calls = [];
  return { calls, get: async (url, opt) => { calls.push({ url, opt }); return typeof res === 'function' ? res(url) : res; } };
}
const ok = (text) => ({ status: 200, text });
const never = () => fakeIo(() => { throw new Error('must not be called'); });
const run = async (list, f, now, page) => { const io = fakeIo(ok(body(list, page))); const r = await S.run(f || F(), io, now || NOW); return { r, c: r && r.chart, io }; };

// ---- the happy feed: 20 entries from January to November 2026
const HAPPY = () => [
  inc('2026-01-20', 'minor'), // the oldest entry: January is not fully covered
  inc('2026-02-03', 'minor'), inc('2026-02-19', 'major'),
  inc('2026-03-15', 'none'),
  inc('2026-04-02', 'critical'), inc('2026-04-11', 'minor'), inc('2026-04-27', 'minor'),
  inc('2026-05-08', 'minor'),
  inc('2026-06-12', 'maintenance', { status: 'completed', scheduled_for: '2026-06-12T09:30:00.000Z', scheduled_until: '2026-06-12T11:30:00.000Z' }),
  inc('2026-07-01', 'major'), inc('2026-07-09', 'none'), inc('2026-07-14', 'major'), inc('2026-07-22', 'minor'), inc('2026-07-30', 'minor'),
  inc('2026-08-18', 'minor'),
  inc('2026-09-04', 'minor'), inc('2026-09-25', 'major', { name: 'Delayed webhooks' }),
  inc('2026-10-13', 'critical', { name: 'Sign-in unavailable' }),
  inc('2026-11-03', 'minor'), inc('2026-11-10', 'major', { name: 'Slow dashboard loads' }) // the month in progress
];

(async () => {
  let n = 0;
  // ---- applies / sends
  assert.strictEqual(S.basis, 'records'); assert.strictEqual(S.scope, 'page');
  for (const g of ['other', 'organization', 'shop']) assert.ok(S.applies(F({ group: g })), 'applies on a page about the site itself: ' + g);
  for (const g of ['news', 'evergreen']) assert.ok(!S.applies(F({ group: g })), 'an article is not about the site: ' + g);
  assert.ok(!S.applies(F({ statusPages: [] })) && !S.applies(F({ statusPages: undefined })) && !S.applies(F({ statusPages: 'https://status.example.com' })), 'no status link on the page: does not apply');
  assert.strictEqual(S.sends(F()), 'a request to this site\'s status page (status.example.com)');
  assert.strictEqual(S.sends(F({ statusPages: ['https://www.examplestatus.com/'] })), 'nothing', 'a host that is not under the site\'s own domain is never named and never asked');
  assert.ok(!S.applies(F({ statusPages: ['https://www.examplestatus.com/'] })) && !S.applies(F({ statusPages: ['https://example.statuspage.io'] })), 'another host: does not apply');
  assert.strictEqual(S.sends(F({ statusPages: ['https://status.example.com', 'https://example.statuspage.io'] })), 'a request to this site\'s status page (status.example.com)', 'the other host is left out');
  assert.strictEqual(S.sends(F({ statusPages: ['https://status.example.com', 'https://uptime.example.com'] })), 'a request to this site\'s status page (status.example.com), then to uptime.example.com if the first has no incident feed');
  assert.ok(!/pricing|plan=|page text/i.test(S.sends(F())), 'nothing about the page in the line');
  n += 5;

  // ---- a status link on a private host, plain http, a port or with credentials is never requested
  for (const bad of ['http://status.example.com', 'https://status.example.local', 'https://status.internal', 'https://10.0.0.5', 'https://192.168.1.20/status', 'https://localhost', 'https://intranet',
    'https://[::1]', 'https://status.example.com:8443', 'https://user:pw@status.example.com', 'https://status.example.com.', 'ftp://status.example.com', 'javascript:alert(1)', 'not a url', '', null, 42]) {
    const f = F({ statusPages: [bad] });
    assert.ok(!S.applies(f), 'does not apply for ' + bad);
    assert.strictEqual(await S.run(f, never(), NOW), null, 'no request for ' + bad);
    assert.strictEqual(S.sends(f), 'nothing');
  }
  { const io = fakeIo(ok(body(HAPPY()))); const r = await S.run(F({ statusPages: ['http://status.example.com', ORIGIN + '/history?utm=1#x'] }), io, NOW);
    assert.strictEqual(io.calls.length, 1); assert.strictEqual(io.calls[0].url, FEED, 'only the https origin is asked, and only the fixed path'); assert.ok(r && r.chart); }
  { const io = never(); assert.strictEqual(await S.run(F({ group: 'news' }), io, NOW), null, 'an article: no request'); }
  n += 3;

  // ---- happy path
  let { r, c, io } = await run(HAPPY());
  assert.strictEqual(io.calls.length, 1, 'one request');
  assert.strictEqual(io.calls[0].url, FEED, 'the fixed path on the linked origin');
  assert.strictEqual(io.calls[0].opt.accept, 'application/json'); assert.ok(!io.calls[0].opt.cookies, 'no cookies');
  assert.strictEqual(io.calls[0].opt.redirect, 'error', 'a status host that redirects is not followed: the request fails instead');
  assert.ok(!/pricing|plan|Example%20Co|text/i.test(io.calls[0].url), 'no page address, name or text in the request');
  assert.deepStrictEqual(r.facts, []);
  assert.strictEqual(c.id, 'status_incidents'); assert.strictEqual(c.basis, 'records'); assert.strictEqual(c.kind, 'bars'); assert.strictEqual(c.resolution, 'month'); assert.strictEqual(c.unit, 'incidents');
  assert.ok(!('about' in c) && !('aboutLabel' in c), 'the source does not say what the chart is about: on an inner page the router labels it as about the site');
  assert.strictEqual(c.title, 'Incidents Example Co reported on its own status page');
  assert.deepStrictEqual(c.points, [{ t: '2026-02', v: 2 }, { t: '2026-03', v: 0 }, { t: '2026-04', v: 3 }, { t: '2026-05', v: 1 }, { t: '2026-06', v: 0 }, { t: '2026-07', v: 4 }, { t: '2026-08', v: 1 }, { t: '2026-09', v: 2 }, { t: '2026-10', v: 1 }]);
  assert.strictEqual(c.sentence, 'Example Co\'s own status page lists 14 incidents with an impact from Feb 2026 to Oct 2026: 2 critical, 4 major and 8 minor, by its own labels. The most in one month was 4, in Jul 2026. 2 of the 9 months list none.');
  assert.strictEqual(c.note, 'This is Example Co\'s own account, not an independent record. Entries it labelled as no impact (2) and scheduled maintenance are not counted. The feed returns only the most recent entries (20 here), so earlier months are not shown. Dates are in UTC.');
  assert.deepStrictEqual(c.source, { name: 'Example Co status page (status.example.com)', url: ORIGIN + '/history' });
  assert.strictEqual(c.rows.length, 6, 'six most recent counted incidents');
  assert.deepStrictEqual(c.rows.map((x) => x.t), ['2026-11-10', '2026-11-03', '2026-10-13', '2026-09-25', '2026-09-04', '2026-08-18'], 'newest first, whatever order the feed uses');
  assert.strictEqual(c.rows[0].text, 'Slow dashboard loads (major)'); assert.strictEqual(c.rows[2].text, 'Sign-in unavailable (critical)');
  assert.ok(c.rows.every((x) => /^https:\/\/status\.example\.com\/incidents\/inc\d{9}$/.test(x.url)), 'each row links to the incident on the status page itself');
  assert.ok(/own impact label/.test(c.rowsLabel) && /Example Co/.test(c.rowsLabel), c.rowsLabel);
  assert.ok(!/because|outage-prone|unreliable|reliable|poor|good|bad|frequent|often|only \d/i.test(c.sentence + ' ' + c.title), 'observations only');
  assert.ok(!/stspg|page_id|incident_updates|has been resolved/.test(JSON.stringify(r)), 'no shortener link and no update text in the result');
  n += 10;

  // ---- the month in progress is dropped; it is drawn once it has finished
  assert.ok(!c.points.some((p) => p.t === '2026-11'), 'November 2026 is in progress on 17 Nov');
  ({ c } = await run(HAPPY(), F(), new Date('2026-12-01T00:30:00Z')));
  assert.deepStrictEqual(c.points[c.points.length - 1], { t: '2026-11', v: 2 }, 'drawn on 1 Dec');
  n += 2;

  // ---- months before the window are not counted as zero: the oldest entry's own month and everything earlier are absent
  ({ c } = await run(HAPPY()));
  assert.strictEqual(c.points[0].t, '2026-02', 'starts the month after the oldest entry');
  assert.ok(!c.points.some((p) => p.t <= '2026-01'), 'January 2026 has an incident in the feed and is still not drawn; 2025 is not drawn as zeros');
  n += 2;

  // ---- the feed is ordered by resolution: an old entry that took days to resolve moves the start one month later
  { const tail = HAPPY(); tail[0] = inc('2026-01-28', 'minor', { resolved_at: '2026-02-03T10:00:00.000Z', updated_at: '2026-02-03T10:00:00.000Z' });
    ({ c } = await run(tail));
    assert.strictEqual(c.points[0].t, '2026-03', 'an incident created on 1 Feb and resolved on 2 Feb could be missing from the feed: February is not covered');
    assert.ok(/lists 12 incidents with an impact from Mar 2026 to Oct 2026/.test(c.sentence), c.sentence);
    // an open entry (no resolution time) is placed by its last update
    const open = HAPPY(); open.push(inc('2026-11-16', 'major', { status: 'investigating', resolved_at: null, updated_at: '2026-11-16T10:00:00.000Z' }));
    ({ c } = await run(open));
    assert.strictEqual(c.points[0].t, '2026-02'); assert.strictEqual(c.rows[0].t, '2026-11-16', 'an open incident is listed');
    // any order gives the same answer
    const a = (await run(HAPPY())).c; seq -= 20; const shuffled = HAPPY().reverse(); const moved = shuffled.splice(3, 5); shuffled.push(...moved);
    const b = (await S.run(F(), fakeIo(ok(JSON.stringify({ page: { id: 'pg1example00', name: 'Example Co' }, incidents: shuffled }))), NOW)).chart;
    assert.deepStrictEqual(b.points, a.points); assert.strictEqual(b.sentence, a.sentence); assert.deepStrictEqual(b.rows.map((x) => x.t), a.rows.map((x) => x.t)); }
  n += 3;

  // ---- a quiet service: months with no incident are true zeros, and the sentence says where the list stops
  const QUIET = () => [inc('2025-02-10', 'minor'), inc('2025-05-05', 'major'), inc('2025-09-18', 'minor'), inc('2026-01-22', 'minor'), inc('2026-04-02', 'critical'), inc('2026-08-14', 'minor'), inc('2026-08-30', 'minor')];
  ({ c } = await run(QUIET()));
  assert.strictEqual(c.kind, 'bars'); assert.strictEqual(c.points.length, 20, 'Mar 2025 to Oct 2026');
  assert.strictEqual(c.points[0].t, '2025-03'); assert.strictEqual(c.points[19].t, '2026-10');
  assert.strictEqual(c.points.filter((p) => p.v === 0).length, 15, 'fifteen true zeros'); assert.ok(c.points.every((p) => typeof p.v === 'number'), 'a zero is 0, never null');
  assert.strictEqual(c.sentence, 'Example Co\'s own status page lists 6 incidents with an impact from Mar 2025 to Oct 2026: 1 critical, 1 major and 4 minor, by its own labels. The most in one month was 2, in Aug 2026. 15 of the 20 months list none. The latest incident with an impact it lists is dated 30 Aug 2026.');
  n += 3;

  // ---- a long window: at most the last 24 months are drawn, and older incidents are not in the count
  { const long = [inc('2023-06-10', 'major'), inc('2023-09-01', 'minor'), inc('2024-03-03', 'critical'), inc('2024-12-12', 'minor'), inc('2025-03-03', 'minor'), inc('2025-03-20', 'minor'), inc('2025-10-10', 'major'), inc('2026-02-02', 'minor'), inc('2026-10-20', 'minor')];
    ({ c } = await run(long));
    assert.strictEqual(c.points.length, 24); assert.strictEqual(c.points[0].t, '2024-11'); assert.strictEqual(c.points[23].t, '2026-10');
    assert.strictEqual(c.sentence, 'Example Co\'s own status page lists 6 incidents with an impact from Nov 2024 to Oct 2026: 1 major and 5 minor, by its own labels. The most in one month was 2, in Mar 2025. 19 of the 24 months list none.');
    assert.ok(/Only the last 24 months are shown\./.test(c.note) && !/earlier months are not shown/.test(c.note), c.note); }
  n += 2;

  // ---- fewer than the minimum: a dated list, or nothing
  { // a busy service: the feed reaches back to July, so only Aug to Oct are covered (3 months < 6)
    const busy = []; for (const m of ['07', '08', '09', '10']) for (const d of ['05', '09', '14', '21', '27']) busy.push(inc('2026-' + m + '-' + d, d === '14' ? 'major' : 'minor'));
    busy.push(inc('2026-11-10', 'critical'));
    ({ r, c } = await run(busy));
    assert.strictEqual(c.kind, 'list'); assert.deepStrictEqual(c.points, []); assert.strictEqual(c.rows.length, 6); assert.strictEqual(c.rows[0].t, '2026-11-10');
    assert.strictEqual(c.sentence, 'Example Co\'s own status page lists 20 incidents with an impact from 9 Jul 2026 to 10 Nov 2026: 1 critical, 4 major and 15 minor, by its own labels.', 'the day of the oldest entry is not fully covered and is left out');
    assert.strictEqual(c.title, 'Incidents Example Co reported on its own status page'); assert.ok(!('about' in c));
    assert.strictEqual(c.note, 'This is Example Co\'s own account, not an independent record. Entries it labelled as no impact and scheduled maintenance are not counted. The feed returns only the most recent entries (21 here). Dates are in UTC.');
    assert.ok(!/month/.test(c.sentence), 'a list claims nothing about months');
    // an old entry that took two weeks to resolve: incidents created and resolved in between can be missing, so the list starts after the earliest resolution
    busy[0] = inc('2026-07-05', 'minor', { resolved_at: '2026-07-20T10:00:00.000Z', updated_at: '2026-07-20T10:00:00.000Z' });
    ({ c } = await run(busy));
    assert.strictEqual(c.sentence, 'Example Co\'s own status page lists 19 incidents with an impact from 14 Jul 2026 to 10 Nov 2026: 1 critical, 4 major and 14 minor, by its own labels.', 'the earliest resolution in the feed is on 9 Jul: the list starts the day after');
    assert.ok(c.rows.every((x) => x.t > '2026-07-09'), 'rows come from the same days');
    // enough months, too few incidents inside them (4 < 5): a list
    ({ c } = await run([inc('2025-12-10', 'minor'), inc('2026-02-10', 'minor'), inc('2026-05-10', 'minor'), inc('2026-07-10', 'minor'), inc('2026-09-10', 'minor')]));
    assert.strictEqual(c.kind, 'list'); assert.strictEqual(c.sentence, 'Example Co\'s own status page lists 4 incidents with an impact from 10 Feb 2026 to 10 Sep 2026, all labelled minor by the vendor.');
    // exactly at the minimum: 6 covered months and 5 incidents inside them
    ({ c } = await run([inc('2026-04-10', 'minor'), inc('2026-05-10', 'minor'), inc('2026-06-10', 'major'), inc('2026-07-10', 'minor'), inc('2026-09-10', 'minor'), inc('2026-10-10', 'minor')]));
    assert.strictEqual(c.kind, 'bars'); assert.strictEqual(c.points.length, 6);
    // five covered months: a list
    ({ c } = await run([inc('2026-05-10', 'minor'), inc('2026-06-10', 'major'), inc('2026-07-10', 'minor'), inc('2026-08-10', 'minor'), inc('2026-09-10', 'minor'), inc('2026-10-10', 'minor')]));
    assert.strictEqual(c.kind, 'list');
    // three counted incidents: a list. Two: nothing
    ({ c } = await run([inc('2026-02-10', 'none'), inc('2026-03-10', 'minor'), inc('2026-06-10', 'major'), inc('2026-09-10', 'minor'), inc('2026-09-12', 'none')]));
    assert.strictEqual(c.kind, 'list'); assert.strictEqual(c.rows.length, 3);
    ({ r } = await run([inc('2026-02-10', 'none'), inc('2026-03-10', 'minor'), inc('2026-06-10', 'major'), inc('2026-09-12', 'none'), inc('2026-10-12', 'none')]));
    assert.strictEqual(r, null, 'two counted incidents: nothing');
    ({ r } = await run([inc('2026-03-10', 'minor'), inc('2026-06-10', 'major'), inc('2026-09-10', 'minor')]));
    assert.strictEqual(r, null, 'three in the feed, two on fully covered days: nothing');
    ({ r } = await run([]));
    assert.strictEqual(r, null, 'an empty feed: nothing'); }
  n += 9;

  // ---- impact "none" and maintenance are ignored, however the vendor marks maintenance
  { const list = QUIET().concat([inc('2026-03-03', 'none'), inc('2026-03-09', 'none'), inc('2026-03-21', 'none'),
      inc('2026-05-05', 'maintenance'), inc('2026-05-06', 'minor', { scheduled_for: '2026-05-06T09:30:00.000Z' }), inc('2026-05-07', 'major', { status: 'completed' }), inc('2026-05-08', 'critical', { status: 'in_progress' }),
      inc('2026-06-06', 'severe'), inc('2026-06-07', '') ]);
    ({ c } = await run(list));
    assert.strictEqual(c.points.find((p) => p.t === '2026-03').v, 0, 'three "none" entries in March: still 0');
    assert.strictEqual(c.points.find((p) => p.t === '2026-05').v, 0, 'maintenance in May: still 0');
    assert.strictEqual(c.points.find((p) => p.t === '2026-06').v, 0, 'an unknown label is not counted');
    assert.ok(/^Example Co's own status page lists 6 incidents /.test(c.sentence), c.sentence);
    assert.ok(/Entries it labelled as no impact \(3\) and scheduled maintenance are not counted\./.test(c.note), c.note);
    assert.ok(!c.rows.some((x) => /none|maintenance|severe/.test(x.text)), 'ignored entries are not listed');
    // a vendor that labels everything "none": nothing, never a chart of zeros
    const flat = []; for (let m = 1; m <= 10; m++) for (const d of ['04', '12', '20', '26']) flat.push(inc('2026-' + String(m).padStart(2, '0') + '-' + d, 'none'));
    ({ r } = await run(flat));
    assert.strictEqual(r, null, 'every entry labelled no impact: nothing'); }
  n += 4;

  // ---- dates carry the vendor's local offset; months and days are UTC
  { const list = HAPPY().concat([inc('2026-10-31T20:00:00.000-08:00', 'major', { name: 'Late on the last day of October, Pacific time' })]);
    ({ c } = await run(list));
    assert.strictEqual(c.points.find((p) => p.t === '2026-10').v, 1, '04:00 UTC on 1 Nov belongs to November');
    assert.ok(c.rows.some((x) => x.t === '2026-11-01' && /Pacific time/.test(x.text)), 'listed under its UTC date');
    // an entry dated after now is ignored
    ({ c } = await run(HAPPY().concat([inc('2026-12-25', 'critical', { name: 'Dated in the future' })])));
    assert.ok(!JSON.stringify(c).includes('Dated in the future')); assert.ok(/\(20 here\)/.test(c.note), c.note); }
  n += 3;

  // ---- nothing of any kind for a year: nothing (a quiet service and an abandoned page look the same)
  { const old = [inc('2024-01-10', 'minor'), inc('2024-03-10', 'major'), inc('2024-06-10', 'minor'), inc('2024-09-10', 'minor'), inc('2025-02-10', 'critical'), inc('2025-06-24', 'minor')];
    ({ r } = await run(old));
    assert.strictEqual(r, null, 'newest entry June 2025, read in November 2026');
    ({ c } = await run(old.concat([inc('2026-01-05', 'none')])));
    assert.ok(c && c.kind === 'list', 'an entry inside the year shows the page is kept; two incidents in the last 24 months are a list, not a chart');
    assert.strictEqual(c.sentence, 'Example Co\'s own status page lists 5 incidents with an impact from 10 Mar 2024 to 24 Jun 2025: 1 critical, 1 major and 3 minor, by its own labels.'); }
  n += 2;

  // ---- a history imported into a new status page: every imported entry carries the day of the import, and its resolution date is years earlier
  { const imported = []; for (let i = 0; i < 18; i++) imported.push(inc('2026-03-02T08:00:' + String(i).padStart(2, '0') + '.000Z', i % 3 ? 'major' : 'minor', { resolved_at: new Date(Date.UTC(2019, i % 12, 5 + i)).toISOString(), name: 'Imported entry' }));
    const since = [inc('2026-03-20', 'minor'), inc('2026-05-11', 'major'), inc('2026-08-03', 'minor'), inc('2026-11-04', 'critical')];
    ({ c } = await run(imported.concat(since)));
    assert.strictEqual(c.kind, 'list', 'eight months since the import, four incidents in them: a list');
    assert.strictEqual(c.sentence, 'Example Co\'s own status page lists 4 incidents with an impact from 20 Mar 2026 to 4 Nov 2026: 1 critical, 1 major and 2 minor, by its own labels.', 'imported entries are not dated to the day of the import');
    assert.ok(!JSON.stringify(c).includes('Imported entry') && !c.rows.some((x) => x.t === '2026-03-02'), 'no imported entry is listed under the import date');
    ({ c } = await run(imported.concat(since, [inc('2026-06-01', 'minor'), inc('2026-09-09', 'minor'), inc('2026-10-05', 'minor')])));
    assert.strictEqual(c.kind, 'bars'); assert.strictEqual(c.points[0].t, '2026-04', 'months start after the month of the import, never at the imported resolution dates');
    assert.strictEqual(c.points.reduce((a, p) => a + p.v, 0), 5, 'May, June, August, September and October: nothing imported is counted');
    ({ c } = await run(imported.concat([inc('2026-05-11', 'major'), inc('2026-06-01', 'minor'), inc('2026-08-03', 'minor'), inc('2026-09-09', 'minor'), inc('2026-10-05', 'minor')])));
    assert.strictEqual(c.kind, 'bars'); assert.strictEqual(c.rows.length, 5, 'five incidents since the import: five rows, none of them an imported entry under the import date');
    assert.ok(!JSON.stringify(c).includes('Imported entry'));
    ({ r } = await run(imported));
    assert.strictEqual(r, null, 'only imported entries: nothing');
    // one incident posted two weeks after it ended: not counted, and nothing before its posting date is counted
    const lateOne = HAPPY(); lateOne.push(inc('2026-06-20', 'critical', { resolved_at: '2026-06-05T12:00:00.000Z', name: 'Posted later' }));
    ({ c } = await run(lateOne));
    assert.strictEqual(c.sentence, 'Example Co\'s own status page lists 10 incidents with an impact from 1 Jul 2026 to 10 Nov 2026: 1 critical, 4 major and 5 minor, by its own labels.', 'July to October are four covered months: a list that starts after the posting date');
    assert.ok(!JSON.stringify(c).includes('Posted later'));
    // a few hours of back-dating is ordinary and changes nothing
    const backdated = HAPPY(); backdated[5] = inc('2026-04-11', 'minor', { resolved_at: '2026-04-11T02:00:00.000Z' });
    ({ c } = await run(backdated));
    assert.strictEqual(c.points[0].t, '2026-02'); assert.strictEqual(c.points.find((p) => p.t === '2026-04').v, 3); }
  n += 7;

  // ---- the 25-entry feed some status pages serve on the same path: no shortlink, started_at or time zone
  { const slim = HAPPY().map((x, i) => ({ id: '01M' + String(i).padStart(23, '0').replace(/0/g, 'A').slice(0, 21) + String(i).padStart(2, '0'), name: x.name, status: x.status, created_at: x.created_at.replace('.000Z', 'Z'), updated_at: x.updated_at.replace('.000Z', 'Z'), resolved_at: x.resolved_at.replace('.000Z', 'Z'), impact: x.impact, page_id: '01PAGEEXAMPLE', incident_updates: [] }));
    const io2 = fakeIo(ok(JSON.stringify({ page: { id: '01PAGEEXAMPLE', name: 'Example Co', url: ORIGIN + '/', updated_at: '2026-11-16T00:00:00Z' }, incidents: slim })));
    const r2 = await S.run(F(), io2, NOW);
    assert.strictEqual(r2.chart.kind, 'bars'); assert.strictEqual(r2.chart.points.length, 9);
    assert.ok(/^Example Co's own status page lists 14 incidents /.test(r2.chart.sentence), 'same count as the full shape; the maintenance entry has no scheduled_for here and is left out by its impact label: ' + r2.chart.sentence);
    assert.ok(r2.chart.rows.every((x) => /^https:\/\/status\.example\.com\/incidents\/01M[A-Z0-9]+$/.test(x.url)), r2.chart.rows[0].url); }
  n += 2;

  // ---- long names are capped; markup in a name is never passed on; a link is built from the origin, never taken from the feed
  { const list = HAPPY();
    list.push(inc('2026-11-12', 'major', { name: 'A'.repeat(40) + ' ' + 'very long incident name '.repeat(12), shortlink: 'javascript:alert(1)' }));
    list.push(inc('2026-11-13', 'minor', { name: '<img src=x onerror="alert(1)">Outage <b>now</b> <script>steal()</script>&lt;i&gt; a < b > c\n\tnext line', shortlink: 'https://evil.example.net/x' }));
    list.push(inc('2026-11-14', 'minor', { id: '../../admin?x=<y>', name: '' }));
    list.push(inc('2026-11-15', 'critical', { id: 12345, name: null }));
    ({ r, c } = await run(list));
    const [a, b, d, e] = [c.rows[3], c.rows[2], c.rows[1], c.rows[0]];
    assert.ok(a.text.length <= 90 + ' (major)'.length && a.text.endsWith(String.fromCharCode(8230) + ' (major)'), 'capped at 90 characters: ' + a.text.length);
    assert.ok(!/[<>]/.test(b.text) && !/\s{2}|\n|\t/.test(b.text), 'no angle brackets or raw whitespace: ' + b.text);
    assert.strictEqual(b.text, 'Outage now steal() &lt;i&gt; a c next line (minor)', 'tags removed, entities left as plain text for the card to escape');
    assert.strictEqual(d.text, 'Untitled incident (minor)'); assert.strictEqual(d.url, ORIGIN + '/history', 'an id that is not plain letters and digits is not put in a link');
    assert.strictEqual(e.text, 'Untitled incident (critical)'); assert.strictEqual(e.url, ORIGIN + '/history');
    assert.ok(!/javascript:|evil\.example\.net|onerror|<script|admin\?x/.test(JSON.stringify(r)), 'nothing from the feed becomes a link or markup');
    // the address the feed gives for itself is never used. Its name is used only when the site gave none (the feed sits on the site's own domain), cleaned like any feed string
    ({ c } = await run(HAPPY(), F({ siteName: '', brand: '' }), NOW, { name: '<b>Example</b> Co Status', url: 'https://evil.example.net' }));
    assert.strictEqual(c.title, 'Incidents Example Co reported on its own status page', 'the site gives no name: the feed\'s own short name, without markup or the word Status'); assert.ok(!/evil|Co Status|<b>/.test(JSON.stringify(c)));
    ({ c } = await run(HAPPY(), F({ siteName: '', brand: '' }), NOW, { name: '' }));
    assert.strictEqual(c.title, 'Incidents example.com reported on its own status page', 'neither gives a name: the domain');
    ({ c } = await run(HAPPY(), F({ siteName: 'Example: the all-you-need toolkit for small and growing teams', brand: '' }), NOW, { name: 'Example Co' }));
    assert.strictEqual(c.title, 'Incidents Example Co reported on its own status page', 'a page title in place of a site name: the feed\'s short name');
    ({ c } = await run(HAPPY(), F({ siteName: 'Example: the all-you-need toolkit for small and growing teams', brand: '' }), NOW, { name: '' }));
    assert.strictEqual(c.title, 'Incidents Example reported on its own status page', 'and with no feed name, the title cut at its first separator');
    ({ c } = await run(HAPPY(), F({ siteName: 'Example Co', brand: '' }), NOW, { name: 'Some Other Name' }));
    assert.strictEqual(c.title, 'Incidents Example Co reported on its own status page', 'the site\'s own name stands over the feed\'s');
    // a site name is cleaned the same way as a feed string
    ({ c } = await run(HAPPY(), F({ siteName: '<i>Example</i>\n Co', brand: '' })));
    assert.strictEqual(c.title, 'Incidents Example Co reported on its own status page'); }
  n += 7;

  // ---- a feed string is cut to 400 characters before any pattern runs on it: a 200,000-character run of "<" costs nothing
  { const list = HAPPY(); list[0].name = '<'.repeat(200000); list.push(inc('2026-11-12', 'major', { name: '<'.repeat(200000) + 'x' }));
    const text = body(list, { name: '<'.repeat(200000) });
    const t0 = process.hrtime.bigint(); const r5 = await S.run(F(), fakeIo(ok(text)), NOW); const took = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(r5 && r5.chart, 'the feed is still read');
    assert.ok(took < 200, 'a 200,000-character name took ' + took.toFixed(0) + ' ms (limit 200 ms)');
    assert.ok(r5.chart.rows.every((x) => x.text.length <= 90 + ' (critical)'.length && !/[<>]/.test(x.text)), 'and the name is still capped and plain');
    const t1 = process.hrtime.bigint(); await S.run(F({ siteName: '<'.repeat(200000) }), fakeIo(ok(body(HAPPY()))), NOW);
    assert.ok(Number(process.hrtime.bigint() - t1) / 1e6 < 200, 'a 200,000-character site name is cut first too'); }
  n += 4;

  // ---- whose status page: only a host under the site's own domain is asked. No other host is requested, whatever it calls itself
  { const refused = async (f, why) => { const io2 = never(); assert.ok(!S.applies(f), 'does not apply: ' + why); assert.strictEqual(await S.run(f, io2, NOW), null, why); assert.strictEqual(io2.calls.length, 0, 'not requested at all: ' + why); assert.strictEqual(S.sends(f), 'nothing'); };
    // a host that names itself after the site (a link anyone can post; the name in its feed is the host's own claim)
    await refused(F({ statusPages: ['https://www.examplestatus.com'] }), 'another host, even one whose feed is named "Example Co"');
    await refused(F({ statusPages: ['https://t98765.evil.example'] }), 'a planted host');
    await refused(F({ statusPages: ['https://example.statuspage.io'] }), 'a status vendor\'s host with the site\'s name in it');
    await refused(F({ statusPages: ['https://status.notexample.com'] }), 'a host that only ends with the same letters');
    await refused(F({ statusPages: ['https://example.com.evil.example'] }), 'the site\'s domain as a prefix of another host');
    await refused(F({ siteName: '', brand: '', statusPages: ['https://www.examplestatus.com'] }), 'another host, when the site gives no name');
    // the site's own host is not its status page, with or without www
    await refused(F({ statusPages: ['https://example.com', 'https://www.example.com'] }), 'the site\'s own host');
    // on the site's own domain the feed's name does not have to match (a product's status page under the company's domain), and is not shown
    ({ c } = await run(HAPPY(), F(), NOW, { name: 'Assistant' }));
    assert.ok(c && c.title === 'Incidents Example Co reported on its own status page' && !/Assistant/.test(JSON.stringify(c)));
    ({ c } = await run(HAPPY(), F({ statusPages: ['https://uptime.example.com'] })));
    assert.ok(c && c.source.url === 'https://uptime.example.com/history', 'any host under the site\'s domain that the page links as its status page');
    // a site on a hosting platform's domain: the platform's status page is not the site's, whether or not the platform is on the list of platforms
    await refused(F({ domain: 'shop.bigplatform.com', registrable: 'shop.bigplatform.com', siteName: 'Corner Candles', brand: 'Corner Candles', statusPages: ['https://status.bigplatform.com'] }), 'a tenant of a listed platform');
    await refused(F({ domain: 'shop.bigplatform.com', registrable: 'bigplatform.com', siteName: 'Corner Candles', brand: 'Corner Candles', statusPages: ['https://status.bigplatform.com'] }), 'a tenant of a platform that is not on the list: a page on a subdomain is given only a status host under that subdomain');
    await refused(F({ domain: 'shop.bigplatform.com', registrable: undefined, siteName: 'Corner Candles', brand: 'Corner Candles', statusPages: ['https://status.bigplatform.com'] }), 'no registrable domain given: the page\'s own host is the limit');
    ({ c } = await run(HAPPY(), F({ domain: 'app.example.com', statusPages: ['https://status.app.example.com'] })));
    assert.ok(c && c.source.url === 'https://status.app.example.com/history', 'a page on a subdomain: a status host under that subdomain');
    // a registrable domain that is not the page's own (a wrong fact): nothing
    await refused(F({ domain: 'example.com', registrable: 'other.example', statusPages: ['https://status.other.example'] }), 'a registrable domain the page is not on');
    await refused(F({ domain: 'example.com', registrable: 'com', statusPages: ['https://status.other.com'] }), 'a registrable domain that is only a suffix');
    ({ c } = await run(HAPPY(), F({ domain: 'example.co.uk', registrable: 'example.co.uk', siteName: '', brand: '', statusPages: ['https://status.example.co.uk'] }), NOW, { name: '' }));
    assert.ok(c && c.title === 'Incidents example.co.uk reported on its own status page', c && c.title);
    // a planted host listed before or after the site's own: only the site's own is asked
    for (const pages of [['https://t98765.evil.example', 'https://status.example.com'], ['https://status.example.com', 'https://t98765.evil.example']]) {
      const io2 = fakeIo((url) => (url.startsWith('https://status.example.com/') ? { status: 404, text: '' } : ok(body(HAPPY()))));
      assert.strictEqual(await S.run(F({ statusPages: pages }), io2, NOW), null); assert.deepStrictEqual(io2.calls.map((x) => x.url), [FEED], 'only the site\'s own status host: ' + pages.join(' ')); } }
  n += 15;

  // ---- two status links: the second is asked only when the first has no feed; never more than two requests
  { const f2 = F({ statusPages: ['https://status.example.com', 'https://uptime.example.com', 'https://third.example.com'] });
    let io2 = fakeIo((url) => (url.startsWith('https://status.example.com/') ? { status: 404, text: '<html>Not found</html>' } : ok(body(HAPPY(), { name: 'Example Co' }))));
    let r2 = await S.run(f2, io2, NOW);
    assert.deepStrictEqual(io2.calls.map((x) => x.url), [FEED, 'https://uptime.example.com/api/v2/incidents.json']);
    assert.ok(io2.calls.every((x) => x.opt.redirect === 'error'), 'neither request follows a redirect');
    assert.strictEqual(r2.chart.source.url, 'https://uptime.example.com/history');
    io2 = fakeIo(ok(body(HAPPY()))); r2 = await S.run(f2, io2, NOW);
    assert.strictEqual(io2.calls.length, 1, 'the first feed answered: one request');
    io2 = fakeIo({ status: 500, text: '' }); r2 = await S.run(f2, io2, NOW);
    assert.strictEqual(r2, null); assert.strictEqual(io2.calls.length, 2, 'never a third request');
    io2 = fakeIo(ok(body([inc('2026-10-01', 'minor')]))); r2 = await S.run(f2, io2, NOW);
    assert.strictEqual(r2, null); assert.strictEqual(io2.calls.length, 1, 'a real feed with too little in it is the answer: the second link is not asked'); }
  n += 4;

  // ---- not this feed: other products' JSON, the page summary, HTML, HTTP errors, broken JSON. Always null, never a throw.
  const summary = JSON.stringify({ page: { id: 'pg1example00', name: 'Example Co', url: ORIGIN }, status: { indicator: 'none', description: 'All Systems Operational' }, components: [], incidents: JSON.parse(body(HAPPY())).incidents.slice(0, 10) });
  const noDate = JSON.parse(body(HAPPY())); delete noDate.incidents[4].created_at;
  const badDate = JSON.parse(body(HAPPY())); badDate.incidents[4].created_at = 'last Tuesday';
  const noImpact = JSON.parse(body(HAPPY())); noImpact.incidents[4].impact = 3;
  for (const res of [
    ok('{"error":"No such page"}'), { status: 404, text: '{"status":404,"error":"Not Found"}' }, { status: 404, text: '<!DOCTYPE html><html><head><title>404 Not Found</title></head></html>' },
    { status: 403, text: '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code></Error>' }, { status: 500, text: '' }, { status: 0, text: '', error: 'TypeError: Failed to fetch' }, { status: 301, text: '' },
    ok('<!DOCTYPE html><html lang="en"><head><title>Example Co Status</title></head><body>All systems operational</body></html>'), ok('<div class="status">All services are online</div>'),
    ok(JSON.stringify({ data: { attributes: { aggregate_state: 'operational' } }, included: [] })), ok(JSON.stringify({ activeIncidents: [], activeMaintenances: [], page: { name: 'Example Co', status: 'UP' } })),
    ok(JSON.stringify({ incidents: JSON.parse(body(HAPPY())).incidents })), ok(JSON.stringify({ page: 'Example Co', incidents: [] })), ok(JSON.stringify({ page: { name: 'Example Co' }, incidents: { total: 3 } })),
    ok(JSON.stringify([{ id: 1, name: 'x' }])), ok('null'), ok('""'), ok('42'), ok(''), ok(body(HAPPY()).slice(0, 900)), ok(summary), ok(JSON.stringify(noDate)), ok(JSON.stringify(badDate)), ok(JSON.stringify(noImpact)),
    ok(JSON.stringify({ page: { name: 'Example Co' }, incidents: [null, 'x', 7] })), null, undefined, {}
  ]) {
    let out; try { out = await S.run(F(), fakeIo(res), NOW); } catch (e) { assert.fail('threw for ' + JSON.stringify(res).slice(0, 60) + ': ' + e); }
    assert.strictEqual(out, null, 'null for ' + JSON.stringify(res || null).slice(0, 70));
  }
  n += 6;

  // ---- the name shown is the site's; the feed's own name is never shown
  ({ c } = await run(HAPPY(), F({ siteName: 'Example', brand: 'Example Co' }), NOW, { name: 'Example Platform Status' }));
  assert.ok(c.title === 'Incidents Example reported on its own status page' && c.sentence.startsWith('Example\'s own status page lists 14 incidents'));
  ({ c } = await run(HAPPY(), F({ siteName: '', brand: 'Example Co' }), NOW, { name: 'Example Platform' }));
  assert.ok(c.sentence.startsWith('Example Co\'s own status page lists') && !/Platform/.test(JSON.stringify(c)));
  n += 2;

  // ---- a list whose incidents all fall on one day says "on", not "from A to A"
  { ({ c } = await run([inc('2026-11-02T01:00:00Z', 'minor'), inc('2026-11-02T05:00:00Z', 'minor'), inc('2026-11-02T09:00:00Z', 'minor'), inc('2026-10-20', 'minor')]));
    assert.strictEqual(c.kind, 'list');
    assert.strictEqual(c.sentence, 'Example Co\'s own status page lists 3 incidents with an impact on 2 Nov 2026, all labelled minor by the vendor.'); }
  n += 1;

  // ---- wording at the edges: one incident, a tie for the busiest month, one empty month
  { ({ c } = await run([inc('2026-04-10', 'minor'), inc('2026-05-10', 'minor'), inc('2026-05-11', 'major'), inc('2026-07-10', 'minor'), inc('2026-07-12', 'minor'), inc('2026-08-10', 'minor'), inc('2026-09-10', 'minor'), inc('2026-10-10', 'minor')]));
    assert.strictEqual(c.sentence, 'Example Co\'s own status page lists 7 incidents with an impact from May 2026 to Oct 2026: 1 major and 6 minor, by its own labels. The most in one month was 2, in May 2026 and Jul 2026. 1 of the 6 months lists none.');
    ({ c } = await run([inc('2026-03-10', 'minor'), inc('2026-04-10', 'major'), inc('2026-05-10', 'major'), inc('2026-06-10', 'major'), inc('2026-07-10', 'major'), inc('2026-08-10', 'major'), inc('2026-09-10', 'major'), inc('2026-10-10', 'major')]));
    assert.strictEqual(c.sentence, 'Example Co\'s own status page lists 7 incidents with an impact from Apr 2026 to Oct 2026, all labelled major by the vendor. The most in one month was 1, in 7 of the months.');
    assert.ok(!/ reported \d+ incidents with an impact on /.test(c.sentence), 'never worded as incidents that affected the status page'); }
  n += 2;

  console.log('Context status_incidents: ' + n + ' checks passed (only a linked host under the site domain is asked, redirects refused, private and http hosts refused, covered months, true zeros, month in progress, resolution-ordered window, none and maintenance ignored, minimum rule, stale feed, imported history, identity, second link, capped plain names, non-feed answers).');
})().catch((e) => { console.error(e); process.exit(1); });
