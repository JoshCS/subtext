/* Subtext: SEC records for an Entity that has an SEC central index key (entity.cik, Wikidata P5531).
   sec_financials: yearly revenue from the company's 10-K figures (XBRL company concepts), with net income for the latest year.
   sec_filings: the company's recent material filings from its EDGAR submissions file.
   Requests carry the CIK only. Contract: docs/CONTEXT-CONTRACT.md */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./context-data.js'));
  else factory(root.SubtextContextData);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (X) {
  'use strict';
  const U = X.util;

  const cik10 = (entity) => { const d = String((entity && entity.cik) || '').trim(); return /^\d{1,10}$/.test(d) && Number(d) > 0 ? d.padStart(10, '0') : ''; };
  const cikInt = (c10) => String(Number(c10));
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dayMonth = (d) => Number(d.slice(8, 10)) + ' ' + MONTHS[Number(d.slice(5, 7)) - 1];
  const usd = (v) => {
    const a = Math.abs(v);
    const s = a >= 1e9 ? (a / 1e9).toFixed(a >= 1e11 ? 0 : 1).replace(/\.0$/, '') + ' billion' : a >= 1e6 ? (a >= 1e8 ? Math.round(a / 1e6) : (a / 1e6).toFixed(1).replace(/\.0$/, '')) + ' million' : U.money(a).replace(/^\$/, '');
    return '$' + s;
  };
  const normName = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|inc|incorporated|corp|corporation|co|company|plc|ltd|limited|holdings?|group|sa|nv|ag)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const nameOf = (entity, secName) => {
    const label = String(entity.label || '').trim();
    if (!secName) return label || 'This company';
    if (!label || normName(label) === normName(secName)) return label || secName;
    return label + ' (listed with the SEC as ' + secName + ')';
  };

  /* ---------- financials ----------
     Total-revenue tags only, in priority order. Component tags (SalesRevenueGoodsNet, SalesRevenueServicesNet) are left out:
     they can be one part of revenue and would draw a false drop when joined to a total. */
  const REVENUE_TAGS = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet'];
  const conceptUrl = (c10, tag) => 'https://data.sec.gov/api/xbrl/companyconcept/CIK' + c10 + '/us-gaap/' + tag + '.json';
  const ANNUAL_FORMS = /^10-K(\/A)?$/;
  const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;

  /* Annual rows from one companyconcept response: 10-K forms, full-year duration (350 to 380 days), ended by `now`.
     Quarterly rows inside a 10-K are dropped by the duration test. */
  function annualRows(j, tag, now) {
    const rows = (((j || {}).units || {}).USD || []);
    const today = U.iso(now);
    const out = [];
    for (const r of rows) {
      if (!r || !ANNUAL_FORMS.test(String(r.form || ''))) continue;
      const v = U.num(r.val); const start = String(r.start || ''), end = String(r.end || '');
      if (v == null || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) continue;
      const d = days(start, end); if (!(d >= 350 && d <= 380)) continue;
      if (end > today) continue; // an unfinished fiscal year
      out.push({ tag, end, v, fy: U.num(r.fy), filed: String(r.filed || ''), accn: String(r.accn || '') });
    }
    return out;
  }
  /* The fiscal-year label for a period end. A year that ends in the first week of January is the year before (52/53-week years).
     The company's own naming (Nvidia: the year ending January 2026 is fiscal 2026; Target: the year ending February 2025 is fiscal 2024)
     comes from one offset: the `fy` of the latest 10-K against the end of its latest period. One offset for every year, because
     older filings can carry a different `fy` for the same kind of period (Nvidia's 10-Ks before 2015 did), which would open false gaps. */
  const endYear = (end) => { const y = Number(end.slice(0, 4)); return end.slice(5, 7) === '01' && Number(end.slice(8, 10)) <= 7 ? y - 1 : y; };
  function fiscalLabels(rows) {
    let latest = null; const ends = new Map();
    for (const r of rows) { const e = ends.get(r.accn); if (!e || r.end > e.end) ends.set(r.accn, r); }
    for (const r of ends.values()) if (r.fy && (!latest || r.filed > latest.filed || (r.filed === latest.filed && r.end > latest.end))) latest = r;
    let off = latest ? latest.fy - endYear(latest.end) : 0;
    if (off < -1 || off > 1) off = 0;
    return (end) => endYear(end) + off;
  }
  /* One value per fiscal year: the most recent filing wins (restated figures), then the tag priority. Never summed.
     Two tags are joined into one series only when they agree (within 2%) on a year both report: a tag that stops in one year and
     another that starts in the next may measure different things, and joining them would draw a rise or fall that is not there.
     With no agreeing year, only the tag that reports the latest year is used. */
  function yearly(rows) {
    const label = fiscalLabels(rows);
    const tags = [...new Set(rows.map((r) => r.tag))];
    if (tags.length > 1) {
      const per = new Map(tags.map((t) => [t, new Map()]));
      for (const r of rows) { const m = per.get(r.tag); const y = label(r.end); const cur = m.get(y); if (!cur || r.filed > cur.filed) m.set(y, r); }
      const latestOf = (t) => Math.max(...per.get(t).keys());
      const main = tags.slice().sort((a, b) => latestOf(b) - latestOf(a) || REVENUE_TAGS.indexOf(a) - REVENUE_TAGS.indexOf(b))[0];
      const agrees = (t) => [...per.get(t).keys()].some((y) => per.get(main).has(y) && Math.abs(per.get(t).get(y).v - per.get(main).get(y).v) <= 0.02 * Math.abs(per.get(main).get(y).v || 1));
      rows = rows.filter((r) => r.tag === main || agrees(r.tag));
    }
    const best = new Map();
    for (const r of rows) {
      const y = label(r.end); const cur = best.get(y);
      const better = !cur || r.filed > cur.filed || (r.filed === cur.filed && REVENUE_TAGS.indexOf(r.tag) < REVENUE_TAGS.indexOf(cur.tag));
      if (better) best.set(y, Object.assign({ y }, r));
    }
    return best;
  }
  // a continuous run of fiscal years; a year with no figure stays null
  function toPoints(byYear) {
    const ys = [...byYear.keys()].sort((a, b) => a - b); if (!ys.length) return [];
    const pts = []; for (let y = ys[0]; y <= ys[ys.length - 1]; y++) pts.push({ t: String(y), v: byYear.has(y) ? byYear.get(y).v : null });
    return pts.slice(-15);
  }

  X.register({
    id: 'sec_financials',
    basis: 'records',
    scope: 'entity',
    label: 'Revenue reported to the SEC',
    question: 'What has this company reported to the SEC?',
    applies: (entity) => !!cik10(entity),
    sends: (entity) => 'the SEC company number of ' + (entity.label || 'this company') + ' to the SEC',
    sec: { REVENUE_TAGS, annualRows, yearly, toPoints },
    async run(entity, f, io, now) {
      const c10 = cik10(entity); if (!c10) return null;
      now = now || new Date();
      const get = async (tag) => { const r = await io.get(conceptUrl(c10, tag), { accept: 'application/json' }); if (!r || r.status !== 200) return null; const j = U.json(r.text); return j && j.units ? j : null; };
      // 1 and 2: the two tags that carry total revenue for most filers since 2009 (the second since 2018)
      const a = await get(REVENUE_TAGS[0]); const b = await get(REVENUE_TAGS[1]);
      let rows = annualRows(a, REVENUE_TAGS[0], now).concat(annualRows(b, REVENUE_TAGS[1], now));
      const secName = String((a && a.entityName) || (b && b.entityName) || '');
      let byYear = yearly(rows);
      const lastEnd = rows.reduce((m, r) => (r.end > m ? r.end : m), '');
      let ni = null; let name = secName;
      // 3: when neither tag reaches the last two years, the company may use the third tag; otherwise net income
      if (!lastEnd || days(lastEnd, U.iso(now)) > 2 * 366) {
        const c = await get(REVENUE_TAGS[2]);
        if (c) { rows = rows.concat(annualRows(c, REVENUE_TAGS[2], now)); byYear = yearly(rows); name = name || String(c.entityName || ''); }
      } else {
        const n = await get('NetIncomeLoss');
        if (n) { const nr = yearly(annualRows(n, 'NetIncomeLoss', now)); ni = nr; }
      }
      const points = toPoints(byYear);
      if (!U.validSeries(points, U.MIN_YEARS)) return null;
      const known = points.filter((p) => p.v != null);
      const last = known[known.length - 1];
      if (!(last.v > 0)) return null;
      let peak = known[0]; for (const p of known) if (p.v > peak.v) peak = p;
      const lastRow = byYear.get(Number(last.t));
      const n = ni && ni.get(Number(last.t));
      const sameYear = n && lastRow && Math.abs(days(n.end, lastRow.end)) <= 14;
      const who = nameOf(entity, name);
      const niText = sameYear ? (n.v < 0 ? ' and a net loss of ' + usd(n.v) : ' and net income of ' + usd(n.v)) : '';
      const cmp = peak.t !== last.t ? 'revenue was ' + usd(peak.v) + ' in fiscal ' + peak.t + ', the highest year shown' : 'revenue was ' + usd(known[0].v) + ' in fiscal ' + known[0].t;
      const gaps = points.filter((p) => p.v == null).length;
      return { chart: {
        id: 'sec_financials', basis: 'records', question: 'What has this company reported to the SEC?',
        title: 'Revenue: ' + (name || entity.label || 'company'),
        sentence: who + ' reported ' + usd(last.v) + ' in revenue for fiscal ' + last.t + niText + ' (SEC annual report); ' + cmp + '.',
        kind: 'bars', resolution: 'year', points, unit: 'US dollars', nominal: true,
        note: gaps ? 'Fiscal years, as tagged in 10-K filings; ' + gaps + (gaps === 1 ? ' year has' : ' years have') + ' no tagged revenue figure and ' + (gaps === 1 ? 'is' : 'are') + ' left blank.' : 'Fiscal years, as tagged in 10-K filings; a later filing\'s restated figure replaces the first one.',
        source: { name: 'SEC EDGAR (10-K financial data)', url: 'https://www.sec.gov/edgar/browse/?CIK=' + cikInt(c10) }
      }, facts: [] };
    }
  });

  /* ---------- filings ---------- */
  const ITEMS = {
    '1.01': 'entry into a material agreement', '1.02': 'end of a material agreement', '1.03': 'bankruptcy or receivership', '1.04': 'mine safety report',
    '1.05': 'cybersecurity incident', '2.01': 'completed acquisition or sale of assets', '2.02': 'results of operations', '2.03': 'new debt or financial obligation',
    '2.04': 'event that speeds up a debt obligation', '2.05': 'costs of exit or restructuring', '2.06': 'write-down of assets',
    '3.01': 'delisting notice or failure to meet a listing rule', '3.02': 'unregistered sale of shares', '3.03': 'change to shareholders\' rights',
    '4.01': 'change of auditor', '4.02': 'earlier financial statements no longer reliable (restatement)', '5.01': 'change in control of the company',
    '5.02': 'departure or appointment of a director or senior officer', '5.03': 'change to articles, bylaws or fiscal year', '5.04': 'pause in employee benefit plan trading',
    '5.05': 'change to code of ethics', '5.06': 'change in shell company status', '5.07': 'results of a shareholder vote', '5.08': 'shareholder director nominations',
    '7.01': 'disclosure to investors (Regulation FD)', '8.01': 'other events'
  };
  const HIGH_ITEMS = new Set(['1.01', '1.02', '1.03', '1.05', '2.01', '2.05', '2.06', '3.01', '4.01', '4.02', '5.01', '5.02']);
  const FORMS = {
    '10-K': 'annual report', '10-K/A': 'amended annual report', '10-Q': 'quarterly report', '10-Q/A': 'amended quarterly report',
    '20-F': 'annual report (foreign company)', '40-F': 'annual report (Canadian company)', '6-K': 'report of a foreign company',
    'S-1': 'registration of new shares', 'S-1/A': 'amended registration of new shares', 'F-1': 'registration of new shares (foreign company)',
    'S-4': 'registration of shares for a merger or exchange', 'F-4': 'registration of shares for a merger or exchange',
    'DEF 14A': 'proxy statement for a shareholder meeting', 'DEFM14A': 'proxy statement for a merger vote', 'PREM14A': 'draft proxy statement for a merger vote',
    'SC TO-T': 'tender offer for the company\'s shares', 'SC TO-I': 'offer by the company to buy back shares', 'SC 14D9': 'response to a tender offer',
    'SC 13D': 'investor\'s report of a stake of more than 5%', 'SC 13D/A': 'update to an investor\'s report of a stake of more than 5%',
    'SCHEDULE 13D': 'investor\'s report of a stake of more than 5%', 'SCHEDULE 13D/A': 'update to an investor\'s report of a stake of more than 5%',
    '25-NSE': 'exchange notice removing one of its securities from listing', '25': 'notice removing one of its securities from listing', '15-12B': 'end of SEC registration of its shares',
    '15-12G': 'end of SEC registration of its shares', '15-15D': 'suspension of SEC reporting', 'NT 10-K': 'notice of a late annual report', 'NT 10-Q': 'notice of a late quarterly report',
    'NT 20-F': 'notice of a late annual report'
  };
  const HIGH_FORMS = new Set(['S-1', 'F-1', 'S-4', 'F-4', 'DEFM14A', 'PREM14A', 'SC TO-T', 'SC TO-I', 'SC 14D9', 'SC 13D', 'SCHEDULE 13D', '25-NSE', '25', '15-12B', '15-12G', '15-15D', 'NT 10-K', 'NT 10-Q', 'NT 20-F', '10-K/A']);
  /* What a filing is, in plain words, and how much a reader would care: 2 an event, 1 a regular report, 0 routine (left out). */
  function describe(form, items) {
    form = String(form || '').trim();
    if (form === '8-K' || form === '8-K/A') {
      const codes = String(items || '').split(/[,\s]+/).filter((c) => ITEMS[c]);
      const named = codes.filter((c) => c !== '8.01' || codes.length === 1);
      const high = codes.some((c) => HIGH_ITEMS.has(c));
      if (!named.length) return { text: form + ': current report', weight: 1 };
      return { text: form + ': ' + named.map((c) => ITEMS[c]).join('; '), weight: high ? 2 : 1, event: high ? ITEMS[codes.find((c) => HIGH_ITEMS.has(c))] : '' };
    }
    if (FORMS[form]) return { text: form + ': ' + FORMS[form], weight: HIGH_FORMS.has(form) ? 2 : 1, event: HIGH_FORMS.has(form) ? FORMS[form] : '' };
    return { text: form, weight: 0 }; // insider forms (3, 4, 5, 144), 13G stakes, prospectus pages, S-8, letters and the rest
  }
  const indexUrl = (c10, accn) => 'https://www.sec.gov/Archives/edgar/data/' + cikInt(c10) + '/' + accn.replace(/-/g, '') + '/' + accn + '-index.htm';
  const prevMonth = (m) => { const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)); return mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0'); };
  const monthName = (m) => MONTHS[Number(m.slice(5, 7)) - 1];

  X.register({
    id: 'sec_filings',
    basis: 'records',
    scope: 'entity',
    label: 'Recent SEC filings',
    question: 'What has this company filed with the SEC lately?',
    applies: (entity) => !!cik10(entity),
    sends: (entity) => 'the SEC company number of ' + (entity.label || 'this company') + ' to the SEC',
    sec: { describe },
    async run(entity, f, io, now, o) {
      const c10 = cik10(entity); if (!c10) return null;
      now = now || new Date(); o = o || {};
      const r = await io.get('https://data.sec.gov/submissions/CIK' + c10 + '.json', { accept: 'application/json' });
      if (!r || r.status !== 200) return null;
      const j = U.json(r.text); const rec = j && j.filings && j.filings.recent;
      if (!rec || !Array.isArray(rec.form) || !Array.isArray(rec.filingDate) || !Array.isArray(rec.accessionNumber)) return null;
      const today = U.iso(now);
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(o.month || '')) ? String(o.month) : '';
      let from, to;
      if (month) { from = prevMonth(month) + '-01'; to = month + '-31'; } else { from = U.iso(U.daysAgo(now, 365)); to = today; }
      // `recent` holds the latest 1,000 filings or one year; an older month sits in the extra files it lists, which this source does not fetch
      const oldest = rec.filingDate.reduce((m, d) => (d && d < m ? d : m), '9999');
      if (month && oldest > from && ((j.filings.files || []).length > 0 || rec.filingDate.length >= 1000)) return null;
      const all = [];
      for (let i = 0; i < rec.form.length; i++) {
        const d = String(rec.filingDate[i] || ''); const accn = String(rec.accessionNumber[i] || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{10}-\d{2}-\d{6}$/.test(accn) || d < from || d > to || d > today) continue;
        const k = describe(rec.form[i], (rec.items || [])[i]); if (!k.weight) continue;
        all.push({ t: d, text: k.text, url: indexUrl(c10, accn), weight: k.weight, event: k.event || '' });
      }
      if (!all.length) return null;
      all.sort((a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : 0));
      const events = all.filter((x) => x.weight === 2);
      const pick = events.slice(0, 6).concat(all.filter((x) => x.weight === 1).slice(0, Math.max(0, 6 - events.length)));
      pick.sort((a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : 0));
      const rows = pick.map((x) => ({ t: x.t, text: x.text, url: x.url }));
      const who = nameOf(entity, String(j.name || ''));
      const when = month ? (month.slice(0, 4) === prevMonth(month).slice(0, 4) ? 'in ' + monthName(prevMonth(month)) + ' and ' + monthName(month) + ' ' + month.slice(0, 4) : 'in ' + monthName(prevMonth(month)) + ' ' + prevMonth(month).slice(0, 4) + ' and ' + monthName(month) + ' ' + month.slice(0, 4)) : (oldest > from && ((j.filings.files || []).length > 0 || rec.filingDate.length >= 1000) ? 'since ' + dayMonth(oldest) + ' ' + oldest.slice(0, 4) + ' (the SEC\'s list of its recent filings goes back no further)' : 'in the 12 months to ' + dayMonth(today) + ' ' + today.slice(0, 4));
      const ev = events[0];
      const art = (w) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
      const incl = ev ? ', including ' + art(ev.event) + ' on ' + dayMonth(ev.t) + (ev.t.slice(0, 4) !== to.slice(0, 4) || month ? ' ' + ev.t.slice(0, 4) : '') : '; the latest is ' + art(all[0].text.replace(/^[^:]+: /, '')) + ' on ' + dayMonth(all[0].t) + ' ' + all[0].t.slice(0, 4);
      return { chart: {
        id: 'sec_filings', basis: 'records', question: 'What has this company filed with the SEC lately?',
        title: 'SEC filings: ' + (j.name || entity.label || 'company'),
        sentence: who + ' filed ' + all.length + (all.length === 1 ? ' report' : ' reports') + ' with the SEC ' + when + incl + '.',
        kind: 'list', resolution: 'day', points: [], rows, unit: 'filings',
        note: 'Insider trading forms, ownership forms under 5% and routine registration papers are left out; the item codes say what kind of event a report covers, not what it says.',
        source: { name: 'SEC EDGAR', url: 'https://www.sec.gov/edgar/browse/?CIK=' + cikInt(c10) }
      }, facts: [] };
    }
  });
  return X;
});
