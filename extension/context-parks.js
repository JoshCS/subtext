/* Subtext context source: recreation visits by month to one US national park, from the National Park Service's own visitor statistics.
   Applies only on nps.gov pages whose first path segment is a four-letter park unit code (/grca/, /acad/). Site-wide sections are listed
   in NOT_UNITS and never reach the lookup. A code that is not a unit comes back as an empty list: no chart. Not on a news article
   (group 'news') and not under a path that contains /news/: a press release under a park's address is about its own story.
   Contract: docs/CONTEXT-CONTRACT.md.
   Response shape (probed 17 Nov 2026): GET https://irmaservices.nps.gov/v3/rest/stats/visitation?unitCodes=GRCA&startMonth=1&startYear=2021&endMonth=11&endYear=2026
   with Accept: application/json -> [{ UnitCode, UnitName, Year, Month (1-12), RecreationVisitors, NonRecreationVisitors }], one row per published
   month, ascending, several years in one answer. A month that is not published yet has no row (it is absent, not 0). A closed month is a row with
   RecreationVisitors 0 (Yosemite April and May 2020, Isle Royale each winter): kept as 0. On the probe day the newest row was December 2025.
   Request: one. Only the four-letter unit code is sent. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./context-data.js'));
  else factory(root.SubtextContextData);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (X) {
  'use strict';
  const U = X.util;
  const API = 'https://irmaservices.nps.gov/v3/rest/stats/visitation';
  const REPORT = 'https://irma.nps.gov/Stats/SSRSReports/Park%20Specific%20Reports/Recreation%20Visitors%20By%20Month%20(1979%20-%20Last%20Calendar%20Year)?Park=';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // first path segments on nps.gov that are not parks (the four-letter ones would otherwise pass the shape test)
  const NOT_UNITS = new Set(['subjects', 'orgs', 'aboutus', 'index.htm', 'planyourvisit', 'learn', 'places', 'parkhistory', 'media', 'news', 'people',
    'thingstodo', 'articles', 'lesson-plans', 'teachers', 'kids', 'jobs', 'maps', 'help', 'find', 'apps', 'arts', 'live', 'tools', 'data', 'docs',
    'getinvolved', 'management', 'search', 'calendar', 'subjects', 'upload', 'common', 'hfc', 'pdfhelp', 'state', 'parkhistory']);

  // 'GRCA' from https://www.nps.gov/grca/planyourvisit/index.htm, or '' when the page is not a park's
  function unitOf(f) {
    if (!f || !/^(?:www\.)?nps\.gov$/i.test(String(f.domain || ''))) return '';
    let u; try { u = new URL(String(f.url || '')); } catch (e) { return ''; }
    if (!/(^|\.)nps\.gov$/i.test(u.hostname)) return '';
    if (f.group === 'news' || /\/news\//i.test(u.pathname + '/')) return ''; // an article, or a park's news list: not a page about the park's visitors
    const seg = (u.pathname.split('/')[1] || '').toLowerCase();
    return /^[a-z]{4}$/.test(seg) && !NOT_UNITS.has(seg) ? seg.toUpperCase() : '';
  }
  const ym = (y, m) => y + '-' + String(m).padStart(2, '0');
  const count = (n) => Math.round(n).toLocaleString('en-US');

  X.register({
    id: 'park_visits',
    basis: 'statistic',
    scope: 'page',
    label: 'Recreation visits reported by the National Park Service',
    question: 'How many people visit this park, month by month?',
    applies: (f) => !!unitOf(f),
    sends: (f) => "the park's four-letter code (" + (unitOf(f) || 'the code') + "), taken from this page's address, to the National Park Service's visitor statistics service",
    async run(f, io, now) {
      const code = unitOf(f);
      if (!code) return null;
      now = now || new Date();
      const url = API + '?unitCodes=' + code + '&startMonth=1&startYear=' + (now.getUTCFullYear() - 5) + '&endMonth=' + (now.getUTCMonth() + 1) + '&endYear=' + now.getUTCFullYear();
      const r = await io.get(url, { accept: 'application/json' });
      if (!r || r.status !== 200) return null;
      const d = U.json(r.text);
      if (!Array.isArray(d)) return null;

      // one value per published month; a row without a number stays missing
      const by = new Map(); let name = '';
      for (const x of d) {
        if (!x || String(x.UnitCode || '').toUpperCase() !== code) continue; // identity: only the unit that was asked for
        const y = U.num(x.Year), m = U.num(x.Month);
        // a year from 1900 to the current one: the loop below walks every month from the first row to the last
        if (!Number.isInteger(y) || y < 1900 || y > now.getUTCFullYear() || !Number.isInteger(m) || m < 1 || m > 12) continue;
        const nm = String(x.UnitName || '').slice(0, 400).replace(/\s+/g, ' ').trim().slice(0, 120); if (nm && !name) name = nm;
        const v = U.num(x.RecreationVisitors);
        by.set(ym(y, m), v != null && v >= 0 ? v : null);
      }
      if (!name || !by.size) return null;

      // first to last published month; months in between with no row stay missing (a gap, never 0). Months after the last row are not published yet.
      const keys = [...by.keys()].sort();
      const raw = []; let y = Number(keys[0].slice(0, 4)), m = Number(keys[0].slice(5));
      const lastKey = keys[keys.length - 1];
      for (;;) { const k = ym(y, m); raw.push({ t: k, v: by.has(k) ? by.get(k) : null }); if (k >= lastKey) break; if (++m > 12) { m = 1; y++; } }
      const clean = U.cleanSeries(raw, 'month', now);
      while (clean.length && clean[clean.length - 1].v == null) clean.pop(); // after the last published month: not published yet, not a gap
      const points = clean.slice(-60);
      if (!U.validSeries(points)) return null;

      // latest calendar year with all twelve months, and the year before when it is complete too
      const total = (yr) => { const ps = points.filter((p) => p.t.startsWith(yr + '-')); return ps.length === 12 && ps.every((p) => p.v != null) ? { ps, sum: ps.reduce((a, p) => a + p.v, 0) } : null; };
      const years = [...new Set(points.map((p) => p.t.slice(0, 4)))].sort();
      let L = null, ly = '';
      for (let i = years.length - 1; i >= 0 && !L; i--) { L = total(years[i]); ly = years[i]; }
      let sentence;
      if (L && L.sum === 0) {
        // every month of the year reported 0 (a unit closed all year): there is no busiest month and no percentage to give
        sentence = name + ' reported no recreation visits in ' + ly + '.';
      } else if (L) {
        const P = total(String(Number(ly) - 1));
        sentence = name + ' reported ' + count(L.sum) + ' recreation visits in ' + ly + '.';
        if (P && P.sum > 0) {
          const pct = Math.round(Math.abs(L.sum - P.sum) / P.sum * 100);
          sentence += ' In ' + (Number(ly) - 1) + ' it reported ' + count(P.sum) + (L.sum === P.sum ? ', the same number.' : pct === 0 ? ', a difference of less than 1 percent.' : ', so ' + ly + ' was ' + pct + ' percent ' + (L.sum > P.sum ? 'higher' : 'lower') + '.');
        }
        const hi = L.ps.reduce((a, p) => (p.v > a.v ? p : a)), lo = L.ps.reduce((a, p) => (p.v < a.v ? p : a));
        const mn = (p) => MONTHS[Number(p.t.slice(5)) - 1];
        const zeros = L.ps.filter((p) => p.v === 0).map(mn);
        sentence += ' The busiest month of ' + ly + ' was ' + mn(hi) + ' (' + count(hi.v) + ').';
        sentence += zeros.length ? ' It reported 0 visits in ' + (zeros.length === 1 ? zeros[0] : zeros.slice(0, -1).join(', ') + ' and ' + zeros[zeros.length - 1]) + '.'
          : ' The quietest was ' + mn(lo) + ' (' + count(lo.v) + ').';
      } else {
        const s = X.summary(points);
        sentence = name + ' reported ' + count(s.peak.v) + ' recreation visits in ' + X.fmtT(s.peak.t) + ', its busiest month from ' + X.fmtT(points[0].t) + ' to ' + X.fmtT(points[points.length - 1].t) + '. The fewest was ' + count(s.low.v) + ', in ' + X.fmtT(s.low.t) + '.';
      }
      const gaps = points.filter((p) => p.v == null).length;
      if (gaps) sentence += ' ' + (gaps === 1 ? 'One month has' : gaps + ' months have') + ' no figure.';
      const lastT = points[points.length - 1].t;

      return { chart: {
        id: 'park_visits', basis: 'statistic', question: 'How many people visit this park, month by month?',
        about: 'subject', aboutLabel: name,
        title: 'Recreation visits: ' + name, sentence, kind: 'bars', resolution: 'month', points, unit: 'recreation visits',
        note: 'A recreation visit is one entry of a person onto park land or water for recreation; staff, contractors and people only passing through are not counted. Figures are Park Service counts and may be revised; the latest published month is ' + X.fmtT(lastT) + '.',
        source: { name: 'National Park Service, Visitor Use Statistics', url: REPORT + code }
      }, facts: [] };
    }
  });
  X.parkUnitOf = unitOf;
  return X;
});
