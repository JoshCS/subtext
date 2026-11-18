/* Subtext context source: finances a US nonprofit reports to the IRS (Form 990 extracts via ProPublica Nonprofit Explorer).
   Looked up by tax ID only, never by name. The tax ID comes from Wikidata, from one exact-name lookup, or from the page itself
   (entity.einFrom === 'page': the router took it from the page's footer, and only after this filer's name agreed with the site's
   Wikidata label or with its address. Another site can still register an address that matches a filer's name, so the chart then
   carries a `relation` line that says what is known and no more: the page prints this ID, and these are the filings under it. The
   note also says where the ID was read). One legal filer per chart: sibling entities (a 501(c)(3) fund and a 501(c)(4)
   action fund) file separately and are never merged or searched for. Contract: docs/CONTEXT-CONTRACT.md.
   Response shape (probed 17 Nov 2026, api_version 2): { organization: { ein (integer, leading zero lost), name (IRS legal name),
   city, state, subsection_code }, filings_with_data: [{ tax_prd (YYYYMM, end of the period), tax_prd_yr (year the period ends),
   formtype (0 = 990, 1 = 990-EZ, 2 = 990-PF), totrevenue, totfuncexpns, totnetassetend (990) | totnetassetsend (990-EZ) }],
   filings_without_data: [{ tax_prd, tax_prd_yr, formtype, pdf_url }] } (returns listed as PDFs, figures not extracted yet). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./context-data.js'));
  else factory(root.SubtextContextData);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (X) {
  'use strict';
  const U = X.util;
  const API = 'https://projects.propublica.org/nonprofits/api/v2/organizations/';
  const PAGE = 'https://projects.propublica.org/nonprofits/organizations/';
  const FORMS = { 0: 'Form 990', 1: 'Form 990-EZ', 2: 'Form 990-PF' };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // a US tax ID is nine digits; Wikidata writes it as 12-3456789 and ProPublica drops a leading zero
  const einOf = (entity) => {
    const d = String((entity && entity.ein) || '').replace(/[\s-]/g, '');
    return /^\d{8,9}$/.test(d) ? d.padStart(9, '0') : '';
  };
  const dashed = (ein) => ein.slice(0, 2) + '-' + ein.slice(2);
  // "2023" for a calendar year, "the fiscal year ending March 2024" otherwise
  const period = (p) => (p.month === 12 || !p.month ? p.t : 'the fiscal year ending ' + MONTHS[p.month - 1] + ' ' + p.t);

  X.register({
    id: 'nonprofit_finances',
    basis: 'records',
    scope: 'entity',
    label: 'Finances reported to the IRS',
    question: 'What does this organization report to the IRS?',
    applies: (entity) => !!einOf(entity),
    sends: (entity) => 'the tax ID of ' + ((entity && entity.label) || 'this organization') + ' to ProPublica Nonprofit Explorer',
    async run(entity, f, io, now) {
      const ein = einOf(entity);
      if (!ein) return null;
      now = now || new Date();
      const r = await io.get(API + ein + '.json', { accept: 'application/json' });
      if (!r || r.status !== 200) return null;
      const d = U.json(r.text);
      const org = d && d.organization;
      if (!org || U.num(org.ein) !== Number(ein)) return null; // identity first: the record must be this tax ID
      const legal = String(org.name || '').slice(0, 400).replace(/\s+/g, ' ').trim(); // a feed string is cut before it is cleaned
      if (!legal) return null;

      // one row per year the period ends; drop periods that have not ended yet
      const cur = now.toISOString().slice(0, 7).replace('-', '');
      const years = new Map(); const split = new Set();
      for (const x of Array.isArray(d.filings_with_data) ? d.filings_with_data : []) {
        const prd = String(U.num(x && x.tax_prd) || ''); const y = U.num(x && x.tax_prd_yr);
        if (!/^\d{6}$/.test(prd) || !y || prd >= cur) continue;
        const prev = years.get(y);
        if (prev && prev.prd !== prd) { split.add(y); continue; } // two periods ending in one year (a change of fiscal year)
        if (prev) continue; // an amended copy of the same period: keep the first listed
        const form = U.num(x.formtype);
        years.set(y, { prd, month: Number(prd.slice(4)), form,
          rev: U.num(x.totrevenue), exp: U.num(x.totfuncexpns),
          net: form === 0 ? U.num(x.totnetassetend) : form === 1 ? U.num(x.totnetassetsend) : null });
      }
      for (const y of split) years.set(y, Object.assign({}, years.get(y), { rev: null, exp: null, net: null }));
      // a return that ends in a different month from the year before covers a short period (a change of fiscal year): not a full year's figure
      { const ys = [...years.keys()].sort((a, b) => a - b); for (let i = 1; i < ys.length; i++) { const a = years.get(ys[i - 1]), b = years.get(ys[i]); if (ys[i] - ys[i - 1] === 1 && a.month && b.month && a.month !== b.month) years.set(ys[i], Object.assign({}, b, { rev: null, exp: null, net: null })); } }
      const withFig = [...years.entries()].filter(([, v]) => v.rev != null).sort((a, b) => a[0] - b[0]);
      if (withFig.filter(([, v]) => v.rev !== 0).length < U.MIN_YEARS) return null; // six years of $0 are not a revenue history

      // every year from the first to the last figure; a year with no figure stays null (drawn as a gap, never as $0)
      const first = withFig[0][0], last = withFig[withFig.length - 1][0];
      const points = [];
      for (let y = first; y <= last; y++) { const v = years.get(y); points.push({ t: String(y), v: v && v.rev != null ? v.rev : null }); }
      const L = Object.assign({ t: String(last) }, years.get(last)); const F = Object.assign({ t: String(first) }, years.get(first));
      const form = FORMS[L.form] || 'Form 990';

      let sentence = legal + ' reported ' + U.money(L.rev) + ' in revenue for ' + period(L) + ' on its IRS ' + form;
      sentence += L.exp != null ? ', and ' + U.money(L.exp) + ' in expenses.' : '.';
      sentence += ' For ' + period(F) + ' it reported ' + U.money(F.rev) + ' in revenue.';
      const gaps = points.filter((p) => p.v == null).map((p) => p.t);
      if (gaps.length) sentence += ' No figure is listed for ' + (gaps.length === 1 ? gaps[0] : gaps.slice(0, -1).join(', ') + ' and ' + gaps[gaps.length - 1]) + '.';

      const source = { name: 'ProPublica Nonprofit Explorer (IRS Form 990)', url: PAGE + ein };
      const chart = {
        id: 'nonprofit_finances', basis: 'records', question: 'What does this organization report to the IRS?',
        title: 'Revenue: ' + legal, sentence, kind: 'bars', resolution: 'year', points, unit: 'US dollars', nominal: true,
        // a tax ID read from the page: say so, and say which name the IRS has for it, so a reader can compare the two
        note: entity.einFrom === 'page' ? 'The tax ID ' + dashed(ein) + ' was read from this page. The IRS lists it as ' + legal + '. These are the filings of that one legal entity; related organizations may file separately.'
          : 'These are the filings of one legal entity, tax ID ' + dashed(ein) + '. Related organizations may file separately.',
        source
      };

      if (entity.einFrom === 'page') {
        // the legal name is cut at a word when the line (240 characters) would not hold both sentences
        const lead = 'This page prints the tax ID ' + dashed(ein) + '. IRS filings under that ID are from '; const room = 240 - lead.length - 1;
        const cut = legal.slice(0, room - 1); const sp = cut.lastIndexOf(' ');
        const shown = legal.length <= room ? legal : (sp > 20 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '') + '\u2026';
        chart.relation = lead + shown + (/[.!?]$/.test(shown) ? '' : '.');
      }

      const facts = [];
      const sub = U.num(org.subsection_code);
      if (sub && Number.isInteger(sub) && sub >= 2 && sub <= 29) {
        facts.push({ id: 'nonprofit_subsection', label: 'Tax-exempt status', text: 'The IRS lists ' + legal + ' as exempt under section 501(c)(' + sub + ').',
          links: [{ text: 'Filings on ProPublica', url: PAGE + ein }], note: 'The status of this tax ID only.', source });
      }
      if (L.net != null) {
        facts.push({ id: 'nonprofit_net_assets', label: 'Net assets', text: legal + ' reported ' + U.money(L.net) + ' in net assets at the end of ' + (L.month === 12 || !L.month ? L.t : MONTHS[L.month - 1] + ' ' + L.t) + '.',
          links: [{ text: 'Filings on ProPublica', url: PAGE + ein }], note: 'Not adjusted for inflation.', source });
      }
      return { chart, facts: facts.slice(0, 2) };
    }
  });
  return X;
});
